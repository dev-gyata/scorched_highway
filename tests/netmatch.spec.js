import { test, expect } from '@playwright/test';
import * as metrics from '../tools/netmatch-metrics.js';

test('network payload size counts UTF-8 bytes and binary buffers', () => {
  expect(metrics.payloadBytes('Driver 🚗')).toBe(11);
  expect(metrics.payloadBytes(new ArrayBuffer(419))).toBe(419);
});

test('network percentiles ignore missing samples and handle empty and small sets', () => {
  expect(metrics.percentile([NaN, 9, 1, Infinity, 3], 0.5)).toBe(3);
  expect(metrics.percentile([9, 1], 0.95)).toBe(9);
  expect(metrics.percentile([], 0.95)).toBeNull();
  expect(metrics.percentile([4], 0.5)).toBe(4);
});

test('network CLI preserves defaults and validates supported values', () => {
  expect(metrics.parseArgs([])).toMatchObject({ guests: 2, mode: 'deathmatch', map: 'ghost-town', lag: 40, seconds: 20 });
  expect(metrics.parseArgs(['--mode', 'race'])).toMatchObject({ map: 'route67' });
  expect(metrics.parseArgs(['--guests', '9', '--lag', '0', '--seconds', '0.5']).guests).toBe(9);
  for (const args of [['--guests', '0'], ['--guests', '10'], ['--guests', '1.5'], ['--lag', '-1'], ['--lag', 'NaN'], ['--seconds', '0'], ['--seconds', 'Infinity'], ['--mode', 'unknown'], ['--url', 'file:///tmp/game'], ['--lag'], ['--typo', '1']]) {
    expect(() => metrics.parseArgs(args)).toThrow();
  }
});

test('network URL preserves the path and other query parameters', () => {
  expect(metrics.matchUrl('http://localhost:4173/game?foo=bar&lag=1#play', 40)).toBe('http://localhost:4173/game?foo=bar&lag=40&net=local#play');
});

test('drift aligns host history to guest timestamps and excludes life transitions', () => {
  const history = [
    { at: 100, cars: [{ pid: 0, x: 0, z: 0, alive: true }, { pid: 1, x: 5, z: 0, alive: true }] },
    { at: 200, cars: [{ pid: 0, x: 10, z: 0, alive: true }, { pid: 1, x: 10, z: 0, alive: false }] },
  ];
  const result = metrics.measureDrift(history, [{ at: 150, me: 0, cars: [{ pid: 0, x: 6, z: 0, alive: true }, { pid: 1, x: 5, z: 0, alive: true }] }]);
  expect(result.own).toEqual([1]);
  expect(result.other).toEqual([]);
  expect(metrics.measureDrift(history, [{ at: 250, me: 0, cars: [] }])).toEqual({ own: [], other: [] });
});
