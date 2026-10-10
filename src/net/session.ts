// The online session: the room this player is in, who else is there, and which role this player has right now
// (host or guest, see types.ts). It owns the transport and passes what arrives to the role; it starts matches the
// same way on every screen; and it gives the game loop its hook (G.net).
import { onEvent, type GameEvent } from '../engine/events';
import { isTouch } from '../engine/util.js';
import { tick } from '../game/loop.js';
import { endMatch, startMatch } from '../game/match.js';
import { G, saveSettings } from '../game/state.js';
import type { ResultsView } from '../game/results';
import { localTransport } from './local';
import { peerTransport } from './peer';
import { type MatchOpts, type Msg, PROTOCOL, type Player, type Seat, type Transport } from './types';

/** A role: what this player does with what arrives, every frame, and when someone's link drops. */
export interface Role {
  name: 'host' | 'guest';
  message(from: string, m: Msg | ArrayBuffer): void;
  frame(rdt: number): void;
  closed(id: string): void;
  event?(e: GameEvent): void;
  /** Guests: mirror the host's match this frame (instead of running it). */
  replica?(dt: number, rdt: number): void;
  /** Guests: a new host has taken over; start listening to it afresh. */
  rehost?(): void;
  /** Stop: this player is switching roles (or leaving). */
  dispose?(): void;
}
export interface Session {
  t: Transport; code: string; me: string; host: string; role: Role;
  players: Player[]; opts: MatchOpts;
  /** The match being played, if one is (seats in pid order), and its people in lobby order: the line to take over as host. */
  seats: Seat[] | null; line: string[];
  /** The room's code and link no longer reach it: the host who opened it left, and its address couldn't be taken over. */
  shut: boolean;
  /** When each link was last heard from (s), and its round trip (ms). */
  heard: Map<string, number>; rtt: Map<string, number>;
  /** Called when the lobby changes (lobby.ts redraws), and when a match starts. */
  onlobby: () => void; onstart: () => void;
  /** Called when the session ends, with a reason when it wasn't this player's choice. */
  onend: (why?: string) => void;
}
export let S: Session | null = null;

export const ROOM = 'scorched-hwy-';
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as 1 and 0
export const newCode = () => Array.from({ length: 5 }, () => CODE_LETTERS[Math.random() * CODE_LETTERS.length | 0]).join('');
export const now = () => performance.now() / 1000;

/** ?net=local plays between tabs of this browser (local.ts); otherwise over the internet (peer.ts). */
export function openTransport(id: string): Promise<Transport> {
  const q = new URLSearchParams(location.search);
  return q.get('net') === 'local' ? localTransport(id, +(q.get('lag') || 0)) : peerTransport(id);
}
/** This player as the lobby lists them. */
export const meAsPlayer = (id: string): Player => ({ id, name: G.settings.name || 'Driver', car: G.settings.car, ready: false, desktop: !isTouch, ping: 0 });
/** What the host has picked, from its settings. */
export const hostOpts = (): MatchOpts => ({ mode: G.settings.mode, map: G.settings.map, difficulty: +G.settings.difficulty, tod: G.settings.tod, bots: G.settings.bots === 'off' ? 'off' : 'fill' });

/** Start a session on transport `t`, as `role`. */
let own: Partial<typeof G.settings> = {};
export function begin(t: Transport, code: string, host: string, role: Role, players: Player[]): Session {
  S = { t, code, me: t.id, host, role, players, opts: hostOpts(), seats: null, line: [], shut: false, heard: new Map(), rtt: new Map(), onlobby: () => { }, onstart: () => { }, onend: () => { } };
  own = role.name === 'guest' ? { mode: G.settings.mode, map: G.settings.map, difficulty: G.settings.difficulty, tod: G.settings.tod } : {}; // a guest plays the host's choices, then gets its own back
  // Messages come from other people's games: anything that isn't what we expect, or trips us up, is dropped
  // rather than allowed to stop this game.
  t.onmessage = (from, data) => {
    if (!S) return;
    S.heard.set(from, now());
    try {
      if (data instanceof ArrayBuffer) { if (data.byteLength) S.role.message(from, data); return; }
      if (typeof data !== 'string' || data.length > 200_000) return;
      const m = JSON.parse(data) as Msg; if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (m.t === 'hb') { send(from, { t: 'pong', at: +m.at || 0 }); return; }
      if (m.t === 'pong') { const rtt = performance.now() - +m.at; if (rtt >= 0 && rtt < 10_000) S.rtt.set(from, rtt); return; }
      S.role.message(from, m);
    } catch (e) { console.warn('Dropped a message from', from, e); }
  };
  t.onopen = id => { S?.heard.set(id, now()); };
  t.onclose = id => { S?.role.closed(id); };
  G.net = hook;
  return S;
}
/** Leave the room (`why` says why, when it wasn't this player's choice). */
export function end(why?: string) {
  if (!S) return;
  const s = S; S = null; s.role.dispose?.(); closeDoor();
  for (const id of s.t.links()) s.t.send(id, JSON.stringify({ t: 'bye' } satisfies Msg), true);
  setTimeout(() => s.t.close(), 100);
  G.net = null; G.replica = false;
  Object.assign(G.settings, own); saveSettings();
  s.onend(why);
}

/** Ask the host at `to` for a place in its room. */
export const sayHello = (to: string) => send(to, { t: 'hello', name: G.settings.name || 'Driver', car: G.settings.car, desktop: !isTouch, v: PROTOCOL });

// The room's code and link are the address of the player who opened it. When another player takes over as host
// (migrate.ts), it answers at that address too, sending whoever knocks on to its own, so the same code and link
// keep working. The address only frees up once the old host is really gone, so it tries for a while.
let door: Transport | null = null, doorTry = 0;
export function openDoor(tries = 8) {
  if (!S || door || S.me === ROOM + S.code) return;
  const s = S, n = ++doorTry, mine = () => S === s && s.role.name === 'host' && n === doorTry;
  openTransport(ROOM + s.code).then(t => {
    if (!mine()) { t.close(); return; }
    door = t; s.shut = false;
    t.onopen = from => t.send(from, JSON.stringify({ t: 'moved', to: s.me } satisfies Msg), true);
  }).catch(() => {
    if (tries > 1) setTimeout(() => { if (mine()) openDoor(tries - 1); }, 1500);
    else if (mine()) { s.shut = true; s.onlobby(); }
  });
}
export function closeDoor() { doorTry++; door?.close(); door = null; }

export const send = (to: string, m: Msg) => S?.t.send(to, JSON.stringify(m), true);
export const sendBytes = (to: string, b: ArrayBuffer, reliable = false) => S?.t.send(to, b, reliable);
export function broadcast(m: Msg) { if (!S) return; const s = JSON.stringify(m); for (const id of S.t.links()) S.t.send(id, s, true); }
/** Everyone else in the room. */
export const others = () => (S ? S.players.filter(p => p.id !== S!.me) : []);
/** A seat's pid by its player's address, and back. */
export const pidOf = (id: string) => (S?.seats ? S.seats.findIndex(s => s.id === id) : -1);
export const idOf = (pid: number) => S?.seats?.[pid]?.id;

/**
 * The seats for a match: the people in lobby order, then (if bots fill the field) bots in the other cars up to six.
 * People may pick the same car; bots never take one a person has.
 */
export function seatsFor(players: Player[], opts: MatchOpts, cars: string[]): Seat[] {
  const seats: Seat[] = players.map(p => ({ car: p.car, human: true, name: p.name, id: p.id }));
  if (opts.bots === 'fill') {
    const free = cars.filter(c => !players.some(p => p.car === c)).sort(() => Math.random() - 0.5);
    while (seats.length < 6 && free.length) seats.push({ car: free.pop()!, human: false, name: '' });
  }
  return seats;
}
/** Start a match on this screen as the host described it (host and guests alike). */
export function beginMatch(seats: Seat[], opts: MatchOpts, replica: boolean) {
  if (!S) return;
  S.seats = seats; S.opts = opts; S.line = seats.filter(s => s.id).map(s => s.id!);
  Object.assign(G.settings, { mode: opts.mode, map: opts.map, difficulty: opts.difficulty, tod: opts.tod }); // not saved: they're the host's choices
  G.replica = replica;
  S.onstart();
  startMatch(seats.map(s => ({ car: s.car, human: s.human, name: s.human ? s.name : undefined, local: s.id === S!.me })));
}
/** The match is over: show the results as this player sees them. */
export function finishMatch(view?: ResultsView) { endMatch(view); }

// heartbeats: everyone pings everyone twice a second (round trips for the lobby; silence means trouble, see migrate.ts)
let hbT = 0;
function heartbeat(rdt: number) {
  if (!S || (hbT -= rdt) > 0) return;
  hbT = 0.5;
  const m = JSON.stringify({ t: 'hb', at: performance.now() } satisfies Msg);
  for (const id of S.t.links()) S.t.send(id, m, true);
}
// A hidden tab gets no animation frames, which would freeze the match for everyone: while this player hosts a
// match from a hidden tab, a worker's timer runs the game loop instead (twenty times a second).
let keeper: Worker | null = null;
document.addEventListener('visibilitychange', () => {
  const need = document.hidden && S?.role.name === 'host' && !!S.seats;
  if (need && !keeper) {
    keeper = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
    keeper.onmessage = () => { if (document.hidden) tick(performance.now()); };
  } else if (!need && keeper) { keeper.terminate(); keeper = null; }
});
// match events go to the role (the host forwards them)
onEvent(e => S?.role.event?.(e));

/** The game loop's way in (G.net): the role's frame, and a guest's mirror of the match. */
const hook = {
  get role() { return S?.role.name; },
  frame(rdt: number) { if (!S) return; heartbeat(rdt); S.role.frame(rdt); },
  replica(dt: number, rdt: number) { S?.role.replica?.(dt, rdt); },
};
