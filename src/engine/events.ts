// Match events: moments in a match meant for one driver's screen (or everyone's), raised by the simulation and
// shown by whoever listens. The HUD (game/hud.js) shows the ones for the car this screen follows; in an online match
// the host (src/net) also forwards them to the other players. Simulation code raises an event instead of calling the
// HUD itself, so it never needs to know whose screen it is running on.
//
// Effects are the same idea for sights and sounds: a one-off effect (an explosion, sparks, a positional sound) is
// made with `effect`, runs where it's called and is raised as an 'fx' event, so every other screen can play it too.

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
  | { kind: 'sound'; to: number; name: string }
  /** An effect (see `effect`) played here, for other screens to play as well. */
  | { kind: 'fx'; name: string; args: unknown[] };

const LISTENERS: Array<(e: GameEvent) => void> = [];
export function onEvent(fn: (e: GameEvent) => void) { LISTENERS.push(fn); }
export function emit(e: GameEvent) { for (const fn of LISTENERS) fn(e); }

/** Big text for one driver (`to` a car's pid) or everyone (ALL). */
export const announce = (to: number, text: string, dur: number, small?: boolean) => emit({ kind: 'big', to, text, dur, small });
/** A highlighted feed line for one driver. */
export const tell = (to: number, text: string) => emit({ kind: 'feed', to, text, mine: true });

// ---------- effects ----------
const FX: Record<string, (...a: never[]) => void> = {};
let depth = 0, muted = 0;
/**
 * Make a one-off effect: calling it plays it here and raises an 'fx' event naming it, with its arguments (plain
 * numbers, strings and flags, so they can travel). An effect that plays other effects is raised once, as itself.
 */
export function effect<A extends unknown[] = number[]>(name: string, fn: (...a: A) => void): (...a: A) => void {
  FX[name] = fn as unknown as (...a: never[]) => void;
  return (...a: A) => {
    if (muted) return;
    if (!depth) emit({ kind: 'fx', name, args: a });
    depth++; try { fn(...a); } finally { depth--; }
  };
}
/** Play an effect raised on another screen (it isn't raised again). */
export function playEffect(name: string, args: unknown[]) {
  const fn = FX[name]; if (!fn) return;
  depth++; try { fn(...(args as never[])); } finally { depth--; }
}
/**
 * Run `fn` with effects silenced. An online guest moves some things itself to keep them smooth (its own car,
 * falling boulders, toppling towers); the host plays their effects, so the guest's own copies stay quiet.
 */
export function muffled(fn: () => void) { muted++; try { fn(); } finally { muted--; } }
