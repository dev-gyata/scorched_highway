// The online screens: Play online (your name, host or join with a code) and the lobby (who's in the room, the
// host's choices, Start). Also what the shared buttons do online: play again, back to the lobby, leave.
import { CAR_BY_ID } from '../cars/roster.js';
import { $, isTouch } from '../engine/util.js';
import { goGarage, goTitle, show } from '../game/screens.js';
import { G, saveSettings } from '../game/state.js';
import { guestRole } from './guest';
import { hostRole, lobbyOnline, shareLobby, startOnline } from './host';
import { netError } from './peer';
import { ROOM, S, begin, end, meAsPlayer, newCode, openTransport, send } from './session';
import { PROTOCOL } from './types';

const status = (el: string, text: string) => { $(el).textContent = text; };
let busy = false;

/** Wire up the online screens (once, at boot). */
export function setupOnline() {
  const name = $('#netName') as HTMLInputElement, code = $('#netCode') as HTMLInputElement;
  $('#toOnline').addEventListener('click', () => { name.value = G.settings.name || ''; status('#netStatus', ''); show('online'); });
  $('#netBack').addEventListener('click', () => show('title'));
  name.addEventListener('change', () => { G.settings.name = name.value.trim().slice(0, 16); saveSettings(); });
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  code.addEventListener('keydown', e => { if (e.key === 'Enter') join(code.value); });
  $('#netHost').addEventListener('click', host);
  $('#netJoin').addEventListener('click', () => join(code.value));
  $('#lobbyGo').addEventListener('click', () => {
    if (!S) return;
    if (S.role.name === 'host') startOnline();
    else { const me = S.players.find(p => p.id === S!.me); send(S.host, { t: 'me', ready: !me?.ready }); }
  });
  $('#lobbyCar').addEventListener('click', () => { document.body.classList.add('picking'); goGarage(); $('#startBtn').textContent = 'Back to the lobby'; });
  $('#lobbyShare').addEventListener('click', share);
  $('#lobbyLeave').addEventListener('click', leaveOnline);
  // the host's choices: the pickers save to settings (game/screens.js); tell everyone
  $('#lobbyOpts').addEventListener('click', () => { if (S?.role.name === 'host') shareLobby(); });
}

async function host() {
  if (busy) return; busy = true; status('#netStatus', 'Opening a room…');
  try {
    let t = null;
    for (let tries = 0; !t && tries < 4; tries++) {
      const c = newCode();
      t = await openTransport(ROOM + c).catch(e => { if ((e as { type?: string; message?: string })?.type === 'unavailable-id' || (e as Error)?.message === 'unavailable-id') return null; throw e; });
      if (t) { const s = begin(t, c, t.id, hostRole(), [{ ...meAsPlayer(t.id), ready: true }]); hooks(s); shareLobby(); toLobby(); }
    }
    if (!t) status('#netStatus', 'Couldn’t open a room. Try again.');
  } catch (e) { status('#netStatus', netError(e)); }
  busy = false;
}
async function join(raw: string) {
  const c = raw.trim().toUpperCase();
  if (busy) return; if (c.length !== 5) { status('#netStatus', 'Room codes have five letters.'); return; }
  busy = true; status('#netStatus', 'Joining…');
  try {
    const t = await openTransport(ROOM + c + '-' + Math.random().toString(36).slice(2, 8));
    try { await t.connect(ROOM + c); } catch (e) { t.close(); throw e; }
    const s = begin(t, c, ROOM + c, guestRole(), []); hooks(s);
    send(s.host, { t: 'hello', name: G.settings.name || 'Driver', car: G.settings.car, desktop: !isTouch, v: PROTOCOL });
    // the lobby (or a "no") should come back at once
    setTimeout(() => { if (S === s && !s.players.length) end('No answer from that game. Try again.'); }, 8000);
  } catch (e) { status('#netStatus', netError(e)); }
  busy = false;
}
/** What the session tells the screens. */
function hooks(s: NonNullable<typeof S>) {
  let first = true;
  s.onlobby = () => {
    render();
    if (first && s.players.length) { first = false; toLobby(); } // a guest's first look at the room
    else if (!s.seats && (G.state === 'over' || G.state === 'playing')) toLobby(); // the host went back to the lobby
  };
  s.onstart = () => document.body.classList.remove('picking');
  s.onend = why => { document.body.classList.remove('picking'); goTitle(); if (why) { show('online'); status('#netStatus', why); } };
}

/** Show the lobby (over the title-screen view). */
function toLobby() { document.body.classList.remove('picking'); goTitle(); show('lobby'); render(); }
/** Draw the lobby: the room code, who's in, what the host has picked. */
function render() {
  if (!S) return;
  const hostHere = S.role.name === 'host';
  $('#lobbyCode').textContent = S.code;
  const list = $('#lobbyPlayers'); list.innerHTML = '';
  for (const p of S.players) {
    const li = document.createElement('li'), d = CAR_BY_ID[p.car];
    if (p.id === S.me) li.className = 'me';
    li.innerHTML = '<i></i><span class="who"></span><small></small>';
    (li.querySelector('i') as HTMLElement).style.background = d ? d.tag : '#999';
    (li.querySelector('.who') as HTMLElement).textContent = p.name + (p.id === S.me ? ' (you)' : ''); // names are text, never HTML
    (li.querySelector('small') as HTMLElement).textContent = (d ? d.name : '') + (p.id !== S.me && p.ping ? ` · ${p.ping} ms` : '');
    const tag = p.id === S.host ? ['host', 'Host'] : p.ready ? ['ready', 'Ready'] : null;
    if (tag) { const b = document.createElement('b'); b.className = 'tag ' + tag[0]; b.textContent = tag[1]; li.appendChild(b); }
    list.appendChild(li);
  }
  $('#lobbyOpts').hidden = !hostHere;
  const me = S.players.find(p => p.id === S!.me), go = $('#lobbyGo') as HTMLButtonElement;
  go.textContent = hostHere ? 'Start' : me?.ready ? 'Not ready' : 'Ready';
  go.disabled = hostHere && S.players.length < 2 && G.settings.bots === 'off';
  const opts = S.opts, mode = opts.mode === 'race' ? 'Race' : 'Deathmatch';
  status('#lobbyNote', hostHere
    ? (isTouch ? 'Hosting works best on a computer: the host’s device runs the whole match.' : S.players.length < 2 ? 'Waiting for drivers… or start now against bots.' : '')
    : `${mode} · ${opts.bots === 'fill' ? 'bots fill the field' : 'no bots'} · the host starts the match`);
}
async function share() {
  if (!S) return;
  const url = `${location.origin}${location.pathname}?join=${S.code}`, text = `Join my Scorched Highway game: room ${S.code}`;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: 'Scorched Highway', text, url });
    else { await navigator.clipboard.writeText(S.code); status('#lobbyNote', 'Room code copied.'); }
  } catch { /* cancelled */ }
}

/** Back from choosing a car in the garage: tell the room. */
export function carPicked() {
  document.body.classList.remove('picking');
  if (!S) return;
  const me = S.players.find(p => p.id === S!.me); if (me) me.car = G.settings.car;
  if (S.role.name === 'host') shareLobby(); else send(S.host, { t: 'me', car: G.settings.car });
  toLobby();
}
/** Results' main button, online: the host starts the next match; guests wait for it. */
export function playAgain() { if (S?.role.name === 'host') startOnline(); }
/** Results' second button, online: back to the lobby (the host takes everyone). */
export function backToLobby() { if (S?.role.name === 'host') lobbyOnline(); toLobby(); }
export function leaveOnline() { end(); goTitle(); }
/** A ?join=CODE link: open Play online with the code filled in. */
export function openFromLink() {
  const q = new URLSearchParams(location.search).get('join'); if (!q) return;
  ($('#netCode') as HTMLInputElement).value = q.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  ($('#netName') as HTMLInputElement).value = G.settings.name || '';
  show('online');
}
