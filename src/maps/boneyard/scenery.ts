// The Boneyard's scenery and what a car can hit: rows of wingless airliners (two of them gutted, to drive through),
// walls of crushed cars, engine pods and tail fins, and the berm round the yard. Positions are metres from the
// map's origin; collision is boxes and circles (world/collision.js), so the planes lie square to the compass.
import * as THREE from 'three';
import { MAT_VC, PB } from '../../engine/geometry.js';
import { addToScene } from '../../engine/renderer.js';
import { TAU, mulberry32 } from '../../engine/util.js';
import { addMesas, desertMaterial, paintVerts, splitByTriangle, worldUV } from '../../world/landscape';
import { finishProps, placeProp } from '../../world/props.js';
import { ARENA_R, OX, OZ, PIT_RIM, RAMPS, baseHeight, setTerrainGrid } from './terrain';

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number; h: number }
export interface Circle { x: number; z: number; r: number; h: number }
/** What cars and shots hit, in world coordinates. */
export const BOXES: Box[] = [], CIRCLES: Circle[] = [];
const addBox = (cx: number, cz: number, w: number, d: number, h: number) => BOXES.push({ minX: OX + cx - w / 2, maxX: OX + cx + w / 2, minZ: OZ + cz - d / 2, maxZ: OZ + cz + d / 2, h: baseHeight(OX + cx, OZ + cz) + h });
const addCircle = (x: number, z: number, r: number, h: number) => CIRCLES.push({ x: OX + x, z: OZ + z, r, h: baseHeight(OX + x, OZ + z) + h });

/** Airliners: centre, length, radius, lying along x ('x') or z, livery stripe; `open` ones are gutted shells to drive through. */
interface Plane { x: number; z: number; len: number; r: number; along: 'x' | 'z'; stripe: number; open?: boolean }
const PLANES: Plane[] = [
  { x: -95, z: -78, len: 34, r: 2.7, along: 'x', stripe: 0x9a4a3a }, { x: -92, z: -108, len: 30, r: 2.5, along: 'x', stripe: 0x3a6a8a },
  { x: 98, z: -70, len: 34, r: 2.7, along: 'z', stripe: 0x3a6a8a }, { x: 126, z: -52, len: 28, r: 2.4, along: 'z', stripe: 0xc9a23a },
  { x: 88, z: 96, len: 32, r: 2.6, along: 'x', stripe: 0x9a4a3a }, { x: -112, z: 84, len: 30, r: 2.5, along: 'z', stripe: 0xc9a23a },
  { x: -14, z: 112, len: 30, r: 4.3, along: 'x', stripe: 0x3a6a8a, open: true }, { x: 10, z: -118, len: 30, r: 4.3, along: 'z', stripe: 0x9a4a3a, open: true },
];
/** Walls of crushed cars: centre, size across x and z, height. Gaps between them are the ways through. */
const STACKS: number[][] = [
  [-40, -70, 26, 4, 4.2], [-8, -84, 4, 22, 4.2], [46, -64, 22, 4, 5], [78, -14, 4, 28, 4.2], [70, 44, 4, 24, 5],
  [26, 76, 26, 4, 4.2], [-34, 74, 4, 24, 4.2], [-78, 38, 26, 4, 5], [-84, -20, 4, 30, 4.2], [-132, -8, 18, 4, 4.2], [134, 30, 4, 20, 4.2], [30, 140, 20, 4, 4.2],
];
/** Engine pods and tail fins lying about: x, z, radius, height. */
const JUNK: number[][] = [[-60, -100, 1.6, 2.6], [118, -96, 1.6, 2.6], [112, 78, 1.6, 2.6], [-128, 52, 1.6, 2.6], [50, 118, 1.3, 6], [-70, 112, 1.3, 6], [140, -10, 1.3, 6], [-140, -60, 1.3, 6]];
const WRECK_COLS = [0x8a3a2a, 0x3a5a6a, 0xb08a3a, 0x5a6a4a, 0x7a7068, 0x4a3a4a];

/** The lake bed, the pit and the berm in one mesh, cut into tiles for culling; pale where the salt lies. */
export function buildTerrain(lowQ: boolean) {
  const SIZE = 440, SEG = lowQ ? 110 : 180;
  setTerrainGrid(SIZE, SEG);
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); g.rotateX(-Math.PI / 2); g.translate(OX, 0, OZ);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, baseHeight(p.getX(i), p.getZ(i)));
  g.computeVertexNormals(); worldUV(g);
  const SALT = new THREE.Color(0xe9dfc8), DUST = new THREE.Color(0xcfa97a), PIT = new THREE.Color(0xb98a62), BERM = new THREE.Color(0xc98f5e);
  paintVerts(g, (x, y, z, c) => {
    const r = Math.hypot(x - OX, z - OZ), n = 0.5 + 0.5 * Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2) * Math.cos(z * 0.037 - x * 0.013);
    c.copy(SALT).lerp(DUST, n * 0.45);
    if (r < PIT_RIM + 6) c.lerp(PIT, 1 - Math.max(0, (r - PIT_RIM + 10) / 16));
    if (y > 2.5 && r > ARENA_R - 12) c.lerp(BERM, Math.min(1, (y - 2.5) / 8));
  });
  const TILE = SIZE / 4;
  for (const piece of splitByTriangle(g, (x, _y, z) => Math.hypot(x - OX, z - OZ) > ARENA_R + 38 ? null : Math.floor((x - OX + SIZE / 2) / TILE) * 4 + Math.floor((z - OZ + SIZE / 2) / TILE))) {
    const m = new THREE.Mesh(piece, desertMaterial()); m.receiveShadow = true; addToScene(m, 'landscape');
  }
  // the desert beyond the berm, and buttes on the skyline
  const og = new THREE.RingGeometry(ARENA_R + 24, 1500, 64, 4); og.rotateX(-Math.PI / 2); og.translate(OX, 22, OZ); og.computeVertexNormals(); worldUV(og); paintVerts(og, (_x, _y, _z, c) => c.copy(BERM));
  addToScene(new THREE.Mesh(og, desertMaterial()), 'landscape');
  const r = mulberry32(747), far: number[][] = [];
  for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + r() * 0.25, R = 300 + r() * 260; far.push([OX + Math.sin(a) * R, OZ + Math.cos(a) * R, 20, 20 + r() * 40, 36 + r() * 60, 700 + i]); }
  addMesas(far, 28, false);
}

/** The planes, car stacks and junk: one merged mesh, a gutted shell or two, and their collision. */
export function buildStatic() {
  const b = new PB(), r = mulberry32(1958), ALU = 0xc4c8ca, DARK = 0x2a2a30;
  const gy = (x: number, z: number) => baseHeight(OX + x, OZ + z);
  for (const pl of PLANES) {
    const lx = pl.along === 'x', y = gy(pl.x, pl.z), yaw = lx ? Math.PI / 2 : 0, cy = y + pl.r * 0.62, half = pl.len / 2;
    const at = (u: number, side = 0): [number, number] => (lx ? [OX + pl.x + u, OZ + pl.z + side] : [OX + pl.x + side, OZ + pl.z + u]);
    if (pl.open) {
      // a gutted shell, open at both ends: drawn two-sided; its sides are walls, the way through is clear
      const shell = new THREE.CylinderGeometry(pl.r, pl.r, pl.len, 18, 1, true); shell.rotateX(Math.PI / 2); shell.rotateY(yaw); shell.translate(OX + pl.x, cy, OZ + pl.z);
      const m = new THREE.Mesh(shell, new THREE.MeshLambertMaterial({ color: ALU, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; addToScene(m, 'town');
      const gap = Math.sqrt(pl.r * pl.r - (pl.r * 0.62) ** 2); // half the width of the floor inside
      for (const side of [-1, 1]) { const o = side * (gap + 0.5); if (lx) addBox(pl.x, pl.z + o, pl.len, 1, pl.r * 1.6); else addBox(pl.x + o, pl.z, 1, pl.len, pl.r * 1.6); }
      for (const u of [-half + 0.4, half - 0.4]) { const [x, z] = at(u); b.box(lx ? 0.6 : pl.r * 1.5, 0.5, lx ? pl.r * 1.5 : 0.6, pl.stripe, x, cy + pl.r * 0.92, z); } // what's left of its livery, over each doorway
      continue;
    }
    const [cx, cz] = at(-1.5);
    b.cyl(pl.r, pl.r, pl.len - 7, 14, ALU, cx, cy, cz, Math.PI / 2, yaw, 0);
    const [nx, nz] = at(half - 3.2); b.cone(pl.r, 5, 14, ALU, nx, cy, nz, Math.PI / 2, yaw, 0); // nose
    const [tx, tz] = at(-half + 1); b.cone(pl.r, 5, 14, ALU, tx, cy + 0.5, tz, -Math.PI / 2, yaw, 0); // tail cone
    const [fx, fz] = at(-half + 3); b.box(lx ? 4.5 : 0.35, 5.5, lx ? 0.35 : 4.5, pl.stripe, fx, cy + pl.r + 2.2, fz); // fin
    for (const side of [-1, 1]) { const [sx, sz] = at(-1.5, side * (pl.r + 0.02)); b.box(lx ? pl.len - 9 : 0.12, 0.5, lx ? 0.12 : pl.len - 9, pl.stripe, sx, cy + 0.5, sz); const [wx, wz] = at(0, side * (pl.r + 0.03)); b.box(lx ? pl.len - 14 : 0.1, 0.32, lx ? 0.1 : pl.len - 14, DARK, wx, cy + 1.05, wz); } // stripe and windows
    if (lx) addBox(pl.x, pl.z, pl.len - 2, pl.r * 1.8, pl.r * 1.6); else addBox(pl.x, pl.z, pl.r * 1.8, pl.len - 2, pl.r * 1.6);
  }
  for (const [x, z, w, d, h] of STACKS) {
    // three layers of crushed cars, each a little askew
    const along = w > d, n = Math.round(Math.max(w, d) / 4.4), y = gy(x, z);
    for (let layer = 0; layer < 3; layer++) for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n * Math.max(w, d) - Math.max(w, d) / 2, j = (r() - 0.5) * 0.5;
      b.box(along ? 4.1 : 3.4, h / 3 - 0.08, along ? 3.4 : 4.1, WRECK_COLS[Math.floor(r() * WRECK_COLS.length)], OX + x + (along ? u : j), y + (layer + 0.5) * h / 3, OZ + z + (along ? j : u), 0, (r() - 0.5) * 0.12, 0);
    }
    addBox(x, z, w, d, h);
  }
  for (const [x, z, rad, h] of JUNK) {
    const y = gy(x, z);
    if (h > 4) { b.box(0.4, h, 3.6, ALU, OX + x, y + h / 2, OZ + z, 0, r() * TAU, 0.12); b.box(0.45, 1.1, 3.7, 0x9a4a3a, OX + x, y + h - 0.9, OZ + z, 0, 0, 0.12); } // a tail fin stuck in the ground
    else { b.cyl(rad, rad * 0.8, 4.6, 12, ALU, OX + x, y + rad * 0.85, OZ + z, Math.PI / 2, r() * TAU, 0); b.cyl(rad * 0.7, rad * 0.7, 0.3, 12, DARK, OX + x, y + rad * 0.85, OZ + z, Math.PI / 2, 0, 0); } // an engine pod
    addCircle(x, z, rad + 0.3, h);
  }
  // the pit's ramps: planks on a frame
  for (const R of RAMPS) {
    const g = new THREE.BoxGeometry(R.w, 1, R.len, 1, 1, 8), P = g.attributes.position;
    for (let i = 0; i < P.count; i++) P.setY(i, P.getY(i) > 0 ? (P.getZ(i) + R.len / 2) / R.len * R.h + 0.04 : -0.4);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8a5a36 })); m.position.set(OX + R.x, R.base, OZ + R.z); m.rotation.y = R.yaw; m.castShadow = true; m.receiveShadow = true; addToScene(m, 'town');
  }
  const mesh = new THREE.Mesh(b.build(), MAT_VC); mesh.castShadow = true; mesh.receiveShadow = true; addToScene(mesh, 'town');
}

/** Things to blow up: fuel pumps and barrels by the planes, a billboard at the gate, the yard's water tower. */
export function buildProps() {
  const put = (kind: string, x: number, z: number, opts?: object) => placeProp(kind, OX + x, OZ + z, opts);
  put('tower', -40, 118);
  put('billboard', 0, -150, { text: 'Calder Air Salvage', bg: '#3a6a8a', fg: '#f6ead4', yaw: 0 });
  put('billboard', 150, 60, { text: 'No Trespassing', bg: '#c0392b', fg: '#f6ead4', yaw: -Math.PI / 2 });
  for (const [x, z] of [[-70, -92], [-66, -92], [112, -38], [112, -34], [60, 104]]) put('pump', x, z);
  for (const [x, z] of [[-30, -62], [-28.6, -61.4], [-29.4, -60.2], [52, -56], [53.3, -55.2], [84, 20], [20, 68], [21.2, 69], [-42, 60], [-90, 30], [-91.2, 31.1], [0, 0], [1.3, 0.6], [0.4, 1.5], [-120, -40], [120, 0], [0, 150]]) put('barrel', x, z);
  finishProps();
}
