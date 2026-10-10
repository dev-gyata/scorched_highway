// A race course as a map: wraps a track (world/course.ts) as a GameMap, so a course map is its layout, its look
// and one call here. The ground, barriers, race progress and radar drawing are the same for every course.
import { ROCKS, truck } from '../world/hazards';
import type { Track } from '../world/course';
import { PICK, PICKUPS } from '../world/pickups';
import { PLATE, PLATES } from '../world/plates';
import type { Course, GameMap } from './types';

/**
 * A GameMap for `track`, in the band of world x0 to x1. `build` makes its meshes (world/course-scenery.ts
 * buildCourse, plus anything of the map's own); it's called once.
 */
export function courseMap(spec: { id: string; name: string; x0: number; x1: number; track: Track; build(lowQ: boolean): void }): GameMap {
  const T = spec.track, B = T.bounds;
  const course: Course = { laps: T.laps, lapLength: T.lapLength, sections: T.sections, grid: T.grid, advance: T.advance, distance: T.distance, heading: T.heading, respawn: T.respawn, fallen: T.fallen };
  const mine = (x: number) => x >= spec.x0 && x < spec.x1; // crates, plates and hazards are shared lists: draw this map's
  let built = false;
  return {
    id: spec.id, name: spec.name, x0: spec.x0, x1: spec.x1, modes: ['race'],
    build(lowQ) { if (built) return; built = true; spec.build(lowQ); },
    isBuilt: () => built,
    // ground comes from the built terrain's height grid (see course.ts, surface)
    height: T.surface, ramp: T.ramp, drawn: T.surface, roadLift: T.roadLift, speed: T.speed,
    collide: T.collide, blocked: T.blocked, solid: T.solid,
    outOfBounds: (x, z) => T.blocked(x, z, -40),
    sees: (ax, az, bx, bz) => T.inTunnel(ax, az) === T.inTunnel(bx, bz), // nothing homes into or out of a tunnel
    overview: { x: (B.minX + B.maxX) / 2, z: (B.minZ + B.maxZ) / 2, r: Math.max(B.maxX - B.minX, B.maxZ - B.minZ) / 2 },
    course, obstacles: { rocks: T.obstacles, holes: T.sinkholes }, plates: T.plateSpots, hazards: T.hazardSites,
    drawRadar(x, toR) {
      x.strokeStyle = 'rgba(246,234,212,0.3)'; x.lineCap = 'round';
      for (const path of T.paths) {
        x.lineWidth = Math.max(3, path.half * 0.9); x.beginPath(); let on = false;
        for (let i = 0; i < path.x.length; i += 2) { const [px, py, ok] = toR(path.x[i], path.z[i]); if (ok) { if (on) x.lineTo(px, py); else x.moveTo(px, py); on = true; } else on = false; }
        x.stroke();
      }
      // rocks and sinkholes to steer round, crates to grab
      x.fillStyle = 'rgba(30,17,42,0.85)'; for (const h of T.sinkholes) { const [px, py, ok] = toR(h.x, h.z); if (ok) { x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2); x.fill(); } }
      x.fillStyle = 'rgba(160,120,90,0.9)'; for (const o of T.obstacles) { const [px, py, ok] = toR(o.x, o.z); if (ok) x.fillRect(px - 3, py - 3, 6, 6); }
      for (const pk of PICKUPS) { if (!pk.active || !mine(pk.x)) continue; const [px, py, ok] = toR(pk.x, pk.z); if (ok) { x.fillStyle = PICK[pk.type].css; x.fillRect(px - 3.5, py - 3.5, 7, 7); } }
      // armed plates as diamonds; boulders that have come down and the truck, in warning red
      for (const pl of PLATES) { if (!pl.armed || !mine(pl.x)) continue; const [px, py, ok] = toR(pl.x, pl.z); if (ok) { x.fillStyle = PLATE[pl.type].css; x.beginPath(); x.moveTo(px, py - 4.5); x.lineTo(px + 4.5, py); x.lineTo(px, py + 4.5); x.lineTo(px - 4.5, py); x.fill(); } }
      x.fillStyle = '#ff4a3a'; for (const r of ROCKS) { if (r.phase === 'wait') continue; const [px, py, ok] = toR(r.x, r.z); if (ok) { x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fill(); } }
      if (truck) { const [px, py, ok] = toR(truck.x, truck.z); if (ok) { x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill(); } }
    },
  };
}
