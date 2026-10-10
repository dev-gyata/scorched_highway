import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise transport lifecycle without software rendering or a running match.
const source = ts.transpileModule(readFileSync(new URL('../src/net/local.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

test('local transport announces departure before page teardown, once across lifecycle events', async ({ context }) => {
  await context.route('**/__transport-test', r => r.fulfill({ contentType: 'text/html', body: '<title>Transport lifecycle</title>' }));
  await context.route('**/__local-transport.js', r => r.fulfill({ contentType: 'text/javascript', body: source }));
  const host = await context.newPage(), guest = await context.newPage();
  for (const [page, id] of [[host, 'host'], [guest, 'guest']]) {
    await page.goto('/__transport-test');
    await page.evaluate(async id => {
      const { localTransport } = await import('/__local-transport.js');
      window.transport = await localTransport(id);
      window.departures = [];
      window.transport.onclose = id => window.departures.push(id);
    }, id);
  }
  await guest.evaluate(() => window.transport.connect('host'));
  await expect.poll(() => host.evaluate(() => window.transport.links())).toEqual(['guest']);
  await guest.evaluate(() => dispatchEvent(new Event('beforeunload')));
  await expect.poll(() => host.evaluate(() => window.departures)).toEqual(['guest']);
  await guest.evaluate(() => dispatchEvent(new Event('pagehide')));
  expect(await host.evaluate(() => window.departures)).toEqual(['guest']);
  expect(await guest.evaluate(() => window.transport.links())).toEqual([]);
});
