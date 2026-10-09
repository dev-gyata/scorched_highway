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
import { S, broadcast, end, now } from './session';

/** Seconds of silence before the host counts as gone, and before a successor that never speaks up is passed over. */
export const SILENT = 1.5, WAIT = 3;
let ck: Record<string, unknown> | null = null, waiting = '', waitUntil = 0;
/** A takeover we heard of before noticing the host had gone (it's honoured once we do). */
let claim = { from: '', at: 0 };

/** Host: send everyone the checkpoint. */
export function saveCheckpoint() { if (S?.seats) broadcast({ t: 'ck', d: JSON.stringify(saveState()) }); }
/** Guest: keep the latest checkpoint. */
export function keepCheckpoint(m: { d: string }) { try { ck = JSON.parse(m.d); } catch { /* a garbled one: keep the last */ } }

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
  S.players = S.players.filter(p => p.id !== gone); S.t.drop(gone);
  const t = now();
  const next = S.players.find(p => p.id === S!.me || (S!.t.links().includes(p.id) && t - (S!.heard.get(p.id) ?? 0) < SILENT * 2));
  if (!next || next.id === S.me) { takeOver(); return; }
  if (claim.from === next.id && t - claim.at < WAIT) { S.host = next.id; waiting = ''; S.role.rehost?.(); return; } // it already has
  S.host = next.id; waiting = next.id; waitUntil = t + WAIT; S.role.rehost?.();
}
/** A successor has taken over (`from`). If we took over too and come later in line, we hand it back. */
export function migrated(from: string) {
  if (!S || !S.seats || S.line.indexOf(from) < 0) return; // only someone in this match's line can take it over
  const hostHere = S.role.name === 'guest' && !waiting && S.host !== from && now() - (S.heard.get(S.host) ?? 0) < SILENT;
  if (hostHere) { claim = { from, at: now() }; return; } // and not while the host is still with us
  waiting = '';
  if (S.role.name === 'host') { if (S.line.indexOf(from) >= 0 && S.line.indexOf(from) < S.line.indexOf(S.me)) { S.role.dispose?.(); G.replica = true; S.role = guestRole(); } else return; }
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
      if (!seat.human || !seat.id) { G.ais.push(new AI(c)); return; }
      if (seat.id === S!.me) return;
      if (S!.players.some(p => p.id === seat.id)) { c.human = true; c.ctl = newControls(); } // still here: their controls will come to us now
      else retire(pid, seat.name); // the old host, or anyone else who went with it
    });
  }
  S.role = hostRole();
  broadcast({ t: 'migrated', host: S.me });
  shareLobby();
  const me = S.players.find(p => p.id === S!.me);
  emit({ kind: 'feed', to: ALL, text: `${me?.name || 'You'} is hosting now` });
}
