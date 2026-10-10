// The online screens: Play online (your name, host or join with a code) and the lobby (who's in the room, the
// host's choices, Start). Also what the shared buttons do online: play again, back to the lobby, leave.
import { CAR_BY_ID } from '../cars/roster.js';
import { $, isTouch } from '../engine/util.js';
import { goGarage, goTitle, show } from '../game/screens.js';
import { G, saveSettings } from '../game/state.js';
import { guestRole } from './guest';
import { hostRole, lobbyOnline, shareLobby, startOnline } from './host';
import { netError } from './peer';
import { ROOM, S, begin, end, meAsPlayer, newCode, openTransport, sayHello, send } from './session';

const status = (el: string, text: string) => { $(el).textContent = text; };
let busy = false;

/** Wire up the online screens (once, at boot). */
export function setupOnline() {
  const name = $('#netName') as HTMLInputElement, code = $('#netCode') as HTMLInputElement;
  $('#toOnline').addEventListener('click', () => { name.value = G.settings.name || ''; status('#netStatus', ''); $('#netJoin').textContent = 'Join'; show('online'); });
  $('#netBack').addEventListener('click', () => show('title'));
  name.addEventListener('change', keepName);
  name.addEventListener('keydown', e => { if (e.key === 'Enter' && code.value.length === 5) { keepName(); join(code.value); } });
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  code.addEventListener('keydown', e => { if (e.key === 'Enter') join(code.value); });
  $('#netHost').addEventListener('click', host);
  $('#netJoin').addEventListener('click', () => { keepName(); join(code.value); });
  $('#lobbyGo').addEventListener('click', () => {
    if (!S) return;
    if (S.role.name === 'host') startOnline();
    else { const me = S.players.find(p => p.id === S!.me); send(S.host, { t: 'me', ready: !me?.ready }); }
  });
  $('#lobbyCar').addEventListener('click', () => { document.body.classList.add('picking'); goGarage(); $('#startBtn').textContent = 'Back to the lobby'; });
  $('#lobbyShare').addEventListener('click', e => share(e.currentTarget as HTMLElement));
  $('#inviteBtn').addEventListener('click', e => share(e.currentTarget as HTMLElement));
  $('#lobbyLink').addEventListener('focus', e => (e.target as HTMLInputElement).select());
  $('#lobbyLeave').addEventListener('click', leaveOnline);
  // the host's choices: the pickers save to settings (game/screens.js); tell everyone
  $('#lobbyOpts').addEventListener('click', () => { if (S?.role.name === 'host') shareLobby(); });
}

function keepName() { G.settings.name = ($('#netName') as HTMLInputElement).value.trim().slice(0, 16); saveSettings(); }

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
    sayHello(s.host);
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
  $('#lobbyCode').textContent = S.code; ($('#lobbyLink') as HTMLInputElement).value = S.shut ? '' : inviteLink();
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
  status('#lobbyNote', S.shut ? 'The invite link and code stopped working when the first host left. Open a new room to invite more people.' : hostHere
    ? (isTouch ? 'Hosting works best on a computer: the host’s device runs the whole match.' : S.players.length < 2 ? 'Waiting for drivers… or start now against bots.' : '')
    : `${mode} · ${opts.bots === 'fill' ? 'bots fill the field' : 'no bots'} · the host starts the match`);
}
/** The link that brings someone straight into this room. */
function inviteLink() {
  const u = new URL(location.href), keep = new URLSearchParams(), q = u.searchParams;
  for (const k of ['net', 'lag']) if (q.has(k)) keep.set(k, q.get(k)!); // playing between tabs (local.ts): so must they
  keep.set('join', S!.code); u.search = keep.toString(); u.hash = '';
  return u.href;
}
/** Send the invite: the phone's share sheet, or the clipboard (`btn` says it's done). */
async function share(btn: HTMLElement) {
  if (!S || S.shut) return;
  const url = inviteLink(), label = btn.textContent;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: 'Scorched Highway', text: `Join my Scorched Highway game (room ${S.code})`, url });
    else { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied'; setTimeout(() => { btn.textContent = label; }, 1800); }
  } catch { /* cancelled, or no clipboard: the link is there to copy by hand */ }
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
/** A ?join=CODE link: join that room at once (or ask for a name first, if this player hasn't one yet). */
export function openFromLink() {
  const q = new URLSearchParams(location.search), raw = q.get('join'); if (!raw) return;
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5), name = $('#netName') as HTMLInputElement;
  q.delete('join'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); // used: a reload shouldn't join again
  ($('#netCode') as HTMLInputElement).value = code; name.value = G.settings.name || '';
  status('#netStatus', ''); show('online');
  if (code.length !== 5) { status('#netStatus', 'That invite link isn’t complete. Ask for it again, or type the room code.'); return; }
  if (G.settings.name) join(code);
  else { status('#netStatus', `You’re invited to room ${code}. Pick a name, then join.`); $('#netJoin').textContent = `Join ${code}`; name.focus(); }
}
