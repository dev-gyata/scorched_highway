// The host: runs the lobby and the match. The match runs exactly as in single-player (game/match.js); the host
// drives each guest's car with the controls that guest sends, and twenty times a second sends everyone a snapshot
// of where everything is, along with what happened since the last one (effects, feed lines, messages). It never
// touches the DOM or the screen, only the match and the transport, so it could run on a server one day.
import { AI } from '../ai/ai.js';
import { CARS } from '../cars/roster.js';
import { ALL, type GameEvent, emit } from '../engine/events';
import { resultsView } from '../game/results';
import { G } from '../game/state.js';
import type { Car } from '../modes/types';
import { migrated, saveCheckpoint } from './migrate';
import { INPUT, type Input, decodeInput, encodeSnap, kindOf } from './protocol';
import { type Role, S, beginMatch, broadcast, hostOpts, now, others, pidOf, seatsFor, send, sendBytes } from './session';
import { PROTOCOL, type Player } from './types';

/** Snapshots a second, and checkpoints (for a new host to carry on from, see migrate.ts). */
const SNAP_RATE = 20, CHECKPOINT_EVERY = 1;
export const MAX_PLAYERS = 6;

/** Become the host (of a new room, or of a match already going when the host before left: migrate.ts). */
export function hostRole(): Role {
  const last = new Map<string, Input>(); // each guest's latest controls
  let seq = 0, snapT = 0, ckT = 0, events: GameEvent[] = [], over = G.state === 'over';
  const playing = () => !!S?.seats && (G.state === 'playing' || G.state === 'paused' || G.state === 'over');
  return {
    name: 'host',
    event(e) { if (playing()) events.push(e); },
    message(from, m) {
      if (!S) return;
      if (m instanceof ArrayBuffer) { if (kindOf(m) === INPUT) steer(from, decodeInput(m)); return; }
      if (m.t === 'hello') {
        if (m.v !== PROTOCOL) { send(from, { t: 'busy', why: 'That game is on a different version. Reload the page and try again.' }); return; }
        if (S.seats) { send(from, { t: 'busy', why: 'That game has already started.' }); return; }
        if (S.players.length >= MAX_PLAYERS) { send(from, { t: 'busy', why: 'That game is full.' }); return; }
        const p: Player = { id: from, name: clean(m.name), car: m.car, ready: false, desktop: m.desktop, ping: 0 };
        // desktops before phones (after the host): the order in which players would take over hosting
        const at = m.desktop ? S.players.findIndex((q, i) => i > 0 && !q.desktop) : -1;
        if (at > 0) S.players.splice(at, 0, p); else S.players.push(p);
        shareLobby();
      } else if (m.t === 'me') {
        const p = S.players.find(q => q.id === from); if (!p || S.seats) return;
        if (m.name != null) p.name = clean(m.name);
        if (m.car != null && CARS.some(d => d.id === m.car)) p.car = m.car;
        if (m.ready != null) p.ready = m.ready;
        shareLobby();
      } else if (m.t === 'migrated') migrated(from); // another player took over too: whoever comes first in line keeps it
      else if (m.t === 'bye') S.t.drop(from);
    },
    frame(rdt) {
      if (!S) return;
      for (const p of S.players) p.ping = Math.round(S.rtt.get(p.id) || 0);
      if (!playing()) return;
      if ((snapT -= rdt) <= 0) {
        snapT += 1 / SNAP_RATE; if (snapT < 0) snapT = 0;
        const snap = encodeSnap(seq++, now());
        for (const p of others()) { sendBytes(p.id, snap); deliver(p.id, events); }
        events = [];
      }
      if ((ckT -= rdt) <= 0) { ckT = CHECKPOINT_EVERY; saveCheckpoint(); }
      // the match just ended: everyone gets their own results
      if (G.state === 'over' && !over) for (const p of others()) { const c = G.cars[pidOf(p.id)] as Car; if (c) send(p.id, { t: 'over', r: resultsView(c) }); }
      over = G.state === 'over';
    },
    closed(id) {
      if (!S) return;
      const i = S.players.findIndex(p => p.id === id); if (i < 0) return;
      const who = S.players[i]; S.players.splice(i, 1); last.delete(id);
      if (S.seats) retire(pidOf(id), who.name);
      shareLobby();
    },
  };
  /** Drive a guest's car with the controls it sent; a one-shot press counts once, when its counter moves. */
  function steer(from: string, i: Input) {
    const c = G.cars[pidOf(from)] as Car & { ctl: Record<string, number | boolean> | null }; if (!c?.ctl) return;
    const prev = last.get(from);
    if (prev && ((i.seq - prev.seq) & 0xffff) >= 0x8000) return; // older than what we have: it arrived late
    last.set(from, i);
    const k = c.ctl;
    k.throttle = i.throttle; k.steer = i.steer; k.handbrake = i.handbrake; k.mg = i.mg; k.w = i.w; k.aim = i.aim;
    if (!prev || i.prefN !== prev.prefN) k.pref = i.pref;
    if (!prev) return;
    if (i.fire !== prev.fire) { k.fire = true; k.combo = i.combo; }
    if (i.special !== prev.special) k.special = true;
    if (i.cycle !== prev.cycle) k.cycle = i.cycleDir;
    if (i.flip !== prev.flip) k.flip = true;
  }
}
/** Names come from other players: short, plain text. */
const clean = (s: string) => [...String(s || '')].filter(ch => ch >= ' ' && ch !== '<' && ch !== '>').join('').trim().slice(0, 16) || 'Driver';

/** Tell everyone who's in the room. */
export function shareLobby() {
  if (!S) return;
  S.opts = hostOpts();
  broadcast({ t: 'lobby', code: S.code, host: S.me, players: S.players, opts: S.opts });
  S.onlobby();
}
/** Start a match for everyone in the room. */
export function startOnline() {
  if (!S) return;
  const seats = seatsFor(S.players, hostOpts(), CARS.map(d => d.id));
  broadcast({ t: 'start', seats, opts: hostOpts() });
  beginMatch(seats, hostOpts(), false);
}
/** Back to the lobby, everyone. */
export function lobbyOnline() {
  if (!S) return;
  S.seats = null; broadcast({ t: 'lobbyback' }); shareLobby();
}
/** A player left mid-match: a bot takes their car if bots fill the field; otherwise the car drops out. */
export function retire(pid: number, name: string) {
  const c = G.cars[pid] as (Car & { ctl: unknown; wreck(): void }) | undefined; if (!c || !S?.seats) return;
  c.human = false; c.ctl = null; S.seats[pid] = { car: S.seats[pid].car, human: false, name: '' };
  emit({ kind: 'feed', to: ALL, text: `${name} left` });
  if (S.opts.bots === 'fill') { if (!G.ais.some((a: { car: Car }) => a.car === c)) G.ais.push(new AI(c)); }
  else if (c.alive) { c.wreck(); c.place = G.cars.filter((o: Car) => o.alive).length + 1; G.mode.wrecked(c, null); if (c.race) c.race.respawnT = 0; } // out quietly, for good
}
/** Events for one guest: everything everyone sees, plus what's meant for that guest's driver. */
function deliver(id: string, list: GameEvent[]) {
  const pid = pidOf(id), mine = list.filter(e => e.kind === 'fx' || e.kind === 'wreck' || e.to === ALL || e.to === pid);
  if (mine.length) send(id, { t: 'ev', e: mine.map(trim) });
}
/** Effects' numbers rounded to centimetres: plenty for a spark, and a third of the bytes. */
function trim(e: GameEvent): GameEvent {
  return e.kind === 'fx' ? { kind: 'fx', name: e.name, args: e.args.map(a => (typeof a === 'number' ? Math.round(a * 100) / 100 : a)) } : e;
}
