import { playSfx } from '../audio/audio.js';
import { COMBOS, CONE, RANGE } from '../combat/arsenal';
import { findTarget } from '../combat/weapons.js';
import { hint } from '../input/bindings';
import { LAST, toggleMapView } from '../input/input.js';
import { camera } from '../engine/renderer.js';
import { ALL, onEvent } from '../engine/events';
import { $, TAU, _v1 } from '../engine/util.js';
import { G } from './state.js';
import { drawGlyph } from '../world/glyphs';
import { PICK } from '../world/pickups';

// ================= HUD helpers =================
export const hud = {
  big: $('#big'), feed: $('#feed'), vign: $('#vign'), hpFill: $('#hpFill'), hpBar: $('#hpBar'), hHp: $('#hHp'), hName: $('#hName'),
  wName: $('#wName'), wAmmo: $('#wAmmo'), wIcon: $('#wIcon'), sPips: $('#sPips'), combo: $('#comboHint'), alive: $('#alive'), clock: $('#clock'),
  spd: $('#spd'), radar: $('#radar'), lights: $('#lights'), lock: $('#lock'), tags: $('#tags'), reset: $('#bReset'), cache: {},
  place: $('#place'), placeN: $('#placeN'), placeTh: $('#placeTh'), placeOf: $('#placeOf'), standings: $('#standings'),
};
hud.radar.addEventListener('click', toggleMapView); // tap the radar: nearby, or the whole map
let bigTimer = 0;
export function bigText(txt, dur, small) {
  hud.big.textContent = txt; hud.big.classList.toggle('small', !!small); hud.big.classList.add('show');
  bigTimer = dur || 1;
}
export function feed(msg, mine) {
  const d = document.createElement('div'); d.textContent = msg; if (mine) d.className = 'me';
  hud.feed.appendChild(d); while (hud.feed.children.length > 4) hud.feed.removeChild(hud.feed.firstChild);
  setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 4200);
}
/** How a wreck reads on this screen: "You" for its own driver, names for everyone else. */
function wreckLine(e, me) {
  const v = G.cars[e.victim], by = e.by >= 0 ? G.cars[e.by] || null : null; if (!v) return '';
  const vName = v === me ? 'You' : v.name;
  if (!by) return e.how === 'fall' ? vName + ' came down too hard' : e.how === 'truck' ? vName + ' got flattened by the truck' : e.how === 'rock' ? vName + ' got buried in the rockfall' : vName + (v === me ? ' wrecked yourself' : ' wrecked themselves');
  return (by === me ? 'You' : by.name) + ' wrecked ' + (v === me ? 'you' : v.name);
}
// match events (engine/events) meant for this screen's driver, or for everyone
onEvent(e => {
  if (!G.player) return;
  const me = G.watching ? null : G.player, pid = me ? me.pid : -2; // someone only watching is nobody's driver
  if (e.kind === 'wreck') { const line = wreckLine(e, me); if (line) feed(line, e.by === pid || e.victim === pid); return; }
  if (e.kind === 'fx' || (e.to !== ALL && e.to !== pid)) return;
  if (e.kind === 'big') bigText(e.text, e.dur, e.small);
  else if (e.kind === 'feed') { if (e.skip !== pid) feed(e.text, e.mine); }
  else if (e.kind === 'hit') hudHit(e.amt);
  else if (e.kind === 'sound') playSfx(e.name);
});
let vignT = 0;
export function hudHit(amt) { vignT = Math.min(1, vignT + 0.25 + amt * 0.03); if (amt > 3) playSfx('hurt', null, null, 0.8); }
function setIf(key, el, prop, val) { if (hud.cache[key] !== val) { hud.cache[key] = val; el[prop] = val; } }
function drawWeaponIcon(type, locked) {
  const x = hud.wIcon.getContext('2d'); x.clearRect(0, 0, 80, 80);
  x.fillStyle = 'rgba(246,234,212,0.08)'; x.beginPath(); x.arc(40, 40, 38, 0, TAU); x.fill();
  x.save(); x.translate(8, 8); drawGlyph(x, type || 'mg', 64, type ? PICK[type].css : locked ? 'rgba(246,234,212,0.3)' : '#f6ead4'); x.restore();
  if (!type && locked) { x.save(); x.translate(44, 44); drawGlyph(x, 'sword', 32, '#e8433a'); x.restore(); } // locked until a sword plate
}
export function updateHUD(dt) {
  const p = G.player; if (!p) return;
  const hpF = Math.max(0, p.hp / p.def.hp);
  hud.hpFill.style.transform = `scaleX(${hpF.toFixed(3)})`;
  setIf('hp', hud.hHp, 'textContent', Math.ceil(Math.max(0, p.hp)) + '');
  const low = hpF < 0.3; if (hud.cache.low !== low) { hud.cache.low = low; hud.hpBar.classList.toggle('low', low); }
  const w = p.weapon, locked = p.mgLocked, wk = w + (locked ? '!' : ''); // the machine gun can be locked (races, until a sword plate)
  if (hud.cache.w !== wk) { hud.cache.w = wk; drawWeaponIcon(w, locked); hud.wName.textContent = w ? PICK[w].label : locked ? 'Machine gun locked' : 'Machine gun only'; } // combo hints for whichever device the player is using
  const dev = LAST.device;
  if (hud.cache.cw !== wk || hud.cache.dev !== dev) { hud.cache.cw = wk; hud.cache.dev = dev; hud.combo.innerHTML = w ? `${hint('attack', dev)}: ${COMBOS[w][0]}<br>${hint('defend', dev)}: ${COMBOS[w][1]}` : locked ? 'Drive over a sword plate to unlock it' : G.mode.unarmedHint; }
  setIf('ammo', hud.wAmmo, 'textContent', w ? (w === 'flame' ? p.ammo.flame.toFixed(1) + 's' : Math.floor(p.ammo[w]) + '') : locked ? '–' : '∞');
  if (hud.cache.sp !== p.special) { hud.cache.sp = p.special; let s = ''; for (let i = 0; i < 6; i++) s += `<i class="${i < p.special ? 'on' : ''}"></i>`; hud.sPips.innerHTML = s; }
  const [status, clock] = G.mode.status(p);
  setIf('alive', hud.alive, 'textContent', status); setIf('clock', hud.clock, 'textContent', clock);
  // starting lights, for modes that use them: three reds, then green
  const lit = !G.mode.lights ? -1 : G.countdown > 0 ? Math.min(3, Math.max(0, 4 - Math.ceil(G.countdown))) : G.clock < 1 ? 4 : -1;
  if (hud.cache.lights !== lit) { hud.cache.lights = lit; hud.lights.hidden = lit < 0; hud.lights.className = 'l' + lit; }
  setIf('spd', hud.spd, 'textContent', Math.round(p.speed * 2.1) + '');
  vignT = Math.max(0, vignT - dt * 1.6);
  hud.vign.style.opacity = Math.max(vignT, low ? 0.25 + 0.15 * Math.sin(performance.now() / 150) : 0).toFixed(2);
  if (bigTimer > 0) { bigTimer -= dt; if (bigTimer <= 0) hud.big.classList.remove('show'); }
  // stuck detection for flip button
  if (p.alive && ((Math.abs(p.input.throttle) > 0.5 && p.speed < 1.5) || p.airT > 4)) p.stuckT += dt; else p.stuckT = 0;
  const showReset = p.stuckT > 2;
  if (hud.cache.reset !== showReset) { hud.cache.reset = showReset; hud.reset.hidden = !showReset; }
  if ((standT -= dt) <= 0) { standT = 0.25; updateStandings(p); }
  drawRadar();
  updateTags();
}
// ================= zoomed pages =================
/**
 * Lay the HUD out in the part of the page that's on screen. Normally that's all of it; if the page has been zoomed
 * (a browser that zooms in on a text field, a pinch that got through), the controls stay within reach instead of
 * sitting off screen at the page's edges. `vv`: the visual viewport (tests pass their own).
 */
export function fitHud(vv = window.visualViewport) {
  if (!vv) return;
  const s = $('#hud').style, zoomed = vv.scale > 1.01 || vv.offsetLeft > 0.5 || vv.offsetTop > 0.5;
  s.inset = zoomed ? 'auto' : ''; s.left = zoomed ? vv.offsetLeft + 'px' : ''; s.top = zoomed ? vv.offsetTop + 'px' : '';
  s.width = zoomed ? vv.width + 'px' : ''; s.height = zoomed ? vv.height + 'px' : '';
}
if (window.visualViewport) for (const type of ['resize', 'scroll']) window.visualViewport.addEventListener(type, () => fitHud());
// ================= where you stand =================
const TH = n => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
let standT = 0;
/** The big place readout and the list of everyone in order (the mode says who's where: GameMode.standings). */
function updateStandings(p) {
  const order = G.mode.standings(), me = G.watching ? null : p, place = order.indexOf(me) + 1;
  if (hud.cache.place !== place) {
    if (place && place < hud.cache.place) { hud.place.classList.remove('up'); void hud.place.offsetWidth; hud.place.classList.add('up'); } // moved up: a flash
    hud.cache.place = place; hud.place.hidden = !place;
    hud.placeN.textContent = place; hud.placeTh.textContent = TH(place); hud.placeOf.textContent = '/' + order.length;
  }
  const scores = order.map(c => G.mode.score(c)), key = order.map((c, i) => c.pid + scores[i] + (c.alive ? '' : 'x')).join('|');
  if (hud.cache.standings === key) return;
  hud.cache.standings = key;
  const list = hud.standings;
  while (list.children.length > order.length) list.removeChild(list.lastChild);
  order.forEach((c, i) => {
    let li = list.children[i];
    if (!li) { li = document.createElement('li'); li.innerHTML = '<b></b><i></i><span></span><em></em>'; list.appendChild(li); }
    const [n, dot, name, sc] = li.children, cls = (c === me ? 'me' : '') + (c.alive ? '' : ' out');
    if (li.className !== cls) li.className = cls;
    n.textContent = i + 1; dot.style.background = c.def.tag; name.textContent = c === me ? 'You' : c.name; sc.textContent = scores[i]; // names can come from other players: never HTML
  });
}
function drawRadar() {
  const cv = hud.radar, x = cv.getContext('2d'), S = cv.width, R = S / 2, p = G.player;
  // what's nearby, turning with the car; or the whole map, north up (the `map` action switches)
  const whole = G.settings.radar === 'map', o = G.map.overview, range = whole ? o.r : 130, k = (R - 8) / range;
  x.clearRect(0, 0, S, S);
  x.fillStyle = 'rgba(30,17,42,0.7)'; x.beginPath(); x.arc(R, R, R - 3, 0, TAU); x.fill();
  x.strokeStyle = 'rgba(246,234,212,0.35)'; x.lineWidth = 3; x.stroke();
  if (!whole) { x.strokeStyle = 'rgba(246,234,212,0.12)'; x.lineWidth = 2; x.beginPath(); x.arc(R, R, R * 0.5, 0, TAU); x.stroke(); }
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  /** @type {(wx: number, wz: number) => [number, number, boolean]} */
  const toR = whole
    ? (wx, wz) => { const lx = wx - o.x, lz = wz - o.z; return [R - lx * k, R - lz * k, Math.hypot(lx, lz) < range]; }
    : (wx, wz) => { const dx = wx - p.x, dz = wz - p.z; const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy; return [R - lx * k, R - lz * k, Math.hypot(lx, lz) < range]; };
  // the map's own features, then the cars
  x.save(); x.beginPath(); x.arc(R, R, R - 4, 0, TAU); x.clip();
  G.map.drawRadar(x, toR, R, range);
  for (const c of G.cars) {
    if (c === p) continue; const [cx, cyy, ok] = toR(c.x, c.z);
    const px = ok ? cx : R + (cx - R) * (R - 10) / Math.hypot(cx - R, cyy - R), py = ok ? cyy : R + (cyy - R) * (R - 10) / Math.hypot(cx - R, cyy - R);
    x.fillStyle = c.alive ? c.def.tag : 'rgba(120,110,110,0.7)';
    x.beginPath(); x.arc(px, py, c.alive ? 6.5 : 4, 0, TAU); x.fill();
  }
  x.restore();
  // this screen's car: an arrow, at the middle pointing up, or where it is on the map pointing where it's going
  const [ax, ay] = whole ? toR(p.x, p.z) : [R, R];
  x.save(); x.translate(ax, ay); if (whole) { x.rotate(-p.yaw); x.strokeStyle = 'rgba(30,17,42,0.9)'; x.lineWidth = 3; }
  x.fillStyle = '#f6ead4'; x.beginPath(); x.moveTo(0, -10); x.lineTo(7, 7); x.lineTo(0, 3); x.lineTo(-7, 7); x.closePath(); if (whole) x.stroke(); x.fill();
  x.restore();
}
export const TAGS = [];
export function buildTags() {
  hud.tags.innerHTML = ''; TAGS.length = 0;
  for (const c of G.cars) {
    if (c.isPlayer) continue;
    const el = document.createElement('div'); el.className = 'tag'; el.style.color = c.def.tag;
    el.innerHTML = '<span></span><b><i></i></b>'; el.firstChild.textContent = c.name; hud.tags.appendChild(el); // names can come from other players: never HTML
    TAGS.push({ c, el, bar: el.querySelector('i'), vis: null, pref: false });
  }
}
function updateTags() {
  const W = innerWidth, H = innerHeight, p = G.player;
  for (const t of TAGS) {
    const c = t.c; let show = c.alive;
    if (show) {
      _v1.set(c.x, c.y + 3.6, c.z).project(camera);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      show = _v1.z < 1 && d < 100 && Math.abs(_v1.x) < 1.1 && Math.abs(_v1.y) < 1.1;
      if (show) {
        const sx = (_v1.x * 0.5 + 0.5) * W, sy = (-_v1.y * 0.5 + 0.5) * H;
        t.el.style.transform = `translate(${sx.toFixed(1)}px,${(sy - 20).toFixed(1)}px)`;
        t.el.style.opacity = d < 70 ? 1 : (1 - (d - 70) / 30).toFixed(2);
        t.bar.style.transform = `scaleX(${Math.max(0, c.hp / c.def.hp).toFixed(3)})`;
      }
    }
    const pref = c === p.pref; if (t.pref !== pref) { t.pref = pref; t.el.classList.toggle('pref', pref); }
    if (t.vis !== show) { t.vis = show; t.el.style.display = show ? '' : 'none'; }
  }
  // lock-on
  let lt = null;
  if (p.alive && (p.weapon === 'missile' || p.weapon === 'mortar' || p.def.id === 'bigchill')) lt = findTarget(p, p.weapon === 'mortar' ? RANGE.mortar : RANGE.missile, p.weapon === 'mortar' ? CONE.mortar : CONE.missile);
  if (lt) {
    _v1.set(lt.x, lt.y + 1.2, lt.z).project(camera);
    if (_v1.z < 1) { hud.lock.style.transform = `translate(${((_v1.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-_v1.y * 0.5 + 0.5) * H).toFixed(1)}px)`; hud.lock.classList.add('on'); } else lt = null;
  }
  if (!lt) hud.lock.classList.remove('on');
}
