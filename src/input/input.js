import { ensureAudio } from '../audio/audio.js';
import { CONE, RANGE } from '../combat/arsenal';
import { cycleTarget, cycleWeapon, findTarget } from '../combat/weapons.js';
import { BINDINGS, actionForKey } from './bindings';
import { currentScreen, menuBack, menuMove, menuSelect } from './menu';
import { $, clamp, isTouch } from '../engine/util.js';
import { pauseGame, resumeGame } from '../game/match.js';
import { TAGS } from '../game/hud.js';
import { G, saveSettings } from '../game/state.js';
import { blockedAt } from '../world/collision.js';
import { puff } from '../world/props.js';
import { ground } from '../world/terrain.js';

// ================= input =================
export const KEYS = {};
const INP = { wPress: false, combo: 0, sPress: false, cycle: 0, target: false, reset: false };
/** The device the player last used, so hints show the right buttons. */
/** How much wider the weapons' lock-on cones are for a player on touch controls. */
export const TOUCH_AIM = 1.5;
export const LAST = { device: /** @type {import('./bindings').Device} */ (isTouch ? 'touch' : 'keys') };
/** Remember the device the player is using; the page shows hints for it via body[data-device]. */
function useDevice(d) { if (LAST.device !== d || document.body.dataset.device !== d) { LAST.device = d; document.body.dataset.device = d; } }
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return; // typing a name or a room code
  if (GAME_KEYS.has(e.code) && G.state === 'playing') e.preventDefault();
  const first = !KEYS[e.code]; KEYS[e.code] = true;
  const driving = G.state === 'playing' && !currentScreen(); // online, the pause menu opens over a match that goes on
  if (!driving && menuKey(e)) return;
  if (!first || e.repeat) return;
  const a = actionForKey(e.code); if (!a) return;
  useDevice('keys');
  if (driving) press(a, e.code === 'KeyQ' ? -1 : 1);
  if (a === 'pause' && driving) pauseGame();
});
/** Keys in menus: arrows move, Enter selects, Esc goes back. Returns true when the key was used. */
const MENU_DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
function menuKey(e) {
  if (!currentScreen()) return false;
  if (MENU_DIRS[e.code]) { e.preventDefault(); return menuMove(MENU_DIRS[e.code]); }
  if (e.code === 'Escape' || (e.code === 'KeyP' && G.state === 'paused')) return menuBack();
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); return menuSelect(); }
  return false;
}
/** One-shot actions (held ones are read each frame in readPlayerInput). */
function press(a, dir = 1) {
  if (a === 'fire') { INP.wPress = true; INP.combo = 0; }
  else if (a === 'attack') { INP.wPress = true; INP.combo = 1; }
  else if (a === 'defend') { INP.wPress = true; INP.combo = 2; }
  else if (a === 'special') INP.sPress = true;
  else if (a === 'swap') INP.cycle = dir;
  else if (a === 'target') INP.target = true;
  else if (a === 'flip') INP.reset = true;
  else if (a === 'map') toggleMapView();
}
/** Switch the radar between what's nearby and the whole map (game/hud.js draws it). */
export function toggleMapView() { G.settings.radar = G.settings.radar === 'map' ? 'near' : 'map'; saveSettings(); }
const held = a => BINDINGS[a].keys.some(k => KEYS[k]);
addEventListener('keyup', e => { KEYS[e.code] = false; });
addEventListener('keydown', () => ensureAudio(), { once: true });
addEventListener('blur', () => { for (const k in KEYS) KEYS[k] = false; });

// touch controls
const TOUCH = { active: false, jx: 0, jy: 0, w: false, drift: false };
/** Let go of everything a finger was holding (set by setupTouch). */
let letGo = () => { };
/**
 * Let go of the stick and the held buttons. A finger's "lifted" event can go missing (the HUD is hidden under it
 * when a match ends or the menu opens, the page loses focus, the system takes the touch for a gesture of its own),
 * and a stick still waiting for it would steer nowhere, and refuse every touch after, until the page was reloaded.
 */
export function releaseTouch() { letGo(); }
export function setupTouch() {
  if (isTouch) document.body.classList.add('touch');
  const zone = $('#stickZone'), base = $('#stickBase'), knob = $('#stickKnob');
  let sid = null, ox = 0, oy = 0; const R = 56;
  const baseHome = () => { base.style.left = ''; base.style.bottom = ''; base.style.top = ''; };
  /** Hold a pointer's later events to `el` (not fatal if the browser won't: the window-wide listeners below still see them lift). */
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* not an active pointer */ } };
  const stickHome = () => { sid = null; TOUCH.jx = 0; TOUCH.jy = 0; knob.style.transform = ''; baseHome(); };
  zone.addEventListener('pointerdown', e => {
    // a new touch always takes the stick: if another finger had it, that one is a second thumb or never reported lifting
    sid = e.pointerId; capture(zone, sid);
    const zr = zone.getBoundingClientRect();
    ox = e.clientX; oy = e.clientY;
    base.style.left = (ox - zr.left - 64) + 'px'; base.style.top = (oy - zr.top - 64) + 'px'; base.style.bottom = 'auto';
    TOUCH.jx = 0; TOUCH.jy = 0; knob.style.transform = '';
    e.preventDefault();
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy; const L = Math.hypot(dx, dy);
    if (L > R) { dx *= R / L; dy *= R / L; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    TOUCH.jx = dx / R; TOUCH.jy = dy / R;
  });
  const end = e => { if (e.pointerId === sid) stickHome(); };
  // wherever the finger lifts, and if the browser takes the touch away
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);

  let driftId = null;
  const drift = $('#bDrift'), driftUp = () => { driftId = null; TOUCH.drift = false; drift.classList.remove('on'); };
  drift.addEventListener('pointerdown', e => { driftId = e.pointerId; capture(drift, driftId); TOUCH.drift = true; drift.classList.add('on'); e.preventDefault(); ensureAudio(); });
  const driftEnd = e => { if (e.pointerId === driftId) driftUp(); };
  addEventListener('pointerup', driftEnd); addEventListener('pointercancel', driftEnd); drift.addEventListener('lostpointercapture', driftEnd);
  const tap = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('on'); fn(); setTimeout(() => el.classList.remove('on'), 120); });
  tap($('#bSpec'), () => { INP.sPress = true; });
  $('.wpn').addEventListener('pointerdown', e => { e.preventDefault(); INP.cycle = 1; }); // tap the weapon panel to switch
  $('#tags').addEventListener('pointerdown', e => { // tap a name tag to make that car your target
    const tag = /** @type {HTMLElement} */ (e.target).closest('.tag'); if (!tag || !G.player) return;
    const t = TAGS.find(t => t.el === tag); if (t) { e.preventDefault(); G.player.pref = t.c; }
  });
  addEventListener('pointerdown', e => { if (e.pointerType === 'touch') useDevice('touch'); }, { capture: true });
  useDevice(LAST.device);
  $('#bReset').addEventListener('pointerdown', e => { e.preventDefault(); INP.reset = true; });
  // fire: tap = fire, hold = hold (torch), swipe up/down = combo
  const fb = $('#bFire'); let fid = null, fy0 = 0, fstate = '', ftimer = 0;
  fb.addEventListener('pointerdown', e => {
    e.preventDefault(); capture(fb, e.pointerId); fid = e.pointerId; fy0 = e.clientY; fstate = 'pending'; fb.classList.add('on'); ensureAudio();
    clearTimeout(ftimer); ftimer = setTimeout(() => { if (fstate === 'pending') { fstate = 'held'; INP.wPress = true; INP.combo = 0; TOUCH.w = true; } }, 150);
  });
  fb.addEventListener('pointermove', e => {
    if (e.pointerId !== fid || fstate !== 'pending') return;
    const dy = e.clientY - fy0;
    if (Math.abs(dy) > 26) { fstate = 'swiped'; INP.wPress = true; INP.combo = dy < 0 ? 1 : 2; }
  });
  /** The fire finger is gone; `shoot`: it lifted after a quick tap, which fires. */
  const fireUp = shoot => { if (shoot && fstate === 'pending') { INP.wPress = true; INP.combo = 0; } fstate = ''; fid = null; TOUCH.w = false; fb.classList.remove('on'); clearTimeout(ftimer); };
  const fireGone = e => { if (e.pointerId === fid) fireUp(false); };
  addEventListener('pointerup', e => { if (e.pointerId === fid) fireUp(true); }); addEventListener('pointercancel', fireGone); fb.addEventListener('lostpointercapture', fireGone);
  letGo = () => { stickHome(); driftUp(); fireUp(false); };

  // Nothing may zoom the page: zoomed in, the controls at the screen's edges are out of reach. (The page already asks
  // not to be scaled, but Safari on iPhones doesn't listen.) No double-tap zoom, no pinch, in Safari's events or anyone's.
  for (const type of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(type, e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 && G.state === 'playing') e.preventDefault(); }, { passive: false });
}
addEventListener('blur', releaseTouch);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseTouch(); });

// gamepad (standard mapping)
const PAD = { prev: [], active: false, steer: 0, thr: 0, mg: false, w: false, hb: false, sx: 0, sy: 0 };
/** @type {Array<[number, import('./bindings').Action, number?]>} button index, action, direction */
const PAD_PRESS = [[0, 'fire'], [5, 'attack'], [4, 'defend'], [3, 'special'], [14, 'swap', -1], [15, 'swap', 1], [11, 'target'], [8, 'flip'], [12, 'map']];
export function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) { PAD.active = false; return; }
  const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed), bv = i => gp.buttons[i] ? gp.buttons[i].value : 0;
  const edge = i => b(i) && !PAD.prev[i];
  const ax = gp.axes[0] || 0;
  PAD.steer = Math.abs(ax) > 0.15 ? ax : 0;
  PAD.thr = bv(7) - bv(6);
  PAD.mg = b(2); PAD.w = b(0); PAD.hb = b(1);
  const used = Math.abs(ax) > 0.3 || PAD.thr !== 0 || gp.buttons.some(x => x.pressed);
  if (used) useDevice('pad');
  PAD.active = PAD.active || used;
  const driving = G.state === 'playing' && !currentScreen();
  if (driving) { for (const [i, a, dir] of PAD_PRESS) if (edge(i)) press(a, dir); }
  else if (currentScreen()) { // menus: d-pad or stick moves, A selects, B goes back
    const ay = gp.axes[1] || 0, sx = Math.abs(ax) > 0.6 ? Math.sign(ax) : 0, sy = Math.abs(ay) > 0.6 ? Math.sign(ay) : 0;
    const stick = sx !== PAD.sx || sy !== PAD.sy; PAD.sx = sx; PAD.sy = sy;
    if (edge(12) || (stick && sy < 0)) menuMove('up');
    if (edge(13) || (stick && sy > 0)) menuMove('down');
    if (edge(14) || (stick && sx < 0)) menuMove('left');
    if (edge(15) || (stick && sx > 0)) menuMove('right');
    if (edge(0)) menuSelect();
    if (edge(1)) menuBack();
  }
  if (edge(9)) { if (driving) pauseGame(); else if (G.state === 'paused' || G.state === 'playing') resumeGame(); }
  PAD.prev = gp.buttons.map(x => x.pressed);
}

/**
 * What a driver is doing this frame: held controls, plus one-shot presses that applyControls uses up. The local
 * devices fill one in (readControls); online, a guest's comes over the network (src/net) and is applied the same way.
 * @typedef {{ throttle: number, steer: number, handbrake: boolean, mg: boolean, w: boolean, fire: boolean, combo: number,
 *   special: boolean, cycle: number, target: boolean, flip: boolean, aim: number, pref: number }} Controls
 */
/** @returns {Controls} */
export function newControls() { return { throttle: 0, steer: 0, handbrake: false, mg: false, w: false, fire: false, combo: 0, special: false, cycle: 0, target: false, flip: false, aim: 1, pref: -1 }; }
const AUTO = { sightT: 0, inSights: false, hardT: 0 };
/** Read the keyboard, touch controls and gamepad into `ctl` for car `c` (its sights drive the automatic machine gun). */
export function readControls(c, dt, ctl) {
  if (currentScreen()) { Object.assign(ctl, newControls(), { pref: ctl.pref }); return; } // a menu is open over the match (online)
  const k = KEYS;
  let thr = ((k.ArrowUp || k.KeyW) ? 1 : 0) - ((k.ArrowDown || k.KeyS) ? 1 : 0);
  let steer = ((k.ArrowRight || k.KeyD) ? 1 : 0) - ((k.ArrowLeft || k.KeyA) ? 1 : 0);
  let hb = held('drift'), mg = held('gun'), w = held('fire');
  if (TOUCH.jx || TOUCH.jy) {
    const jy = -TOUCH.jy, jx = TOUCH.jx;
    thr = Math.abs(jy) < 0.15 ? 0 : clamp(jy * 1.6, -1, 1);
    steer = Math.sign(jx) * Math.pow(Math.min(1, Math.abs(jx) * 1.15), 1.4);
  }
  if (TOUCH.w) w = true; if (TOUCH.drift) hb = true;
  if (PAD.active) { if (PAD.thr) thr = PAD.thr; if (PAD.steer) steer = PAD.steer; mg = mg || PAD.mg; w = w || PAD.w; hb = hb || PAD.hb; }
  // automatic machine gun: fires whenever a car is in its sights (checked ten times a second)
  if (G.settings.autofire === 'on') {
    AUTO.sightT -= dt;
    if (AUTO.sightT <= 0) { AUTO.sightT = 0.1; AUTO.inSights = !!findTarget(c, RANGE.mg, CONE.mg, true); }
    mg = mg || AUTO.inSights;
  }
  // automatic drift: holding the steering hard over at speed for a moment slides the back out
  AUTO.hardT = Math.abs(steer) > 0.85 && thr > 0 && c.speed > 22 ? AUTO.hardT + dt : 0;
  if (G.settings.autodrift === 'on' && AUTO.hardT > 0.25) hb = true;
  ctl.throttle = thr; ctl.steer = steer; ctl.handbrake = hb; ctl.mg = mg; ctl.w = w;
  ctl.aim = LAST.device === 'touch' ? TOUCH_AIM : 1; // thumbs steer less precisely than keys
  if (INP.wPress) { ctl.fire = true; ctl.combo = INP.combo; INP.wPress = false; INP.combo = 0; }
  if (INP.sPress) { ctl.special = true; INP.sPress = false; }
  if (INP.cycle) { ctl.cycle = INP.cycle; INP.cycle = 0; }
  if (INP.target) { ctl.target = true; INP.target = false; }
  if (INP.reset) { ctl.flip = true; INP.reset = false; }
  ctl.pref = c.pref ? c.pref.pid : -1;
}
/** Drive car `c` with `ctl`, using up its one-shot presses. */
export function applyControls(c, ctl) {
  c.input.throttle = ctl.throttle; c.input.steer = ctl.steer; c.input.handbrake = ctl.handbrake;
  c.mgHeld = ctl.mg; c.wHeld = ctl.w; c.aimAssist = ctl.aim;
  if (ctl.fire) { c.wFire = true; c.wCombo = ctl.combo; ctl.fire = false; ctl.combo = 0; }
  if (ctl.special) { c.sFire = true; ctl.special = false; }
  if (ctl.cycle) { cycleWeapon(c, ctl.cycle); ctl.cycle = 0; }
  const pref = G.cars[ctl.pref]; if (ctl.pref >= 0 && pref && pref !== c) c.pref = pref; // a tapped name tag (see setupTouch)
  if (ctl.target) { ctl.target = false; cycleTarget(c); }
  if (ctl.flip) { ctl.flip = false; flipBack(c); }
}
function flipBack(c) {
  if (!c.alive || c.resetCd > 0) return;
  c.resetCd = 2.5; c.vx = c.vz = 0; c.vy = 0; c.y = ground(c.x, c.z) + 1.5; c.tumble = 0; c.tumbleV = 0; c.up.set(0, 1, 0);
  // nudge out of any overlap toward the arena centre
  for (let k = 0; k < 12 && blockedAt(c.x, c.z, 1.2, c); k++) { const L = Math.hypot(c.x, c.z) || 1; c.x -= c.x / L * 3; c.z -= c.z / L * 3; }
  puff(c.x, c.y, c.z, 0xd8a878, 8);
}
