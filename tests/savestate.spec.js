import { test, expect } from '@playwright/test';

// What online play saves and sends: a snapshot survives being packed into bytes and back, and a match's saved
// state (for a player taking over as host, src/net/migrate.ts) loads back as it was.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(() => localStorage.setItem('shwy_settings', JSON.stringify({ quality: 'low', mode: 'deathmatch', map: 'ghost-town' })));
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
  // a match with things in flight: missiles, rockets and mines, a cooldown or two, a crate taken
  await page.evaluate(() => {
    const { G, goGarage, startMatch, step, testPark, combat, pickups } = window.SH;
    goGarage(); startMatch(); G.countdown = 0; G.ais.length = 0; testPark(30);
    const [p, o] = G.cars;
    combat.giveAmmo(p, 'missile'); combat.giveAmmo(p, 'mines'); combat.giveAmmo(o, 'rockets');
    p.weapon = 'missile'; p.wFire = true; step(1 / 60, 1 / 60);
    p.weapon = 'mines'; p.cdW = 0; p.wFire = true; step(1 / 60, 1 / 60);
    o.weapon = 'rockets'; o.wFire = true; step(1 / 60, 1 / 60);
    const pk = pickups.find(k => k.active && Math.abs(k.x) < 3000); pk.active = false; pk.respawn = 9;
  });
});

test('a snapshot packed into bytes and back says the same', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, net } = window.SH, bytes = net.encodeSnap(7, 12.5), s = net.decodeSnap(bytes);
    const c = G.cars[0], sc = s.cars[0];
    return {
      bytes: bytes.byteLength, seq: s.seq, now: s.now, cars: s.cars.length, n: G.cars.length, proj: s.proj.length, live: window.SH.combat.PROJ.filter(p => p.mesh).length,
      mines: s.mines.length, liveMines: window.SH.combat.MINES.length,
      pos: Math.hypot(sc.x - c.x, sc.y - c.y, sc.z - c.z), yaw: Math.abs(sc.yaw - c.yaw), hp: Math.abs(sc.hp - c.hp), weapon: sc.weapon === c.weapon,
      ammo: Object.values(c.ammo).map((a, i) => Math.abs(a - sc.ammo[i])).every(d => d < 0.01), alive: sc.alive === c.alive,
    };
  });
  expect(r.seq).toBe(7); expect(r.now).toBe(12.5); expect(r.cars).toBe(r.n);
  expect(r.proj).toBe(r.live); expect(r.proj).toBeGreaterThan(0); expect(r.mines).toBe(r.liveMines);
  expect(r.pos).toBeLessThan(0.001); expect(r.yaw).toBeLessThan(0.001); expect(r.hp).toBeLessThan(0.1);
  expect(r.weapon && r.ammo && r.alive).toBe(true);
  expect(r.bytes).toBeLessThan(2048); // twenty a second to every guest: it has to stay small
});

test('saved match state loads back as it was', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, net, combat } = window.SH, saved = JSON.parse(JSON.stringify(net.saveState())); // as it travels
    const before = { proj: combat.PROJ.map(p => [p.type, p.owner.pid, p.target ? p.target.pid : -1, p.x.toFixed(2)]), mines: combat.MINES.map(m => [m.owner.pid, m.x.toFixed(2)]), cd: G.cars[0].cdW, hit: G.cars[1].lastHitBy?.pid };
    // wreck it: clear what's in flight, reset the timers
    for (const p of combat.PROJ) p.mesh.visible = false; combat.PROJ.length = 0;
    for (const m of combat.MINES) m.mesh.visible = false; combat.MINES.length = 0;
    G.cars[0].cdW = 0; G.cars[1].lastHitBy = null;
    net.loadState(saved);
    const after = { proj: combat.PROJ.map(p => [p.type, p.owner.pid, p.target ? p.target.pid : -1, p.x.toFixed(2)]), mines: combat.MINES.map(m => [m.owner.pid, m.x.toFixed(2)]), cd: G.cars[0].cdW, hit: G.cars[1].lastHitBy?.pid };
    window.SH.step(1 / 60, 1 / 60); // and the match carries on from it
    return { before, after, size: JSON.stringify(saved).length, meshes: combat.PROJ.every(p => !p.mesh || p.mesh.visible) };
  });
  expect(r.after).toEqual(r.before);
  expect(r.meshes).toBe(true);
  expect(r.size).toBeLessThan(20_000); // once a second to every guest
});
