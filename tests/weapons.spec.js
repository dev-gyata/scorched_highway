import { test, expect } from '@playwright/test';

// Weapon rules, checked in a live match with every opponent's AI switched off.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
  await page.evaluate(() => {
    const { G, goGarage, startMatch } = window.SH;
    goGarage(); startMatch(); G.countdown = 0; G.ais.length = 0;
    for (const c of G.cars) c.input = { throttle: 0, steer: 0, handbrake: true };
  });
});
const run = (page, s) => page.evaluate(s => { for (let i = 0; i < s * 60; i++) window.SH.step(1 / 60, 1 / 60); }, s);

test('a car carries three weapons; a fourth replaces the one it has least of', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, combat } = window.SH, p = G.player;
    p.ammo.missile = 0; p.weapon = null;
    for (const w of ['missile', 'rockets', 'mortar']) combat.giveAmmo(p, w);
    p.ammo.rockets = 1; p.weapon = 'missile';
    const dropped = combat.giveAmmo(p, 'mines');
    return { dropped, held: Object.keys(p.ammo).filter(w => p.ammo[w] > 0).sort() };
  });
  expect(r.dropped).toBe('rockets');
  expect(r.held).toEqual(['mines', 'missile', 'mortar']);
});

test('every weapon and combo fires without errors', async ({ page }) => {
  const fired = await page.evaluate(() => {
    const { G, step } = window.SH, p = G.player, out = [];
    for (const w of ['missile', 'rockets', 'mortar', 'mines', 'flame']) for (const combo of [0, 1, 2]) {
      if (w === 'flame' && combo === 0) continue;
      p.ammo[w] = 10; p.weapon = w; p.cdW = 0; p.wFire = true; p.wCombo = combo;
      const before = p.ammo[w]; step(1 / 60, 1 / 60); out.push([w, combo, before - p.ammo[w]]);
      for (let i = 0; i < 90; i++) step(1 / 60, 1 / 60);
      p.ammo[w] = 0;
    }
    return out;
  });
  for (const [w, combo, spent] of fired) expect(spent, `${w} combo ${combo}`).toBe(combo ? 3 : 1);
});

test('a decoy flare pulls homing missiles off its car', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, step, combat } = window.SH, p = G.player, foe = G.cars[1];
    // park the opponent 40 m straight ahead of the player, facing it, and fire a missile at the player
    window.SH.testPark(40);
    foe.ammo.missile = 5; foe.weapon = 'missile'; foe.cdW = 0; foe.wFire = true; foe.wCombo = 0;
    step(1 / 60, 1 / 60);
    const m = combat.PROJ.find(q => q.type === 'missile'); const aimedAtPlayer = m && m.target === p;
    p.ammo.missile = 3; p.weapon = 'missile'; p.cdW = 0; p.wFire = true; p.wCombo = 2;
    step(1 / 60, 1 / 60);
    return { aimedAtPlayer, chasing: m.target && m.target.type };
  });
  expect(r.aimedAtPlayer).toBe(true);
  expect(r.chasing).toBe('flare');
});

test('mines: at most six live per car, and smoke breaks a missile lock', async ({ page }) => {
  const mines = await page.evaluate(() => {
    const { G, step, combat } = window.SH, p = G.player;
    p.ammo.mines = 8; p.weapon = 'mines';
    for (let i = 0; i < 8; i++) { p.cdW = 0; p.wFire = true; p.wCombo = 0; step(1 / 60, 1 / 60); }
    return combat.MINES.filter(m => m.owner === p).length;
  });
  expect(mines).toBe(6);
  const lost = await page.evaluate(() => {
    const { G, step, combat } = window.SH, p = G.player, foe = G.cars[1];
    window.SH.testPark(45);
    foe.ammo.missile = 5; foe.weapon = 'missile'; foe.cdW = 0; foe.wFire = true; foe.wCombo = 0;
    step(1 / 60, 1 / 60);
    const m = combat.PROJ.find(q => q.type === 'missile');
    combat.SMOKES.push({ x: (p.x + foe.x) / 2, z: (p.z + foe.z) / 2, r: 11, t: 6 });
    for (let i = 0; i < 40 && m.target; i++) step(1 / 60, 1 / 60);
    return m.target === null;
  });
  expect(lost).toBe(true);
  await run(page, 1);
});

/** A match with the player in `car` facing a parked bot `gap` metres ahead (or behind, if negative), on open ground. */
const duel = (page, car, gap) => page.evaluate(([car, gap]) => {
  const { G, goGarage, startMatch } = window.SH;
  goGarage(); startMatch([{ car, human: true, local: true }, { car: 'lawdog', human: false }]); G.countdown = 0; G.ais.length = 0;
  const [p, foe] = G.cars, put = (c, z) => { c.x = 60; c.z = z; c.y = G.map.height(60, z); c.yaw = 0; c.vx = c.vz = c.vy = 0; c.input = { throttle: 0, steer: 0, handbrake: true }; };
  put(p, 60); put(foe, 60 + gap);
  return [G.map.blocked(60, 60, 3), G.map.blocked(60, 60 + gap, 3)];
}, [car, gap]);

test('Hookjaw: the tow hook bites the car ahead and reels it in', async ({ page }) => {
  expect(await duel(page, 'hookjaw', 34)).toEqual([false, false]);
  const r = await page.evaluate(() => {
    const { G, step, combat } = window.SH, [p, foe] = G.cars, hp = foe.hp, gap = () => Math.hypot(foe.x - p.x, foe.z - p.z), start = gap();
    p.special = 3; p.cdS = 0; p.sFire = true; step(1 / 60, 1 / 60);
    const hook = combat.PROJ.some(q => q.type === 'hook');
    let bitten = false, towedBy = null;
    for (let i = 0; i < 60 && !bitten; i++) { step(1 / 60, 1 / 60); if (foe.towT > 0) { bitten = true; towedBy = foe.towBy === p; } }
    const speedIn = () => -(foe.vz); // the foe is north of the truck: reeled in is south
    for (let i = 0; i < 30; i++) step(1 / 60, 1 / 60);
    const pulling = speedIn();
    for (let i = 0; i < 120; i++) step(1 / 60, 1 / 60);
    return { hook, bitten, towedBy, lost: hp - foe.hp, pulling, start, end: gap(), over: foe.towT <= 0 && foe.towBy === null, left: p.special };
  });
  expect(r.hook).toBe(true); expect(r.bitten).toBe(true); expect(r.towedBy).toBe(true);
  expect(r.lost).toBeGreaterThan(8); // the bite itself hurts
  expect(r.pulling).toBeGreaterThan(8); // m/s toward the truck, from a standstill with the handbrake on
  expect(r.end).toBeLessThan(r.start - 8);
  expect(r.over).toBe(true); // the cable lets go
  expect(r.left).toBe(2);
});

test('Dust Devil: sandstorm is a burst of speed and a wall of dust behind that stings a chaser and breaks its missile lock', async ({ page }) => {
  expect(await duel(page, 'dustdevil', -9)).toEqual([false, false]);
  const r = await page.evaluate(() => {
    const { G, step, combat } = window.SH, [p, foe] = G.cars, hp = foe.hp;
    // the chaser has a missile on the way
    foe.ammo.missile = 2; foe.weapon = 'missile'; foe.cdW = 0; foe.wFire = true; foe.wCombo = 0; step(1 / 60, 1 / 60);
    const m = combat.PROJ.find(q => q.type === 'missile'), locked = m && m.target === p, smokeBefore = combat.SMOKES.length;
    p.special = 3; p.cdS = 0; p.sFire = true; p.input = { throttle: 1, steer: 0, handbrake: false }; step(1 / 60, 1 / 60);
    const clouds = combat.SMOKES.slice(smokeBefore), boosted = p.boost > 0;
    for (let i = 0; i < 45; i++) step(1 / 60, 1 / 60);
    return { locked, clouds: clouds.length, behind: clouds.every(s => s.z < p.z), boosted, lockLost: m.target === null, speed: Math.hypot(p.vx, p.vz), top: p.def.max, stung: hp - foe.hp };
  });
  expect(r.locked).toBe(true);
  expect(r.clouds).toBe(3); expect(r.behind).toBe(true); expect(r.boosted).toBe(true);
  expect(r.lockLost).toBe(true);
  expect(r.speed).toBeGreaterThan(r.top * 0.6); // from a standstill in three quarters of a second
  expect(r.stung).toBeGreaterThan(1); // the car on its tail takes some
});

test('every car has a model, a special that fires, and a rule for when its bot uses it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const { G, CARS, AI, goGarage, startMatch, step } = window.SH, out = [];
    for (const d of CARS) {
      goGarage(); startMatch([{ car: d.id, human: true, local: true }, { car: 'sundowner', human: false }]); G.countdown = 0;
      const p = G.cars[0], rule = typeof new AI(p).specialOK(20, 0.1) === 'boolean'; G.ais.length = 0;
      p.special = 2; p.cdS = 0; p.sFire = true; step(1 / 60, 1 / 60);
      for (let i = 0; i < 60; i++) step(1 / 60, 1 / 60);
      out.push([d.id, p.special === 1, rule, p.model.group.children.length > 0]);
    }
    return out;
  });
  expect(r).toHaveLength(8);
  for (const [id, fired, rule, model] of r) { expect(fired, id).toBe(true); expect(rule, id).toBe(true); expect(model, id).toBe(true); }
});
