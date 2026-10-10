// Route 67: a three-lap canyon race course with three forks, 6 km east of the ghost town (see maps/registry).
//
// A lap runs through three kinds of country: open desert flats around the start, slot canyons and washes cut
// into the mesas, and a cliff road along a mesa face. This is its layout; world/course.ts works out the ground,
// barriers and race progress from it.
import { type CourseLayout, makeCourse } from '../../world/course';

// layout in metres: x, z and floor height y; paths in a section share their first and last point
const N0 = [-60, -30, 0], N1 = [360, 130, 2], N2 = [420, 420, 4], N3 = [230, 535, 2], N4 = [-60, 520, 2], N4b = [-110, 490, 3], N5 = [-260, 330, 4], N6 = [-220, 120, 1];
const W = ['missile', 'rockets', 'mortar', 'mines', 'flame'];
const LAYOUT: CourseLayout = {
  name: 'Route 67', origin: [6000, 0], laps: 3,
  sections: [
    { paths: [{ name: 'Desert flats', half: 16, surface: 'dirt', style: 'desert', pts: [N0, [60, -10, 0], [180, 10, 1], [290, 55, 1], N1] }] },
    {
      fork: 'Mine shaft or dry wash',
      paths: [
        { name: 'Mine shaft', risky: true, half: 6, surface: 'tunnel', style: 'canyon', pts: [N1, [395, 230, 3], [415, 330, 4], N2] },
        { name: 'Dry wash', half: 14, surface: 'sand', style: 'canyon', pts: [N1, [460, 160, 2], [530, 250, 3], [525, 350, 4], N2] },
      ],
    },
    { paths: [{ name: 'Canyon run', half: 10, surface: 'dirt', style: 'canyon', pts: [N2, [370, 495, 4], [280, 528, 3], N3] }] },
    {
      fork: 'Cliff road or boulder alley',
      paths: [
        { name: 'Cliff road', risky: true, half: 5.5, surface: 'dirt', style: 'ledge', below: 'Boulder alley', pts: [N3, [208, 556, 2.5], [170, 570, 11], [130, 576, 19], [40, 578, 20], [0, 572, 12], [-32, 553, 3], N4] },
        { name: 'Boulder alley', half: 10, surface: 'sand', style: 'canyon', pts: [N3, [190, 545, 2], [130, 557, 2], [40, 560, 2], [-20, 543, 2], N4] },
      ],
    },
    { paths: [{ name: 'Mesa gap', half: 10, surface: 'dirt', style: 'canyon', pts: [N4, [-85, 505, 2], N4b] }] },
    {
      fork: 'Gorge jump or switchback',
      paths: [
        { name: 'Gorge jump', risky: true, half: 8, surface: 'dirt', style: 'canyon', gap: [0.44, 0.5], pts: [N4b, [-160, 440, 4], [-210, 385, 4], N5] },
        { name: 'Switchback', half: 8, surface: 'dirt', style: 'canyon', pts: [N4b, [-140, 560, 4], [-215, 575, 5], [-280, 520, 5], [-305, 420, 4], N5] },
      ],
    },
    { paths: [{ name: 'Canyon exit', half: 10, surface: 'dirt', style: 'canyon', pts: [N5, [-270, 230, 3], N6] }] },
    { paths: [{ name: 'Home straight', half: 16, surface: 'dirt', style: 'desert', pts: [N6, [-180, 50, 0], [-120, -20, 0], N0] }] },
  ],
  // things on the course, placed by path, fraction along it and metres to the side
  rocks: [
    ['Desert flats', 0.22, -8, 2.2], ['Desert flats', 0.68, 7, 1.8], ['Desert flats', 0.86, -4, 1.5],
    ['Dry wash', 0.3, 5, 2.5], ['Dry wash', 0.55, -6, 2], ['Dry wash', 0.75, 3, 1.6],
    ['Boulder alley', 0.18, 4, 2], ['Boulder alley', 0.33, -5, 2.4], ['Boulder alley', 0.47, 2, 1.8], ['Boulder alley', 0.6, -3, 2.2], ['Boulder alley', 0.76, 5, 2],
    ['Canyon exit', 0.5, -2, 1.5], ['Home straight', 0.62, -9, 2],
  ],
  holes: [
    ['Desert flats', 0.48, 6, 4.5], ['Dry wash', 0.42, 0, 4], ['Home straight', 0.38, -5, 4.5],
  ],
  jumps: [['Desert flats', 0.43, 6]], // over the sinkhole on the flats
  barrels: [['Desert flats', 0.6, -12], ['Canyon run', 0.5, 7], ['Home straight', 0.25, 11], ['Boulder alley', 0.86, -6]],
  crates: [
    ['Desert flats', 0.32, 0, W], ['Desert flats', 0.8, -6, ['repair', 'special']], ['Dry wash', 0.5, -3, W], ['Canyon run', 0.3, 0, W],
    ['Cliff road', 0.45, 0, W], ['Cliff road', 0.7, 0, ['special']], ['Boulder alley', 0.68, 4, ['repair']], ['Switchback', 0.5, 0, W],
    ['Canyon exit', 0.6, 3, W], ['Home straight', 0.75, 5, W], ['Home straight', 0.18, -5, ['repair']],
  ],
  plates: [
    ['Desert flats', 0.1, -9, 'sword'], ['Desert flats', 0.1, 0, 'sword'], ['Desert flats', 0.1, 9, 'shield'],
    ['Desert flats', 0.76, -7, 'skull'], ['Desert flats', 0.76, 1, 'sword'],
    ['Dry wash', 0.2, 0, 'sword'], ['Mine shaft', 0.5, 0, 'sword'],
    ['Canyon run', 0.12, -4, 'sword'], ['Canyon run', 0.12, 4, 'shield'],
    ['Cliff road', 0.3, 0, 'skull'], ['Boulder alley', 0.4, 6, 'sword'],
    ['Mesa gap', 0.5, -4, 'shield'], ['Mesa gap', 0.5, 4, 'skull'],
    ['Gorge jump', 0.25, 0, 'sword'], ['Switchback', 0.2, 0, 'shield'],
    ['Canyon exit', 0.15, -4, 'skull'], ['Canyon exit', 0.15, 4, 'sword'],
    ['Home straight', 0.5, -1, 'sword'], ['Home straight', 0.5, 7, 'shield'], ['Home straight', 0.5, 13, 'skull'],
  ],
  falls: [['Dry wash', 0.55, 0.9], ['Canyon run', 0.3, 0.8], ['Boulder alley', 0.12, 0.42], ['Switchback', 0.3, 0.7], ['Canyon exit', 0.35, 0.85]],
  trucks: [['Desert flats', 0], ['Home straight', 3]],
};
/** Route 67's track. */
export const TRACK = makeCourse(LAYOUT);
