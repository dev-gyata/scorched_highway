import { test, expect } from '@playwright/test';

// Every map and mode, so a new one is covered as soon as it's registered.
async function boot(page) {
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
}

test('every map hosts at least one mode, every mode has a map, and maps own separate stretches of the world', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const maps = window.SH.allMaps(), modes = window.SH.allModes().map(m => m.id);
    return {
      unknownModes: maps.flatMap(m => m.modes.filter(id => !modes.includes(id)).map(id => `${m.id}:${id}`)),
      homeless: modes.filter(id => !maps.some(m => m.modes.includes(id))),
      overlaps: maps.slice(1).filter((m, i) => m.x0 < maps[i].x1).map(m => m.id),
    };
  });
  expect(r).toEqual({ unknownModes: [], homeless: [], overlaps: [] });
});

test('every map and mode pairing starts, plays and ends cleanly', async ({ page }) => {
  test.slow(); // builds every map
  await boot(page);
  const played = await page.evaluate(() => {
    const { G, goGarage, startMatch, step, damageCar, allMaps } = window.SH, out = [];
    for (const map of allMaps()) for (const mode of map.modes) {
      G.settings.mode = mode; G.settings.map = map.id; G.settings.opponents = 3;
      goGarage(); startMatch(); G.countdown = 0;
      const ok = G.map === map && G.mode.id === mode && G.cars.every(c => !map.blocked(c.x, c.z, 0));
      for (let i = 0; i < 120; i++) step(1 / 60, 1 / 60);
      for (const c of G.cars) if (!c.isPlayer) damageCar(c, 9999, G.player);
      for (let i = 0; i < 300; i++) step(1 / 60, 1 / 60);
      out.push({ pair: `${map.id}/${mode}`, ok, status: G.mode.status(G.player).join(' ') });
    }
    return out;
  });
  expect(played.length).toBeGreaterThanOrEqual(2);
  for (const p of played) { expect(p.ok, p.pair).toBe(true); expect(p.status, p.pair).not.toBe(''); }
});

test('every map has room for a field of ten: nobody starts in a wall or on top of someone else', async ({ page }) => {
  test.slow();
  await boot(page);
  const fields = await page.evaluate(() => {
    const { G, goGarage, startMatch, step, allMaps } = window.SH, out = [];
    for (const map of allMaps()) for (const mode of map.modes) {
      G.settings.mode = mode; G.settings.map = map.id; G.settings.opponents = 9;
      goGarage(); startMatch(); G.countdown = 0;
      let gap = Infinity; for (const a of G.cars) for (const b of G.cars) if (a !== b) gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z));
      const clear = G.cars.every(c => !map.blocked(c.x, c.z, 0)), names = new Set(G.cars.map(c => c.name)).size;
      for (let i = 0; i < 240; i++) step(1 / 60, 1 / 60);
      out.push({ pair: `${map.id}/${mode}`, cars: G.cars.length, gap, clear, names, moving: G.cars.filter(c => c.speed > 3).length });
    }
    return out;
  });
  for (const f of fields) {
    expect(f.cars, f.pair).toBe(10); expect(f.clear, f.pair).toBe(true);
    expect(f.gap, f.pair).toBeGreaterThan(5); // a car is under 5 m long
    expect(f.names, f.pair).toBe(10); // a model's second driver gets a name of their own
    expect(f.moving, f.pair).toBeGreaterThan(5); // and the bots get going
  }
});

test('garage: picking a mode offers only the maps that host it', async ({ page }) => {
  await boot(page);
  await page.click('#toGarage');
  const mode = page.locator('#garage .cyc[data-opt="mode"]'), map = page.locator('#garage .cyc[data-opt="map"]'); // (the online lobby has its own)
  await expect(mode.locator('span')).toHaveText('Deathmatch');
  await expect(map.locator('span')).toHaveText('Ghost Town');
  await expect(page.locator('#startBtn')).toHaveText('Enter the Arena');
  await mode.locator('button').last().click();
  await expect(mode.locator('span')).toHaveText('Race');
  await expect(map.locator('span')).toHaveText('Route 67');
  await expect(page.locator('#startBtn')).toHaveText('Start the race');
  // the map picker goes round the maps that host the mode, and no others
  const offered = async () => {
    const seen = [];
    for (;;) { const name = await map.locator('span').textContent(); if (seen.includes(name)) return seen; seen.push(name); if (await map.locator('button').last().isDisabled()) return seen; await map.locator('button').last().click(); } // (one map: nothing to switch to)
  };
  const hosts = id => page.evaluate(id => window.SH.allMaps().filter(m => m.modes.includes(id)).map(m => m.name), id);
  expect((await offered()).sort()).toEqual((await hosts('race')).sort());
  expect(await hosts('race')).toContain('Salt Lake Run');
  await mode.locator('button').last().click();
  await expect(mode.locator('span')).toHaveText('Deathmatch');
  expect((await offered()).sort()).toEqual((await hosts('deathmatch')).sort());
});

test('sand is slower than dirt', async ({ page }) => {
  await boot(page);
  const k = await page.evaluate(() => {
    const route = window.SH.getMap('route67'), paths = route.course.sections.flatMap(s => s.paths);
    const wash = paths.find(p => p.name === 'Dry wash'), flats = paths.find(p => p.name === 'Desert flats'), i = 20;
    return [route.speed(wash.x[i], wash.z[i]), route.speed(flats.x[i], flats.z[i])];
  });
  expect(k[0]).toBeLessThan(1); expect(k[1]).toBeGreaterThanOrEqual(1);
});

test('the Boneyard: planes and car stacks are solid, the gutted shells are open, the pit is below the lake bed and the berm holds cars in', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const { G, goGarage, startMatch, step, getMap } = window.SH, m = getMap('boneyard'), X = 18000;
    G.settings.mode = 'deathmatch'; G.settings.map = 'boneyard'; goGarage(); startMatch(); G.countdown = 0; G.ais.length = 0;
    const p = G.player, drive = (x, z, yaw, frames) => { p.x = X + x; p.z = z; p.y = m.height(p.x, p.z) + 0.5; p.yaw = yaw; p.vx = p.vz = p.vy = 0; for (let i = 0; i < frames; i++) { p.vx = Math.sin(yaw) * 14; p.vz = Math.cos(yaw) * 14; step(1 / 60, 1 / 60); } return [p.x - X, p.z]; }; // pushed along at 14 m/s
    const through = drive(-40, 112, Math.PI / 2, 240); // east along the gutted airliner at (-14, 112)
    const into = drive(-95, -50, Math.PI, 240); // south into the side of the airliner at (-95, -78)
    const out = drive(150, 0, Math.PI / 2, 300); // east at the berm
    return {
      plane: m.blocked(X - 95, -78, 0), stack: m.solid(X - 40, m.height(X - 40, -70) + 2, -70), aboveStack: m.solid(X - 40, m.height(X - 40, -70) + 9, -70),
      shell: m.blocked(X - 14, 112, 1), pit: m.height(X, 0), bed: m.height(X + 100, 0), ramp: m.ramp(X, -56), through, into, out: Math.hypot(...out),
    };
  });
  expect(r.plane).toBe(true); expect(r.stack).toBe(true); expect(r.aboveStack).toBe(false);
  expect(r.shell).toBe(false); // the way through is clear
  expect(r.pit).toBeLessThan(r.bed - 4); expect(r.ramp).toBeGreaterThan(2);
  expect(r.through[0]).toBeGreaterThan(10); expect(Math.abs(r.through[1] - 112)).toBeLessThan(3); // out the far end, still in line
  expect(r.into[1]).toBeGreaterThan(-78 + 2.4); // stopped at its side
  expect(r.out).toBeLessThan(176);
});
