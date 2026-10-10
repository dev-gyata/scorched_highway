// Race courses: a loop of sections laid out as centre lines, and everything worked out from them: the ground carved
// around the paths, barriers at their edges, where a car is on the lap, the starting grid and where to restart
// after a wreck. A course map (src/maps/<id>) gives a layout to makeCourse(); world/course-scenery.ts builds its
// meshes and maps/course-map.ts wraps it as a GameMap.
//
// A course is a loop of sections; at a fork a section has two paths that split at one node and meet at the next.
// The ground is a height field shaped around the paths' centre lines, each path in its own style:
// - desert: a low berm at the road's edge, open dunes beyond, cliffs far off;
// - canyon: rock walls rising from a shoulder at the road's edge to the high ground;
// - ledge: a shelf on a cliff face, rock wall on one side and a sheer drop on the other, down to the road below.
// Where paths meet, the lowest ground wins, so forks and the rock between branches fall out of one function.
import * as THREE from 'three';
import { clamp, lerp, smooth } from '../engine/util.js';
import type { HazardSite } from './hazards';
import { scatterDrops } from './hazards';
import type { PlateSpot, PlateType } from './plates';
import type { PlateTag, Progress } from '../maps/types';

export type Surface = 'dirt' | 'tunnel' | 'asphalt' | 'sand' | 'salt';
export type Style = 'desert' | 'canyon' | 'ledge';
/** What each surface is like: how wide its road ribbon is as a share of the corridor (0: none), and its top speed relative to dirt. */
export const SURFACES: Record<Surface, { ribbon: number; speed: number }> = {
  dirt: { ribbon: 0.75, speed: 1 }, tunnel: { ribbon: 0.8, speed: 1 }, asphalt: { ribbon: 0.9, speed: 1.06 }, sand: { ribbon: 0, speed: 0.8 }, salt: { ribbon: 0, speed: 1.05 },
};
/** How far road ribbons float above the ground; how far in from a tunnel's ends its roof starts, and how high it is. */
export const ROAD_LIFT = 0.08, PORTAL = 22, ROOF = 7.5;

export interface PathDef {
  name: string; half: number; surface: Surface; style: Style;
  /** Centre line in metres from the course's origin: x, z and floor height y. Paths in a section share their first and last point. */
  pts: number[][];
  risky?: boolean;
  gap?: [number, number]; // a gorge across the road, as fractions of the path
  below?: string; // ledge: the path the drop falls to
}
export interface SectionDef { paths: PathDef[]; fork?: string }
/** Something on the course: the path it's on, how far along it (0 to 1) and metres to the side. */
export type At = [string, number, number];
export interface CourseLayout {
  /** On the start gantry. */
  name: string;
  /** The course's origin in the world: x, z. */
  origin: [number, number];
  laps: number;
  sections: SectionDef[];
  /** Boulders on the road to steer round: [path, along, across, radius]. */
  rocks: Array<[...At, number]>;
  /** Sinkholes: fall in and you're wrecked. [path, along, across, radius]. */
  holes: Array<[...At, number]>;
  /** Jump ramps. */
  jumps: At[];
  /** Explosive barrels, in clusters of three. */
  barrels: At[];
  /** Crates: [path, along, across, what can appear]. */
  crates: Array<[...At, string[]]>;
  /** Plates in the road: swords arm you, shields protect you, skulls set off the next hazard ahead. */
  plates: Array<[...At, PlateType]>;
  /** Rockfalls a skull can set off: [path, from, to] (fractions along it). */
  falls: Array<[string, number, number]>;
  /** Stretches of open ground a wrong-way truck can come down: [path, lane across]. */
  trucks: Array<[string, number]>;
  /** Height of the high ground the course is cut into, if not mesa tops. */
  top?: (x: number, z: number) => number;
}

export interface Section { paths: Path[]; fork?: string; start: number; len: number }

export interface Ramp { x: number; z: number; yaw: number; s: number; c: number; len: number; w: number; h: number; base: number }

export interface Rock { x: number; z: number; r: number; top: number }

export interface Hole { x: number; z: number; r: number; floor: number }

/** The closest point of the path network to (x, z), measured by how far outside its corridor the point is. */
export interface Near { path: Path; i: number; t: number; d: number; e: number; floor: number; side: number; alongside: boolean }

export interface Path {
  name: string; half: number; surface: Surface; style: Style; section: number; index: number; risky: boolean;
  x: Float32Array; z: Float32Array; y: Float32Array; tx: Float32Array; tz: Float32Array; s: Float32Array; len: number;
  gap: [number, number] | null; // metres along the path where the gorge drops away
  /** Ledge: which side the drop is on (in nearest()'s `side` sign), the height of the road below, and how wide the fall zone is. */
  open: number; below: number; fallWidth: number;
}

const STEP = 3; // metres between samples
const CELL = 32, WALL = 16, SHOULDER = 1.8;
const DESERT_OPEN = 90, DESERT_CLIFF = 30; // desert: open ground this far past the berm, then cliffs
const NEAR = 44, FAR_STRIDE = 6;
const GORGE = 34, GORGE_WIDE = 5; // how deep a gorge is, and how far past the road it cuts into the walls
const HOLE_DEPTH = 7;
const EDGE = 0.6; // how far past a corridor's edge a car may go before the barrier stops it

export type Track = ReturnType<typeof makeCourse>;
/** Work a layout out into a course: its sampled paths, ground, barriers and race progress. */
export function makeCourse(L: CourseLayout) {
  const [ox, oz] = L.origin;
  // ---------- sampled paths ----------
  const SECTIONS_BUILT: Section[] = [];
  let LAP_LEN = 0;

  function samplePath(def: PathDef, section: number, index: number): Path {
    const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z, y]) => new THREE.Vector3(ox + x, y, oz + z)), false, 'centripetal');
    const n = Math.max(8, Math.round(curve.getLength() / STEP)), pts = curve.getSpacedPoints(n);
    const x = new Float32Array(n + 1), z = new Float32Array(n + 1), y = new Float32Array(n + 1), tx = new Float32Array(n + 1), tz = new Float32Array(n + 1), s = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      x[i] = pts[i].x; z[i] = pts[i].z; y[i] = pts[i].y;
      if (i) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    }
    for (let i = 0; i <= n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n, i + 1), dx = x[b] - x[a], dz = z[b] - z[a], L = Math.hypot(dx, dz) || 1;
      tx[i] = dx / L; tz[i] = dz / L;
    }
    const len = s[n];
    return {
      name: def.name, half: def.half, surface: def.surface, style: def.style, section, index, risky: !!def.risky, x, z, y, tx, tz, s, len,
      gap: def.gap ? [def.gap[0] * len, def.gap[1] * len] : null, open: 0, below: 0, fallWidth: 0,
    };
  }
  L.sections.forEach((sd, k) => {
    const paths = sd.paths.map((p, i) => samplePath(p, k, i));
    const len = paths.reduce((a, p) => a + p.len, 0) / paths.length; // a fork counts as its paths' average length
    SECTIONS_BUILT.push({ paths, fork: sd.fork, start: LAP_LEN, len });
    LAP_LEN += len;
  });
  const PATHS: Path[] = SECTIONS_BUILT.flatMap(s => s.paths);
  const byName = (name: string) => { const p = PATHS.find(q => q.name === name); if (!p) throw new Error('no path ' + name); return p; };
  /** World position of [path, along, across]. */
  function place([name, along, across]: At) {
    const p = byName(name), i = Math.round(along * (p.x.length - 1));
    return { x: p.x[i] - p.tz[i] * across, z: p.z[i] + p.tx[i] * across, y: p.y[i], yaw: Math.atan2(p.tx[i], p.tz[i]), path: p, i };
  }
  // ledges: find which side the road below is on, how far down it is and how wide the drop zone must be
  L.sections.forEach((sd, k) => sd.paths.forEach((d, j) => {
    if (!d.below) return;
    const p = SECTIONS_BUILT[k].paths[j], q = byName(d.below), m = Math.round(p.x.length / 2);
    let qi = 0, qd = Infinity; for (let i = 0; i < q.x.length; i++) { const dd = (q.x[i] - p.x[m]) ** 2 + (q.z[i] - p.z[m]) ** 2; if (dd < qd) { qd = dd; qi = i; } }
    p.open = Math.sign(p.tx[m] * (q.z[qi] - p.z[m]) - p.tz[m] * (q.x[qi] - p.x[m]));
    p.below = q.y[qi]; p.fallWidth = Math.sqrt(qd) - p.half + q.half;
  }));

  // ---------- ramps: the gorge jump's plank ramp and jumps on the flats ----------
  const TRACK_RAMPS: Ramp[] = [];
  function addRamp(x: number, z: number, yaw: number, len: number, w: number, h: number, base: number) {
    TRACK_RAMPS.push({ x, z, yaw, s: Math.sin(yaw), c: Math.cos(yaw), len, w, h, base });
  }
  for (const p of PATHS) if (p.gap) {
    const len = 15, i = Math.round((p.gap[0] - len / 2 - 0.5) / (p.len / (p.x.length - 1)));
    addRamp(p.x[i], p.z[i], Math.atan2(p.tx[i], p.tz[i]), len, p.half * 1.4, 3.4, p.y[i]);
  }
  for (const j of L.jumps) { const at = place(j); addRamp(at.x, at.z, at.yaw, 10, 7, 2.2, at.y); }
  function trackRamp(x: number, z: number): number {
    for (const R of TRACK_RAMPS) {
      const dx = x - R.x, dz = z - R.z, u = dx * R.s + dz * R.c; if (u < -R.len / 2 || u > R.len / 2) continue;
      const v = dx * R.c - dz * R.s; if (Math.abs(v) > R.w / 2) continue;
      return (u + R.len / 2) / R.len * R.h;
    }
    return 0;
  }

  // ---------- obstacles ----------
  const OBSTACLES: Rock[] = L.rocks.map(([n, a, c, r]) => { const at = place([n, a, c]); return { x: at.x, z: at.z, r, top: at.y + r * 1.3 }; });
  const SINKHOLES: Hole[] = L.holes.map(([n, a, c, r]) => { const at = place([n, a, c]); return { x: at.x, z: at.z, r, floor: at.y }; });
  /** Plates, each tagged with where it is on the course (for the bots). */
  const PLATE_SPOTS: PlateSpot[] = L.plates.map(([n, a, c, type]) => { const at = place([n, a, c]); return { x: at.x, z: at.z, yaw: at.yaw, type, tag: { path: at.path, i: at.i, across: c } as PlateTag }; });
  /** Where a sample of a path is on the lap, in metres from the start line. */
  const lapAt = (p: Path, i: number) => { const sec = SECTIONS_BUILT[p.section]; return sec.start + p.s[i] / p.len * sec.len; };
  /** The hazards skulls set off; filled in when the map is built (the wall tops need the terrain). */
  const HAZARD_SITES: HazardSite[] = [];
  function buildHazardSites() {
    if (HAZARD_SITES.length) return;
    const at = (p: Path, i: number, across: number) => [p.x[i] - p.tz[i] * across, p.z[i] + p.tx[i] * across];
    L.falls.forEach(([name, a, b], k) => {
      const p = byName(name), idx = (u: number) => Math.round((a + (b - a) * u) * (p.x.length - 1));
      const drops = scatterDrops(Math.round((b - a) * p.len / 18), 670 + k, (u, side, rng) => {
        const i = idx(u), [fx, fz] = at(p, i, side * (p.half + 8)), [tx, tz] = at(p, Math.min(p.x.length - 1, i + 2), (rng() * 2 - 1) * (p.half - 2.5));
        return { fx, fy: trackHeight(fx, fz) + 2, fz, tx, tz };
      });
      HAZARD_SITES.push({ kind: 'rockfall', name, s: lapAt(p, idx(0)), drops });
    });
    // a truck comes in off the desert past the far end of the stretch, drives it the wrong way and leaves past the near end
    const cx = PATHS.reduce((s, p) => s + p.x[p.x.length >> 1], 0) / PATHS.length, cz = PATHS.reduce((s, p) => s + p.z[p.z.length >> 1], 0) / PATHS.length;
    for (const [name, lane] of L.trucks) {
      const p = byName(name), n = p.x.length - 1, m = n >> 1;
      const out = Math.sign((p.x[m] - p.tz[m] - cx) ** 2 + (p.z[m] + p.tx[m] - cz) ** 2 - (p.x[m] + p.tz[m] - cx) ** 2 - (p.z[m] - p.tx[m] - cz) ** 2) || 1; // the side away from the middle of the course
      const x: number[] = [], z: number[] = [], push = (i: number, across: number) => { const [px, pz] = at(p, i, across); x.push(px); z.push(pz); };
      push(n - 14, out * 80); push(n - 9, out * 30); push(n - 6, out * 8);
      for (let i = n - 4; i >= 4; i -= 3) push(i, lane);
      push(2, out * 10); push(0, out * 30); push(0, out * 90);
      HAZARD_SITES.push({ kind: 'truck', name, s: lapAt(p, 0), route: { x, z } });
    }
  }
  const CRATE_SPOTS = L.crates.map(([n, a, c, pool]) => { const at = place([n, a, c]); return [at.x, at.z, pool] as [number, number, string[]]; });

  // ---------- spatial index of path segments ----------
  const reachOf = (p: Path) => p.half + SHOULDER + (p.style === 'desert' ? DESERT_OPEN + DESERT_CLIFF : (p.style === 'ledge' ? Math.max(WALL, p.fallWidth) : 0) + WALL + 4) + 4;
  const MAX_REACH = Math.max(...PATHS.map(reachOf));
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of PATHS) for (let i = 0; i < p.x.length; i++) { minX = Math.min(minX, p.x[i]); maxX = Math.max(maxX, p.x[i]); minZ = Math.min(minZ, p.z[i]); maxZ = Math.max(maxZ, p.z[i]); }
  minX -= MAX_REACH + CELL; minZ -= MAX_REACH + CELL; maxX += MAX_REACH + CELL; maxZ += MAX_REACH + CELL;
  const BOUNDS = { minX, minZ, maxX, maxZ };
  const NX = Math.ceil((maxX - minX) / CELL), NZ = Math.ceil((maxZ - minZ) / CELL);
  /**
   * Per cell: segments (path index * 65536 + sample index) within NEAR metres of it, for nearest() and the ground
   * near roads; and, for the open desert's far reaches, a coarse copy of the desert paths (every FAR_STRIDE-th
   * sample) out to their full reach, which only the height field needs (and only while the terrain is built).
   */
  const GRID: Int32Array[] = new Array(NX * NZ), FAR_GRID: Int32Array[] = new Array(NX * NZ);
  /** Per cell: sinkholes and rocks near it. */
  const HOLE_GRID: Hole[][] = Array.from({ length: NX * NZ }, () => []), ROCK_GRID: Rock[][] = Array.from({ length: NX * NZ }, () => []);
  {
    const lists: number[][] = Array.from({ length: NX * NZ }, () => []), far: number[][] = Array.from({ length: NX * NZ }, () => []);
    const cover = (x0: number, z0: number, x1: number, z1: number, fn: (c: number) => void) => {
      for (let cx = Math.floor((x0 - minX) / CELL); cx <= Math.floor((x1 - minX) / CELL); cx++) for (let cz = Math.floor((z0 - minZ) / CELL); cz <= Math.floor((z1 - minZ) / CELL); cz++) fn(cx * NZ + cz);
    };
    PATHS.forEach((p, pi) => {
      const R = Math.min(reachOf(p), p.half + NEAR);
      for (let i = 0; i < p.x.length - 1; i++) cover(Math.min(p.x[i], p.x[i + 1]) - R, Math.min(p.z[i], p.z[i + 1]) - R, Math.max(p.x[i], p.x[i + 1]) + R, Math.max(p.z[i], p.z[i + 1]) + R, c => lists[c].push(pi * 65536 + i));
      if (p.style !== 'desert') return;
      const RF = reachOf(p);
      for (let i = 0; i < p.x.length - 1; i += FAR_STRIDE) {
        const j = Math.min(i + FAR_STRIDE, p.x.length - 1);
        cover(Math.min(p.x[i], p.x[j]) - RF, Math.min(p.z[i], p.z[j]) - RF, Math.max(p.x[i], p.x[j]) + RF, Math.max(p.z[i], p.z[j]) + RF, c => far[c].push(pi * 65536 + i));
      }
    });
    lists.forEach((l, i) => { GRID[i] = Int32Array.from(l); });
    far.forEach((l, i) => { FAR_GRID[i] = Int32Array.from(l); });
    for (const h of SINKHOLES) cover(h.x - h.r, h.z - h.r, h.x + h.r, h.z + h.r, c => HOLE_GRID[c].push(h));
    for (const r of OBSTACLES) cover(r.x - r.r - 4, r.z - r.r - 4, r.x + r.r + 4, r.z + r.r + 4, c => ROCK_GRID[c].push(r));
  }
  const cellIndex = (x: number, z: number) => {
    const cx = Math.floor((x - minX) / CELL), cz = Math.floor((z - minZ) / CELL);
    return cx < 0 || cz < 0 || cx >= NX || cz >= NZ ? -1 : cx * NZ + cz;
  };
  const cellAt = (x: number, z: number) => { const i = cellIndex(x, z); return i < 0 ? null : GRID[i]; };

  /** Does any path come near the rectangle? (For deciding which terrain tiles to build.) */
  function pathsNear(x0: number, z0: number, x1: number, z1: number): boolean {
    for (let x = x0; x <= x1; x += CELL) for (let z = z0; z <= z1; z += CELL) { const i = cellIndex(Math.min(x, x1), Math.min(z, z1)); if (i >= 0 && (GRID[i].length || FAR_GRID[i].length)) return true; }
    return false;
  }
  const _near: Near = { path: PATHS[0], i: 0, t: 0, d: 0, e: 0, floor: 0, side: 0, alongside: true };
  /** How far the gorge drops at distance s along path p (0 outside it). */
  function gorgeDrop(p: Path, s: number) {
    return p.gap && s > p.gap[0] && s < p.gap[1] ? GORGE * Math.min(1, (s - p.gap[0]) / 1.5, (p.gap[1] - s) / 1.5) : 0;
  }
  /** Nearest corridor to (x, z), or null when no path is near. */
  function nearest(x: number, z: number): Near | null {
    const cell = cellAt(x, z); if (!cell || !cell.length) return null;
    let best = Infinity;
    for (let k = 0; k < cell.length; k++) {
      const p = PATHS[cell[k] >> 16], i = cell[k] & 65535;
      const ax = p.x[i], az = p.z[i], bx = p.x[i + 1] - ax, bz = p.z[i + 1] - az, L2 = bx * bx + bz * bz || 1;
      const raw = ((x - ax) * bx + (z - az) * bz) / L2, t = clamp(raw, 0, 1), px = ax + bx * t - x, pz = az + bz * t - z, d = Math.sqrt(px * px + pz * pz), e = d - p.half;
      if (e < best) { best = e; _near.path = p; _near.i = i; _near.t = t; _near.d = d; _near.e = e; _near.side = Math.sign(bx * (z - az) - bz * (x - ax)); _near.alongside = raw >= 0 && raw <= 1; }
    }
    const p = _near.path;
    _near.floor = lerp(p.y[_near.i], p.y[_near.i + 1], _near.t) - (_near.alongside ? gorgeDrop(p, lerp(p.s[_near.i], p.s[_near.i + 1], _near.t)) : 0);
    return _near;
  }

  // ---------- the height field ----------
  /** The high ground the course is cut into (mesa tops, unless the layout says otherwise): broken, and higher away from the course. */
  const plateau = L.top || ((x: number, z: number) => 34 + 3 * Math.sin(x * 0.013 + 1.3) * Math.cos(z * 0.011) + 1.5 * Math.sin(x * 0.041 - z * 0.037));
  /** Canyon wall profile, 0 at the corridor's edge to 1 at the rim, with ledges; e is metres past the corridor's edge. */
  function wall(e: number, x: number, z: number) {
    // a flat shoulder past the edge (where the barrier holds cars), then the rock, set back 0-2 m more
    const jitter = SHOULDER + 0.75 + 0.75 * Math.sin(x * 0.09 + z * 0.07) + 0.4 * Math.sin(x * 0.23 - z * 0.19);
    const u = clamp((e - jitter) / WALL, 0, 1); if (u <= 0) return 0;
    const steep = 1 - Math.pow(1 - u, 2.2);
    return clamp(steep + 0.05 * Math.sin(u * 19 + x * 0.05), 0, 1);
  }
  /** Desert either side of the road: a low berm, open dunes, then mesa cliffs. */
  function desert(e: number, x: number, z: number, floor: number, top: number) {
    const berm = 2.2 * smooth(SHOULDER, SHOULDER + 5, e);
    const dunes = (0.8 + 0.8 * Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * Math.cos(z * 0.05 - x * 0.02)) * smooth(SHOULDER + 4, SHOULDER + 14, e);
    return floor + Math.max(berm + dunes, (top - floor) * wall(e - DESERT_OPEN, x, z));
  }
  /** Ground height on the course (ramps excluded). */
  function trackHeight(x: number, z: number): number {
    const top = plateau(x, z), ci = cellIndex(x, z); if (ci < 0) return top;
    const cell = GRID[ci];
    let h = top, shelf = -Infinity;
    for (let k = 0; k < cell.length; k++) {
      const p = PATHS[cell[k] >> 16], i = cell[k] & 65535;
      const ax = p.x[i], az = p.z[i], bx = p.x[i + 1] - ax, bz = p.z[i + 1] - az, L2 = bx * bx + bz * bz || 1;
      const raw = ((x - ax) * bx + (z - az) * bz) / L2, t = clamp(raw, 0, 1), d = Math.hypot(ax + bx * t - x, az + bz * t - z);
      const e = d - p.half; if (e > reachOf(p)) continue;
      const floor = lerp(p.y[i], p.y[i + 1], t) + (e < 0 ? -0.15 * (1 - (d / p.half) ** 2) : 0); // a slight crown down the middle
      let hh: number;
      if (p.style === 'ledge' && e <= 0.3 && raw >= 0 && raw <= 1) shelf = Math.max(shelf, floor); // a ledge's road surface stands, whatever carves below it
      if (p.style === 'desert') hh = desert(e, x, z, floor, top);
      else if (p.style === 'ledge' && p.open && Math.sign(bx * (z - az) - bz * (x - ax)) === p.open) {
        // the open side: a sheer drop (with a lip) down to the road below, never lower, then that road's far wall
        const drop = Math.max(0, floor - p.below), cliff = floor - Math.min(drop, Math.max(0, e - 0.3) * 4);
        hh = Math.max(cliff, p.below + (top - p.below) * wall(e - p.fallWidth, x, z));
      } else hh = floor + (top - floor) * wall(e, x, z);
      // the gorge cuts straight across, a little wider than the road, with sheer edges where the road stops
      if (p.gap && raw >= 0 && raw <= 1) { const drop = gorgeDrop(p, lerp(p.s[i], p.s[i + 1], t)); if (drop) hh = Math.min(hh, floor - drop + (top - floor + drop) * wall(e - GORGE_WIDE, x, z)); }
      if (hh < h) h = hh;
    }
    // the open desert's far reaches: dunes and the distant mesa cliffs, from the coarse paths
    const farCell = FAR_GRID[ci];
    for (let k = 0; k < farCell.length; k++) {
      const p = PATHS[farCell[k] >> 16], i = farCell[k] & 65535, j = Math.min(i + FAR_STRIDE, p.x.length - 1);
      const ax = p.x[i], az = p.z[i], bx = p.x[j] - ax, bz = p.z[j] - az, L2 = bx * bx + bz * bz || 1;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / L2, 0, 1), e = Math.hypot(ax + bx * t - x, az + bz * t - z) - p.half;
      if (e < NEAR - 4 || e > reachOf(p)) continue; // near the road the detailed segments above already answer
      const hh = desert(e, x, z, lerp(p.y[i], p.y[j], t), top); if (hh < h) h = hh;
    }
    if (shelf > h) h = shelf;
    // sinkholes: steep-sided pits
    for (const s of HOLE_GRID[ci]) { const dd = Math.hypot(x - s.x, z - s.z); if (dd < s.r) h = Math.min(h, s.floor - HOLE_DEPTH * smooth(s.r, s.r * 0.65, dd)); }
    return h;
  }
  // Once the terrain is built, its height grid (computed for the whole course) answers every ground query: the
  // flat triangles between samples are exactly what's drawn, and a lookup is far cheaper than the height field.
  let grid: { s: number; x0: number; z0: number; nx: number; nz: number; h: Float32Array } | null = null;
  /** Keep the terrain's height grid: spacing, origin, size and heights (index i * nz + j for x0 + i * s, z0 + j * s). */
  function setTrackGrid(s: number, x0: number, z0: number, nx: number, nz: number, h: Float32Array) { grid = { s, x0, z0, nx, nz, h }; }
  const gh = (i: number, j: number) => { const g = grid!; return g.h[clamp(i, 0, g.nx - 1) * g.nz + clamp(j, 0, g.nz - 1)]; };
  /** Ground height as drawn: the terrain grid's flat triangles (or the height field before the terrain is built). */
  function trackSurface(x: number, z: number): number {
    if (!grid) return trackHeight(x, z);
    const fx = (x - grid.x0) / grid.s, fz = (z - grid.z0) / grid.s, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    // PlaneGeometry-style split along the diagonal from (i + 1, j) to (i, j + 1), as the terrain mesh is built
    if (u + v <= 1) { const h = gh(i, j); return h + u * (gh(i + 1, j) - h) + v * (gh(i, j + 1) - h); }
    const h = gh(i + 1, j + 1); return h + (1 - u) * (gh(i, j + 1) - h) + (1 - v) * (gh(i + 1, j) - h);
  }

  // ---------- corridor queries ----------
  /** Off a ledge's open side: no barrier there, the car goes over. */
  const overTheEdge = (n: Near) => n.path.open !== 0 && n.side === n.path.open;
  /** Keep a car on the course: barriers at the corridors' edges (not over a ledge's drop) and the rocks. Returns the impact speed. */
  function keepOnTrack(c: { x: number; y: number; z: number; vx: number; vz: number; radius: number }): number {
    let impact = 0;
    const n = nearest(c.x, c.z);
    if (n && !overTheEdge(n)) {
      const over = n.e + c.radius * 0.5 - EDGE;
      if (over > 0) {
        const p = n.path, px = p.x[n.i] + (p.x[n.i + 1] - p.x[n.i]) * n.t, pz = p.z[n.i] + (p.z[n.i + 1] - p.z[n.i]) * n.t;
        const nx = (px - c.x) / (n.d || 1), nz = (pz - c.z) / (n.d || 1);
        c.x += nx * over; c.z += nz * over;
        const vn = -(c.vx * nx + c.vz * nz); if (vn > 0) { c.vx += 1.3 * vn * nx; c.vz += 1.3 * vn * nz; impact = vn; } // bounce off at 30%
      }
    }
    const ci = cellIndex(c.x, c.z);
    if (ci >= 0) for (const r of ROCK_GRID[ci]) {
      if (c.y > r.top) continue;
      const dx = c.x - r.x, dz = c.z - r.z, R = c.radius + r.r * 0.9, d2 = dx * dx + dz * dz; if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 0.01, nx = dx / d, nz = dz / d; c.x = r.x + nx * R; c.z = r.z + nz * R;
      const vn = -(c.vx * nx + c.vz * nz); if (vn > 0) { c.vx += 1.3 * vn * nx; c.vz += 1.3 * vn * nz; impact = Math.max(impact, vn); }
    }
    return impact;
  }
  const rockAt = (x: number, z: number, m: number) => { const ci = cellIndex(x, z); if (ci >= 0) for (const r of ROCK_GRID[ci]) if (Math.hypot(x - r.x, z - r.z) < r.r + m) return true; return false; };
  /** Off the drivable course, or into a rock or sinkhole (AI probes, placing things). */
  function offTrack(x: number, z: number, margin = 0): boolean {
    const n = nearest(x, z); if (!n || n.e + margin > EDGE) return true;
    if (rockAt(x, z, margin)) return true;
    const ci = cellIndex(x, z); for (const s of HOLE_GRID[ci]) if (Math.hypot(x - s.x, z - s.z) < s.r + margin) return true;
    return false;
  }
  /** Inside the mine shaft, away from its portals. */
  function inTunnel(x: number, z: number): boolean {
    const n = nearest(x, z); if (!n || n.path.surface !== 'tunnel' || n.e > 1) return false;
    const s = n.path.s[n.i]; return s > PORTAL && s < n.path.len - PORTAL;
  }
  /** Solid at (x, y, z) beyond what the height field says: the mine shaft's ceiling and the rocks. */
  function trackSolid(x: number, y: number, z: number): boolean {
    const ci = cellIndex(x, z);
    if (ci >= 0) for (const r of ROCK_GRID[ci]) if (y < r.top && Math.hypot(x - r.x, z - r.z) < r.r * 0.9) return true;
    return inTunnel(x, z) && y > (nearest(x, z) as Near).floor + ROOF;
  }
  /** Down in the gorge or a sinkhole: there's no way out, the car is wrecked. */
  function fallen(x: number, y: number, z: number): boolean {
    const ci = cellIndex(x, z);
    if (ci >= 0) for (const s of HOLE_GRID[ci]) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.8 && y < s.floor - 3) return true;
    const n = nearest(x, z); if (!n || !n.path.gap) return false;
    const s = lerp(n.path.s[n.i], n.path.s[n.i + 1], n.t);
    return s > n.path.gap[0] && s < n.path.gap[1] && y < lerp(n.path.y[n.i], n.path.y[n.i + 1], n.t) - 6;
  }
  const inGap = (n: Near) => { const s = lerp(n.path.s[n.i], n.path.s[n.i + 1], n.t); return !!n.path.gap && s > n.path.gap[0] - 1 && s < n.path.gap[1] + 1; };
  /** How far the road surface floats above the terrain at (x, z): 0 off the roads. */
  function trackRoadLift(x: number, z: number): number {
    const n = nearest(x, z); return n && n.d < n.path.half * SURFACES[n.path.surface].ribbon && !(n.path.gap && inGap(n)) ? ROAD_LIFT : 0;
  }
  /** Top speed on this surface, relative to dirt. */
  function surfaceSpeed(x: number, z: number): number {
    const n = nearest(x, z); if (!n || n.e > 0) return 1;
    return SURFACES[n.path.surface].speed;
  }

  // ---------- race progress ----------
  /** Nearest sample on one path to (x, z), searching around a hint first. */
  function onPath(p: Path, x: number, z: number, hint: number): [number, number] {
    let bi = 0, bd = Infinity;
    const scan = (a: number, b: number) => { for (let i = Math.max(0, a); i <= Math.min(p.x.length - 1, b); i++) { const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2; if (d < bd) { bd = d; bi = i; } } };
    scan(hint - 12, hint + 12);
    if (bd > 30 * 30) scan(0, p.x.length - 1);
    return [bi, Math.sqrt(bd)];
  }
  /** Advance a car's progress to where it is now: moves between sections as it passes nodes, counts laps. */
  function track(pr: Progress, x: number, z: number) {
    const n = SECTIONS_BUILT.length;
    const cand: Array<[number, number]> = [];
    for (const k of [pr.section, (pr.section + 1) % n, (pr.section + n - 1) % n]) SECTIONS_BUILT[k].paths.forEach((_, j) => cand.push([k, j]));
    let best: [number, number, number] = [pr.section, pr.path, pr.i], bd = Infinity;
    for (const [k, j] of cand) {
      const p = SECTIONS_BUILT[k].paths[j], [i, d] = onPath(p, x, z, k === pr.section && j === pr.path ? pr.i : 0);
      // prefer staying put: only switch when clearly closer, and only onto the ends of neighbouring sections
      const atEnd = k === pr.section || (k === (pr.section + 1) % n ? i < 10 : i > p.x.length - 11);
      const score = d + (k === pr.section && j === pr.path ? 0 : 2);
      if (atEnd && score < bd) { bd = score; best = [k, j, i]; }
    }
    const [k, j, i] = best;
    if (k === (pr.section + 1) % n && k !== pr.section) { if (k === 0) pr.lap++; }
    else if (k === (pr.section + n - 1) % n && k !== pr.section) { if (pr.section === 0) pr.lap--; }
    pr.section = k; pr.path = j; pr.i = i;
    const sec = SECTIONS_BUILT[k], p = sec.paths[j];
    pr.s = sec.start + p.s[i] / p.len * sec.len;
  }
  /** Total distance covered, for ordering cars: laps plus progress round the current one. */
  const distance = (pr: Progress) => pr.lap * LAP_LEN + pr.s;
  /** Direction of the track at a car's progress point. */
  function heading(pr: Progress): [number, number] { const p = SECTIONS_BUILT[pr.section].paths[pr.path]; return [p.tx[pr.i], p.tz[pr.i]]; }

  /** Starting grid: two columns behind the start line, front row first. */
  function gridSlots(n: number): Array<{ x: number; z: number; yaw: number; progress: Progress }> {
    const last = SECTIONS_BUILT.length - 1, p = SECTIONS_BUILT[last].paths[0], end = p.x.length - 1, out = [];
    for (let k = 0; k < n; k++) {
      const i = end - 3 - Math.floor(k / 2) * 3, lat = (k % 2 ? -1 : 1) * 3.4;
      out.push({ x: p.x[i] + p.tz[i] * lat, z: p.z[i] - p.tx[i] * lat, yaw: Math.atan2(p.tx[i], p.tz[i]), progress: { section: last, path: 0, i, s: 0, lap: 0 } });
    }
    return out;
  }
  /** Where a car restarts after a wreck: the start of the section it's in, its lane spread by `slot`. */
  function respawnPoint(pr: Progress, slot: number) {
    const sec = SECTIONS_BUILT[pr.section], p = sec.paths[Math.min(pr.path, sec.paths.length - 1)], i = Math.min(4 + (slot % 3) * 3, p.x.length - 2), lat = ((slot % 2) * 2 - 1) * Math.min(3, p.half * 0.4);
    return { x: p.x[i] + p.tz[i] * lat, z: p.z[i] - p.tx[i] * lat, yaw: Math.atan2(p.tx[i], p.tz[i]), i };
  }

  return {
    name: L.name, laps: L.laps, sections: SECTIONS_BUILT, paths: PATHS, lapLength: LAP_LEN, bounds: BOUNDS,
    place, lapAt, pathsNear, nearest,
    ramps: TRACK_RAMPS, obstacles: OBSTACLES, sinkholes: SINKHOLES, barrels: L.barrels, crateSpots: CRATE_SPOTS, plateSpots: PLATE_SPOTS,
    hazardSites: HAZARD_SITES, buildHazardSites,
    // ground
    height: trackHeight, setGrid: setTrackGrid, surface: trackSurface, ramp: trackRamp, roadLift: trackRoadLift, speed: surfaceSpeed,
    // collision and sight
    collide: keepOnTrack, blocked: offTrack, solid: trackSolid, inTunnel, fallen,
    // race progress
    advance: track, distance, heading, grid: gridSlots, respawn: respawnPoint,
  };
}
