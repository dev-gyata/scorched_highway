// Match events: moments in a match meant for one driver's screen (or everyone's), raised by the simulation and
// shown by whoever listens. The HUD (game/hud.js) shows the ones for the car this screen follows; in an online match
// the host (src/net) also forwards them to the other players. Simulation code raises an event instead of calling the
// HUD itself, so it never needs to know whose screen it is running on.

/** Send an event to every screen rather than one driver's. */
export const ALL = -1;

export type GameEvent =
  /** Big centre-screen text. */
  | { kind: 'big'; to: number; text: string; dur: number; small?: boolean }
  /** A line in the kill feed; `mine` highlights it. `skip` leaves out one driver (who got their own message). */
  | { kind: 'feed'; to: number; text: string; mine?: boolean; skip?: number }
  /** A car was wrecked (`by` -1 when nobody did it); each screen words it for its own driver. */
  | { kind: 'wreck'; victim: number; by: number; how: string }
  /** A driver took a hit: the red vignette (and a grunt for a big one). */
  | { kind: 'hit'; to: number; amt: number }
  /** A sound only that driver hears (pickups, plates). */
  | { kind: 'sound'; to: number; name: string };

const LISTENERS: Array<(e: GameEvent) => void> = [];
export function onEvent(fn: (e: GameEvent) => void) { LISTENERS.push(fn); }
export function emit(e: GameEvent) { for (const fn of LISTENERS) fn(e); }

/** Big text for one driver (`to` a car's pid) or everyone (ALL). */
export const announce = (to: number, text: string, dur: number, small?: boolean) => emit({ kind: 'big', to, text, dur, small });
/** A highlighted feed line for one driver. */
export const tell = (to: number, text: string) => emit({ kind: 'feed', to, text, mine: true });
