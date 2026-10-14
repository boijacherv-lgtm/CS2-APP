# CS2 Tactics Board

A 2D tactics board, round simulator and match reviewer for Counter-Strike 2, running in the browser.

You place CTs and Ts on Valve's real radar, give them routes, grenades and line-ups, and watch the round play out with fights. The app shows map control, predicts the enemy's plays, rates every spot on the map for a CT, and grades real match demos move by move, chess-engine style (Brilliant !!, Mistake ?, Blunder ??).

> **Working on this as an AI agent / new developer?** Read [Agent guide](#agent-guide) first. It has the conventions, gotchas and open work that aren't obvious from the code.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173  (add `-- --host` to open it from other devices on your network)
npm test             # engine tests (vitest, ~2 s)
npm run build        # type-check + production build
npm run build:maps   # regenerate src/map/generated/maps.json from public/maps/*.png (only after changing radars or tools/build-maps.mjs)
```

Requires Node 18+. The project was developed on macOS (Apple Silicon) and also runs on Windows.

## Features

| Area | What it does |
|---|---|
| **Maps** | 9 competitive maps (Mirage, Inferno, Dust II, Nuke, Ancient, Anubis, Overpass, Train, Vertigo) on Valve's radars, with Upper/Lower levels for Nuke, Train and Vertigo. |
| **Board** | CT/T players with view cones (106° FOV); drag, double-click → click to move, right-click to send a player somewhere; turn players by clicking the white dot or with `[` `]`; smokes, flashes, molotovs, HE grenades. |
| **Routes** | Route tool: click a player, then click a destination, and it follows the shortest walkable path (Shift+click adds waypoints). Leave time, run/walk. |
| **Timeline** | Round-time slider and ▶ Play (0.5–4×). Everything (positions, smokes, map control, fights) follows the time. |
| **Guns** | 31 CS2 weapons with price, damage, fire rate, armour pen, movement speed, kill speed and range. Pick the exact gun per player; the simulation uses its stats. |
| **Combat** | Seeded fight simulation: reaction times, peeker's advantage, crossfires, gun stats, flashes, HE/molotov damage and HP. 🎲 Re-roll for other outcomes. 200-round batches give kill chances and round win rates. |
| **Analysis** | Map control as territory (CT/T ground with a front line, ownership per area), entry points (when Ts arrive, who holds it with what, crossfire, share of the T push), predicted T plays, best spots for a selected CT, utility evaluation. |
| **Tactical layers** | Hand-made for **Mirage** and **Nuke** (A on the upper level, B on the lower level); generated from geometry for the other maps (Vertigo is marked rough). |
| **Line-ups** | Starter library (Mirage, Dust II) and custom line-ups saved in the browser. "Use" makes the selected player walk to the spot and throw it. |
| **Match review** | Load a `.dem` file. Rounds replay live like a chess game review (eval bar, graph and grades revealed as the round plays; ⏭ Reveal all / R). Kills, deaths and flashes get grades (Brilliant !! … Blunder ??), weighed by each team's economy (eco / force / full buy) and the guns used. Demos are parsed locally by the dev server. |

---

## Agent guide

### How the user works with you
- Communicates casually and briefly ("try again", "start the server"). Act on clear requests and report results plainly.
- **Uses a MacBook trackpad, often with tap-to-click, so press-and-drag is unreliable for them.** Every interaction must also work without dragging; that's why click-to-move, right-click-to-send and click-to-aim exist. Keep it that way.
- Wants to *see* things working: when asked, start the dev server (`npm run dev -- --host`) and give the URL.
- **GitHub identity matters:** this repo belongs to **boijacherv-lgtm**. Commit and push only as that account (the local repo config uses its no-reply email and a dedicated SSH key, `core.sshCommand` → `~/.ssh/id_ed25519_boijacherv`). **Don't commit or push as any other account or with any other email.**
- Valve assets (radars) are deliberately committed to this public repo; this was the user's call.

### Architecture

```
src/
  engine/            pure TypeScript, no React: everything testable in Node
    types.ts         data model: MapDefinition, Player, Utility, Route, BoardState…
    grid.ts          MapGrid: walkability bitset, Dijkstra fields, A* shortestPath, line of sight, vision casting, popAt()
    predict.ts       TacticalEngine: timings, chokepoint threat, T-strategy Monte Carlo, facing; per map level
    strategies.ts    T strategy archetypes (Mirage) + priors by economy/phase
    autolayer.ts     generates lanes/chokepoints/strats/presets from geometry for maps without a hand-made layer
    timeline.ts      bakes routes onto the grid; player state at time t (no combat)
    guns.ts          weapon database, demo/inventory name matching, kill rate and range falloff
    combat.ts        round simulation with fights, HP, flashes, HE, molotovs → Simulation (per-step arrays)
    control.ts       map control: territory value per cell (+1 CT … −1 T), front line, ownership per area
    entries.ts       chokepoints explained: arrival timing, holders and guns, crossfire, T pressure
    killmap.ts       first-sight sweep of T movement + duel model (shared by spots)
    spots.ts         best spots for a selected CT (first duel, trade, exposure; keeps their entry covered)
    batch.ts         chunked many-round runs (kill chances, win rate) + utility impact
    recap.ts         demo → replay (Simulation-shaped), economy/buy types, eval curve, chess-style move grading
    coords.ts / rng.ts
  map/
    catalog.ts       MAPS list, hand-made layers (EXTRAS) incl. per-level data, getEngine(map, level), presets, T plays
    lineups.ts       built-in + custom line-ups, flight-time model
    generated/maps.json   walkability grids + overview calibration (built by tools/build-maps.mjs)
  ui/
    Board.tsx        Konva stage: radar, overlays, players, routes, utility, tools, gestures
    Panels.tsx       left toolbar + right analysis panel
    Recap.tsx        demo loader + review panel (eval graph, moves, player grades)
  store.ts           zustand store: board per map level, tools, overlays, time/playback, review state
  App.tsx            wires engine ⇄ store; memoized analysis, simulation, control, kill map, batches
tools/
  build-maps.mjs     radar PNG → grid (alpha = floor; small grey shapes = props/walls; dark lines = walls on Nuke/Vertigo)
  demo.mjs           .dem → per-round JSON (uses @laihoe/demoparser2, Node only)
vite.config.ts       dev-server plugin: POST /api/demo parses a demo locally
public/maps/         Valve radars + overview .txt (pos_x/pos_y/scale, spawns, bomb markers)
```

**Data flow:** `store.board` → (deferred) → `engine.analyze` / `simulate` / `computeControl` / `computeKillMap` / `runBatch` → props to `Board` and panels. In review mode `buildReplay()` replaces the board and the simulation with the real round.

### Conventions and invariants
- **Coordinates:** all geometry is in **radar pixels (0–1024)**. Convert to world units only via `coords.ts` (`worldToRadar`, `radarToWorld`) with the map's `pos_x/pos_y/scale`. Engine timings use `engine.secPerPx(side, weapon)`.
- **Grid:** `CELL = 4` px. `MapGrid.isWalkable`, `lineOfSight` (ray-marched, smokes as discs), `distanceField` (multi-source, `blocked`, `start` offsets), `shortestPath` (A* + string pulling).
- **Grenade timing:** always use `popAt(u)` (throw time + `flight` or the type default). Never hard-code flight constants.
- **Facing:** radians in radar space (y down). `undefined` = auto-aim (`engine.facing(p)`). Demo yaw converts as `-yaw°`.
- **Simulation shape:** `combat.Simulation` (per-player Float32/Uint8 arrays at `SIM_DT = 0.1 s`) is the common format for playback, control, kill feed and demo replays. Reuse it rather than inventing parallel structures.
- **Determinism:** everything random goes through `mulberry32(seed)`. Same board + seed = same round.
- **Per-level maps:** `getEngine(mapId, level)`. Level 1 can have its own layer (`EXTRAS[map].lower`) with `entries` (spawn points with delays computed from the upper level). The store keeps a separate board per `map:level`.
- **Tactical data:** hand-made layers live in `catalog.ts` (`ChokepointSpec` uses `at` + `axis`, and the portal is fitted to the walls). Prefer adding callouts/chokepoints there over editing the generator.
- **Style:** match the surrounding code: small pure functions in `engine/`, short doc comments on the *why*, no new dependencies without asking the user (demo parsing is the only native one).

### Testing
- `npm test` runs `src/engine/__tests__/engine.test.ts` (35 tests). They cover every map's connectivity, preset/route walkability, Mirage/Nuke layers, combat determinism, grenades, guns, map control, spot finder, line-ups, economy and round review on a simulated demo-shaped round.
- Add a test for every engine change. For UI changes, run the app and check it in a browser.
- Debug trick: print an ASCII walkability map of a region (`grid.isWalkable` in a loop) inside a temporary vitest file. It's the fastest way to place chokepoints and line-ups. Delete the temporary file afterwards; `tsc` type-checks everything under `src/`.
- When driving the running app from browser JS after hot reloads, the store module URL may carry `?t=…`; import that exact URL (see `performance.getEntriesByType('resource')`), or you'll get a second store instance.

### Gotchas
- Radars only mark floor by opacity. Walls drawn *on* the floor are recovered heuristically in `build-maps.mjs` (grey props, dark wall lines on Nuke/Vertigo). After changing it, run `npm run build:maps` and the full test suite: props can seal off doorways.
- Nuke's floors aren't connected (no ramp/vent transitions within one simulation); B is analysed on the lower level only.
- `npm run dev` binds to localhost; use `-- --host` for LAN access. `/api/demo` exists only in the dev server, and `tools/demo.mjs` is cached by Node: restart the dev server after editing it.
- Don't feed `useDeferredValue(time)` into anything that must update during playback: it never settles while time changes every frame. `App.tsx` steps map control at 4 Hz while playing instead.

### Status and open work
- **Demo review works on the user's real demos.** The newer fields (economy: `balance`, `current_equip_value`, `inventory`, `armor_value`…; gun names in kills) are each parsed defensively in `tools/demo.mjs`. If the Economy table or gun names come out empty, check those names against the parser output.
- Share-code links (`steam://…csgo_download_match CSGO-…`) can't be downloaded directly; they need CS2 or a service like csstats.gg/Leetify to get the `.dem.bz2` URL. Decoding the code works (base-57 → match id / outcome id / token).
- Ideas the user showed interest in: grade utility beyond flashes, positioning/rotation moves, CT reactions in the simulation (rotate on contact, retreat), more line-ups, a hand-made Vertigo layer, Train/Vertigo lower-level layers, a GitHub Pages build (without demo review), fetching matches automatically (needs Steam/FACEIT API access).
- Calibration: travel times come from geometry and the fight model is hand-tuned. Nothing is fitted to pro demo data yet; the review grades are estimates.

---

## Credits

Radar images and overview data are © Valve Corporation, taken from the CS2 game files via [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons). Demo parsing by [LaihoE/demoparser](https://github.com/LaihoE/demoparser). Counter-Strike is a trademark of Valve Corporation; this project is not affiliated with Valve.
