// A bot-filled online match across headless tabs, using ?net=local (&lag in ms each way).
// npm run net -- [--guests 2] [--mode deathmatch|race] [--map id] [--lag 40] [--seconds 20] [--url http://localhost:4173/]
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { matchUrl, measureDrift, parseArgs, payloadBytes, percentile } from './netmatch-metrics.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fmt = (n, digits = 2) => n === null || !Number.isFinite(n) ? 'unavailable' : n.toFixed(digits);
const summary = values => `median ${fmt(percentile(values, 0.5))} m, p95 ${fmt(percentile(values, 0.95))} m (${values.length} samples)`;

// Runs inside each page; wraps the existing debug handle rather than changing game code.
function instrument() {
  const { G, net } = window.SH, session = net.session;
  const stamp = () => performance.timeOrigin + performance.now();
  const m = window.__netmatch = { history: [], samples: [], sent: {}, received: {}, checkpoints: 0, active: false, trial: null, keyAt: null, recovery: null };
  const positions = () => G.cars.map(c => ({ pid: c.pid, x: c.x, z: c.z, alive: c.alive }));
  const send = session.t.send.bind(session.t);
  session.t.send = (to, data, reliable) => {
    if (m.active && session.t.links().includes(to)) {
      const row = m.sent[to] ||= { bytes: 0, snapshots: 0 };
      row.bytes += window.__netBytes(data);
      if (data instanceof ArrayBuffer && new Uint8Array(data)[0] === 2) row.snapshots++;
    }
    send(to, data, reliable);
  };
  const receive = session.t.onmessage;
  session.t.onmessage = (from, data) => {
    receive(from, data);
    if (data instanceof ArrayBuffer && new Uint8Array(data)[0] === 2 && from === session.host && session.role.name === 'guest') {
      const snap = net.decodeSnap(data);
      const row = m.received[from] ||= { count: 0, firstAt: stamp(), time: G.time, seq: -1 };
      if (snap.seq <= row.seq) return;
      row.seq = snap.seq;
      row.count++; row.lastAt = stamp();
      if (m.recovery && from === m.recovery.host) {
        m.recovery.fresh++;
        // Require advancement after accepting two successor snapshots, not during departure setup.
        if (m.recovery.fresh === 2) { m.recovery.time = G.time; m.recovery.baselineAt = stamp(); }
      }
    } else if (typeof data === 'string' && from === session.host && JSON.parse(data).t === 'ck') m.checkpoints++;
  };
  const message = session.role.message.bind(session.role);
  session.role.message = (from, data) => {
    message(from, data);
    const trial = m.trial;
    if (trial && trial.id === from && trial.seen === null && G.cars[trial.pid]?.ctl?.throttle < -0.5) trial.seen = stamp();
  };
  addEventListener('keydown', e => { if (e.code === 'KeyS' && !e.repeat) m.keyAt = stamp(); });
  const frame = G.net.frame.bind(G.net);
  let sampleAt = 0;
  G.net.frame = dt => {
    frame(dt);
    const at = stamp();
    if (m.active) {
      if (session.role.name === 'host') m.history.push({ at, cars: positions() });
      else if (at - sampleAt >= 250 && G.state === 'playing') {
        sampleAt = at; m.samples.push({ at, me: G.player.pid, cars: positions() });
      }
    }
    const r = m.recovery;
    if (!r) return;
    if (session.role.name === 'host' && !G.replica) {
      if (r.promotedAt === null) { r.promotedAt = at; r.time = G.time; }
      else if (G.time > r.time && r.resumedAt === null) r.resumedAt = at;
    } else if (session.role.name === 'guest' && G.replica && session.host === r.host && r.fresh >= 2 && at > r.baselineAt && G.time > r.time && r.resumedAt === null) r.resumedAt = at;
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let server, browser;
  const errors = [], failures = [];
  const healthy = () => { if (errors.length) throw new Error(errors.join('\n')); };
  const wait = async (page, fn, arg, label, timeout = 30_000) => {
    try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); }
    catch (e) { throw new Error(`${label}: ${e.message}`); }
    healthy();
  };
  try {
    let url = opts.url;
    if (!url) {
      server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
      await server.listen(); url = server.resolvedUrls.local[0];
    }
    browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 480, height: 270 } });
    const open = async name => {
      const page = await context.newPage();
      page.on('pageerror', e => { errors.push(`${name}: ${e.message}`); });
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await page.addInitScript(s => localStorage.setItem('shwy_settings', JSON.stringify(s)), { quality: 'low', name, mode: opts.mode, map: opts.map, bots: 'fill' });
      await page.addInitScript({ content: `window.__netBytes = ${payloadBytes.toString()};` });
      await page.goto(matchUrl(url, opts.lag), { timeout: 30_000 });
      await wait(page, () => window.SH?.G.state === 'title', null, `${name} boot`, 120_000);
      return page;
    };
    const host = await open('Host');
    const validMap = await host.evaluate(o => window.SH.getMap(o.map)?.modes.includes(o.mode), opts);
    if (!validMap) throw new Error(`Map '${opts.map}' does not support '${opts.mode}' (or does not exist)`);
    const guests = [];
    for (let i = 0; i < opts.guests; i++) guests.push({ name: `Guest${i + 1}`, page: await open(`Guest${i + 1}`) });
    await host.click('#toOnline'); await host.click('#netHost');
    await wait(host, () => document.querySelector('#lobbyCode').textContent.length === 5, null, 'Room code');
    const code = await host.textContent('#lobbyCode');
    for (const { page, name } of guests) {
      await page.click('#toOnline'); await page.fill('#netCode', code); await page.click('#netJoin');
      await page.waitForSelector('#lobby:not([hidden])', { timeout: 30_000 });
      healthy();
      console.log(`${name} joined`);
    }
    const pages = [host, ...guests.map(g => g.page)];
    for (const page of pages) await wait(page, n => window.SH.net.session.players.length === n && window.SH.net.session.t.links().length === n - 1, opts.guests + 1, 'Complete lobby and peer links');
    for (const page of pages) await page.evaluate(instrument);
    for (const g of guests) Object.assign(g, await g.page.evaluate(() => ({ id: window.SH.net.session.me })));
    await host.click('#lobbyGo');
    for (const page of pages) await wait(page, () => window.SH.G.state === 'playing', null, 'Match start', 120_000);
    await host.evaluate(() => { window.SH.G.countdown = 0; });
    for (const g of guests) {
      await wait(g.page, () => window.SH.G.countdown <= 0 && window.__netmatch.checkpoints > 0 && Object.keys(window.__netmatch.received).length > 0, null, `${g.name} countdown, snapshot and checkpoint`, 60_000);
      g.pid = await g.page.evaluate(() => window.SH.G.player.pid);
    }
    healthy();
    console.log(`${opts.mode} on ${opts.map}: host + ${opts.guests} guest(s), ${opts.lag} ms one-way lag, ${opts.seconds} s requested`);
    console.log('BroadcastChannel application payloads; timings include browser scheduling and software rendering.');
    for (const g of guests) await g.page.keyboard.down('KeyW');
    for (const g of guests) await g.page.evaluate(() => { window.__netmatch.active = true; });
    const started = await host.evaluate(() => {
      const m = window.__netmatch, at = performance.timeOrigin + performance.now();
      m.sent = {}; m.active = true;
      m.history.push({ at, cars: window.SH.G.cars.map(c => ({ pid: c.pid, x: c.x, z: c.z, alive: c.alive })) });
      return at;
    });
    let turn = 0, matchState = 'playing';
    while (Date.now() - started < opts.seconds * 1000) {
      await sleep(Math.min(500, Math.max(1, opts.seconds * 1000 - (Date.now() - started))));
      healthy();
      matchState = await host.evaluate(() => window.SH.G.state);
      if (matchState !== 'playing') break;
      if (Date.now() - started >= opts.seconds * 1000) break;
      for (const g of guests) {
        await g.page.keyboard.up(turn % 2 ? 'KeyA' : 'KeyD');
        await g.page.keyboard.down(turn % 2 ? 'KeyD' : 'KeyA');
      }
      turn++;
    }
    const measured = await host.evaluate(() => {
      const m = window.__netmatch; m.active = false;
      const end = performance.timeOrigin + performance.now();
      m.history.push({ at: end, cars: window.SH.G.cars.map(c => ({ pid: c.pid, x: c.x, z: c.z, alive: c.alive })) });
      return { sent: m.sent, history: m.history, end, state: window.SH.G.state };
    });
    for (const g of guests) {
      g.samples = await g.page.evaluate(() => { window.__netmatch.active = false; return window.__netmatch.samples; });
      for (const key of ['KeyW', 'KeyA', 'KeyD']) await g.page.keyboard.up(key);
    }
    const duration = (measured.end - started) / 1000;
    console.log(`Measured ${duration.toFixed(2)} s; match state: ${measured.state}`);
    for (const g of guests) {
      const sent = measured.sent[g.id] || { bytes: 0, snapshots: 0 };
      console.log(`${g.name}: ${(sent.bytes / duration / 1024).toFixed(2)} KiB/s, ${sent.snapshots} snapshots (${(sent.snapshots / duration).toFixed(2)}/s)`);
      if (!sent.snapshots) failures.push(`${g.name}: no snapshots sent during measurement`);
      const drift = measureDrift(measured.history, g.samples.filter(s => s.at >= started && s.at <= measured.end));
      console.log(`  own car drift: ${summary(drift.own)}; other cars: ${summary(drift.other)}`);
    }
    console.log('Drift compares timestamp-aligned current host positions; other cars are intentionally drawn 0.1 s behind, with transport delay as well.');
    const encoding = await host.evaluate(() => {
      const { net } = window.SH, t = performance.now(); let bytes = 0;
      for (let i = 0; i < 500; i++) bytes = net.encodeSnap(i, performance.now() / 1000).byteLength;
      return { ms: (performance.now() - t) / 500, bytes };
    });
    console.log(`Snapshot packing: ${encoding.bytes} bytes, ${encoding.ms.toFixed(3)} ms average (500 encodes; separate benchmark)`);
    for (const g of guests) {
      const delays = []; let timedOut = 0, unavailable = 0;
      for (let trial = 0; trial < 5; trial++) {
        const active = measured.state === 'playing'
          && await g.page.evaluate(() => window.SH.G.state === 'playing' && window.SH.G.player.alive)
          && await host.evaluate(pid => window.SH.G.state === 'playing' && window.SH.G.cars[pid]?.alive, g.pid);
        if (!active) { unavailable++; continue; }
        await wait(host, pid => Math.abs(window.SH.G.cars[pid].ctl?.throttle) < 0.01, g.pid, `${g.name} neutral controls`);
        await wait(g.page, () => Math.abs(window.SH.G.player.ctl?.throttle) < 0.01, null, `${g.name} local neutral controls`);
        await host.evaluate(g => { window.__netmatch.trial = { id: g.id, pid: g.pid, seen: null }; }, { id: g.id, pid: g.pid });
        await g.page.evaluate(() => { window.__netmatch.keyAt = null; });
        await g.page.keyboard.down('KeyS');
        try {
          await wait(host, () => window.__netmatch.trial.seen !== null, null, `${g.name} input trial ${trial + 1}`, 10_000);
          const seen = await host.evaluate(() => window.__netmatch.trial.seen);
          const keyAt = await g.page.evaluate(() => window.__netmatch.keyAt);
          if (keyAt === null || seen < keyAt) throw new Error('Invalid browser input timestamps');
          delays.push(seen - keyAt);
        } catch (e) { timedOut++; failures.push(e.message); }
        finally { await g.page.keyboard.up('KeyS'); await host.evaluate(() => { window.__netmatch.trial = null; }); }
      }
      console.log(`${g.name} keydown → host controls: median ${fmt(percentile(delays, 0.5), 0)} ms, p95 ${fmt(percentile(delays, 0.95), 0)} ms; trials [${delays.map(d => d.toFixed(0)).join(', ')}], ${timedOut} timed out, ${unavailable} unavailable`);
    }
    // A fresh checkpoint makes this a meaningful takeover check even for a very short run.
    for (const g of guests) await wait(g.page, () => window.__netmatch.checkpoints > 0, null, `${g.name} migration checkpoint`);
    const successor = guests[0];
    for (const g of guests) await g.page.evaluate(id => {
      window.__netmatch.recovery = { host: id, promotedAt: null, resumedAt: null, fresh: 0, time: window.SH.G.time };
    }, successor.id);
    const closedAt = await host.evaluate(() => performance.timeOrigin + performance.now());
    // Use normal tab-close lifecycle, including departure handlers, and confirm the tab actually closes.
    await Promise.all([host.waitForEvent('close', { timeout: 30_000 }), host.close({ runBeforeUnload: true })]);
    await wait(successor.page, () => window.__netmatch.recovery.resumedAt !== null && window.SH.net.session.role.name === 'host' && !window.SH.G.replica, null, 'Successor simulation recovery');
    const takeover = await successor.page.evaluate(() => ({ ...window.__netmatch.recovery, state: window.SH.G.state, hostCarIsBot: !window.SH.G.cars[0].human && window.SH.G.ais.some(a => a.car === window.SH.G.cars[0]) }));
    if (!takeover.hostCarIsBot) failures.push('Departed host car was not handed to a bot');
    console.log(`Host tab-close request: ${successor.name} promoted after ${fmt(takeover.promotedAt - closedAt, 0)} ms, simulation advancing after ${fmt(takeover.resumedAt - closedAt, 0)} ms; match ${takeover.state}`);
    for (const g of guests.slice(1)) {
      await wait(g.page, id => window.SH.net.session.host === id && window.__netmatch.recovery.resumedAt !== null, successor.id, `${g.name} successor snapshots and replica recovery`);
      const r = await g.page.evaluate(() => window.__netmatch.recovery);
      console.log(`${g.name}: successor snapshots and replica advancing after ${fmt(r.resumedAt - closedAt, 0)} ms (${r.fresh} fresh snapshots)`);
    }
    healthy();
    if (failures.length) throw new Error(failures.join('\n'));
  } finally {
    try { if (browser) await browser.close(); }
    finally { if (server) await server.close(); }
  }
}

main().catch(e => { console.error(`netmatch: ${e.message}`); process.exitCode = 1; });
