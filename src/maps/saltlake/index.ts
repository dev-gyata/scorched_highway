// Salt Lake Run: a three-lap race round a dried-up lake with three forks (see track.ts), 12 km east of the ghost town.
import { buildCourse } from '../../world/course-scenery';
import { courseMap } from '../course-map';
import { buildSaltLakeScenery, placeSaltLakeProps } from './scenery';
import { TRACK } from './track';

export const saltLake = courseMap({
  id: 'saltlake', name: 'Salt Lake Run', x0: 9000, x1: 15000, track: TRACK,
  build(lowQ) {
    // pale salt and sand under a low rim of bluffs; no saguaros out on the lake bed
    buildCourse(TRACK, lowQ, { floor: { dirt: 0xdcc9a4, sand: 0xefe2c0, asphalt: 0xb9a892 }, high: 0xcdb58c, deep: 0x77685a, sign: ['#1f7a7a', '#f6ead4'], plants: false, seed: 1977, props: placeSaltLakeProps });
    buildSaltLakeScenery();
  },
});
