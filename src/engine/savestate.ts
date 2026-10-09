// Saving the parts of a match that online snapshots don't carry (weapon cooldowns, who last hit whom, projectiles'
// owners and targets, mines, crate and plate timers, the mode's own state), so another player can carry the match
// on if the host leaves (src/net/migrate.ts). Each module that holds match state registers a part here; a part saves
// plain JSON (cars named by pid) and loads it back.

export interface StatePart { save(): unknown; load(data: unknown): void }
const PARTS = new Map<string, StatePart>();
export function registerState(name: string, part: StatePart) { PARTS.set(name, part); }
export function saveState(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, p] of PARTS) out[name] = p.save();
  return out;
}
export function loadState(data: Record<string, unknown>) {
  for (const [name, p] of PARTS) if (name in data) p.load(data[name]);
}
