// The Boneyard: a free-for-all arena in an aircraft scrapyard on a dry lake, 18 km east of the ghost town. Rows of
// wingless airliners for cover (two to drive through), walls of crushed cars that make chokepoints, and a quarry
// pit in the middle with ramps to jump it.
import { collideShapes, pushOut, shapesNear, shapesSolid } from '../../world/collision.js';
import { PICK, PICKUPS, type PickSpot, buildPickups } from '../../world/pickups';
import type { Body, GameMap, Spot } from '../types';
import { BOXES, CIRCLES, buildProps, buildStatic, buildTerrain } from './scenery';
import { ARENA_R, OX, OZ, baseHeight, rampHeight, surfaceHeight } from './terrain';

const W_POOL = ['missile', 'rockets', 'mortar', 'mines', 'flame', 'missile', 'rockets', 'special'];
/** Crates, in metres from the origin: repairs down in the pit and on two flanks, weapons among the planes, special ammo out by the berm. */
const PICK_SPOTS: Array<[number, number, string[]]> = [
  [0, 10, ['repair']], [-118, 20, ['repair']], [122, -24, ['repair']],
  [-14, -30, W_POOL], [22, 14, W_POOL], [-10, 112, W_POOL], [10, -118, W_POOL],
  [-64, -52, W_POOL], [62, -40, W_POOL], [48, 60, W_POOL], [-56, 56, W_POOL], [-100, -92, W_POOL], [110, -84, W_POOL],
  [100, 110, W_POOL], [-96, 110, W_POOL], [0, -62, W_POOL], [-150, -20, ['special', 'rockets']], [150, 16, ['special', 'mortar']], [0, 156, ['special', 'missile']],
];
/** Ten starting spots round the yard, everyone facing the pit. */
const SPAWNS = Array.from({ length: 10 }, (_, i) => { const a = (i + 0.5) / 10 * Math.PI * 2; return [Math.sin(a) * 148, Math.cos(a) * 148]; });

let built = false;
export const boneyard: GameMap = {
  id: 'boneyard', name: 'The Boneyard', x0: 15000, x1: 21000, modes: ['deathmatch'],
  build(lowQ, timed = (_name, fn) => fn()) {
    if (built) return; built = true;
    timed('terrain', () => buildTerrain(lowQ));
    timed('town', () => buildStatic());
    timed('props', () => { buildProps(); buildPickups(PICK_SPOTS.map(([x, z, pool]): PickSpot => [OX + x, OZ + z, pool])); });
  },
  isBuilt: () => built,
  height: baseHeight, ramp: rampHeight, drawn: surfaceHeight, roadLift: () => 0, speed: () => 1,
  /** The berm holds cars in; the planes, stacks and junk push them out. */
  collide(c: Body) {
    let impact = 0;
    const dx = c.x - OX, dz = c.z - OZ, r = Math.hypot(dx, dz);
    if (r > ARENA_R - c.radius) { const k = (ARENA_R - c.radius) / r; c.x = OX + dx * k; c.z = OZ + dz * k; impact = pushOut(c, -dx / r, -dz / r, 0.3); }
    return Math.max(impact, collideShapes(c, BOXES, CIRCLES));
  },
  blocked: (x, z, m) => Math.hypot(x - OX, z - OZ) > ARENA_R - 3 - m || shapesNear(x, z, m, BOXES, CIRCLES),
  solid: (x, y, z) => shapesSolid(x, y, z, BOXES, CIRCLES),
  outOfBounds: (x, z) => Math.hypot(x - OX, z - OZ) > ARENA_R + 32,
  overview: { x: OX, z: OZ, r: ARENA_R + 12 },
  spawns(n) {
    // spread a small field out: every other spot first
    const order = [...SPAWNS.filter((_, i) => i % 2 === 0).sort(() => Math.random() - 0.5), ...SPAWNS.filter((_, i) => i % 2).sort(() => Math.random() - 0.5)];
    return order.slice(0, n).map(([x, z]): Spot => ({ x: OX + x, z: OZ + z, yaw: Math.atan2(-x, -z) }));
  },
  drawRadar(x, toR, R, range) {
    const [ax, ay] = toR(OX, OZ), k = (R - 8) / range;
    x.strokeStyle = 'rgba(232,102,42,0.5)'; x.lineWidth = 2; x.beginPath(); x.arc(ax, ay, ARENA_R * k, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(30,17,42,0.6)'; x.beginPath(); x.arc(ax, ay, 37 * k, 0, Math.PI * 2); x.stroke(); // the pit
    // planes and car stacks, to scale: turned with the radar by drawing each as a line between its ends
    x.strokeStyle = 'rgba(246,234,212,0.3)'; x.lineCap = 'butt';
    for (const b of BOXES) {
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, lx = w > d;
      const [x0, y0, ok0] = toR(lx ? b.minX : cx, lx ? cz : b.minZ), [x1, y1, ok1] = toR(lx ? b.maxX : cx, lx ? cz : b.maxZ); if (!ok0 && !ok1) continue;
      x.lineWidth = Math.max(2.5, Math.min(w, d) * k); x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    }
    for (const pk of PICKUPS) { if (!pk.active || Math.abs(pk.x - OX) > 3000) continue; const [px, py, ok] = toR(pk.x, pk.z); if (!ok) continue; x.fillStyle = PICK[pk.type].css; x.fillRect(px - 3.5, py - 3.5, 7, 7); }
  },
};
