// The ghost town's static collision: the canyon wall ringing the arena, buildings (boxes), and posts, poles,
// mesas and boulders (circles).
import { collideShapes, pushOut, shapesNear, shapesSolid } from '../../world/collision.js';
import { BOXES, CIRCLES } from './scenery.js';
import { ARENA_R } from './terrain.js';

/** Push a car out of the wall and scenery; returns the impact speed. */
export function collide(c) {
  let impact = 0;
  const rad = c.radius;
  const r = Math.hypot(c.x, c.z);
  if (r > ARENA_R - rad) { const k = (ARENA_R - rad) / r; c.x *= k; c.z *= k; impact = Math.max(impact, pushOut(c, -c.x / r, -c.z / r, 0.3)); }
  return Math.max(impact, collideShapes(c, BOXES, CIRCLES));
}
/** Scenery or the arena's edge within m metres of (x, z). */
export function blocked(x, z, m) { return Math.hypot(x, z) > ARENA_R - 3 - m || shapesNear(x, z, m, BOXES, CIRCLES); }
/** Inside a building, post or rock at (x, y, z). */
export function solid(x, y, z) { return shapesSolid(x, y, z, BOXES, CIRCLES); }
