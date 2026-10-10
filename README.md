# Scorched Highway

A vehicular combat game set in the desert in 1977, inspired by late-90s car combat games like Vigilante 8. Eight cars, two arenas and two race courses, a trunk full of rockets — last car running wins, or first across the line. Play alone against bots or online with up to ten people.

Runs in any modern browser, desktop or phone. Players need nothing installed; developing it needs Node (see below).

## Play

**[Play it in your browser →](https://dev-gyata.github.io/scorched_highway/)**

**Online:** choose *Play online*, enter a name and *Host a game*; then send friends the room's link (*Copy link* in the lobby, *Invite* in the pause menu): opening it puts them straight into the room. They can also choose *Play online* and type the five-letter room code. Someone who arrives while a match is on watches it and drives in the next one. Up to ten drivers, on desktops and phones; the host picks the mode, map, bot difficulty, time of day, whether bots fill the field, and how big the field is (6, 8 or 10 cars). The host's device runs the match and sends it to everyone (with ten players, twenty 0.7 KB snapshots a second to each of nine guests: about 120 KB/s, or 1 Mbit/s, up), so a computer hosts a full room better than a phone. Players are connected browser to browser through PeerJS's free public broker, so there's no game server. Some networks (strict mobile carriers, offices) can't connect two browsers directly; for those, build with a TURN relay: `VITE_TURN_URL`, `VITE_TURN_USER` and `VITE_TURN_PASS`.

The game is a static site: `npm run build` produces `dist/`, which can be hosted anywhere. Pushes to `main` are built and published to GitHub Pages by CI (one-time setup: *Settings → Pages → Source: GitHub Actions*).

## Develop

Needs Node 20+.

```sh
npm install
npm run dev        # dev server with hot reload at http://localhost:5173
npm run check      # lint + typecheck + build + smoke tests, the same as CI
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` / `npm run preview` | Production build into `dist/`, and serve it |
| `npm run lint` | ESLint, which catches undefined names, unused code and writes to imported values |
| `npm run typecheck` | TypeScript checks the JavaScript (loose mode) against Three.js's types; catches wrong property names and argument types |
| `npm test` | Playwright smoke tests against the build: boot, every car model, garage, a fast-forwarded match |
| `npm run perf -- [--quality high\|low] [--phone] [--frames 60] [--cars 6]` | Benchmark: boot timings (median of warm loads), a scripted match (6 cars unless `--cars` says otherwise) driven frame by frame, draw calls, triangles and vertex memory per scene layer (shadow pass included), and the hottest functions. `--phone` emulates a phone viewport with touch and a 4x slower CPU. Writes `shots/perf-*.json`. It runs on a software GPU, so compare runs with each other |
| `npm run shots -- cars\|env [--tod noon\|sunset\|night] [names]` | Screenshots into `shots/` with a contact sheet: each car from three angles, or fixed viewpoints around the arena |
| `npm run net -- [--guests 2 (up to 9)] [--mode race] [--lag 40] [--seconds 20]` | Online check: a host and guests in headless tabs (`?net=local`) playing a bot-filled match. Reports bytes a second to each guest, snapshot size and packing time, how far guests' views drift from the host, how long a press takes to reach the host, and how long the match takes to carry on when the host leaves. The tabs share one software renderer at a few frames a second, so drift and delays come out pessimistic: compare runs with each other |

The first test run needs a browser: `npx playwright install chromium`.

Measure online play across headless browser tabs with a bot-filled field:

```sh
npm run net                               # host + 2 guests, 40 ms one-way lag, 20 seconds
npm run net -- --mode race --map route67   # race instead of deathmatch
npm run net -- --guests 1 --lag 0          # no simulated transport delay
npm run net -- --seconds 10 --url 'http://localhost:4173/?foo=bar'
```

The tool starts and closes its own Vite server unless `--url` is supplied. Guests must be 1–5; `--lag` is nonnegative milliseconds and `--seconds` is a positive duration. Maps must support the chosen mode. Existing URL parameters are preserved, with `net=local` and `lag` set by the tool.

It reports application payload KiB/s per guest (including reliable messages and checkpoints), snapshot counts and achieved rate, median/p95 car position drift with sample counts, five browser-keydown-to-host-control timing trials per guest, and a separate 500-encode snapshot packing benchmark. Drift uses timestamp-aligned host history, skips life-state transitions, and includes the deliberate 0.1-second interpolation delay for other cars. If the match ends early, the actual measurement duration and state are reported; unavailable active-play trials are labeled.

Finally it closes the host tab, checks that the next guest becomes authoritative and advances simulation, and verifies fresh successor snapshots and advancing replicas on every remaining guest. Errors and timeouts fail the command and close its resources. These are BroadcastChannel measurements, not WebRTC bandwidth or network overhead measurements. Headless tab scheduling and software rendering affect the results; compare runs on the same machine, and use the achieved snapshot rate to spot CPU-limited runs.

In the browser console, `window.SH` exposes the game state and a few entry points (`SH.G`, `SH.tick(ms)`, `SH.step(dt, dt)`, `SH.startMatch()`, `SH.buildCarModel(def)` ...). The tests and tools use it too. Everything in the scene is added with `addToScene(obj, layer)` (`landscape`, `town`, `scatter`, `cars`, ...), so a layer can be found or hidden with `SH.scene.traverse(o => o.userData.layer === 'scatter' && (o.visible = false))`.

## Features

- **Eight original cars**, each with its own speed, armor, handling and signature special:

  | Car | Driver | Special |
  | --- | --- | --- |
  | Sundowner | Dee Cortez | Twin cannons |
  | Gravel Queen | Ma Hollis | Scrap bomb (bursts into bomblets) |
  | Moonbeam | Sky Farrow | Good vibrations (sonic shockwave) |
  | Scorcher | Rex Vance | Afterburner (scorches anyone behind) |
  | Lawdog | Deputy Tull | Riot gun (close-range buckshot) |
  | Big Chill | Mister Frost | Brain freeze (homing ice shot that slows) |
  | Dust Devil | Jody Pike | Sandstorm (a burst of speed and a wall of dust behind: it stings, and homing shots lose you in it) |
  | Hookjaw | Big Ruth Calder | Tow hook (a harpoon on a cable that reels in whatever it bites) |

- **Two modes on four maps:** *Deathmatch*, last car running wins, in the **Ghost Town** or **The Boneyard** (an aircraft scrapyard on a dry lake: airliners for cover, two of them to drive through, walls of crushed cars and a quarry pit to jump). *Race*, three laps with three forks each, on **Route 67** (open desert into the canyons: mine shaft or dry wash, a cliff road above boulder alley, gorge jump or switchback) or **Salt Lake Run** (round a dried-up lake, faster and more open: over the dam or down the spillway, the pier jump or the shoreline, through the drive-in or round it), with boulders and sinkholes on both. Wrecks in a race respawn after three seconds with half armour.
- **Death Race plates:** races start with the machine gun locked. *Sword* plates unlock it and hand out a heavy weapon (heavier further back in the field), *shield* plates cut damage to a quarter for eight seconds, and *skull* plates set off the next hazard ahead: a rockfall or a tanker truck driving the wrong way.
- **Balance:** in races the cars' top speed, acceleration, steering and grip are pulled three quarters of the way to the middle of the field, heavy cars shrug off part of a boulder or truck hit and lose less speed on sand, Big Chill's brain freeze goes for the car just ahead, and Moonbeam's sonic blast shatters fallen boulders. In the arena no more than two bots go after you at once, Scorcher fights hit-and-run, and on touch controls the weapons' lock-on is 50% wider and new players start on Easy.
- **Race AI:** in a race every bot is matched to the pace of the car you picked (90% on Easy, 99% on Normal, 105% on Hard), brakes only as much as each bend really needs, and takes the risky shortcuts more often the harder the difficulty. Rubber banding then gives bots behind you a little more top speed and bots ahead a little less (scaled by difficulty, off in Settings), and anyone tucked in behind another car gets a slipstream.
- **Five weapons, carry three:** homing missiles, rocket pods, mortar, mines and a torch from crates, plus repair and special-ammo pickups. A fourth weapon throws out the one you have least of.
- **Combo moves:** an attack and a defensive combo for every weapon: Rattler volley and Decoy flare, Rocket fan and Tail gunner, Carpet barrage and Smoke screen, Mine toss and Kickback, Fireball and Ring of fire.
- **AI drivers** with personalities (rammers, snipers, opportunists) that hunt, retreat to repair, grab pickups and fight each other, or race the course and pick their branch at each fork.
- **Destructible arena:** exploding barrels and gas pumps, cacti, billboards and a water tower you can drop on someone.
- **Arcade driving:** drifts, ramps and dunes for big air, cars that smoke, burn and lose wheels when wrecked.
- **Where you stand:** your place is always on screen in big numbers (by race position, or by wrecks in a deathmatch), with a list of every driver in order under the radar. Press M (D-pad up, or tap the radar) to switch the radar between what's nearby and the whole map.
- **Online play:** up to ten drivers with an invite link or a room code, bots optional, on desktops and phones. If the host leaves mid-match, the next player takes over and the match goes on.
- **Options:** 2 to 9 opponents, three difficulties, noon / sunset / night (with headlights), view width and camera distance, auto-fire and auto-drift, fast or pretty graphics, sound on/off. Phones and tablets play in landscape.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive / steer | WASD or arrows | Triggers + left stick | Left thumbstick |
| Drift | Space (also automatic on hard turns) | B | Drift |
| Machine gun | J or Z (also fires by itself at cars in its sights) | X | Automatic |
| Fire weapon | K or X | A | Fire |
| Attack combo | I or V | RB | Swipe up on Fire |
| Defensive combo | , or B | LB | Swipe down on Fire |
| Special | L or C | Y | Special |
| Switch weapon | Q / E | D-pad left / right | Tap the weapon panel |
| Switch target | Tab | Right-stick click | Tap a name tag |
| Flip back over | R | Back/Select | Flip back (appears when stuck) |
| Pause | P or Esc | Start | ❚❚ |

Menus work with arrows and Enter, or the d-pad, A and B. Auto-fire and auto-drift can be switched off in Settings. The keys live in one table, `src/input/bindings.ts`, which also drives the in-game help and HUD hints.

## Project layout

ES modules bundled by Vite, with Three.js (pinned to r128) from npm. Modules are grouped by system; lower layers never import from higher ones at load time, and shared code reaches maps and modes only through their registries:

| Folder | What's in it |
| --- | --- |
| `src/main.js` | Boot: builds the world, wires the menus, starts the loop |
| `src/engine/` | Utilities, renderer and lights, sky shader and time of day (`sky.ts`, `onTod` listeners), particles, debris, geometry helpers |
| `src/world/` | Engines every map shares: ground and collision queries that ask the map at a point (`terrain.js`, `collision.js`, `surface.js`), the sand/sandstone material, mesas and boulders (`landscape.ts`), procedural textures, road surfaces (`roads.ts`), plants and scatter (`flora.ts`), destructible props, pickups and their icons, road plates (`plates.ts`), triggered hazards (`hazards.ts`), and race courses: the ground, barriers and race progress worked out from a layout (`course.ts`) and their meshes (`course-scenery.ts`) |
| `src/maps/` | The places. `types.ts` (what a map provides), `registry.ts` (lookup by id or position), `index.ts` (registers them), one folder per map: `ghost-town/` (the arena and menu backdrop: terrain, town, canyon wall, roads, props, crates), `boneyard/` (the aircraft-scrapyard arena: lake bed and pit, planes, car stacks, props, crates) and `route67/` (the canyon race course: its layout), `saltlake/` (the dry-lake race course: its layout and its boats, pier and drive-in), and `course-map.ts` (wraps a course as a map) |
| `src/modes/` | The rules. `types.ts` (what a mode provides), `registry.ts`, `index.ts`, and one file per mode: `deathmatch.ts`, `race.ts`, plus rules they share (`shared.ts` pickups, `plates.ts` what plates do in a race) |
| `src/cars/` | `roster.js` (stats), `car.js` (driving physics, car collisions), `model/` (procedural model kit: lofted hulls, materials and reflections, painted decals, wheels) and `recipes/` (one file per car) |
| `src/combat/` | Projectile pools, damage, explosions and effects, weapons, combos and specials |
| `src/ai/` | Opponent behaviour |
| `src/input/`, `src/audio/` | Keyboard, touch and gamepad input; synthesized sound |
| `src/net/` | Online play: the transports (`peer.ts` WebRTC, `local.ts` between tabs), the binary messages (`protocol.ts`), the room (`session.ts`), the host and guest roles, host migration and the online screens. Nothing outside it imports it |
| `src/game/` | Game state and settings, HUD, camera, menus and results, the match loop (`match.js`, the same for every map and mode), main loop and quality |
| `src/style.css` | Menus, HUD, touch controls |
| `tests/`, `tools/` | Playwright tests; screenshot, benchmark (`perf.js`) and bot-match (`botmatch.js`) tools |

New modules can be written in TypeScript (`.ts`) directly; Vite compiles them and `npm run typecheck` checks them alongside the JavaScript. Add JSDoc types (`/** @type {...} */`) when the checker can't infer something.

### Performance notes

- Draw calls matter most on phones. Static scenery is merged per area (terrain tiles, canyon slices, ground-cover cells) so it can be culled without costing a call per object; repeated things are instanced (wheels, pickups, barrels, tumbleweeds).
- Cars use one material for paint, chrome and trim, reading roughness, metalness and clear coat from a per-vertex attribute, so a car is about five draw calls. Distant cars swap to simple wheels.
- All shaders are compiled at boot and at match start (`renderer.compile`), so effects don't stutter the first time they appear.
- Run `npm run perf` before and after a change that adds geometry or materials.

Everything visual is built from code. There are no image, model or audio files.

### Maps and modes

A **map** is a place and a **mode** is a set of rules; the garage pairs them (each map lists the modes it can host). The match loop in `src/game/match.js` runs cars, weapons and effects the same way everywhere and asks the mode for everything that differs.

All maps live in one scene, each in its own 6 km band of world x (`x0` to `x1`), far enough apart that fog and the camera's far plane keep them out of each other's view. Shared code never asks "which map is this?": ground height, collision, sight lines and surface grip go through `mapAt(x)` in `src/maps/registry.ts`. A map other than the menu map is built the first time it's played.

### Adding a map

1. Make `src/maps/<id>/index.ts` exporting a `GameMap` (`src/maps/types.ts`). Give it the next free band (`x0: 9000, x1: 15000`, and so on) and put everything inside it: an origin at the band's middle keeps coordinates small.
2. Provide the ground (`height`, `ramp`, `drawn`, `roadLift`, `speed`), collision (`collide`, `blocked`, `solid`, `outOfBounds`, optionally `sees`), a `build` that adds its meshes, `drawRadar`, and an `overview` (the middle and reach of the playable area: the radar's whole-map view draws the same `drawRadar` at that scale). Reuse `desertMaterial`, `addMesas`, `addBoulders`, `ribbon` and the scatter and props engines from `src/world/`.
3. List its `modes`, and provide what they need: `spawns` for deathmatch, a `course` for races. A race map is a layout and little else: describe its sections, forks, rocks, crates, plates and hazards as a `CourseLayout` (see `route67/track.ts`), pass it to `makeCourse` (`src/world/course.ts`, which works out the ground, barriers and race progress), build its meshes with `buildCourse` (`src/world/course-scenery.ts`, with the map's own colours and props) and wrap it with `courseMap` (`src/maps/course-map.ts`), which supplies everything in step 2.
4. Register it in `src/maps/index.ts`. `tests/maps.spec.js` then plays it in each of its modes; check the frame cost with `npm run perf -- --map <id> --mode <mode>`.

### Adding a mode

1. Make `src/modes/<id>.ts` exporting a `GameMode` (`src/modes/types.ts`): `setup` places the cars and gives loadouts, `step` runs the rules, `wrecked` says what a wreck means, `status` fills the HUD's top line, `standings` and `score` fill the place readout and the standings list, `results` fills the results screen, and `drive` (optional) steers the bots.
2. Register it in `src/modes/index.ts` and add its id to the `modes` of each map that can host it. It appears in the garage automatically.

### Online play

One player's game hosts: it runs the match exactly as single-player does and drives each guest's car with the controls that guest sends. Twenty times a second it sends every guest a snapshot (cars, projectiles, mines, crates, plates) and the events since the last one. Guests draw other cars a tenth of a second behind, between snapshots, and drive their own car locally, eased toward where the host has it. Every player is linked to every other one. If the host leaves mid-match, the next player in lobby order (desktops before phones) loads the last checkpoint (sent once a second) over the match it was mirroring and carries on as host. It also takes over the room's address (the one the code and the invite link point to) and sends whoever arrives there on to itself, so the link keeps working.

Simulation code never talks to the network. When adding to it:
- A one-off sight or sound that only the host's simulation triggers (an explosion, a burst, a sound at a place) is made with `effect(name, fn)` from `src/engine/events.ts`: it plays where it's called and is replayed on every guest. Its arguments must be plain numbers, strings and flags. Things guests can draw from state (a car's smoke, a projectile's trail) need nothing.
- A message for one driver (big text, a feed line, a sound) is raised with `announce`, `tell` or `emit` to that car's `pid`, never by calling the HUD.
- Rules about people use `c.human`; what this screen shows uses `c.isPlayer` (the car the camera follows).
- New match state that a snapshot doesn't carry registers `save`/`load` with `src/engine/savestate.ts`, so a new host can carry it on.
- On a guest `G.replica` is set: damage and breaking things are the host's alone.

Develop it without the internet: open the game with `?net=local` in two tabs (add `&lag=80` for 80 ms each way). `tests/net.spec.js` plays that way, and `npm run net` measures it.

### Adding a car

Add its stats to `src/cars/roster.js`, write a recipe in `src/cars/recipes/<id>.js` (see `sundowner.js`: a `loftZ` body, `K.sideGlass` / `K.topGlass` windows, `K.decal` livery, lamps, `K.gun`, `K.wheel`), register it in `src/cars/recipes/index.js`, then check it with `npm run shots -- cars <id>`. Give it a special: a `case` in `fireSpecial` (`src/combat/weapons.js`) and one in `AI.specialOK` (`src/ai/ai.js`) for when its bot uses it. A special with a new kind of projectile needs a mesh pool in `src/combat/pools.js` and the kind added to the end of `PROJ_KINDS` (`weapons.js`) and `PROJ_TYPES` (`src/net/protocol.ts`), with `PROTOCOL` raised in `src/net/types.ts`, since players on the old version can't draw it. `tests/weapons.spec.js` then fires it, and `npm run bots` shows whether the car wins too much or too little.
