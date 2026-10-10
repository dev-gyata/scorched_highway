import { C_CHROME, M_CHROME, M_PAINT, M_TRIM } from '../model/constants.js';
import { kf, loftZ } from '../model/loft.js';
import { FONT_COND } from './shared.js';

// --- Dust Devil: a fibreglass dune buggy, all roll cage and rear tyres ---
export function dustdevil(K, def) {
  const P = def.color, CAGE = 0x26262c, SEAT = 0x1c1c20;
  // the tub: a low nose rising to the cowl, a shallow open cockpit, a short tail
  const tub = loftZ({ z: [-1.25, 1.75], step: 0.1, y0: kf([[-1.25, 0.62], [1.2, 0.56], [1.75, 0.7]]), y1: kf([[-1.25, 1.0], [-0.6, 0.98], [0.35, 1.06], [0.62, 1.2], [1.3, 1.0], [1.75, 0.82]]), w: kf([[-1.25, 0.74], [0.4, 0.78], [1.2, 0.6], [1.75, 0.36]]), wt: (z, w) => w - 0.08, rb: 0.06, rt: 0.14, crown: 0.04 });
  K.loft(tub, (x, y, z, nx, ny) => ny < -0.6 ? [M_TRIM, 0x1a1716] : P);
  // cockpit: two bucket seats, a wheel, a low screen
  for (const s of [-1, 1]) K.rbox(M_TRIM, 0.44, 0.14, 0.5, 0.05, SEAT, s * 0.34, 1.06, -0.3).rbox(M_TRIM, 0.44, 0.62, 0.14, 0.05, SEAT, s * 0.34, 1.34, -0.6, -0.18);
  K.torus(M_TRIM, 0.15, 0.022, 0x111111, -0.34, 1.3, 0.2, 0.5, 0, 0).cyl(M_TRIM, 0.02, 0.02, 0.3, 6, 0x333333, -0.34, 1.22, 0.32, 1.0);
  K.rbox(M_TRIM, 1.2, 0.2, 0.03, 0.01, 0x10181c, 0, 1.3, 0.56, -0.5);
  // roll cage: a hoop down each side, tied across front and back, braced to the tail
  for (const s of [-1, 1]) {
    K.tube(M_TRIM, [[s * 0.74, 1.0, 0.6], [s * 0.68, 1.6, 0.3], [s * 0.66, 1.84, 0.1], [s * 0.66, 1.86, -0.7], [s * 0.7, 1.5, -1.0], [s * 0.74, 0.98, -1.18]], 0.045, CAGE, 30);
    K.tube(M_TRIM, [[s * 0.66, 1.86, -0.7], [s * 0.5, 1.3, -1.6], [s * 0.42, 0.9, -1.95]], 0.035, CAGE, 12);
  }
  K.cylX(M_TRIM, 0.045, 1.32, 8, CAGE, 0, 1.84, 0.1).cylX(M_TRIM, 0.045, 1.32, 8, CAGE, 0, 1.86, -0.7).cylX(M_TRIM, 0.035, 0.86, 8, CAGE, 0, 0.9, -1.95);
  K.lamp(0.2, 1.97, 0.14, 1, 'fog', 'round', 0.085, 0, false).lamp(0.5, 1.97, 0.14, 1, 'fog', 'round', 0.085, 0, false);
  for (const x of [-0.5, -0.2, 0.2, 0.5]) K.cylZ(M_TRIM, 0.1, 0.12, 10, 0x1a1a1a, x, 1.97, 0.08);
  // the motor hangs out the back: flat four, fan shroud, twin stingers
  K.rbox(M_CHROME, 0.78, 0.3, 0.56, 0.06, 0x8c8c90, 0, 0.84, -1.56).rbox(M_TRIM, 0.4, 0.4, 0.3, 0.1, 0x202024, 0, 1.08, -1.46);
  K.cylZ(M_CHROME, 0.17, 0.08, 14, C_CHROME, 0, 1.08, -1.64).cylX(M_CHROME, 0.07, 0.86, 10, 0x6a6a6e, 0, 0.96, -1.72);
  for (const s of [-1, 1]) K.tube(M_CHROME, [[s * 0.36, 0.78, -1.7], [s * 0.4, 0.86, -2.0], [s * 0.4, 1.16, -2.24], [s * 0.4, 1.46, -2.4]], 0.045, C_CHROME, 14);
  // front end: beam, arms out to the wheels, a nerf bar
  K.cylX(M_TRIM, 0.04, 1.7, 8, 0x2a2a2a, 0, 0.44, 1.35);
  for (const s of [-1, 1]) K.tube(M_TRIM, [[s * 0.4, 0.66, 1.0], [s * 0.7, 0.5, 1.3], [s * 0.86, 0.42, 1.35]], 0.03, 0x2a2a2a, 8).cyl(M_CHROME, 0.03, 0.03, 0.5, 6, 0xb0b0b0, s * 0.62, 0.72, 1.3, 0, 0, s * 0.5);
  K.tube(M_CHROME, [[-0.5, 0.6, 1.76], [-0.3, 0.52, 1.92], [0.3, 0.52, 1.92], [0.5, 0.6, 1.76]], 0.035, C_CHROME, 14);
  K.lamp(0.3, 0.98, 1.6, 1, 'head', 'round', 0.11).lamp(0.6, 0.94, -1.27, -1, 'tail', 'round', 0.06);
  // whip flag
  K.cyl(M_TRIM, 0.012, 0.012, 2.2, 5, 0x3a3a3a, -0.62, 2.05, -1.12).box(M_PAINT, 0.02, 0.2, 0.36, 0xff7a14, -0.62, 3.02, -1.31);
  // number roundels and a stripe up the nose
  K.decal({ kind: 'side', L: tub, twin: true, a0: -1.25, a1: 1.75, b0: 0.56, b1: 1.2, draw: D => {
    const c = D.ctx; c.beginPath(); c.arc(-0.3, 0.8, 0.17, 0, Math.PI * 2); c.fillStyle = '#f6ead4'; c.fill(); c.lineWidth = 0.02; c.strokeStyle = '#1e1322'; c.stroke();
    D.text('13', -0.3, 0.8, 0.2, '#1e1322', { font: FONT_COND, weight: '700' });
    c.fillStyle = '#f6ead4'; c.fillRect(0.1, 0.68, 1.5, 0.05); c.fillStyle = '#ff7a14'; c.fillRect(0.1, 0.74, 1.3, 0.03);
  } });
  K.decal({ kind: 'top', L: tub, fit: true, b0: 0.66, b1: 1.74, draw: D => { const c = D.ctx; c.fillStyle = '#f6ead4'; c.fillRect(-0.11, 0.66, 0.22, 1.1); c.fillStyle = '#ff7a14'; c.fillRect(-0.035, 0.66, 0.07, 1.1); } });
  K.gun(0.52, 1.14, 1.05);
  K.wheel(0.92, 0.4, 1.35, 0.4, 0.26, 1, { rim: 'steel', rimCol: 0xe8e2d0, tread: 'mud' }).wheel(1.0, 0.58, -1.2, 0.58, 0.52, 0, { rim: 'steel', rimCol: 0xe8e2d0, tread: 'mud' });
}
