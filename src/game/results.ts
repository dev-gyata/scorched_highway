// The career record shown on the title screen, and the results screen at the end of a match.
import { $, loadStore, store } from '../engine/util.js';
import { G } from './state.js';
import type { Car, GameMode } from '../modes/types';

interface Career { matches: number; wins: number; kills: number; mostKills: number; bestPlace: number }
export function career(): Career { return Object.assign({ matches: 0, wins: 0, kills: 0, mostKills: 0, bestPlace: 0 }, loadStore('best', {})); }

const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** "12 matches · 3 wins · 27 wrecks" under the title, once there's a record to show. */
export function showRecord() {
  const c = career(), el = $('#record');
  el.hidden = !c.matches;
  el.textContent = [plural(c.matches, 'match').replace('matchs', 'matches'), plural(c.wins, 'win'), plural(c.kills, 'wreck')].join(' · ');
}

/** The results screen as one driver sees it, in plain data (online, the host works it out for each player). */
export interface ResultsView { order: number[]; win: boolean; title: string; sub: string; tiles: Array<[string, string]>; fates: string[]; place: number }
export function resultsView(viewer: Car): ResultsView {
  const r = (G.mode as GameMode).results(viewer);
  return { order: r.order.map(c => c.pid), win: r.win, title: r.title, sub: r.sub, tiles: r.tiles, fates: r.order.map(c => r.fate(c)), place: r.order.indexOf(viewer) + 1 };
}
/** The results for someone who only watched (they joined an online match part-way): the standings, and who came first. */
export function watcherView(): ResultsView {
  const first = (G.mode as GameMode).results((G.cars as Car[])[0]).order[0], v = resultsView(first);
  return { ...v, win: false, title: 'Match over', sub: `${first.name} came out on top. You’re in the next one.`, tiles: [], place: 0 };
}
/** Fill in the results screen for the match that just ended (the mode supplies the content) and add it to the career record. */
export function showResults(view = resultsView(G.player as Car)) {
  const p = (G.watching ? null : G.player) as Car | null, cars = G.cars as Car[], place = view.place, win = view.win; // someone who only watched has no car, and no place
  const title = $('#overTitle'); title.textContent = view.title; title.classList.toggle('lost', !win);
  $('#overSub').textContent = view.sub;
  // online, the host starts the next match; everyone can go back to the lobby or leave
  const again = $('#againBtn') as HTMLButtonElement, guest = !!G.net && G.net.role !== 'host';
  again.textContent = guest ? 'Waiting for host…' : (G.mode as GameMode).againLabel; again.disabled = guest;
  $('#oGarageBtn').textContent = G.net ? 'Back to the lobby' : 'Change car'; $('#oTitleBtn').textContent = G.net ? 'Leave' : 'Title';
  ($('#rPlace').parentNode as HTMLElement).hidden = !p; $('#rPlace').textContent = ordinal(place); $('#rOf').textContent = `of ${cars.length}`;
  $('#rTiles').innerHTML = view.tiles.map(([label, value]) => `<div><b>${esc(String(value))}</b><span>${esc(String(label))}</span></div>`).join('');
  $('#rStandings').innerHTML = view.order.map((pid, i) => {
    const c = cars[pid]; if (!c) return ''; // online, the view comes from the host: only cars that exist here
    const who = c === p ? `You <small>${esc(c.def.name)}</small>` : `${esc(c.name)} <small>${esc(c.def.name)}</small>`;
    return `<li class="${c === p ? 'me' : ''}"><b>${ordinal(i + 1)}</b><i style="background:${c.def.tag}"></i><span class="who">${who}</span><span class="k">${plural(c.kills, 'wreck')}</span><span class="fate">${esc(String(view.fates[i] ?? ''))}</span></li>`;
  }).join('');
  $('#rBadges').innerHTML = ''; if (!p) return;
  // career record, and anything this match beat
  const c = career(), badges: string[] = [];
  if (win && !c.wins) badges.push('First win!');
  if (p.kills > c.mostKills && c.matches) badges.push('Most wrecks in a match');
  if (c.bestPlace && place < c.bestPlace) badges.push('Best finish yet');
  $('#rBadges').innerHTML = badges.map(b => `<span>${b}</span>`).join('');
  store('best', { matches: c.matches + 1, wins: c.wins + (win ? 1 : 0), kills: c.kills + p.kills, mostKills: Math.max(c.mostKills, p.kills), bestPlace: c.bestPlace ? Math.min(c.bestPlace, place) : place });
}
