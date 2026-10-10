// The Boneyard's ground: a dry lake bed, flat but for a wide quarry pit in the middle with two plank ramps at its
// rim, rising to a berm at the arena's edge. Everything is measured from the map's origin (OX, OZ).
import { lerp, smooth } from '../../engine/util.js';

export const OX = 18000, OZ = 0;
export const ARENA_R = 176;
/** The pit: flat floor out to PIT_FLOOR metres, then a slope cars can climb anywhere, up to the lake bed at PIT_RIM. */
export const PIT_FLOOR = 24, PIT_RIM = 50, PIT_DEPTH = 5.5;

/** Height at (x, z) in metres from the origin, ramps excluded. */
function local(x: number, z: number) {
  const r = Math.hypot(x, z);
  // cracked lake bed: almost flat, with low swells further out
  let h = (0.5 * Math.sin(x * 0.021 + 1.1) * Math.cos(z * 0.017 - 0.6) + 0.3 * Math.sin(x * 0.052 - z * 0.047)) * smooth(PIT_RIM, PIT_RIM + 40, r);
  h -= PIT_DEPTH * (1 - smooth(PIT_FLOOR, PIT_RIM, r));
  if (r > ARENA_R - 10) h += 24 * smooth(ARENA_R - 10, ARENA_R + 34, r); // the berm
  return h;
}
/** Plank ramps on the pit's rim, pointing across it: jump the pit, or land in it. */
export const RAMPS = [{ x: 0, z: -62, yaw: 0 }, { x: 58, z: 22, yaw: -Math.PI * 0.62 }, { x: -54, z: 30, yaw: Math.PI * 0.6 }]
  .map(r => ({ ...r, len: 16, w: 9, h: 4.2, s: Math.sin(r.yaw), c: Math.cos(r.yaw), base: local(r.x, r.z) }));
/** Ground height (ramps excluded): level under each ramp so it sits flat. */
export function baseHeight(wx: number, wz: number): number {
  const x = wx - OX, z = wz - OZ; let h = local(x, z);
  for (const R of RAMPS) { const d = Math.hypot(x - R.x, z - R.z); if (d < 22) h = lerp(h, R.base, 1 - smooth(12, 22, d)); }
  return h;
}
export function rampHeight(wx: number, wz: number): number {
  const x = wx - OX, z = wz - OZ;
  for (const R of RAMPS) {
    const dx = x - R.x, dz = z - R.z, u = dx * R.s + dz * R.c; if (u < -R.len / 2 || u > R.len / 2) continue;
    const v = dx * R.c - dz * R.s; if (v > R.w / 2 || v < -R.w / 2) continue;
    return (u + R.len / 2) / R.len * R.h;
  }
  return 0;
}

// The drawn terrain is a grid of baseHeight samples joined by flat triangles; surfaceHeight() follows those
// triangles exactly, for placing things that must look like they touch the ground (as in the ghost town).
let gridSize = 0, gridSeg = 0;
export function setTerrainGrid(size: number, seg: number) { gridSize = size; gridSeg = seg; }
export function surfaceHeight(wx: number, wz: number): number {
  if (!gridSeg) return baseHeight(wx, wz);
  const s = gridSize / gridSeg, half = gridSize / 2, fx = (wx - OX + half) / s, fz = (wz - OZ + half) / s;
  if (fx < 0 || fz < 0 || fx >= gridSeg || fz >= gridSeg) return baseHeight(wx, wz);
  const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, x0 = OX + ix * s - half, z0 = OZ + iz * s - half;
  // PlaneGeometry (rotated flat) splits each cell along the diagonal from (x0 + s, z0) to (x0, z0 + s)
  if (u + v <= 1) { const h = baseHeight(x0, z0); return h + u * (baseHeight(x0 + s, z0) - h) + v * (baseHeight(x0, z0 + s) - h); }
  const h = baseHeight(x0 + s, z0 + s); return h + (1 - u) * (baseHeight(x0, z0 + s) - h) + (1 - v) * (baseHeight(x0 + s, z0) - h);
}
