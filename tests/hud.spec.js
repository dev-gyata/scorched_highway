import { test, expect } from '@playwright/test';

// Where you stand: the big place readout, the standings list and the radar's whole-map view.
async function match(page, settings) {
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(s => localStorage.setItem('shwy_settings', JSON.stringify(s)), { quality: 'low', opponents: 5, ...settings });
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
  await page.evaluate(() => { const { G, goGarage, startMatch } = window.SH; goGarage(); startMatch(); G.countdown = 0; G.ais.length = 0; });
}
/** Run the game for `n` frames and return what the HUD says. */
const hudAfter = (page, n = 30) => page.evaluate(n => {
  for (let i = 0; i < n; i++) window.SH.tick(performance.now() + i * 17);
  const q = s => document.querySelector(s);
  return {
    place: q('#place').hidden ? '' : q('#placeN').textContent + q('#placeTh').textContent + q('#placeOf').textContent,
    rows: [...q('#standings').children].map(li => [...li.children].map(e => e.textContent).filter(Boolean).join(' ') + (li.className ? ` [${li.className.trim()}]` : '')),
    order: window.SH.G.mode.standings().map(c => c.pid),
  };
}, n);

test('deathmatch: your place and the standings follow wrecks, and wrecked cars drop to the bottom', async ({ page }) => {
  await match(page, { mode: 'deathmatch', map: 'ghost-town', car: 'sundowner' });
  let h = await hudAfter(page);
  expect(h.place).toBe('1st/6'); // nobody has scored: pid order, and you're pid 0
  expect(h.rows).toHaveLength(6);
  expect(h.rows[0]).toBe('1 You 0 wrecks [me]');
  // a bot wrecks another: it goes ahead of you, and its victim to the bottom
  await page.evaluate(() => { const { G, damageCar } = window.SH; damageCar(G.cars[3], 9999, G.cars[2], 'test'); });
  h = await hudAfter(page);
  expect(h.order[0]).toBe(2); expect(h.order[5]).toBe(3);
  expect(h.place).toBe('2nd/6');
  expect(h.rows[0]).toMatch(/^1 .+ 1 wreck$/);
  expect(h.rows[1]).toBe('2 You 0 wrecks [me]');
  expect(h.rows[5]).toMatch(/out \[out\]$/);
  // you wreck two: back in front
  await page.evaluate(() => { const { G, damageCar } = window.SH; damageCar(G.cars[4], 9999, G.player, 'test'); damageCar(G.cars[5], 9999, G.player, 'test'); });
  h = await hudAfter(page);
  expect(h.place).toBe('1st/6');
  expect(h.rows[0]).toBe('1 You 2 wrecks [me]');
  // and the results screen lists everyone in the same order
  const results = await page.evaluate(() => window.SH.G.mode.results(window.SH.G.player).order.map(c => c.pid));
  expect(results).toEqual(h.order);
});

test('race: your place is big, the list shows gaps, and the top line keeps the lap', async ({ page }) => {
  test.slow(); // builds the canyon
  await match(page, { mode: 'race', map: 'route67', car: 'scorcher' });
  let h = await hudAfter(page);
  expect(h.place).toMatch(/^[56]th\/6$/); // people start on the back row
  expect(h.rows[parseInt(h.place) - 1]).toMatch(/^[56] You \+\d+ m \[me\]$/);
  expect(h.rows[0]).toMatch(/^1 .+ Lap 1\/3$/);
  expect(await page.textContent('#alive')).toBe('Lap 1/3');
  // put yourself a lap ahead: first, and the car behind is a lap's length back
  await page.evaluate(() => { window.SH.G.player.race.progress.lap = 2; });
  h = await hudAfter(page);
  expect(h.place).toBe('1st/6');
  expect(h.rows[0]).toBe('1 You Lap 2/3 [me]');
  expect(+h.rows[1].match(/\+(\d+) m/)[1]).toBeGreaterThan(500);
  expect(await page.evaluate(() => document.querySelector('#place').classList.contains('up'))).toBe(true); // moved up: it flashes
});

test('the radar switches between nearby and the whole map: M, or a tap on it', async ({ page }) => {
  await match(page, { mode: 'deathmatch', map: 'ghost-town' });
  /** How many of the other cars the radar draws inside its circle, rather than pinned to its edge. */
  const inside = () => page.evaluate(() => {
    window.SH.tick(performance.now() + 17);
    const { G } = window.SH, o = G.map.overview, p = G.player, whole = G.settings.radar === 'map';
    return { mode: G.settings.radar, n: G.cars.filter(c => c !== p && (whole ? Math.hypot(c.x - o.x, c.z - o.z) < o.r : Math.hypot(c.x - p.x, c.z - p.z) < 130)).length };
  });
  const near = await inside();
  expect(near.mode).toBe('near'); expect(near.n).toBeLessThan(5); // town is wider than the radar reaches
  await page.keyboard.press('KeyM');
  const whole = await inside();
  expect(whole).toEqual({ mode: 'map', n: 5 }); // everyone is on the map
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shwy_settings')).radar)).toBe('map'); // and it's remembered
  await page.click('#radar');
  expect((await inside()).mode).toBe('near');
  // every map says how far it reaches, and its course or arena fits inside
  const fits = await page.evaluate(() => window.SH.allMaps().map(m => {
    const o = m.overview, pts = m.course ? m.course.sections.flatMap(s => s.paths.flatMap(p => [[p.x[0], p.z[0]], [p.x[p.x.length >> 1], p.z[p.z.length >> 1]]])) : m.spawns(6).map(s => [s.x, s.z]);
    return [m.id, pts.every(([x, z]) => Math.hypot(x - o.x, z - o.z) < o.r)];
  }));
  for (const [id, ok] of fits) expect(ok, id).toBe(true);
});
