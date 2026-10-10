// Host migration: when the host leaves in the middle of a match, the next player in lobby order takes over and the
// match goes on after a moment's freeze.
// - Once a second the host sends everyone a checkpoint: what the snapshots don't carry (engine/savestate).
// - A guest that hears nothing from the host for SILENT seconds, or whose link to it closes, counts it gone.
// - Every player works out the same successor: the first in lobby order still here (desktops come before phones,
//   see host.ts). The successor loads the checkpoint over the match it has been mirroring, gives the old host's car
//   to a bot (or takes it out) and starts hosting on the links it already has; the others wait for its word.
import { AI } from '../ai/ai.js';
import { ALL, emit } from '../engine/events';
import { loadState, saveState } from '../engine/savestate';
import { G } from '../game/state.js';
import { newControls } from '../input/input.js';
import { guestRole } from './guest';
import { hostRole, retire, shareLobby } from './host';
import { S, broadcast, closeDoor, end, now, openDoor } from './session';

/** Seconds of silence before the host counts as gone, and before a successor that never speaks up is passed over. */
export const SILENT = 1.5, WAIT = 3;
let ck: Record<string, unknown> | null = null, waiting = '', waitUntil = 0;
/** A takeover we heard of before noticing the host had gone (it's honoured once we do). */
let claim = { from: '', at: 0 };

/** Host: send everyone the checkpoint. */
export function saveCheckpoint() { if (S?.seats) broadcast({ t: 'ck', d: JSON.stringify(saveState()) }); }
/** Guest: keep the latest checkpoint. */
export function keepCheckpoint(m: { d: string }) { try { ck = JSON.parse(m.d); } catch { /* a garbled one: keep the last */ } }

/**
 * Who takes over, in order: the people in the match in lobby order, then anyone watching it. Only people in the room
 * now: an address someone left behind is free for anyone to take, so it mustn't keep its place in the line.
 */
const order = () => (S ? [...S.line.filter(id => S!.players.some(p => p.id === id)), ...S.players.map(p => p.id).filter(id => !S!.line.includes(id))] : []);
let checked = 0;
/**
 * Guest, in a match: has the host (or the successor we're waiting on) gone quiet? Only once the match is under way
 * (`started`: its first snapshot is in, so a host still building the map isn't missing), and only silence while
 * this player's own game was running counts: a stall here leaves messages waiting, not missing.
 */
export function hostSilent(started: boolean): boolean {
  if (!S?.seats || S.role.name !== 'guest' || (!started && !waiting)) return false;
  const t = now(), stalled = t - checked > 0.5; checked = t;
  if (stalled) { S.heard.set(S.host, t); if (waiting) waitUntil = Math.max(waitUntil, t + WAIT); return false; }
  if (waiting) return t > waitUntil;
  const heard = S.heard.get(S.host);
  return heard !== undefined && t - heard > SILENT;
}
/** The host is gone. In the lobby, so is the room; in a match, someone takes over. */
export function hostLost() {
  if (!S) return;
  const gone = S.host, name = S.players.find(p => p.id === gone)?.name || 'The host';
  if (!S.seats) { end(`${name} closed the game.`); return; }
  S.players = S.players.filter(p => p.id !== gone); S.line = S.line.filter(id => id !== gone); S.t.drop(gone);
  const t = now();
  const here = (id: string) => S!.players.some(p => p.id === id) && (id === S!.me || (S!.t.links().includes(id) && t - (S!.heard.get(id) ?? 0) < SILENT * 2));
  const next = S.players.find(p => p.id === order().find(here));
  if (!next || next.id === S.me) { takeOver(); return; }
  if (claim.from === next.id && t - claim.at < WAIT) { S.host = next.id; waiting = ''; S.role.rehost?.(); return; } // it already has
  S.host = next.id; waiting = next.id; waitUntil = t + WAIT; S.role.rehost?.();
}
/** A successor has taken over (`from`). If we took over too and come later in line, we hand it back. */
export function migrated(from: string) {
  const line = order();
  if (!S || !S.seats || line.indexOf(from) < 0) return; // only someone in this match's line can take it over
  // and someone only watching (anyone with the link can be) only once nobody who's playing is left to
  if (!S.line.includes(from) && S.line.some(id => id !== S!.host && id !== from && S!.players.some(p => p.id === id) && (id === S!.me || S!.t.links().includes(id)))) return;
  const hostHere = S.role.name === 'guest' && !waiting && S.host !== from && now() - (S.heard.get(S.host) ?? 0) < SILENT;
  if (hostHere) { claim = { from, at: now() }; return; } // and not while the host is still with us
  waiting = '';
  if (S.role.name === 'host') { if (line.indexOf(from) < line.indexOf(S.me)) { S.role.dispose?.(); closeDoor(); G.replica = true; S.role = guestRole(); } else return; }
  S.host = from; S.role.rehost?.();
}

/** Carry the match on from here, as host (whoever left is announced as their car is retired). */
function takeOver() {
  if (!S?.seats) return;
  waiting = '';
  S.role.dispose?.(); S.host = S.me;
  if (G.state === 'playing' || G.state === 'over') {
    G.replica = false;
    if (ck) loadState(ck);
    G.ais = [];
    S.seats.forEach((seat, pid) => {
      const c = G.cars[pid]; if (!c) return;
      if (!seat.human) { G.ais.push(new AI(c)); return; }
      if (seat.id === S!.me) return;
      if (seat.id && S!.players.some(p => p.id === seat.id)) { c.human = true; c.ctl = newControls(); } // still here: their controls will come to us now
      else retire(pid, seat.id ? seat.name : ''); // the old host, anyone who went with it, or someone who left earlier (everyone's been told)
    });
  }
  S.role = hostRole();
  broadcast({ t: 'migrated', host: S.me });
  shareLobby(); openDoor();
  const me = S.players.find(p => p.id === S!.me);
  emit({ kind: 'feed', to: ALL, text: `${me?.name || 'You'} is hosting now` });
}
