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

// ---------- online, between tabs (?net=local: a BroadcastChannel stands in for the internet) ----------
/** Open the game in a new tab of this browser as player `name`, at the title screen. */
async function player(context, name, settings = {}, url = '/?net=local') {
  const page = await context.newPage();
  page.on('pageerror', e => { throw e; });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript(s => localStorage.setItem('shwy_settings', JSON.stringify(s)), { quality: 'low', name, mode: 'deathmatch', map: 'ghost-town', ...settings });
  await page.setViewportSize({ width: 480, height: 270 }); // match netmatch.js: software-rendered tabs share the CPU
  await page.goto(url);
  await page.waitForFunction(() => window.SH && window.SH.G.state === 'title', null, { timeout: 60_000 });
  return page;
}
/** `host` opens a room and every guest joins it; returns the room code. */
async function room(host, ...guests) {
  await host.click('#toOnline'); await host.click('#netHost');
  await host.waitForFunction(() => document.querySelector('#lobbyCode').textContent.length === 5);
  const code = await host.textContent('#lobbyCode');
  for (const g of guests) {
    await g.click('#toOnline'); await g.fill('#netCode', code); await g.click('#netJoin');
    await expect(g.locator('#lobby')).toBeVisible({ timeout: 45_000 });
  }
  await host.waitForFunction(n => window.SH.net.session.players.length === n, guests.length + 1);
  return code;
}
/** The host starts; wait until every page is in the match, then skip the countdown. */
async function start(host, ...guests) {
  await host.click('#lobbyGo');
  for (const p of [host, ...guests]) await p.waitForFunction(() => window.SH.G.state === 'playing', null, { timeout: 60_000 });
  await host.evaluate(() => { window.SH.G.countdown = 0; });
  for (const g of guests) await g.waitForFunction(() => window.SH.G.countdown <= 0, null, { timeout: 45_000 });
}

/** Close through the browser lifecycle and wait for the tab to finish closing. */
async function closeTab(page) {
  await Promise.all([page.waitForEvent('close', { timeout: 30_000 }), page.close({ runBeforeUnload: true })]);
}

test('online: host and guest share a deathmatch: driving, the feed, results for each, and a rematch', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), guest = await player(context, 'Gus', { car: 'lawdog' });
  await room(host, guest);
  await expect(guest.locator('#lobbyPlayers')).toContainText('Hana');
  await expect(guest.locator('#lobbyPlayers')).toContainText('Gus (you)');
  await start(host, guest);
  const seen = await guest.evaluate(() => { const { G } = window.SH; return { replica: G.replica, me: G.player.pid, car: G.player.def.id, names: G.cars.map(c => c.name) }; });
  expect(seen).toEqual({ replica: true, me: 1, car: 'lawdog', names: expect.arrayContaining(['Hana', 'Gus']) });
  expect(seen.names).toHaveLength(6); // bots fill the field
  // the guest drives: its car moves here at once and on the host too, and they agree on where it is (bots parked, so nobody rams it)
  await host.evaluate(() => { window.SH.G.ais.length = 0; });
  const z0 = await guest.evaluate(() => window.SH.G.player.z);
  await guest.keyboard.down('KeyW');
  await guest.waitForFunction(z => Math.abs(window.SH.G.player.z - z) > 15, z0, { timeout: 90_000 });
  await guest.keyboard.up('KeyW');
  await host.waitForFunction(() => window.SH.G.cars[1].speed < 1, null, { timeout: 90_000 }); // coasted to a stop
  await guest.waitForTimeout(1000);
  const [mine, onHost] = await Promise.all([guest.evaluate(() => { const c = window.SH.G.player; return [c.x, c.z]; }), host.evaluate(() => { const c = window.SH.G.cars[1]; return [c.x, c.z]; })]);
  expect(Math.abs(onHost[1] - z0)).toBeGreaterThan(15); // the host drove it there with the guest's controls
  expect(Math.hypot(mine[0] - onHost[0], mine[1] - onHost[1])).toBeLessThan(2); // and the guest's own copy settled where the host has it
  // a wreck on the host reaches the guest's feed, worded for the guest
  await host.evaluate(() => { const { G, damageCar } = window.SH; damageCar(G.cars[3], 9999, G.cars[1], 'test'); });
  await expect(guest.locator('#feed')).toContainText(/^You wrecked|You wrecked/);
  await expect(host.locator('#feed')).toContainText('Gus wrecked');
  // the guest wrecks everyone else: each sees their own results
  await host.evaluate(() => { const { G, damageCar } = window.SH; for (const c of G.cars) if (c.pid !== 1 && c.alive) damageCar(c, 9999, G.cars[1], 'test'); });
  await expect(guest.locator('#over')).toBeVisible({ timeout: 90_000 });
  await expect(host.locator('#over')).toBeVisible({ timeout: 90_000 });
  await expect(guest.locator('#overTitle')).toHaveText('Last one standing');
  await expect(host.locator('#overTitle')).toHaveText('Wrecked');
  await expect(guest.locator('#againBtn')).toBeDisabled(); // the host starts the next one
  await expect(guest.locator('#rStandings li.me')).toContainText('You');
  await host.click('#againBtn');
  await guest.waitForFunction(() => window.SH.G.state === 'playing' && window.SH.G.cars.every(c => c.alive), null, { timeout: 60_000 });
});

test('online: a guest who leaves mid-match hands their car to a bot', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), guest = await player(context, 'Gus');
  await room(host, guest); await start(host, guest);
  await closeTab(guest);
  await host.waitForFunction(() => !window.SH.G.cars[1].human, null, { timeout: 30_000 });
  const r = await host.evaluate(() => { const { G } = window.SH; return { bot: G.ais.some(a => a.car === G.cars[1]), players: window.SH.net.session.players.length }; });
  expect(r).toEqual({ bot: true, players: 1 });
  await expect(host.locator('#feed')).toContainText('Gus left');
});

test('online: when the host leaves, the next player takes over and the match goes on (twice over)', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), first = await player(context, 'Fay'), second = await player(context, 'Sid');
  await room(host, first, second);
  await start(host, first, second);
  await host.waitForTimeout(2500); // a checkpoint or two
  const hp = await first.evaluate(() => window.SH.G.cars.map(c => Math.round(c.hp)));
  await closeTab(host);
  // Fay joined first, so she takes over; Sid follows her
  await first.waitForFunction(() => window.SH.net.session.role.name === 'host', null, { timeout: 30_000 });
  const fay = await first.evaluate(() => window.SH.net.session.me);
  await second.waitForFunction(id => window.SH.net.session.host === id, fay, { timeout: 30_000 });
  const r = await first.evaluate(() => { const { G } = window.SH; return { state: G.state, replica: G.replica, hostCarIsBot: !G.cars[0].human && G.ais.some(a => a.car === G.cars[0]), hp: G.cars.map(c => Math.round(c.hp)) }; });
  expect(r.state).toBe('playing'); expect(r.replica).toBe(false); expect(r.hostCarIsBot).toBe(true);
  expect(r.hp).toEqual(hp); // nobody lost anything in the handover
  await expect(first.locator('#feed')).toContainText('Hana left');
  // Sid's game follows the new host: his controls drive his car there
  await second.keyboard.down('KeyW');
  await first.waitForFunction(() => window.SH.G.cars[2].ctl?.throttle === 1 && window.SH.G.cars[2].speed > 3, null, { timeout: 90_000 });
  await second.keyboard.up('KeyW');
  // and if Fay goes too, Sid carries on alone with the bots
  await closeTab(first);
  await second.waitForFunction(() => window.SH.net.session.role.name === 'host' && !window.SH.G.replica, null, { timeout: 30_000 });
  expect(await second.evaluate(() => window.SH.G.state)).toBe('playing');
});

test('online: a race starts for everyone, and the guest sees the standings and its lap', async ({ context }) => {
  test.slow(); // the first race builds the canyon, in two tabs
  const host = await player(context, 'Hana', { mode: 'race', map: 'route67' }), guest = await player(context, 'Gus');
  await room(host, guest); await start(host, guest);
  expect(await guest.evaluate(() => [window.SH.G.mode.id, window.SH.G.map.id])).toEqual(['race', 'route67']); // the host's choice
  await host.evaluate(() => { const { G } = window.SH; G.ais.length = 0; const c = G.cars[1]; c.race.progress.lap = 2; });
  await expect(guest.locator('#alive')).toContainText('Lap 2/3', { timeout: 30_000 });
});

// ---------- joining by link ----------
/** The room's invite link, as the lobby shows it (a path on this server). */
async function invite(host) { const u = new URL(await host.inputValue('#lobbyLink')); return u.pathname + u.search; }

test('online: an invite link brings a friend straight into the room (after asking a new player their name)', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), code = await room(host), link = await invite(host);
  expect(link).toBe(`/?net=local&join=${code}`);
  // someone who has played before: no clicks
  const gus = await player(context, 'Gus', {}, link);
  await expect(gus.locator('#lobby')).toBeVisible({ timeout: 45_000 });
  await expect(gus.locator('#lobbyPlayers')).toContainText('Hana');
  expect(new URL(gus.url()).search).toBe('?net=local'); // used up: a reload doesn't join again
  // someone new: asked for a name, then in
  const nia = await player(context, '', {}, link);
  await expect(nia.locator('#netJoin')).toHaveText(`Join ${code}`);
  await expect(nia.locator('#netStatus')).toContainText('Pick a name');
  await nia.fill('#netName', 'Nia'); await nia.press('#netName', 'Enter');
  await expect(nia.locator('#lobby')).toBeVisible({ timeout: 45_000 });
  await expect(host.locator('#lobbyPlayers')).toContainText('Nia');
});

test('online: someone who joins a match part-way watches it, and drives in the next one', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), guest = await player(context, 'Gus');
  await room(host, guest); const link = await invite(host);
  await start(host, guest);
  const late = await player(context, 'Lou', { car: 'bigchill' }, link);
  await late.waitForFunction(() => window.SH.G.state === 'playing' && window.SH.G.cars.length === 6, null, { timeout: 60_000 });
  expect(await late.evaluate(() => { const { G } = window.SH; return { watching: G.watching, replica: G.replica, names: G.cars.filter(c => c.human).map(c => c.name) }; }))
    .toEqual({ watching: true, replica: true, names: ['Hana', 'Gus'] });
  await expect(late.locator('#hName')).toHaveText('Watching');
  // the match they're watching moves: the host's car is where the host has it
  await host.evaluate(() => { const { G } = window.SH; G.countdown = 0; G.ais.length = 0; G.cars[0].x += 20; });
  const x = await host.evaluate(() => window.SH.G.cars[0].x);
  await late.waitForFunction(x => Math.abs(window.SH.G.cars[0].x - x) < 3, x, { timeout: 60_000 });
  // it ends: results without a place of their own, and a car in the rematch
  await host.evaluate(() => { const { G, damageCar } = window.SH; for (const c of G.cars) if (c.pid !== 1 && c.alive) damageCar(c, 9999, G.cars[1], 'test'); });
  await expect(late.locator('#over')).toBeVisible({ timeout: 90_000 });
  await expect(late.locator('#overTitle')).toHaveText('Match over');
  await expect(late.locator('#overSub')).toContainText('Gus came out on top');
  await expect(late.locator('.oplace')).toBeHidden();
  await expect(host.locator('#over')).toBeVisible({ timeout: 90_000 });
  await host.click('#againBtn');
  await late.waitForFunction(() => window.SH.G.state === 'playing' && !window.SH.G.watching && window.SH.G.cars.every(c => c.alive), null, { timeout: 60_000 });
  expect(await late.evaluate(() => { const p = window.SH.G.player; return [p.name, p.def.id, p.human]; })).toEqual(['Lou', 'bigchill', true]);
});

test('online: the invite link still works after the host who made it has left', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), fay = await player(context, 'Fay');
  await room(host, fay); const link = await invite(host);
  await start(host, fay);
  await host.waitForTimeout(1500);
  await closeTab(host);
  await fay.waitForFunction(() => window.SH.net.session.role.name === 'host', null, { timeout: 30_000 });
  await fay.waitForTimeout(1000); // Fay takes over the room's address
  const late = await player(context, 'Lou', {}, link);
  await late.waitForFunction(() => window.SH.G.state === 'playing' && window.SH.G.watching, null, { timeout: 60_000 });
  const id = await fay.evaluate(() => window.SH.net.session.me);
  expect(await late.evaluate(() => window.SH.net.session.host)).toBe(id);
  expect(await fay.evaluate(() => window.SH.net.session.players.map(p => p.name))).toEqual(['Fay', 'Lou']);
});

// ---------- big rooms ----------
test('online: a room holds ten people (the eleventh is told it is full), and bots fill the field the host picks', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), code = await room(host);
  // nine more arrive: bare tabs speaking the between-tabs transport (net/local.ts), so the test doesn't draw ten games
  const crowd = await context.newPage();
  await crowd.goto('/favicon.ico').catch(() => { });
  const told = await crowd.evaluate(async code => {
    const bc = new BroadcastChannel('scorched-net'), to = 'scorched-hwy-' + code, got = {};
    bc.onmessage = ({ data: n }) => { if (n.k === 'data' && typeof n.d === 'string') (got[n.to] ||= []).push(JSON.parse(n.d)); };
    for (let i = 0; i < 10; i++) {
      const from = `${to}-crowd${i}`;
      bc.postMessage({ k: 'open', from, to });
      await new Promise(r => setTimeout(r, 60));
      bc.postMessage({ k: 'data', from, to, d: JSON.stringify({ t: 'hello', name: 'Crowd ' + i, car: 'lawdog', desktop: true, v: 2 }) });
    }
    await new Promise(r => setTimeout(r, 800));
    return { last: got[`${to}-crowd9`].filter(m => m.t !== 'hb').map(m => m.why || m.t), ninth: got[`${to}-crowd8`].some(m => m.t === 'lobby' && m.players.length === 10) };
  }, code);
  expect(told.ninth).toBe(true);
  expect(told.last).toEqual(['That game is full.']);
  expect(await host.evaluate(() => window.SH.net.session.players.length)).toBe(10);
  // ten people, ten cars; the field setting only adds bots
  await host.evaluate(() => { window.SH.G.settings.field = 8; });
  await host.click('#lobbyGo');
  await host.waitForFunction(() => window.SH.G.state === 'playing', null, { timeout: 60_000 });
  expect(await host.evaluate(() => { const { G } = window.SH; return [G.cars.length, G.cars.filter(c => c.human).length]; })).toEqual([10, 10]);
});

test('online: alone in a room with a field of ten, nine bots line up', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana'), guest = await player(context, 'Gus');
  await room(host, guest);
  for (let i = 0; i < 2; i++) await host.click('#lobbyOpts .cyc[data-opt="field"] button[aria-label="Next"]');
  await expect(guest.locator('#lobbyNote')).toContainText('field of 10');
  await start(host, guest);
  for (const p of [host, guest]) expect(await p.evaluate(() => { const { G } = window.SH; return [G.cars.length, G.cars.filter(c => !c.human).length]; })).toEqual([10, 8]);
  // the guest sees all ten where the host has them
  await guest.waitForFunction(() => window.SH.G.cars.every(c => c.hp > 0 && Number.isFinite(c.x)), null, { timeout: 60_000 });
  const size = await host.evaluate(() => window.SH.net.encodeSnap(1, 0).byteLength);
  expect(size).toBeLessThan(1500);
  console.log('snapshot with ten cars:', size, 'bytes');
});

// ---------- the new cars, online ----------
test('online: Hookjaw hooks a guest in a Dust Devil: the guest sees the hook fly and its own car reeled in', async ({ context }) => {
  test.slow();
  const host = await player(context, 'Hana', { car: 'hookjaw', bots: 'off' }), guest = await player(context, 'Gus', { car: 'dustdevil' });
  await room(host, guest); await start(host, guest);
  expect(await guest.evaluate(() => window.SH.G.cars.map(c => c.def.id))).toEqual(['hookjaw', 'dustdevil']);
  // line them up on open ground, the buggy 34 m ahead of the truck, and fire
  const snap = await host.evaluate(() => {
    const { G, step, combat, net } = window.SH, [p, foe] = G.cars, put = (c, z) => { c.x = 60; c.z = z; c.y = G.map.height(60, z); c.yaw = 0; c.vx = c.vz = c.vy = 0; };
    put(p, 60); put(foe, 94); p.special = 3; p.cdS = 0; p.sFire = true; step(1 / 60, 1 / 60);
    const flying = net.decodeSnap(net.encodeSnap(1, 0)).proj.map(q => q.type); // what a guest is told is in the air
    return { flying, live: combat.PROJ.some(q => q.type === 'hook') };
  });
  expect(snap.live).toBe(true); expect(snap.flying).toContain('hook');
  await host.waitForFunction(() => window.SH.G.cars[1].towT > 0 || window.SH.G.cars[1].z < 90, null, { timeout: 60_000 });
  // the guest's own car is pulled toward the truck on its own screen too (it settles where the host has it)
  await guest.waitForFunction(() => window.SH.G.player.z < 88, null, { timeout: 60_000 });
  const [mine, onHost] = await Promise.all([guest.evaluate(() => window.SH.G.player.hp), host.evaluate(() => window.SH.G.cars[1].hp)]);
  expect(onHost).toBeLessThan(108); // the bite hurt
  expect(mine).toBeLessThanOrEqual(108);
});
