import { C_CHROME, M_CHROME, M_PAINT, M_TRIM } from '../model/constants.js';
import { kf, loftZ } from '../model/loft.js';
import { FONT_COND, rustSpot } from './shared.js';
import { mat4 } from '../../engine/geometry.js';

// --- Hookjaw: a heavy wrecker, boom and winch on the back ---
export function hookjaw(K, def) {
  const P = def.color, BLK = 0x1c1c20, AMB = 0xe9a520, UNDER = [M_TRIM, 0x1a1716];
  const hood = loftZ({ z: [0.85, 2.5], step: 0.12, y0: () => 0.86, y1: kf([[0.85, 1.62], [2.2, 1.56], [2.5, 1.4]]), w: kf([[0.85, 0.82], [2.3, 0.8], [2.5, 0.74]]), wt: (z, w) => w - 0.08, rb: 0.04, rt: 0.12, crown: 0.03 });
  K.loft(hood, P);
  const fen = loftZ({ z: [0.6, 2.56], step: 0.1, arches: [[1.65, 0.56, 0.64]], y0: kf([[0.6, 0.7], [1.0, 0.64], [2.56, 0.76]]), y1: kf([[0.6, 0.96], [1.0, 1.24], [1.65, 1.36], [2.3, 1.32], [2.56, 1.12]]), w: kf([[0.6, 0.26], [1.0, 0.3], [2.56, 0.28]]), rb: 0.05, rt: 0.1 });
  for (const s of [-1, 1]) K.loft(fen, (x, y, z, nx, ny) => ny < -0.6 ? UNDER : BLK, mat4(s * 0.94, 0, 0));
  const cab = loftZ({ z: [-0.7, 0.95], step: 0.1, keys: [0.86, 0.5, -0.56], creases: [0.86], y0: () => 0.78, y1: kf([[-0.7, 2.2], [-0.56, 2.24], [0.5, 2.24], [0.86, 1.68], [0.95, 1.62]]), w: () => 1.06, wt: () => 0.94, rb: 0.05, rt: 0.14 });
  K.loft(cab, (x, y, z, nx, ny) => ny < -0.6 ? UNDER : P);
  // frame, deck, tool lockers, tail board
  K.box(M_TRIM, 1.1, 0.16, 5.4, 0x18181a, 0, 0.7, -0.5);
  K.box(M_TRIM, 2.0, 0.12, 2.5, 0x2a2a2e, 0, 1.0, -1.98);
  for (const s of [-1, 1]) { K.rbox(M_PAINT, 0.3, 0.46, 2.46, 0.04, P, s * 0.86, 1.29, -1.98); K.rbox(M_CHROME, 0.32, 0.04, 2.5, 0.015, 0x8a8a8a, s * 0.86, 1.54, -1.98); for (const z of [-1.3, -2.1, -2.9]) K.box(M_CHROME, 0.02, 0.05, 0.14, C_CHROME, s * 1.02, 1.32, z); }
  K.rbox(M_PAINT, 2.0, 0.56, 0.08, 0.03, BLK, 0, 1.3, -3.22);
  // the boom: an A-frame over the deck, braced, with the winch at its foot and the hook on its cable
  for (const s of [-1, 1]) {
    K.tube(M_PAINT, [[s * 0.62, 1.08, -1.0], [s * 0.42, 2.0, -2.1], [s * 0.12, 2.72, -3.3]], 0.075, AMB, 14);
    K.tube(M_PAINT, [[s * 0.62, 1.08, -2.9], [s * 0.36, 1.9, -2.75], [s * 0.2, 2.42, -2.92]], 0.05, AMB, 10);
  }
  K.cylX(M_PAINT, 0.05, 0.84, 8, AMB, 0, 2.0, -2.1).cylX(M_CHROME, 0.11, 0.3, 12, 0x5a5a60, 0, 2.72, -3.3);
  K.cylX(M_CHROME, 0.21, 0.74, 14, 0x6a6a70, 0, 1.3, -1.12).cylX(M_TRIM, 0.26, 0.06, 14, BLK, -0.4, 1.3, -1.12).cylX(M_TRIM, 0.26, 0.06, 14, BLK, 0.4, 1.3, -1.12);
  K.tube(M_TRIM, [[0, 1.5, -1.14], [0, 2.3, -2.4], [0, 2.8, -3.3]], 0.016, 0x8a8a8a, 8).cyl(M_TRIM, 0.016, 0.016, 0.8, 5, 0x8a8a8a, 0, 2.3, -3.36);
  K.torus(M_CHROME, 0.15, 0.045, 0xa0a0a6, 0, 1.76, -3.36, 0, Math.PI / 2, 0.4, Math.PI * 1.45, 14).box(M_CHROME, 0.08, 0.16, 0.08, 0xa0a0a6, 0, 1.9, -3.36);
  // beacons, stack, mirrors
  K.rbox(M_CHROME, 1.3, 0.07, 0.26, 0.03, 0x8a8a8a, 0, 2.3, -0.1).lamp(0.36, 2.4, -0.02, 1, 'amber', 'rect', 0.36, 0.13, false);
  K.cyl(M_CHROME, 0.07, 0.07, 1.7, 12, C_CHROME, 1.02, 1.9, -0.6).cyl(M_CHROME, 0.095, 0.095, 0.5, 12, 0x9a9a94, 1.02, 1.5, -0.6);
  for (const s of [-1, 1]) { K.tube(M_CHROME, [[s * 1.04, 1.6, 0.74], [s * 1.2, 1.72, 0.72], [s * 1.26, 1.8, 0.7]], 0.016, C_CHROME, 8); K.rbox(M_CHROME, 0.04, 0.3, 0.16, 0.02, C_CHROME, s * 1.28, 1.9, 0.7); }
  // front: grille, lamps, a push bumper with a plate either side
  K.rbox(M_CHROME, 1.36, 0.56, 0.06, 0.05, C_CHROME, 0, 1.14, 2.5).rbox(M_TRIM, 1.2, 0.44, 0.06, 0.03, 0x121212, 0, 1.14, 2.52);
  for (let i = -3; i <= 3; i++) K.box(M_CHROME, 0.02, 0.42, 0.02, 0xc8c8c8, i * 0.17, 1.14, 2.56);
  K.lamp(0.94, 1.2, 2.57, 1, 'head', 'round', 0.13).lamp(0.94, 0.94, 2.56, 1, 'amber', 'round', 0.05);
  K.rbox(M_TRIM, 2.36, 0.3, 0.22, 0.07, BLK, 0, 0.66, 2.7);
  for (const s of [-1, 1]) K.rbox(M_TRIM, 0.34, 0.7, 0.1, 0.04, 0x2c2c30, s * 0.5, 1.0, 2.84).box(M_TRIM, 0.3, 0.1, 0.02, AMB, s * 0.5, 1.22, 2.9).box(M_TRIM, 0.3, 0.1, 0.02, AMB, s * 0.5, 0.86, 2.9);
  K.lamp(0.8, 1.3, -3.27, -1, 'tail', 'rect', 0.22, 0.1);
  K.rbox(M_CHROME, 2.1, 0.14, 0.16, 0.04, 0x5a5a5e, 0, 0.74, -3.3);
  // glass
  K.sideGlass(cab, -0.6, 0.9, 1.72, { heads: [-0.05], pillars: [[0.52, 0.03]] });
  K.topGlass(cab, 0.52, 0.86, { margin: 0.05, heads: [-0.42], headAt: 0.1 });
  // lettering, hazard chevrons, rust
  K.decal({ kind: 'side', L: cab, twin: true, a0: -0.7, a1: 0.95, b0: 0.78, b1: 1.72, draw: D => {
    const c = D.ctx; c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 0.012; c.beginPath(); c.moveTo(0.72, 1.7); c.lineTo(0.72, 0.86); c.lineTo(-0.5, 0.86); c.lineTo(-0.5, 1.7); c.stroke();
    D.text('CALDER', 0.1, 1.4, 0.2, '#f2e6c8', { font: FONT_COND, weight: '700', stroke: 'rgba(20,20,20,0.6)', strokeW: 0.015 });
    D.text('TOWING · DAY & NIGHT', 0.1, 1.22, 0.075, '#f2e6c8', { font: FONT_COND, weight: '700' });
    rustSpot(D, -0.55, 0.92, 0.06, 41);
  } });
  K.decal({ kind: 'back', z: -3.27, a0: -0.98, a1: 0.98, b0: 1.04, b1: 1.56, draw: D => {
    const c = D.ctx; c.save(); c.beginPath(); c.rect(-0.96, 1.06, 1.92, 0.48); c.clip();
    for (let i = -8; i < 9; i++) { c.fillStyle = i % 2 ? '#e9a520' : '#1c1c20'; c.beginPath(); const x = i * 0.24; c.moveTo(x, 1.04); c.lineTo(x + 0.24, 1.04); c.lineTo(x + 0.76, 1.56); c.lineTo(x + 0.52, 1.56); c.fill(); }
    c.restore();
    c.fillStyle = '#1c1c20'; c.fillRect(-0.5, 1.2, 1.0, 0.2); D.text('HOOKJAW', 0, 1.3, 0.14, '#f2e6c8', { font: FONT_COND, weight: '700' });
  } });
  K.decal({ kind: 'top', L: hood, fit: true, b0: 0.88, b1: 2.48, draw: D => { rustSpot(D, 0.35, 1.9, 0.1, 51, 'rgba(60,40,70,0.6)'); } });
  K.gun(0.8, 1.64, 2.02);
  K.wheel(1.0, 0.56, 1.65, 0.56, 0.44, 1, { rim: 'steel', rimCol: 0x2a2a2e, tread: 'mud', trimRing: true }).wheel(0.98, 0.58, -2.05, 0.58, 0.62, 0, { rim: 'steel', rimCol: 0x2a2a2e, tread: 'mud', trimRing: true });
}
