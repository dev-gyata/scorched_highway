// Salt Lake Run: a three-lap race round a dried-up lake, 12 km east of the ghost town (see maps/registry).
//
// Faster and more open than Route 67: wide salt flats where the water used to be, the old dam and its spillway, a
// marina left high and dry, and a drive-in on the shore. This is its layout; world/course.ts works out the ground,
// barriers and race progress from it.
import { type CourseLayout, makeCourse } from '../../world/course';

// layout in metres: x, z and floor height y; paths in a section share their first and last point
const S0 = [-80, -40, 0], A = [470, 110, 1], B = [430, 420, 3], C = [150, 500, 2], D = [-150, 470, 2], E = [-360, 230, 1], F = [-260, 40, 0];
const W = ['missile', 'rockets', 'mortar', 'mines', 'flame'];
const LAYOUT: CourseLayout = {
  name: 'Salt Lake Run', origin: [12000, 0], laps: 3,
  // low bluffs round the lake bed, not mesas: the sky stays open
  top: (x, z) => 16 + 2 * Math.sin(x * 0.011 + 0.7) * Math.cos(z * 0.013) + Math.sin(x * 0.037 - z * 0.031),
  sections: [
    { paths: [{ name: 'Salt flats', half: 20, surface: 'salt', style: 'desert', pts: [S0, [80, -60, 0], [240, -40, 0], [380, 20, 0], A] }] },
    {
      fork: 'Over the dam or down the spillway',
      paths: [
        { name: 'Dam road', risky: true, half: 6, surface: 'asphalt', style: 'ledge', below: 'Spillway', pts: [A, [498, 150, 2], [516, 200, 9], [522, 260, 13], [516, 325, 13], [492, 380, 7], [458, 408, 3.5], B] },
        { name: 'Spillway', half: 10, surface: 'sand', style: 'canyon', pts: [A, [481, 160, 1], [495, 205, 1.5], [499, 260, 2], [493, 322, 2], [470, 372, 2.5], [448, 402, 3], B] },
      ],
    },
    { paths: [{ name: 'Marina', half: 12, surface: 'dirt', style: 'desert', pts: [B, [360, 478, 3], [250, 508, 2], C] }] },
    {
      fork: 'Pier jump or shoreline',
      paths: [
        { name: 'Pier jump', risky: true, half: 8, surface: 'asphalt', style: 'canyon', gap: [0.46, 0.53], pts: [C, [60, 487, 3], [-50, 482, 3], D] },
        { name: 'Shoreline', half: 12, surface: 'sand', style: 'canyon', pts: [C, [105, 558, 2], [0, 598, 2], [-105, 558, 2], D] },
      ],
    },
    { paths: [{ name: 'Boat graveyard', half: 14, surface: 'salt', style: 'desert', pts: [D, [-250, 430, 1], [-330, 340, 1], E] }] },
    {
      fork: 'Through the drive-in or round it',
      paths: [
        { name: 'Drive-in', risky: true, half: 13, surface: 'asphalt', style: 'desert', pts: [E, [-338, 160, 1], [-305, 95, 0], F] },
        { name: 'Bypass', half: 9, surface: 'dirt', style: 'canyon', pts: [E, [-430, 185, 1], [-450, 100, 1], [-385, 30, 0], [-310, 28, 0], F] },
      ],
    },
    { paths: [{ name: 'Home straight', half: 20, surface: 'salt', style: 'desert', pts: [F, [-200, -5, 0], [-140, -32, 0], S0] }] },
  ],
  // things on the course, placed by path, fraction along it and metres to the side
  rocks: [
    ['Spillway', 0.3, 4, 2.2], ['Spillway', 0.52, -5, 2], ['Spillway', 0.74, 3, 1.8],
    ['Shoreline', 0.2, -5, 2.2], ['Shoreline', 0.42, 6, 2], ['Shoreline', 0.63, -4, 2.4], ['Shoreline', 0.82, 5, 1.8],
    ['Bypass', 0.5, 2, 1.5], ['Boat graveyard', 0.35, -8, 2.2], ['Boat graveyard', 0.7, 7, 2],
  ],
  holes: [['Salt flats', 0.5, -7, 4.5], ['Boat graveyard', 0.52, 0, 4], ['Home straight', 0.4, 8, 4.5]],
  jumps: [['Salt flats', 0.455, -7]], // over the sinkhole on the flats
  barrels: [['Salt flats', 0.7, 13], ['Marina', 0.5, -8], ['Drive-in', 0.3, 6], ['Drive-in', 0.62, -7], ['Home straight', 0.2, -13]],
  crates: [
    ['Salt flats', 0.3, 0, W], ['Salt flats', 0.82, 8, ['repair', 'special']], ['Spillway', 0.45, 0, W], ['Dam road', 0.5, 0, ['special']],
    ['Marina', 0.35, 0, W], ['Pier jump', 0.25, 0, W], ['Shoreline', 0.5, 0, ['repair']], ['Boat graveyard', 0.2, -5, W],
    ['Drive-in', 0.5, 0, W], ['Bypass', 0.3, 0, ['repair']], ['Home straight', 0.7, -6, W],
  ],
  plates: [
    ['Salt flats', 0.1, -10, 'sword'], ['Salt flats', 0.1, 0, 'sword'], ['Salt flats', 0.1, 10, 'shield'],
    ['Salt flats', 0.75, -9, 'skull'], ['Salt flats', 0.75, 2, 'sword'],
    ['Spillway', 0.15, 0, 'sword'], ['Dam road', 0.3, 0, 'skull'],
    ['Marina', 0.15, -5, 'sword'], ['Marina', 0.15, 5, 'shield'],
    ['Pier jump', 0.12, 0, 'sword'], ['Shoreline', 0.12, 0, 'skull'],
    ['Boat graveyard', 0.1, -6, 'shield'], ['Boat graveyard', 0.1, 6, 'sword'],
    ['Drive-in', 0.12, 0, 'sword'], ['Bypass', 0.15, 0, 'shield'],
    ['Home straight', 0.55, -10, 'sword'], ['Home straight', 0.55, 0, 'shield'], ['Home straight', 0.55, 10, 'skull'],
  ],
  falls: [['Spillway', 0.3, 0.8], ['Shoreline', 0.25, 0.75], ['Bypass', 0.2, 0.7]],
  trucks: [['Salt flats', 0], ['Home straight', -4]],
};
/** Salt Lake Run's track. */
export const TRACK = makeCourse(LAYOUT);
