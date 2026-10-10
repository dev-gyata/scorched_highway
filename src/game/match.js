import { AI } from '../ai/ai.js';
import { ensureAudio, playSfx } from '../audio/audio.js';
import { Car, collideCars } from '../cars/car.js';
import { disposeCarModel } from '../cars/model/build.js';
import { CARS, CAR_BY_ID, botCars } from '../cars/roster.js';
import { DIFF } from '../combat/damage.js';
import { updateRings } from '../combat/effects.js';
import { clearWeapons } from '../combat/pools.js';
import { tickCarWeapons, updateMines, updateProjectiles } from '../combat/weapons.js';
import { clearDebris } from '../engine/debris.js';
import { PSYS } from '../engine/particles.js';
import { camera, renderer, scene } from '../engine/renderer.js';
import { announce } from '../engine/events';
import { registerState } from '../engine/savestate';
import { applyTod } from '../engine/sky';
import { $ } from '../engine/util.js';
import { CAM } from './camera.js';
import { bigText, buildTags, fitHud, hud, TAGS } from './hud.js';
import { resize } from './loop.js';
import { clearShowcase, show } from './screens.js';
import { showResults } from './results';
import { MENU_MAP, allMaps, getMap } from '../maps/registry';
import { allModes, getMode } from '../modes/registry';
import { G } from './state.js';
import { KEYS, applyControls, newControls, readControls, releaseTouch } from '../input/input.js';
import { clearHazards, updateHazards } from '../world/hazards';
import { resetPickups, updatePickups } from '../world/pickups';
import { resetPlates, updatePlates } from '../world/plates';
import { resetProps, updateProps } from '../world/props.js';

// ================= match =================
// A match runs cars, weapons and effects the same way on every map and in every mode; the mode (src/modes)
// decides the rules and the map (src/maps) the place.

/** The mode and map chosen in the garage (falling back to a map that hosts the mode). */
export function chosen() {
  const mode = getMode(G.settings.mode) || allModes()[0];
  const map = [getMap(G.settings.map), ...allMaps()].find(m => m && m.modes.includes(mode.id)) || getMap(MENU_MAP);
  return { mode, map };
}
export function clearMatch() {
  for (const c of G.cars) disposeCarModel(c.model);
  G.cars = []; G.ais = []; G.player = null; G.delayed = [];
  clearWeapons(); clearDebris(); for (const s of PSYS) s.clear();
  resetProps(); resetPickups(); resetPlates(); clearHazards();
  hud.tags.innerHTML = ''; TAGS.length = 0; hud.feed.innerHTML = '';
}
/**
 * Who drives in a match: one entry per car, in pid order. `human` cars are driven by people (`local` is the one at
 * this screen); the rest get a bot.
 * @typedef {{ car: string, human: boolean, local?: boolean, name?: string }} Seat
 */
/** A single-player match: you in the car you picked, and bots in the others. @returns {Seat[]} */
export function soloRoster() {
  const pdef = CAR_BY_ID[G.settings.car] || CARS[0];
  return [{ car: pdef.id, human: true, local: true }, ...botCars([pdef.id], G.settings.opponents).map(car => ({ car, human: false }))];
}
/** Start a match with the chosen mode and map; `roster` says who drives (online play passes its own). @param {Seat[]} [roster] */
export function startMatch(roster = soloRoster()) {
  ensureAudio();
  clearShowcase(); clearMatch(); camera.clearViewOffset();
  applyTod(G.settings.tod);
  const { mode, map } = chosen(); G.mode = mode; G.map = map;
  if (!map.isBuilt()) { const t = performance.now(); map.build(G.settings.quality === 'low'); performance.measure('map:build', { start: t }); }
  const diff = DIFF[G.settings.difficulty];
  G.watching = !roster.some(s => s.local); // nobody here drives: this screen follows the first car
  roster.forEach((s, pid) => {
    const def = CAR_BY_ID[s.car] || CARS[0], again = s.name ? 0 : roster.slice(0, pid).filter(o => !o.name && o.car === s.car).length;
    const c = new Car(def, { human: s.human, name: s.name || def.driver + ['', ' II', ' III', ' IV'][Math.min(again, 3)], pid }); // a model's second driver in a big field: "Dee Cortez II"
    c.speedK = s.human ? 1 : diff.speed;
    G.cars.push(c);
    if (s.human) c.ctl = newControls(); else G.ais.push(new AI(c));
    if (s.local || (G.watching && !pid)) G.player = c;
  });
  mode.setup(G.cars, map);
  G.time = 0; G.clock = 0; G.countdown = 3.2; G.endT = -1; G.result = null; G.slowT = 0; G.timeScale = 1; G.shake = 0;
  const p = G.player; CAM.yaw = p.yaw; CAM.x = p.x - Math.sin(p.yaw) * 30; CAM.z = p.z - Math.cos(p.yaw) * 30; CAM.y = p.y + 14;
  hud.cache = {}; hud.hName.textContent = G.watching ? 'Watching' : p.def.name; hud.hName.style.color = p.def.tag;
  buildTags(); show(null); $('#hud').hidden = false; G.state = 'playing'; lastCount = 4;
  releaseTouch(); fitHud(); // nothing held over from the last match; the controls where the screen is
  resize();
  renderer.compile(scene, camera); // compile every shader now (pooled effects included) instead of stuttering when they first appear
}
let lastCount = 4;
// for a new host carrying the match on (engine/savestate): what snapshots don't carry about the cars and the match
const HIDDEN = ['cdMG', 'cdW', 'cdS', 'gunSide', 'resetCd', 'lastHitTime', 'fellLap', 'hazardT', 'deathTime', 'stuckT', 'turnK', 'gripK', 'towT'];
const pidOf = c => (c ? c.pid : -1);
registerState('cars', {
  save: () => G.cars.map(c => ({
    ...Object.fromEntries(HIDDEN.map(k => [k, c[k]])), lastHitBy: pidOf(c.lastHitBy), burnBy: pidOf(c.burnBy), towBy: pidOf(c.towBy),
    race: c.race && { respawnT: c.race.respawnT, wrongT: c.race.wrongT, lapStart: c.race.lapStart },
  })),
  load: (/** @type {any[]} */ list) => list.forEach((s, pid) => {
    const c = G.cars[pid]; if (!c) return;
    for (const k of HIDDEN) if (Number.isFinite(s[k])) c[k] = s[k]; // numbers only, and only these: it came from another game
    c.lastHitBy = G.cars[s.lastHitBy] || null; c.burnBy = G.cars[s.burnBy] || null; c.towBy = G.cars[s.towBy] || null;
    if (c.race && s.race) for (const k of ['respawnT', 'wrongT', 'lapStart']) if (Number.isFinite(s.race[k])) c.race[k] = s.race[k];
  }),
});
registerState('match', { save: () => ({ time: G.time, endT: G.endT }), load: (/** @type {any} */ d) => { if (Number.isFinite(d.time)) G.time = d.time; if (Number.isFinite(d.endT)) G.endT = d.endT; } });
registerState('mode', { save: () => (G.mode.save ? G.mode.save() : null), load: d => { if (d && G.mode.load) G.mode.load(d); } });
/** A car has been wrecked: the mode decides what that means. */
export function onCarKilled(c, by) {
  c.wreckedBy = by || null;
  if (by && by.human && by !== c) announce(by.pid, 'Wrecked ' + c.name.split(' ')[0] + '!', 1.1, true);
  if (by && by.isPlayer) G.slowT = Math.max(G.slowT, 0.55);
  G.mode.wrecked(c, by || null);
}
/** The match is over: results (online guests are handed theirs by the host). */
export function endMatch(view) {
  G.state = 'over'; releaseTouch(); // the HUD goes from under any thumb on it
  showResults(view);
  show('over'); $('#hud').hidden = true; resize();
}
/** Pause. Online the match can't stop for one player: the menu opens over it, and the car coasts. */
export function pauseGame() {
  if (G.state !== 'playing') return;
  if (!G.net) G.state = 'paused';
  $('#restartBtn').hidden = !!G.net; $('#inviteBtn').hidden = !G.net; $('#quitBtn').textContent = G.net ? 'Leave the match' : 'Back to garage';
  show('pause'); for (const k in KEYS) KEYS[k] = false; releaseTouch();
}
export function resumeGame() { if (G.state !== 'paused' && !(G.net && G.state === 'playing')) return; G.state = 'playing'; show(null); releaseTouch(); }
/** The countdown's beeps and big numbers, from G.countdown (online guests run it from the host's countdown). */
export function cueCountdown() {
  const n = Math.max(0, Math.ceil(G.countdown - 0.2)); if (n === lastCount) return;
  lastCount = n; if (n > 0) { bigText(String(n), 0.8); playSfx('beep'); } else { bigText('Go!', 0.8); playSfx('go'); }
}

// ================= step =================
export function step(dt, rdt) {
  const p = G.player;
  // delayed events
  for (let i = G.delayed.length - 1; i >= 0; i--) { const d = G.delayed[i]; d.t -= dt; if (d.t <= 0) { G.delayed.splice(i, 1); d.fn(); } }
  if (G.countdown > 0) { G.countdown -= rdt; cueCountdown(); } else G.clock += dt;
  G.time += dt;
  if (G.state === 'playing' && !G.watching && p.alive && p.ctl) readControls(p, dt, p.ctl); // this screen's driver; others' controls come from afar (src/net)
  for (const c of G.cars) {
    if (!c.human || !c.ctl) continue;
    if (c.alive && G.state === 'playing') applyControls(c, c.ctl); else { c.mgHeld = c.wHeld = false; c.input.throttle = 0; c.input.steer = 0; }
  }
  if (G.countdown > 0) { for (const c of G.cars) { c.input.throttle = 0; c.input.steer = 0; c.input.handbrake = true; } if (p.alive) { p.wFire = false; p.sFire = false; } }
  for (const ai of G.ais) ai.update(dt);
  if (G.countdown > 0) for (const c of G.cars) { c.input.throttle = 0; c.input.handbrake = true; c.wFire = false; c.sFire = false; }
  for (const c of G.cars) c.update(dt);
  collideCars(G.cars);
  for (const c of G.cars) tickCarWeapons(c, dt);
  updateProjectiles(dt); updateMines(dt, G.time); updateRings(dt); updateProps(dt);
  updatePickups(dt, G.time); updatePlates(dt, G.time); updateHazards(dt);
  G.mode.step(dt, rdt);
  if (G.endT > 0) { G.endT -= rdt; if (G.endT <= 0) endMatch(); }
}
