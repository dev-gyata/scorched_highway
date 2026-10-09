// A guest: sends this player's controls to the host and draws the match the way the host says it is.
// - Other cars are drawn a tenth of a second in the past, between the two snapshots either side of that moment,
//   so they move smoothly however the packets arrive.
// - This player's own car is driven here as well as on the host, so it answers the controls at once; it is eased
//   toward where the host has it (or put there, if it's far off: a big hit, a respawn).
// - Projectiles, mines, pickups and plates are shown as the latest snapshot has them; effects, feed lines and
//   messages arrive as events; falling boulders, toppling towers and smoke run here too, quietly (the host's copies
//   make the sounds). Nothing here deals damage: G.replica.
import { cycleTarget, flameFX, projectileLook, updateSmoke } from '../combat/weapons.js';
import { collideCars } from '../cars/car.js';
import { updateRings } from '../combat/effects.js';
import { takeMesh } from '../combat/pools.js';
import { emit, muffled, playEffect } from '../engine/events';
import { angDiff, clamp, lerp } from '../engine/util.js';
import { cueCountdown } from '../game/match.js';
import { G } from '../game/state.js';
import { readControls } from '../input/input.js';
import { updateHazards } from '../world/hazards';
import { mirrorPickup, updatePickups } from '../world/pickups';
import { mirrorPlates, updatePlates } from '../world/plates';
import { updateProps } from '../world/props.js';
import { hostLost, hostSilent, keepCheckpoint, migrated } from './migrate';
import { type CarSnap, type NetCar, PROJ_MESH, SNAP, type Snap, decodeSnap, encodeInput, kindOf, mapPickups, mapPlates, pickOf } from './protocol';
import { type Role, S, beginMatch, end, finishMatch, now, sendBytes } from './session';

const wait = document.getElementById('netWait') as HTMLElement;
/** Messages only the host may send. */
const FROM_HOST = new Set(['lobby', 'start', 'ev', 'over', 'lobbyback', 'busy', 'ck']);
/** How far behind the host other cars are drawn (s), and how often controls go to the host. */
const DELAY = 0.1, INPUT_RATE = 30;
/** Own car: how quickly it's eased toward where the host has it (per second), and how far off it may be before it's put there (m). */
const EASE = 3, SNAP_AT = 6;

type Car = NetCar & {
  ctl: Record<string, number | boolean>; pref: Car | null; contacts: unknown[]; resetCd: number; deathTime: number; wreckT: number; airT: number;
  update(dt: number): void; visuals(dt: number): void; sampleContacts(): void; wreckLook(): void; reset(x: number, z: number, yaw: number): void;
};
interface Shot { id: number; type: string; mesh: { visible: boolean; position: { set(x: number, y: number, z: number): void } }; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number }

export function guestRole(): Role {
  let snaps: Snap[] = [], off: number | null = null, last = -1, inT = 0, seq = 0, ownSet = false;
  const presses = { fire: 0, combo: 0, special: 0, cycle: 0, cycleDir: 0, prefN: 0, flip: 0, pref: -1 };
  const shots = new Map<number, Shot>(), mines: Array<Shot['mesh'] & { userData: { light: { visible: boolean } } }> = [];
  /** A new match: forget the last one's snapshots and meshes. */
  function reset() {
    snaps = []; last = -1; ownSet = false; presses.pref = -1;
    for (const s of shots.values()) s.mesh.visible = false; shots.clear();
    for (const m of mines) m.visible = false; mines.length = 0;
  }
  function take(s: Snap) {
    if (s.seq <= last) return; // late: a newer one is already here
    last = s.seq; snaps.push(s);
    // the host's clock, as best we can tell: the sample with the least delay wins, and it drifts slowly
    const sample = s.now - now();
    off = off === null || sample > off ? sample : off + (sample - off) * 0.002;
    if (snaps.length > 40) snaps.shift();
  }
  return {
    name: 'guest',
    message(from, m) {
      if (!S) return;
      if (m instanceof ArrayBuffer) { if (kindOf(m) === SNAP && from === S.host) take(decodeSnap(m)); return; }
      if (FROM_HOST.has(m.t) && from !== S.host) return; // only the host says how the room and the match are
      switch (m.t) {
        case 'lobby': S.players = m.players; S.opts = m.opts; S.code = m.code; S.host = m.host; meshUp(); S.onlobby(); break;
        case 'start': reset(); beginMatch(m.seats, m.opts, true); break;
        case 'ev': for (const e of m.e) { try { if (e.kind === 'fx') playEffect(e.name, e.args); else emit(e); } catch { /* one bad event mustn't stop the rest */ } } break;
        case 'over': finishMatch(m.r); break;
        case 'lobbyback': S.seats = null; S.onlobby(); break;
        case 'busy': end(m.why); break;
        case 'ck': if (from === S.host) keepCheckpoint(m); break;
        case 'migrated': migrated(from); break;
        case 'bye': S.t.drop(from); break;
      }
    },
    frame(rdt) {
      if (S && hostSilent(last >= 0)) { hostLost(); return; }
      if (!S?.seats || G.state !== 'playing' || (inT -= rdt) > 0) return;
      inT = 1 / INPUT_RATE;
      const k = (G.player as Car | null)?.ctl; if (!k) return;
      sendBytes(S.host, encodeInput({
        seq: seq = (seq + 1) & 0xffff, throttle: +k.throttle, steer: +k.steer, handbrake: !!k.handbrake, mg: !!k.mg, w: !!k.w, aim: +k.aim, ...presses,
      }));
    },
    closed(id) { if (S && id === S.host) hostLost(); },
    rehost() { snaps = []; last = -1; off = null; },
    dispose() { reset(); wait.hidden = true; },
    replica(dt) {
      const s = snaps[snaps.length - 1];
      wait.hidden = !!s && off !== null && now() + off - s.now < 0.6; // nothing new from the host for a moment
      if (!s || off === null) return;
      G.time += dt; G.clock = s.clock; G.countdown = s.countdown; cueCountdown();
      // the two snapshots either side of the moment drawn (or the latest, carried on a little, if none is newer)
      const t = now() + off - DELAY;
      while (snaps.length > 2 && snaps[1].now <= t) snaps.shift();
      const [a, b] = snaps.length > 1 && snaps[0].now <= t ? [snaps[0], snaps[1]] : [s, s];
      const k = b === a ? 0 : clamp((t - a.now) / (b.now - a.now), 0, 1), ahead = b === a ? clamp(t - s.now, 0, 0.25) : 0;
      const me = G.player as Car;
      if (me && G.state === 'playing' && me.alive) controls(me, dt);
      for (const cb of b.cars) {
        const c = G.cars[cb.pid] as Car; if (!c) continue;
        const ca = a.cars.find(o => o.pid === cb.pid) || cb, latest = s.cars.find(o => o.pid === cb.pid) || cb;
        if (c === me && latest.alive && me.alive && ownSet) { own(c, latest, s, dt); continue; }
        state(c, latest); place(c, ca, cb, k, ahead);
        if (c === me) { ownSet = latest.alive; c.speedK = latest.speedK; c.accelK = latest.accelK; }
        c.sampleContacts(); c.visuals(dt);
      }
      shotsFrom(a, b, k, ahead, dt); minesFrom(s);
      const picks = mapPickups(); s.picks.forEach((byte, i) => { const p = picks[i], { active, type } = pickOf(byte); if (p) mirrorPickup(p, active, type); });
      mirrorPlates(mapPlates(), s.plates);
      muffled(() => { updateSmoke(dt); updateProps(dt); updateHazards(dt); });
      updateRings(dt); updatePickups(dt, G.time); updatePlates(dt, G.time);
      for (const c of G.cars as Car[]) if (c.flameOn && c.alive) flameFX(c);
    },
  };

  /** This player's controls: held ones drive the car here; presses go to the host as counts (aiming is decided here). */
  function controls(me: Car, dt: number) {
    const k = me.ctl;
    readControls(me, dt, k);
    if (k.fire) { presses.fire++; presses.combo = +k.combo; k.fire = false; k.combo = 0; }
    if (k.special) { presses.special++; k.special = false; }
    if (k.cycle) { presses.cycle++; presses.cycleDir = +k.cycle; k.cycle = 0; }
    if (k.flip) { presses.flip++; k.flip = false; }
    if (k.target) { k.target = false; cycleTarget(me); }
    const pref = me.pref ? (me.pref as Car).pid : -1;
    if (pref !== presses.pref) { presses.pref = pref; presses.prefN++; }
  }
  /** This player's own car: driven here, then eased toward where the host has it, carried forward by the delay. */
  function own(c: Car, s: CarSnap, snap: Snap, dt: number) {
    state(c, s); c.speedK = s.speedK; c.accelK = s.accelK;
    const k = c.ctl, still = G.countdown > 0 || G.state !== 'playing';
    c.input.throttle = still ? 0 : +k.throttle; c.input.steer = still ? 0 : +k.steer; c.input.handbrake = still || !!k.handbrake;
    muffled(() => { c.update(dt); collideCars([c, ...(G.cars as Car[]).filter(o => o !== c && o.alive)]); });
    // the host's car is behind ours by the trip there and back (controls out, snapshot home)
    const rtt = (S?.rtt.get(S.host) || 100) / 1000, age = clamp(now() + off! - snap.now + rtt / 2, 0, 0.6);
    const tx = s.x + s.vx * age, tz = s.z + s.vz * age, ex = tx - c.x, ez = tz - c.z;
    if (Math.hypot(ex, ez) > SNAP_AT) { c.x = tx; c.z = tz; c.y = s.y; c.vx = s.vx; c.vy = s.vy; c.vz = s.vz; c.yaw = s.yaw; return; }
    const e = 1 - Math.exp(-EASE * dt);
    c.x += ex * e; c.z += ez * e; c.vx += (s.vx - c.vx) * e; c.vz += (s.vz - c.vz) * e;
    c.yaw += angDiff(c.yaw, s.yaw + yawRate(s.pid) * age) * e * 0.5;
  }
  /** How fast a car is turning, from the last two snapshots (rad/s). */
  function yawRate(pid: number) {
    const n = snaps.length; if (n < 2) return 0;
    const p = snaps[n - 2], q = snaps[n - 1], a = p.cars.find(o => o.pid === pid), b = q.cars.find(o => o.pid === pid);
    return a && b && q.now > p.now ? angDiff(a.yaw, b.yaw) / (q.now - p.now) : 0;
  }
  /** Where a car is drawn: between two snapshots (k), or past the newest by `ahead` seconds. */
  function place(c: Car, a: CarSnap, b: CarSnap, k: number, ahead: number) {
    c.x = lerp(a.x, b.x, k) + b.vx * ahead; c.y = lerp(a.y, b.y, k) + b.vy * ahead; c.z = lerp(a.z, b.z, k) + b.vz * ahead;
    c.yaw = a.yaw + angDiff(a.yaw, b.yaw) * k;
    c.vx = lerp(a.vx, b.vx, k); c.vy = lerp(a.vy, b.vy, k); c.vz = lerp(a.vz, b.vz, k);
    const ux = lerp(a.ux, b.ux, k), uz = lerp(a.uz, b.uz, k); c.up.set(ux, Math.sqrt(Math.max(0, 1 - ux * ux - uz * uz)), uz);
    c.tumble = lerp(a.tumble, b.tumble, k); c.tumbleAxis = b.tumbleAxis; c.grounded = b.grounded;
    c.input.steer = b.steer; c.input.throttle = b.throttle;
  }
  /** Everything about a car that isn't where it is: health, weapons, status, score, race. */
  function state(c: Car, s: CarSnap) {
    if (c.alive && !s.alive) { c.alive = false; c.deathTime = G.time; c.wreckT = 0; c.wreckLook(); }
    else if (!c.alive && s.alive) { c.reset(s.x, s.z, s.yaw); if (c === G.player) ownSet = false; } // back on the track (a race)
    c.hp = s.hp; c.flameOn = s.flameOn; c.mgLocked = s.mgLocked; c.weapon = s.weapon;
    s.ammo.forEach((n, i) => { c.ammo[Object.keys(c.ammo)[i]] = n; });
    c.special = s.special; c.kills = s.kills; c.place = s.place; c.wreckedBy = s.wreckedBy >= 0 ? G.cars[s.wreckedBy] : null; c.dealt = s.dealt;
    c.shieldT = s.shieldT; c.frozen = s.frozen; c.burning = s.burning; c.boost = s.boost; c.flash = Math.max(c.flash, s.flash);
    if (s.race && c.race) {
      const r = c.race, p = r.progress;
      p.lap = s.race.lap; p.section = s.race.section; p.path = s.race.path; p.i = s.race.i; p.s = s.race.s;
      r.finished = s.race.finished; r.best = s.race.best; r.lapTimes = s.race.lapTimes;
    }
  }
  /** Projectiles: matched by id across snapshots, each drawn with its own mesh and trail. */
  function shotsFrom(a: Snap, b: Snap, k: number, ahead: number, dt: number) {
    const seen = new Set<number>();
    for (const pb of b.proj) {
      const pa = a.proj.find(o => o.id === pb.id) || pb;
      let sh = shots.get(pb.id);
      if (!sh) { sh = { ...pb, mesh: takeMesh(PROJ_MESH[pb.type] || pb.type), age: 0 }; shots.set(pb.id, sh); }
      sh.x = lerp(pa.x, pb.x, k) + pb.vx * ahead; sh.y = lerp(pa.y, pb.y, k) + pb.vy * ahead; sh.z = lerp(pa.z, pb.z, k) + pb.vz * ahead;
      sh.vx = pb.vx; sh.vy = pb.vy; sh.vz = pb.vz; sh.age += dt; seen.add(pb.id);
      sh.mesh.visible = true; projectileLook(sh, dt);
    }
    for (const [id, sh] of shots) if (!seen.has(id)) { sh.mesh.visible = false; shots.delete(id); }
  }
  /** Mines, as the latest snapshot has them, blinking when armed. */
  function minesFrom(s: Snap) {
    s.mines.forEach((m, i) => {
      const mesh = mines[i] || (mines[i] = takeMesh('mine'));
      mesh.visible = true; mesh.position.set(m.x, m.y, m.z); mesh.userData.light.visible = m.light;
    });
    for (let i = s.mines.length; i < mines.length; i++) mines[i].visible = false;
    mines.length = s.mines.length;
  }
}
/** Link to every other player in the room (each newcomer links to those before it), so anyone can take over as host. */
function meshUp() {
  if (!S) return;
  const mine = S.players.findIndex(p => p.id === S!.me);
  S.players.forEach((p, i) => { if (i < mine && p.id !== S!.host && !S!.t.links().includes(p.id)) S!.t.connect(p.id).catch(() => { }); });
}
