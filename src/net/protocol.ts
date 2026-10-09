// The messages sent many times a second, packed into bytes: a guest's controls (about 30 a second) and the host's
// snapshots of the match (20 a second). Everything else is a JSON message (types.ts Msg).
//
// Controls carry one-shot presses (fire, special, switch weapon...) as counters, not flags: the host acts on a
// press when its counter moves, so a press is never lost or repeated, however the packets arrive. The car a guest
// is aiming at (Tab, or a tapped name tag) is the guest's own choice: it goes over the same way, when it changes.
import { WEAPON_ORDER } from '../combat/arsenal';
import { MINES, PROJ } from '../combat/pools.js';
import { G } from '../game/state.js';
import { mapAt } from '../maps/registry';
import type { Car } from '../modes/types';
import { PICK, PICKUPS } from '../world/pickups';
import { PLATES } from '../world/plates';

export const INPUT = 1, SNAP = 2;

// ---------- bytes ----------
class Out {
  v = new DataView(new ArrayBuffer(16384)); o = 0;
  private room(n: number) { if (this.o + n > this.v.byteLength) { const b = new Uint8Array(this.v.byteLength * 2); b.set(new Uint8Array(this.v.buffer)); this.v = new DataView(b.buffer); } }
  u8(x: number) { this.room(1); this.v.setUint8(this.o, x); this.o += 1; }
  i8(x: number) { this.room(1); this.v.setInt8(this.o, Math.max(-128, Math.min(127, Math.round(x)))); this.o += 1; }
  u16(x: number) { this.room(2); this.v.setUint16(this.o, Math.max(0, Math.min(65535, Math.round(x)))); this.o += 2; }
  i16(x: number) { this.room(2); this.v.setInt16(this.o, Math.max(-32768, Math.min(32767, Math.round(x)))); this.o += 2; }
  u32(x: number) { this.room(4); this.v.setUint32(this.o, x >>> 0); this.o += 4; }
  f32(x: number) { this.room(4); this.v.setFloat32(this.o, x); this.o += 4; }
  done() { return this.v.buffer.slice(0, this.o) as ArrayBuffer; }
}
class In {
  v: DataView; o = 0;
  constructor(b: ArrayBuffer) { this.v = new DataView(b); }
  u8() { return this.v.getUint8(this.o++); }
  i8() { return this.v.getInt8(this.o++); }
  u16() { const x = this.v.getUint16(this.o); this.o += 2; return x; }
  i16() { const x = this.v.getInt16(this.o); this.o += 2; return x; }
  u32() { const x = this.v.getUint32(this.o); this.o += 4; return x; }
  f32() { const x = this.v.getFloat32(this.o); this.o += 4; return x; }
}
/** What kind of message some bytes are. */
export const kindOf = (b: ArrayBuffer) => new DataView(b).getUint8(0);

// ---------- controls ----------
/** A guest's controls: what's held, and running counts of each one-shot press. */
export interface Input {
  seq: number; throttle: number; steer: number; handbrake: boolean; mg: boolean; w: boolean; aim: number; pref: number;
  fire: number; combo: number; special: number; cycle: number; cycleDir: number; prefN: number; flip: number;
}
export function encodeInput(i: Input): ArrayBuffer {
  const o = new Out(); o.u8(INPUT); o.u16(i.seq);
  o.i8(i.throttle * 127); o.i8(i.steer * 127); o.u8((i.handbrake ? 1 : 0) | (i.mg ? 2 : 0) | (i.w ? 4 : 0)); o.u8(i.aim * 50); o.i8(i.pref);
  for (const n of [i.fire, i.combo, i.special, i.cycle]) o.u8(n & 255);
  o.i8(i.cycleDir); o.u8(i.prefN & 255); o.u8(i.flip & 255);
  return o.done();
}
export function decodeInput(b: ArrayBuffer): Input {
  const r = new In(b); r.u8();
  const seq = r.u16(), throttle = r.i8() / 127, steer = r.i8() / 127, f = r.u8(), aim = r.u8() / 50, pref = r.i8();
  const fire = r.u8(), combo = r.u8(), special = r.u8(), cycle = r.u8(), cycleDir = r.i8(), prefN = r.u8(), flip = r.u8();
  return { seq, throttle, steer, handbrake: !!(f & 1), mg: !!(f & 2), w: !!(f & 4), aim, pref, fire, combo, special, cycle, cycleDir, prefN, flip };
}

// ---------- snapshots ----------
/** Projectile types, in the order snapshots number them, and the pooled mesh each is drawn with. */
export const PROJ_TYPES = ['bullet', 'missile', 'rocket', 'flare', 'shell', 'smokeshell', 'minetoss', 'fireball', 'cannon', 'scrap', 'bomblet', 'ice'];
export const PROJ_MESH: Record<string, string> = { smokeshell: 'shell', minetoss: 'mine', bomblet: 'scrap' };
const PICK_TYPES = Object.keys(PICK);
const F_ALIVE = 1, F_GROUND = 2, F_FLAME = 4, F_MGLOCK = 8, F_AXIS = 16, F_RACE = 32;

export interface RaceSnap { lap: number; section: number; path: number; i: number; s: number; finished: number; best: number; lapTimes: number[] }
export interface CarSnap {
  pid: number; x: number; y: number; z: number; yaw: number; vx: number; vy: number; vz: number; ux: number; uz: number;
  tumble: number; tumbleAxis: number; alive: boolean; grounded: boolean; flameOn: boolean; mgLocked: boolean; hp: number;
  weapon: string | null; ammo: number[]; special: number; kills: number; place: number; wreckedBy: number; speedK: number; accelK: number;
  steer: number; throttle: number; shieldT: number; frozen: number; burning: number; boost: number; flash: number; dealt: number;
  race: RaceSnap | null;
}
export interface ProjSnap { id: number; type: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface Snap {
  seq: number; now: number; time: number; clock: number; countdown: number; over: boolean;
  cars: CarSnap[]; proj: ProjSnap[]; mines: Array<{ x: number; y: number; z: number; light: boolean }>;
  picks: number[]; plates: boolean[];
}
/** The parts of a car (cars/car.js) a snapshot carries beyond what modes use. */
export type NetCar = Car & {
  up: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; tumble: number; tumbleAxis: number; grounded: boolean; flameOn: boolean;
  flash: number; frozen: number; boost: number; input: { throttle: number; steer: number; handbrake: boolean };
};
/** The pickups and plates of the map being played, in an order every screen agrees on. */
export const mapPickups = () => PICKUPS.filter(p => mapAt(p.x) === G.map);
export const mapPlates = () => PLATES.filter(p => mapAt(p.x) === G.map);

/** The match as it is now, from the host. `now` is the host's clock (seconds) for the guests' interpolation. */
export function encodeSnap(seq: number, now: number): ArrayBuffer {
  const o = new Out(); o.u8(SNAP); o.u32(seq); o.f32(now); o.f32(G.time); o.f32(G.clock); o.f32(G.countdown); o.u8(G.state === 'over' ? 1 : 0);
  const cars = G.cars as NetCar[];
  o.u8(cars.length);
  for (const c of cars) {
    const r = c.race;
    o.u8(c.pid); o.f32(c.x); o.f32(c.y); o.f32(c.z); o.f32(c.yaw);
    o.i16(c.vx * 100); o.i16(c.vy * 100); o.i16(c.vz * 100); o.i16(c.up.x * 30000); o.i16(c.up.z * 30000); o.f32(c.tumble);
    o.u8((c.alive ? F_ALIVE : 0) | (c.grounded ? F_GROUND : 0) | (c.flameOn ? F_FLAME : 0) | (c.mgLocked ? F_MGLOCK : 0) | (c.tumbleAxis ? F_AXIS : 0) | (r ? F_RACE : 0));
    o.u16(Math.max(0, c.hp) * 10); o.u8(c.weapon ? WEAPON_ORDER.indexOf(c.weapon as never) + 1 : 0);
    for (const w of WEAPON_ORDER) o.u16(c.ammo[w] * 100);
    o.u8(c.special); o.u8(c.kills); o.u8(c.place); o.i8(c.wreckedBy ? c.wreckedBy.pid : -1); o.u16(c.speedK * 10000); o.u16(c.accelK * 10000);
    o.i8(c.input.steer * 127); o.i8(c.input.throttle * 127);
    for (const t of [c.shieldT, c.frozen, c.burning, c.boost]) o.u8(Math.max(0, t) * 10);
    o.u8(c.flash * 100); o.u16(c.dealt);
    if (r) {
      const p = r.progress; o.u8(p.lap); o.u8(p.section); o.u8(p.path); o.u16(p.i); o.f32(p.s); o.f32(r.finished); o.f32(r.best);
      o.u8(r.lapTimes.length); for (const t of r.lapTimes) o.f32(t);
    }
  }
  const proj = PROJ.filter(p => p.mesh);
  o.u16(proj.length);
  for (const p of proj) { o.u16(p.id); o.u8(PROJ_TYPES.indexOf(p.type)); o.f32(p.x); o.f32(p.y); o.f32(p.z); o.i16(p.vx * 10); o.i16(p.vy * 10); o.i16(p.vz * 10); }
  o.u8(Math.min(255, MINES.length));
  for (const m of MINES.slice(0, 255)) { o.f32(m.x); o.f32(m.y); o.f32(m.z); o.u8(m.mesh.userData.light.visible ? 1 : 0); }
  const picks = mapPickups(); o.u8(picks.length); for (const p of picks) o.u8((p.active ? 128 : 0) | PICK_TYPES.indexOf(p.type));
  const plates = mapPlates(); o.u8(plates.length); for (const p of plates) o.u8(p.armed ? 1 : 0);
  return o.done();
}
export function decodeSnap(b: ArrayBuffer): Snap {
  const r = new In(b); r.u8();
  const s: Snap = { seq: r.u32(), now: r.f32(), time: r.f32(), clock: r.f32(), countdown: r.f32(), over: r.u8() === 1, cars: [], proj: [], mines: [], picks: [], plates: [] };
  for (let n = r.u8(); n > 0; n--) {
    const pid = r.u8(), x = r.f32(), y = r.f32(), z = r.f32(), yaw = r.f32();
    const vx = r.i16() / 100, vy = r.i16() / 100, vz = r.i16() / 100, ux = r.i16() / 30000, uz = r.i16() / 30000, tumble = r.f32(), f = r.u8();
    const hp = r.u16() / 10, wi = r.u8(), ammo = WEAPON_ORDER.map(() => r.u16() / 100);
    const special = r.u8(), kills = r.u8(), place = r.u8(), wreckedBy = r.i8(), speedK = r.u16() / 10000, accelK = r.u16() / 10000, steer = r.i8() / 127, throttle = r.i8() / 127;
    const shieldT = r.u8() / 10, frozen = r.u8() / 10, burning = r.u8() / 10, boost = r.u8() / 10, flash = r.u8() / 100, dealt = r.u16();
    let race: RaceSnap | null = null;
    if (f & F_RACE) {
      race = { lap: r.u8(), section: r.u8(), path: r.u8(), i: r.u16(), s: r.f32(), finished: r.f32(), best: r.f32(), lapTimes: [] };
      for (let k = r.u8(); k > 0; k--) race.lapTimes.push(r.f32());
    }
    s.cars.push({
      pid, x, y, z, yaw, vx, vy, vz, ux, uz, tumble, tumbleAxis: f & F_AXIS ? 1 : 0, alive: !!(f & F_ALIVE), grounded: !!(f & F_GROUND), flameOn: !!(f & F_FLAME),
      mgLocked: !!(f & F_MGLOCK), hp, weapon: wi ? WEAPON_ORDER[wi - 1] : null, ammo, special, kills, place, wreckedBy, speedK, accelK, steer, throttle,
      shieldT, frozen, burning, boost, flash, dealt, race,
    });
  }
  for (let n = r.u16(); n > 0; n--) {
    const p = { id: r.u16(), type: PROJ_TYPES[r.u8()], x: r.f32(), y: r.f32(), z: r.f32(), vx: r.i16() / 10, vy: r.i16() / 10, vz: r.i16() / 10 };
    if (p.type) s.proj.push(p); // a kind this version doesn't know is left out
  }
  for (let n = r.u8(); n > 0; n--) s.mines.push({ x: r.f32(), y: r.f32(), z: r.f32(), light: r.u8() === 1 });
  for (let n = r.u8(); n > 0; n--) s.picks.push(r.u8());
  for (let n = r.u8(); n > 0; n--) s.plates.push(r.u8() === 1);
  return s;
}
/** A pickup byte from a snapshot: whether it's there, and its type. */
export const pickOf = (b: number) => ({ active: (b & 128) !== 0, type: PICK_TYPES[b & 127] });
