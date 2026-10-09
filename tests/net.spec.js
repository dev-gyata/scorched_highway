import { test, expect } from '@playwright/test';

// Multiplayer: several people in one match (the groundwork, no network), then online play between pages.
async function boot(page, settings = {}) {
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(s => localStorage.setItem('shwy_settings', JSON.stringify(s)), { quality: 'low', ...settings });
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
}

test('two people in one deathmatch: both drive, the match goes on while one is still running, results for each', async ({ page }) => {
  await boot(page, { mode: 'deathmatch', map: 'ghost-town' });
  const r = await page.evaluate(() => {
    const { G, goGarage, startMatch, step, damageCar } = window.SH;
    goGarage();
    startMatch([{ car: 'sundowner', human: true, local: true }, { car: 'lawdog', human: true, name: 'Pat' }, { car: 'moonbeam', human: false }, { car: 'bigchill', human: false }]);
    G.countdown = 0;
    const [me, pat, b1, b2] = G.cars, x0 = pat.x, z0 = pat.z;
    for (let i = 0; i < 60; i++) { pat.ctl.throttle = 1; step(1 / 60, 1 / 60); }
    const moved = Math.hypot(pat.x - x0, pat.z - z0);
    damageCar(b1, 9999, pat, 'test');
    const feed = document.querySelector('#feed').lastElementChild.textContent;
    damageCar(me, 9999, b2, 'test'); step(1 / 60, 1 / 60);
    const goesOn = G.endT < 0;
    damageCar(b2, 9999, pat, 'test'); step(1 / 60, 1 / 60);
    const ends = G.endT > 0;
    const forPat = G.mode.results(pat), forMe = G.mode.results(me);
    return { humans: G.cars.filter(c => c.human).length, bots: G.ais.length, names: G.cars.map(c => c.name), moved, feed, goesOn, ends, patWins: forPat.win, meWins: forMe.win, mine: forMe.sub };
  });
  expect(r.humans).toBe(2); expect(r.bots).toBe(2);
  expect(r.names[1]).toBe('Pat');
  expect(r.moved).toBeGreaterThan(3); // Pat's controls drive Pat's car
  expect(r.feed).toBe('Pat wrecked Sky Farrow'); // worded for this screen's driver
  expect(r.goesOn).toBe(true); // you're out, but Pat and a bot are still fighting
  expect(r.ends).toBe(true); // Pat is the last one running
  expect(r.patWins).toBe(true); expect(r.meWins).toBe(false);
  expect(r.mine).toContain('Mister Frost got the better of you');
});

test('two people in one race: both start at the back, and bots are paced to the average of their cars', async ({ page }) => {
  test.slow(); // the first race builds the canyon
  await boot(page, { mode: 'race', map: 'route67', difficulty: 1 });
  const r = await page.evaluate(() => {
    const { G, goGarage, startMatch, step } = window.SH;
    goGarage();
    startMatch([{ car: 'scorcher', human: true, local: true }, { car: 'bigchill', human: true, name: 'Pat' }, { car: 'moonbeam', human: false }, { car: 'lawdog', human: false }]);
    G.countdown = 0; G.ais.length = 0; step(1 / 60, 1 / 60);
    const [me, pat] = G.cars, d = c => G.map.course.distance(c.race.progress);
    const raceTop = c => c.def.max + (44 - c.def.max) * 0.75; // modes/race.ts: RACE_TOP, NARROW
    return {
      back: Math.max(d(me), d(pat)) <= Math.min(...G.cars.slice(2).map(d)),
      want: (raceTop(me) + raceTop(pat)) / 2 * 0.99, // PACE on Normal
      botPace: G.cars.slice(2).map(c => c.speedK * c.def.max),
    };
  });
  expect(r.back).toBe(true);
  for (const v of r.botPace) expect(Math.abs(v / r.want - 1)).toBeLessThan(0.04); // their own spread is 3%
});
