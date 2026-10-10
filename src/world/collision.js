// Collision and sight queries anywhere in the world: the map at the point answers for its own scenery, then
// props and wrecks (which every map shares) are checked here.
import { clamp } from '../engine/util.js';
import { G } from '../game/state.js';
import { mapAt } from '../maps/registry';
import { hazardBlocked } from './hazards';
import { PROPS } from './props.js';
import { ground } from './terrain.js';

export function pushOut(c, nx, nz, e) { // bounce velocity for moving object c
  const vn = c.vx * nx + c.vz * nz;
  if (vn < 0) { c.vx -= (1 + e) * vn * nx; c.vz -= (1 + e) * vn * nz; return -vn; }
  return 0;
}
// An arena map's static scenery as shapes: boxes {minX, maxX, minZ, maxZ, h} (buildings) and circles {x, z, r, h}
// (posts, rocks), each as tall as `h` (a car above it clears it).
/** Push a car out of the shapes; returns the hardest impact speed. */
export function collideShapes(c, boxes, circles) {
  let impact = 0;
  const rad = c.radius;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]; if (c.y > b.h) continue;
    const px = clamp(c.x, b.minX, b.maxX), pz = clamp(c.z, b.minZ, b.maxZ);
    const dx = c.x - px, dz = c.z - pz, d2 = dx * dx + dz * dz;
    if (d2 >= rad * rad) continue;
    let nx, nz;
    if (d2 < 1e-6) { // inside: push along least penetration
      const l = c.x - b.minX, rr = b.maxX - c.x, t = c.z - b.minZ, bb = b.maxZ - c.z; const m = Math.min(l, rr, t, bb);
      if (m === l) { nx = -1; nz = 0; c.x = b.minX - rad; } else if (m === rr) { nx = 1; nz = 0; c.x = b.maxX + rad; } else if (m === t) { nx = 0; nz = -1; c.z = b.minZ - rad; } else { nx = 0; nz = 1; c.z = b.maxZ + rad; }
    } else { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; c.x = px + nx * rad; c.z = pz + nz * rad; }
    impact = Math.max(impact, pushOut(c, nx, nz, 0.3));
  }
  for (let i = 0; i < circles.length; i++) {
    const o = circles[i]; if (c.y > o.h) continue;
    const dx = c.x - o.x, dz = c.z - o.z; const R = rad + o.r; const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue; const d = Math.sqrt(d2) || 0.01; const nx = dx / d, nz = dz / d;
    c.x = o.x + nx * R; c.z = o.z + nz * R; impact = Math.max(impact, pushOut(c, nx, nz, 0.3));
  }
  return impact;
}
/** A shape within m metres of (x, z). */
export function shapesNear(x, z, m, boxes, circles) {
  for (const b of boxes) if (x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m) return true;
  for (const o of circles) { const dx = x - o.x, dz = z - o.z, R = o.r + m; if (dx * dx + dz * dz < R * R) return true; }
  return false;
}
/** Inside a shape at (x, y, z). */
export function shapesSolid(x, y, z, boxes, circles) {
  for (const b of boxes) if (y < b.h && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  for (const o of circles) if (y < o.h) { const dx = x - o.x, dz = z - o.z; if (dx * dx + dz * dz < o.r * o.r) return true; }
  return false;
}
/** Keep a car out of the walls and static scenery of the map it's on; returns the impact speed. */
export function resolveStatic(c) { return mapAt(c.x).collide(c); }
export function blockedAt(x, z, m, ignore) {
  if (mapAt(x).blocked(x, z, m)) return true;
  return obstacleAt(x, z, m, ignore);
}
/** Something in the way at (x, z) that isn't the map's edge: rocks and holes on a course, hazards, solid props, wrecks (bots following a racing line). */
export function obstacleAt(x, z, m, ignore) {
  const ob = mapAt(x).obstacles;
  if (ob) for (const list of [ob.rocks, ob.holes]) for (const o of list) { const dx = x - o.x, dz = z - o.z, R = o.r + m; if (dx * dx + dz * dz < R * R) return true; }
  if (hazardBlocked(x, z, m)) return true;
  for (const p of PROPS) if (p.solid && (p.kind === 'tower' || p.kind === 'billboard' || p.kind === 'pump')) { const dx = x - p.x, dz = z - p.z, R = p.r + m; if (dx * dx + dz * dz < R * R) return true; }
  for (const c of G.cars) if (!c.alive && c !== ignore) { const dx = x - c.x, dz = z - c.z, R = c.radius + m; if (dx * dx + dz * dz < R * R) return true; }
  return false;
}
export function pointBlocked(x, y, z) { // for projectiles & line of sight
  if (y < ground(x, z) - 0.2) return true;
  return mapAt(x).solid(x, y, z);
}
/** Far outside the playable world: projectiles stop here. */
export function outOfBounds(x, z) { return mapAt(x).outOfBounds(x, z); }
export function lineOfSight(x1, y1, z1, x2, y2, z2) {
  const d = Math.hypot(x2 - x1, y2 - y1, z2 - z1); const n = Math.ceil(d / 4);
  for (let i = 1; i < n; i++) { const t = i / n; if (pointBlocked(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z1 + (z2 - z1) * t)) return false; }
  return true;
}
