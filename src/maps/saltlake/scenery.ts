// Salt Lake Run's own scenery, on top of what every course gets (world/course-scenery.ts): boats left where the
// water went, the pier's pilings, the drive-in's screen and the pumps and speaker posts in its lot.
import * as THREE from 'three';
import { MAT_VC, PB } from '../../engine/geometry.js';
import { addToScene } from '../../engine/renderer.js';
import { mulberry32 } from '../../engine/util.js';
import { type At } from '../../world/course';
import { placeProp } from '../../world/props.js';
import { TRACK } from './track';

const HULLS = [0xe9e2d2, 0x9fc4c8, 0xd98a5a, 0xc9c0a8, 0x7fa0b8];
/** A boat on its keel, leaning: hull, cabin, a stub of mast. Left to the map's one merged mesh. */
function boat(b: PB, x: number, y: number, z: number, yaw: number, size: number, lean: number, col: number) {
  const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(lean)), v = new THREE.Vector3();
  const at = (lx: number, ly: number, lz: number) => v.set(lx * size, ly * size, lz * size).applyMatrix4(m).add(new THREE.Vector3(x, y, z));
  const part = (w: number, h: number, d: number, c: number, lx: number, ly: number, lz: number) => { const p = at(lx, ly, lz); b.box(w * size, h * size, d * size, c, p.x, p.y, p.z, 0, yaw, lean); };
  part(3.2, 1.3, 7, col, 0, 0.9, -0.6); part(2.4, 1.1, 2.4, col, 0, 0.8, 3.6); part(1.3, 0.9, 1.4, col, 0, 0.7, 5.2); // hull, narrowing to the bow
  part(3.3, 0.18, 7.1, 0x5a4a40, 0, 1.6, -0.6); // deck
  part(2.2, 1.3, 2.6, 0xf1ece0, 0, 2.3, -1.6); part(2.3, 0.14, 2.8, 0x6a5a50, 0, 3.0, -1.6); // cabin and its roof
  part(0.16, 3.2, 0.16, 0x4a3a30, 0, 3.4, 1.2); // mast stub
}
/** The map's scenery that nothing drives into: one merged mesh. */
export function buildSaltLakeScenery() {
  const b = new PB(), r = mulberry32(1977), { place } = TRACK, ground = TRACK.height;
  // boats: thick in the graveyard, a few by the marina and along the shore, all clear of the road
  const boats: Array<[string, number, number]> = [['Boat graveyard', 9, 14], ['Marina', 5, 12], ['Shoreline', 4, 12], ['Home straight', 3, 20]];
  for (const [name, n, half] of boats) for (let k = 0; k < n; k++) {
    const side = r() < 0.5 ? -1 : 1, at = place([name, (k + 0.3 + r() * 0.4) / n, side * (half + 8 + r() * 26)] as At);
    if (TRACK.nearest(at.x, at.z)?.e as number < 5) continue; // not where another road runs
    boat(b, at.x, ground(at.x, at.z) - 0.3, at.z, r() * Math.PI * 2, 0.9 + r() * 0.9, (r() - 0.5) * 0.7, HULLS[k % HULLS.length]);
  }
  // the pier: pilings and a rail either side of the jump's run-up and landing
  const pier = TRACK.paths.find(p => p.name === 'Pier jump')!;
  for (let i = 4; i < pier.x.length - 4; i += 4) {
    if (pier.gap && pier.s[i] > pier.gap[0] - 3 && pier.s[i] < pier.gap[1] + 3) continue;
    for (const side of [-1, 1]) { const lat = side * (pier.half + 1.2), x = pier.x[i] + pier.tz[i] * lat, z = pier.z[i] - pier.tx[i] * lat; b.cyl(0.28, 0.32, 3.2, 6, 0x5a4636, x, pier.y[i] + 1.2, z); }
  }
  // the drive-in: the screen facing the lot, and its ticket booth
  const scr = place(['Drive-in', 0.5, -34]), yaw = scr.yaw + Math.PI / 2, gy = ground(scr.x, scr.z);
  b.box(30, 13, 0.8, 0xf4f0e6, scr.x, gy + 12, scr.z, 0, yaw, 0); b.box(31, 14, 0.5, 0x3a2a30, scr.x + Math.sin(yaw) * 0.5, gy + 12, scr.z + Math.cos(yaw) * 0.5, 0, yaw, 0);
  for (const s of [-11, 0, 11]) b.box(0.8, 12, 0.8, 0x3a2a30, scr.x + Math.cos(yaw) * s, gy + 5, scr.z - Math.sin(yaw) * s, 0, yaw, 0);
  const booth = place(['Drive-in', 0.06, 17]); b.box(3, 3, 3, 0xd98a5a, booth.x, ground(booth.x, booth.z) + 1.5, booth.z, 0, booth.yaw, 0); b.box(3.6, 0.3, 3.6, 0x3a2a30, booth.x, ground(booth.x, booth.z) + 3.1, booth.z, 0, booth.yaw, 0);
  const mesh = new THREE.Mesh(b.build(), MAT_VC); mesh.castShadow = true; mesh.receiveShadow = true; addToScene(mesh, 'track');
}
/** Things in the drive-in's lot to smash through or steer round (world/props): pumps by the booth, a billboard, a water tower by the marina. */
export function placeSaltLakeProps() {
  const { place } = TRACK;
  for (const at of [['Drive-in', 0.18, -8], ['Drive-in', 0.42, 7], ['Drive-in', 0.8, -6]] as At[]) { const p = place(at); placeProp('pump', p.x, p.z); }
  const sign = place(['Drive-in', 0.9, 19]); placeProp('billboard', sign.x, sign.z, { yaw: sign.yaw + Math.PI, text: 'STARLITE DRIVE-IN', bg: '#1f7a7a', fg: '#f6ead4' });
  const tower = place(['Marina', 0.6, 20]); placeProp('tower', tower.x, tower.z);
}
