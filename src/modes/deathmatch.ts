// Deathmatch: free-for-all, last car running wins. Weapons come from the map's crates.
import { ALL, announce } from '../engine/events';
import { G, later } from '../game/state.js';
import { collectPickups } from './shared';
import type { Car, GameMode } from './types';

const clock = () => { const s = G.clock | 0; return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };

/** Cars still running first, by wrecks and then damage dealt; then the wrecks, the last to go first. */
function standings(): Car[] {
  const cars = G.cars as Car[];
  return [...cars.filter(c => c.alive).sort((a, b) => b.kills - a.kills || b.dealt - a.dealt || a.pid - b.pid), ...cars.filter(c => !c.alive).sort((a, b) => a.place - b.place)];
}

export const deathmatch: GameMode = {
  id: 'deathmatch', name: 'Deathmatch', startLabel: 'Enter the Arena', againLabel: 'Fight again', lights: false,
  unarmedHint: 'Grab a crate for heavy weapons',
  setup(cars, map) {
    const spots = map.spawns!(cars.length);
    cars.forEach((c, i) => { const s = spots[i]; c.reset(s.x, s.z, s.yaw); c.ammo.missile = 3; c.weapon = 'missile'; });
  },
  step: () => collectPickups(),
  /** The match ends with the last car running, or once every person is out (online, the wrecked watch the rest). */
  wrecked(c) {
    if (c.human) announce(c.pid, 'Wrecked!', 2);
    if (c.isPlayer) G.slowT = 0.8;
    const alive = (G.cars as Car[]).filter(o => o.alive);
    if (!alive.some(o => o.human)) { if (G.endT < 0) G.endT = 3.2; }
    else if (alive.length === 1) { G.slowT = 1.2; G.endT = 3; later(0.4, () => announce(ALL, 'Last one standing!', 2.5)); }
  },
  status: () => [(G.cars as Car[]).filter(c => c.alive).length + ' cars left', clock()],
  standings,
  score: c => (c.alive ? `${c.kills} ${c.kills === 1 ? 'wreck' : 'wrecks'}` : 'out'),
  results(p) {
    const win = p.alive, by = p.wreckedBy, order = standings();
    return {
      order, win,
      title: win ? 'Last one standing' : 'Wrecked',
      sub: win ? `${p.name} rolls out of town with the ${p.def.name} still smoking.`
        : by ? `${by.name} got the better of you this time.` : 'The desert got the better of you this time.',
      tiles: [['Wrecks', String(p.kills)], ['Damage dealt', String(Math.round(p.dealt))], ['Survived', clock()]],
      fate: c => c.alive ? 'still running' : c.wreckedBy ? `wrecked by ${c.wreckedBy === p ? 'you' : c.wreckedBy.name.split(' ')[0]}` : 'crashed out',
    };
  },
};
