import { test, expect } from '@playwright/test';

const fonts = r => r.fulfill({ status: 200, contentType: 'text/css', body: '' });
async function match(page, settings = {}) {
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, fonts);
  await page.addInitScript(s => localStorage.setItem('shwy_settings', JSON.stringify(s)), settings);
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
  await page.evaluate(() => { const { G, goGarage, startMatch } = window.SH; goGarage(); startMatch(); G.countdown = 0; G.ais.length = 0; });
}
const step = (page, n = 1) => page.evaluate(n => { for (let i = 0; i < n; i++) window.SH.step(1 / 60, 1 / 60); }, n);
/** Park opponent 1 straight ahead of the player at distance d. */
const parkAhead = (page, d) => page.evaluate(d => window.SH.testPark(d), d);

test('combo keys fire the attack and defensive combos', async ({ page }) => {
  await match(page);
  const ammo = () => page.evaluate(() => window.SH.G.player.ammo.rockets);
  await page.evaluate(() => { const p = window.SH.G.player; p.ammo.rockets = 10; p.weapon = 'rockets'; });
  await page.keyboard.press('KeyI'); await step(page);
  expect(await ammo()).toBe(7);
  await page.evaluate(() => { window.SH.G.player.cdW = 0; });
  await page.keyboard.press('Comma'); await step(page);
  expect(await ammo()).toBe(4);
  await page.evaluate(() => { window.SH.G.player.cdW = 0; });
  await page.keyboard.press('KeyK'); await step(page);
  expect(await ammo()).toBe(3);
});

test('Tab picks the car most ahead first, then cycles', async ({ page }) => {
  await match(page);
  await parkAhead(page, 30);
  await page.keyboard.press('Tab'); await step(page);
  const first = await page.evaluate(() => window.SH.G.player.pref === window.SH.G.cars[1]);
  await page.keyboard.press('Tab'); await step(page);
  const second = await page.evaluate(() => { const { G } = window.SH; return G.player.pref && G.player.pref !== G.cars[1]; });
  expect(first).toBe(true); expect(second).toBe(true);
});

test('the machine gun fires itself at a car in its sights, unless switched off', async ({ page }) => {
  await match(page);
  await parkAhead(page, 30); await step(page, 10); // it looks for targets ten times a second
  expect(await page.evaluate(() => window.SH.G.player.mgHeld)).toBe(true);
  await page.evaluate(() => { window.SH.G.settings.autofire = 'off'; }); await step(page, 10);
  expect(await page.evaluate(() => window.SH.G.player.mgHeld)).toBe(false);
});

test('every screen shape sees the same view width', async ({ page }) => {
  await match(page);
  const hfov = () => page.evaluate(() => { const c = window.SH.camera; return 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * c.aspect) * 180 / Math.PI; });
  await page.setViewportSize({ width: 1280, height: 720 }); await page.evaluate(() => window.SH.G.player.speed = 0);
  const wide = await hfov();
  await page.setViewportSize({ width: 915, height: 412 });
  const phone = await hfov();
  expect(Math.abs(wide - 100)).toBeLessThan(2);
  expect(Math.abs(phone - 100)).toBeLessThan(2);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });
  test('touch controls: weapon panel switches weapon; held upright, a rotate screen covers the game', async ({ page }) => {
    await match(page);
    await expect(page.locator('#bGun')).toHaveCount(0);
    await expect(page.locator('#rotate')).toBeHidden();
    await page.evaluate(() => { const p = window.SH.G.player; p.ammo.mortar = 4; p.weapon = 'missile'; });
    await page.locator('.wpn').tap(); await step(page);
    expect(await page.evaluate(() => window.SH.G.player.weapon)).toBe('mortar');
    await page.setViewportSize({ width: 412, height: 915 });
    await expect(page.locator('#rotate')).toBeVisible();
    expect(await page.evaluate(() => window.SH.G.state)).toBe('paused');
  });

  /** Real touches (so pointer capture behaves as on a phone): put fingers down, move them, lift them. */
  const fingers = async page => {
    const cdp = await page.context().newCDPSession(page), send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id = 0]) => ({ x, y, id })) });
    return { down: (...pts) => send('touchStart', pts), move: (...pts) => send('touchMove', pts), up: () => send('touchEnd', []) };
  };
  /** What the car is being told after a step: [steer, throttle, handbrake, weapon held]. */
  const told = page => page.evaluate(() => { const { G, step } = window.SH, p = G.player; step(1 / 60, 1 / 60); return [Math.sign(p.input.steer), Math.sign(p.input.throttle), p.input.handbrake, p.wHeld]; });
  const restart = page => page.evaluate(() => { const { G, startMatch } = window.SH; startMatch(); G.countdown = 0; G.ais.length = 0; });

  test('the stick still works after the HUD was hidden under a thumb (a match ending, the pause menu)', async ({ page }) => {
    await match(page, { autodrift: 'off' });
    const f = await fingers(page);
    // steer right and forward
    await f.down([150, 300]); await f.move([200, 250]);
    expect((await told(page)).slice(0, 2)).toEqual([1, 1]);
    // the match ends with the thumb still down; it lifts over the results screen
    await page.evaluate(() => { const { G, damageCar } = window.SH; for (const c of G.cars) if (c !== G.player) damageCar(c, 9999, G.player, 'test'); G.endT = 0.01; });
    await page.evaluate(() => { window.SH.step(1 / 60, 1 / 60); });
    await expect(page.locator('#over')).toBeVisible();
    await f.up();
    // next match: nothing held over from the last one, and the stick answers
    await restart(page);
    expect((await told(page)).slice(0, 2)).toEqual([0, 0]);
    await f.down([150, 300]); await f.move([100, 250]);
    expect((await told(page)).slice(0, 2)).toEqual([-1, 1]);
    await expect(page.locator('#stickKnob')).toHaveAttribute('style', /translate/);
    // the pause menu opens under the thumb; back in the match the stick answers again
    await page.evaluate(() => window.SH.pauseGame());
    await f.up();
    await page.click('#resumeBtn');
    expect((await told(page)).slice(0, 2)).toEqual([0, 0]);
    await f.down([150, 300]); await f.move([200, 250]);
    expect((await told(page)).slice(0, 2)).toEqual([1, 1]);
    await f.up();
    expect((await told(page)).slice(0, 2)).toEqual([0, 0]);
  });

  test('a second thumb on the stick takes over, and Drift and Fire let go when the HUD is hidden under them', async ({ page }) => {
    await match(page, { autodrift: 'off' });
    const f = await fingers(page);
    const at = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    // Drift held as the match ends
    await f.down(await at('#bDrift'));
    expect((await told(page))[2]).toBe(true);
    await page.evaluate(() => { const { G, endMatch } = window.SH; G.endT = -1; endMatch(); });
    await f.up(); await restart(page);
    expect((await told(page))[2]).toBe(false);
    // Fire held (the torch) as the pause menu opens
    await page.evaluate(() => { const p = window.SH.G.player; p.ammo.flame = 5; p.weapon = 'flame'; });
    await f.down(await at('#bFire'));
    await expect.poll(async () => (await told(page))[3], { timeout: 15_000 }).toBe(true); // (a hold counts after 150 ms)
    await page.evaluate(() => window.SH.pauseGame());
    await f.up(); await page.click('#resumeBtn');
    expect((await told(page))[3]).toBe(false);
    // a touch on the stick is never refused: a new one takes over from one that never lifted
    await f.down([150, 300, 1]); await f.move([200, 300, 1]);
    await f.down([150, 300, 1], [120, 280, 2]); await f.move([150, 300, 1], [70, 280, 2]);
    expect((await told(page))[0]).toBe(-1);
    await f.up();
  });

  test('nothing zooms the page, and the controls stay on screen if it is zoomed anyway', async ({ page }) => {
    await match(page);
    const r = await page.evaluate(() => {
      const px = el => parseFloat(getComputedStyle(el).fontSize), fire = (type, init = {}) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, init); document.querySelector('#stage').dispatchEvent(e); return e.defaultPrevented; };
      return {
        small: [...document.querySelectorAll('input')].filter(i => px(i) < 16).map(i => i.id), // iOS zooms in on a field under 16 px, and stays zoomed
        radar: getComputedStyle(document.querySelector('#radar')).touchAction,
        pinch: fire('gesturestart'), dbl: fire('dblclick'),
      };
    });
    expect(r).toEqual({ small: [], radar: 'none', pinch: true, dbl: true });
    // a tap on the radar still switches its view
    await page.locator('#radar').tap();
    expect(await page.evaluate(() => window.SH.G.settings.radar)).toBe('map');
    // zoomed in on the top-left corner: the HUD is laid out in what's visible, so the buttons are too
    const box = await page.evaluate(() => {
      const vv = { offsetLeft: 40, offsetTop: 20, width: 600, height: 270, scale: 1.5, addEventListener() { } };
      window.SH.fitHud(vv);
      const hud = document.querySelector('#hud').getBoundingClientRect(), inside = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return b.left >= 40 && b.top >= 20 && b.right <= 640 && b.bottom <= 290; };
      return { hud: [hud.left, hud.top, hud.width, hud.height], fire: inside('#bFire'), special: inside('#bSpec'), drift: inside('#bDrift'), stick: inside('#stickBase'), pause: inside('#pauseBtn') };
    });
    expect(box).toEqual({ hud: [40, 20, 600, 270], fire: true, special: true, drift: true, stick: true, pause: true });
    // and back to the whole page when the zoom goes
    expect(await page.evaluate(() => { window.SH.fitHud({ offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight, scale: 1 }); const h = document.querySelector('#hud').getBoundingClientRect(); return [h.left, h.top, h.width === innerWidth, h.height === innerHeight]; })).toEqual([0, 0, true, true]);
  });
});

test('help screen lists every control, for each device', async ({ page }) => {
  test.slow(); // the title screen renders on a software GPU, slower still while the other worker builds a map
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, fonts);
  await page.goto('/');
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
  await page.click('#toHelp');
  for (const d of ['Keyboard', 'Gamepad', 'Touch']) {
    await page.click(`#controlsDevice >> text=${d}`);
    expect(await page.locator('#controlsTable tr').count(), d).toBe(12);
  }
});

test('holding a hard turn at speed drifts, unless switched off', async ({ page }) => {
  await match(page);
  const drive = () => page.evaluate(() => {
    const { G, step } = window.SH, p = G.player;
    for (let i = 0; i < 30; i++) { p.vx = Math.sin(p.yaw) * 30; p.vz = Math.cos(p.yaw) * 30; step(1 / 60, 1 / 60); }
    return p.input.handbrake;
  });
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  expect(await drive()).toBe(true);
  await page.evaluate(() => { window.SH.G.settings.autodrift = 'off'; });
  expect(await drive()).toBe(false);
});

test('deathmatch: no more than two bots go after the player at once', async ({ page }) => {
  await match(page, { opponents: 5, difficulty: 2 }); // Hard: the bots like the player most
  const most = await page.evaluate(() => {
    const { G, step, AI } = window.SH; let most = 0;
    G.ais = G.cars.filter(c => !c.isPlayer).map(c => new AI(c)); // match() benches them
    for (let i = 0; i < 60 * 8; i++) { G.player.hp = G.player.def.hp; step(1 / 60, 1 / 60); most = Math.max(most, G.ais.filter(a => a.car.alive && a.target === G.player).length); }
    return most;
  });
  expect(most).toBeLessThanOrEqual(2);
});
