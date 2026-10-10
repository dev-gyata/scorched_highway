// Route 67: a three-lap canyon race course with three forks (see track.ts), 6 km east of the ghost town.
import { buildCourse } from '../../world/course-scenery';
import { courseMap } from '../course-map';
import { TRACK } from './track';

export const route67 = courseMap({ id: 'route67', name: 'Route 67', x0: 3000, x1: 9000, track: TRACK, build: lowQ => buildCourse(TRACK, lowQ) });
