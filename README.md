# Stratboard: CS2 tactics board & match review

**https://tsakhstvo.xyz** · plan rounds, simulate fights, and review your own matches like a chess game.

You place CTs and Ts on Valve's real radar, give them routes, grenades and line-ups, and watch the round play out with fights. The app shows map control, predicts the enemy's plays, rates every spot on the map for a CT, and grades real match demos move by move, chess-engine style (Brilliant !!, Mistake ?, Blunder ??).

> **Working on this as an AI agent / new developer?** Read [Agent guide](#agent-guide) first. It has the conventions, gotchas and open work that aren't obvious from the code.

---

## Why use it

- **Plan before you play.** Draw a setup or an execute on the real radar and see what it does: who sees whom, which entrance is weak, who wins the first fight, how map control shifts second by second.
- **Test ideas without a server.** The fight simulation plays the round hundreds of times, so you see kill chances and win rates for *your* setup, guns and grenades. 🎲 Re-roll to see other outcomes.
- **Learn from your real games.** Drop in a demo and every round replays with a live win-chance bar. Every kill and grenade gets a grade and a one-word reason (ISOLATED, TRADE, WHIFF, WASTED…), so you see exactly which moments won or lost the round.
- **Fair player ratings.** The match report rates each player for that game on the Premier scale, using who they beat (real opponent ratings) and how much they changed each round, not just K/D.
- **Your matches come to you.** Log in with Steam once, paste the Steam Support page once, and every new match appears by itself, already downloaded and graded.
- **Safe for your account.** Steam login is the official "Sign in through Steam" (you log in on Steam's own page; the app only learns your SteamID), and matches come from Valve's official API. The app never logs in to Steam itself and never sees your password.

## Two ways to use it

| | **Website** (tsakhstvo.xyz) | **Desktop** (run it on your PC) |
|---|---|---|
| Setup | none, just open it | install Node, then `npm install`, `npm run dev` |
| Tactical board, simulation, analysis | ✅ | ✅ |
| Log in with Steam + your match list | ✅ | ✅ |
| Open a raw `.dem` demo | ✅ read in your browser (~10–25 s), nothing uploaded | ✅ |
| Demos from **Download in CS2** import by themselves | ❌ | ✅ (watches CS2's replays folder) |
| Review & Match report | ✅ | ✅ |
| Grenade flight paths in Review | ❌ (grenades show where/when they popped) | ✅ |

The website reads `.dem` files with a WebAssembly build of the same parser (LaihoE/demoparser), so nothing is uploaded; it just doesn't show grenade flight paths. **Save .json** still lets you share an already-read match.

## How to use it

### Plan a round (Tactical)
1. Pick a map on the left. A default CT setup is already placed; **CT setups** and **T plays** load ready-made ones.
2. **Move players:** drag them, or double-click then click where they go (no dragging needed), or select one and right-click the map. Turn them by clicking the white dot or with `[` `]`.
3. **Routes:** Route tool → click a player → click where they should go (Shift+click adds waypoints).
4. **Grenades:** Smoke / Flash / Molotov / HE tools, or **Line-up** for real throws.
5. Press **▶ Play** (or Space) and watch. **Clean / Standard / Full** (keys 1–3) choose how much is drawn; **Layers** turns single layers on/off.
6. The right panel explains it: weakest entrance, likely T plays, kill chances (200 simulated rounds), map control, what each grenade is worth. Select a CT and turn on **Best spots** to see where they should stand.

### Review a match
1. **Review** tab → drop a `.dem` (or a saved `.json`). FACEIT/HLTV demos work too (unzip first). On the website it's read in your browser in about 10–25 seconds.
2. Press **▶ Play**. The win-chance bar, the graph and the grades reveal themselves as the round plays, like a chess review. **⏭ Reveal all** (or R) shows everything at once.
3. **◀ ▶** (or ← →) jump between key moments: kills and graded grenades, across rounds.
4. The top bar shows who's alive, health, the score and the bomb timer. Click any move in the list to jump there.

### Match report
**Match report** tab: every player's estimated rating for this game, match grade, K/D, ADR, KAST, openings, clutches, utility, whiffs, upsets and role. Click a player to highlight their grade in every round; click a grade to watch that round.

### Your matches (automatic match list)
1. **Log in with Steam** (top right). Steam's own page opens; scan the QR code with the Steam app (Steam Guard) and approve.
2. Once only: in **Your matches**, click **Open Steam Support (CS2 codes)**, create the authentication code if asked, select the whole page (Ctrl/Cmd+A), copy, and paste it into the box. The app picks out your **authentication code** and **latest match code**.
   - Desktop only: also paste your own Steam Web API key page (steamcommunity.com/dev/apikey, domain `localhost`). The website uses its own key.
3. Done: new matches appear by themselves (checked every 5 minutes). On the **website** the demo bot downloads and reads each one, so a few minutes after a match it shows map, score, K/D and **Review**, with no clicks. On **desktop**, **Download in CS2** opens CS2, which downloads the demo, and the app imports it by itself.
4. Older games: Valve only lists matches *after* the code you gave it. Paste older share links (CS2 → Watch → Your Matches → copy link) to add them; several at once is fine.
5. Valve deletes demos after about a month, so download the ones you want to keep.

## Running it yourself (desktop)

```bash
npm install
npm run dev          # http://localhost:5173  (add `-- --host` to open it from other devices on your network)
npm test             # tests (vitest, a few seconds)
npm run build        # type-check + production build
npm run build:maps   # regenerate src/map/generated/maps.json from public/maps/*.png (only after changing radars or tools/build-maps.mjs)
```

Requires Node 18+. Developed on macOS (Apple Silicon), also runs on Windows. Your Steam settings and imported matches stay in `.steam-cache/` (never committed).

## How the website is published (for the team)

**Every push to `main` updates https://tsakhstvo.xyz by itself**, about a minute later (`.github/workflows/pages.yml`: tests → `VITE_ONLINE=1` build → GitHub Pages). Pieces involved, and how they're set up:

| Piece | Where | Setting |
|---|---|---|
| Website | GitHub Pages, repo **CS2-APP** | Settings → Pages → **Source: GitHub Actions** (not "Deploy from a branch"!), custom domain `tsakhstvo.xyz`, Enforce HTTPS |
| Domain | Namecheap → Advanced DNS | four `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; `CNAME` `www` → `boijacherv-lgtm.github.io.` |
| Steam login + match list | Cloudflare Worker `stratboard-api` → https://stratboard-api.stratboard.workers.dev | code in `worker/` (setup and updates: [worker/README.md](worker/README.md)); secret `STEAM_API_KEY`; KV storage `SB` |
| Link between them | GitHub → Settings → Secrets and variables → Actions → **Variables** | `API_URL` = `https://stratboard-api.stratboard.workers.dev` |
| Demo parser in the browser | `public/demoparser/` (WebAssembly, ~3 MB) | built by GitHub Actions **Build demo parser (browser)** from LaihoE/demoparser at a pinned commit (`PARSER_REV`), with two build patches (browser-safe clock, panic messages); `tools/demo-wasm.mjs` adapts it, `src/ui/demoWorker.ts` runs it |
| Demo bot | Oracle Cloud Always Free VM, service `stratboard` | code in `server/` (setup and updates: [server/README.md](server/README.md)); its own **bot** Steam account; shares secret `SERVER_TOKEN` with the Worker |

Update the Worker after changing `worker/src`: `cd worker && npx wrangler deploy`.

**Keep secrets out of the repo and out of chats.** The Steam Web API key only ever goes into `npx wrangler secret put STEAM_API_KEY` (type the command exactly like that, then paste the key when asked) and, for desktop, into the app's own paste box. If a key is ever shown anywhere, revoke it on steamcommunity.com/dev/apikey and make a new one.

### Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Website is a blank page | Pages publishes the raw repo instead of the build | Settings → Pages → Source: **GitHub Actions**, then Actions → Deploy website → Run workflow |
| tsakhstvo.xyz doesn't open at all | the four `A` records are missing in Namecheap | add them back (table above) |
| No "Log in with Steam" on the website | `API_URL` variable missing, or the site wasn't rebuilt since | add the variable, re-run Deploy website |
| "Steam refused the site's Web API key" | the Worker's key was revoked or mistyped | new key → `npx wrangler secret put STEAM_API_KEY` |
| "Steam says your authentication code or match code doesn't belong to your account" | codes from another account, or the auth code was reset | paste the Steam Support page again |
| Only a few / no older matches | Valve only lists matches after the code you gave | paste older share links |
| Website: reading a .dem fails or the tab crashes | very large demo on a low-memory device | try a desktop browser; or the desktop version |
| Desktop: CT player button does nothing | the side already has 5 players | the 5/5 counter shows it; select a CT first to move it, or Clear CTs |

## Features

| Area | What it does |
|---|---|
| **Maps** | 10 maps: the 9 competitive ones (Mirage, Inferno, Dust II, Nuke, Ancient, Anubis, Overpass, Train, Vertigo) plus Cache, on Valve's radars, with Upper/Lower levels for Nuke, Train and Vertigo. |
| **Board** | CT/T players with view cones (106° FOV); drag, double-click → click to move, right-click to send a player somewhere; turn players by clicking the white dot or with `[` `]`; smokes, flashes, molotovs, HE grenades. |
| **Routes** | Route tool: click a player, then click a destination, and it follows the shortest walkable path (Shift+click adds waypoints). Leave time, run/walk. |
| **Timeline** | Round-time slider and ▶ Play (0.5–4×). Everything (positions, smokes, map control, fights) follows the time. |
| **Guns** | 31 CS2 weapons with price, damage, fire rate, armour pen, movement speed, kill speed and range. Pick the exact gun per player; the simulation uses its stats. |
| **Combat** | Seeded fight simulation: reaction times, peeker's advantage, crossfires, gun stats, flashes, HE/molotov damage and HP. 🎲 Re-roll for other outcomes. 200-round batches give kill chances and round win rates. |
| **Visuals** | In Review, grenades replay exactly as thrown in the match (real flight path with bounces, real smoke/fire duration) with their grade on them. Grenades look like the real thing and follow the clock: flying along their arc, then a smoke cloud that blooms and fades, flickering fire, a flash burst, an HE blast ring, each with a countdown. The Vision layer draws every living player's field of view (blocked by walls and smokes) and red dashed lines between players who can see each other. |
| **Analysis** | Map control as territory (CT/T ground with a front line, ownership per area), entry points (when Ts arrive, who holds it with what, crossfire, share of the T push), predicted T plays, best spots for a selected CT, utility evaluation. |
| **Tactical layers** | Hand-made for **Mirage** and **Nuke** (A on the upper level, B on the lower level); generated from geometry for the other maps (Vertigo is marked rough). |
| **Line-ups** | Starter library (Mirage, Dust II) and custom line-ups saved in the browser. "Use" makes the selected player walk to the spot and throw it. |
| **Match review** | Load a `.dem` file. Rounds replay live like a chess game review (eval bar, graph and grades revealed as the round plays; ⏭ Reveal all / R; ◀ ▶ or ← → step through key moments like chess moves, across rounds). Kills and every grenade get a chess grade (Brilliant !! … Blunder ??; deaths aren't marked, but their win-chance loss still counts toward impact and grades) plus context tags (OPENING, TRADE, ISOLATED, CLUTCH, FLASH ASSIST, WASTED…); each player gets a round letter grade (S+ … F) and an inferred role (Entry, Lurk, Support, AWPer, Anchor, Rotator, Rifler). Players' Premier ratings (read from the demo) shape the eval and the duel grades (UPSET), and missed sprays are tagged WHIFF. Grades are weighed by each team's economy (eco / force / full buy) and the guns used. |
| **Your matches** | Review start page: **Log in with Steam** (nav bar too; Steam OpenID like Leetify/FACEIT: Steam's own login page, QR with Steam Guard there; the app only receives a signed SteamID). Then, once, smart paste of the Steam Support page (game authentication code + latest share code; desktop also the user's own Web API key; the website uses its own, in the Worker) → Valve's match-history API (`GetNextMatchSharingCode`) lists new matches by itself every 5 minutes. **Download in CS2** uses Valve's `steam://…+csgo_download_match` link; on desktop the dev server watches CS2's replays folder (all Steam libraries) and imports the demo by itself. Every demo loaded on desktop is listed too. Codes and lists are per Steam account. |
| **Match report** | `#/cs2/report`: all rounds graded in a Web Worker; per player an estimated rating for the game (chess-style performance rating from duels vs real opponent ratings + round impact), match grade, K/D/ADR/KAST/HS%, openings, clutches, utility, whiffs, upsets, roles, and a grid of round grades (click → that round in Review) |

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
  shell/             app frame: nav bar (logo, game tabs, Tactical | Review switch), home page, hash router
                     (#/ home · #/cs2/tactical · #/cs2/review · #/cs2/report). Brand name lives in shell/Logo.tsx (APP_NAME).
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
    recap.ts         demo → replay (Simulation-shaped), economy/buy types, eval curve, chess-style move grading, tags, roles, ratings
    sharecode.ts     share codes, CS2 download links, smart-paste extraction, OpenID login URL (no Node APIs: used by the site and the Worker)
    match.ts         match report: per-round summaries → per-player stats, performance rating, match grade
    match.worker.ts  grades every round of a loaded match off the main thread (started by Shell's useMatchGrader)
    coords.ts / rng.ts
  map/
    catalog.ts       MAPS list, hand-made layers (EXTRAS) incl. per-level data, getEngine(map, level), presets, T plays
    lineups.ts       built-in + custom line-ups, flight-time model
    generated/maps.json   walkability grids + overview calibration (built by tools/build-maps.mjs)
  ui/
    Board.tsx        Konva stage: radar, overlays, players, routes, utility, tools, gestures
    Panels.tsx       left toolbar + right analysis panel
    Recap.tsx        demo loader + review panel (eval graph, moves, player grades)
    Report.tsx       match report page (plain layout, design pass pending)
    Fold.tsx         collapsible panel sections (open/closed state remembered per section)
    Layers.tsx       board layer control: Clean / Standard / Full presets (keys 1 2 3) + per-layer list
    Playback.tsx     on-board round clock (alive counts) and playback bar (play, speed, slider, combat)
    SteamLogin.tsx   Log in with Steam (OpenID) button + nav-bar account chip
    steamApi.ts      talks to the Steam backend this build has: the dev server (/api/steam) or, on the website, the Worker (token in localStorage)
    Nades.tsx        grenade visuals: smoke clouds, fire, flash burst, HE ring, flight arcs, countdowns (time-driven)
  store.ts           zustand store: board per map level, tools, overlays, time/playback, mode ('tactical' | 'review'),
                     the loaded match, and the tactical board parked while Review shows a match
  App.tsx            wires engine ⇄ store; memoized analysis, simulation, control, kill map, batches
  env.ts             ONLINE (website build) and API_URL (the Worker) switches
tools/
  build-maps.mjs     radar PNG → grid (alpha = floor; small grey shapes = props/walls; dark lines = walls on Nuke/Vertigo)
  demo.mjs           .dem → per-round JSON (uses @laihoe/demoparser2, Node only)
  steam.mjs          your matches: Steam OpenID (Log in with Steam), Valve match-history Web API, public profile XML (name/avatar, /id/ links), share-code decoding, CS2 download links, replays-folder auto-import, parsed demos keyed by outcome id (.steam-cache/)
vite.config.ts       dev-server plugins: POST /api/demo parses a demo locally; /api/steam/* (status, openid/start + openid/return, settings (profile from anywhere; key/auth code/folder localhost only), forget, sync, load); POST /api/demo?name= keeps Valve demos for the match list
public/maps/         Valve radars + overview .txt (pos_x/pos_y/scale, spawns, bomb markers)
server/              demo bot for the website (Oracle VM): bot Steam account → demo links, download + parse, results to the Worker (see server/README.md)
worker/              Cloudflare Worker for the website: Steam OpenID check, sessions, Valve match history with the site's key (see worker/README.md)
.github/workflows/   pages.yml: test + build (VITE_ONLINE=1, VITE_API_URL from the API_URL repo variable) + deploy to GitHub Pages
```

**Modes:** the URL decides the CS2 mode (`Shell` calls `store.setMode`). Switching parks/restores the tactical board, and a loaded match survives switching back to Tactical. In Review with no match, `ReviewStart` (drop zone) replaces the board.

**Data flow:** `store.board` → (deferred) → `engine.analyze` / `simulate` / `computeControl` / `computeKillMap` / `runBatch` → props to `Board` and panels. In review mode `buildReplay()` replaces the board and the simulation with the real round.

### Conventions and invariants
- **Coordinates:** all geometry is in **radar pixels (0–1024)**. Convert to world units only via `coords.ts` (`worldToRadar`, `radarToWorld`) with the map's `pos_x/pos_y/scale`. Engine timings use `engine.secPerPx(side, weapon)`.
- **Grid:** `CELL = 4` px. `MapGrid.isWalkable`, `lineOfSight` (ray-marched, smokes as discs), `distanceField` (multi-source, `blocked`, `start` offsets), `shortestPath` (A* + string pulling).
- **Grenade timing:** always use `popAt(u)` (throw time + `flight` or the type default). Never hard-code flight constants. Smoke/fire lifetime is `lifeOf(u)` (demo grenades carry their real `duration`). Grading lives in `recap.ts`: chess marks come from win-chance change (`grade`), tags from `TAG_INFO`, letters from `letterGrade` (impact points + tag bonuses), roles from `playerRoles`. Grenade grades are in `gradeNade` (smoke: sightlines cut; molotov: damage + enemies kept off; HE: damage + kills set up; flash: blinds).
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
- **Steam: official route only.** An earlier version signed in to Steam with steam-session (posing as the mobile app) and Steam flagged that login as malicious. **Never add any Steam sign-in / login automation again** (steam-session, steam-user, QR or password logins, scraping logged-in pages). Use only official/public Steam routes (OpenID, Valve's Web API with the user's own key, public profile XML) and Valve's steam:// links for downloads. "Sign in through Steam" (OpenID, `openIdStartUrl`/`openIdVerify` in `tools/steam.mjs`) is fine: the user signs in on steamcommunity.com in their own browser, and the app verifies Steam's signed answer with `check_authentication` and keeps only the SteamID.
- `.steam-cache/` (settings with the user's Web API key and auth code, match list, parsed demos) is git-ignored. Never commit or log it, and never return the key or auth code from `/api/steam/status`; `/settings` is refused from non-localhost requests.

### Status and open work
- **Demo review works on the user's real demos.** The newer fields (economy: `balance`, `current_equip_value`, `inventory`, `armor_value`…; gun names in kills) are each parsed defensively in `tools/demo.mjs`. If the Economy table or gun names come out empty, check those names against the parser output.
- Share-code links (`steam://…csgo_download_match CSGO-…`) can't be downloaded directly; they need CS2 or a service like csstats.gg/Leetify to get the `.dem.bz2` URL. Decoding the code works (base-57 → match id / outcome id / token).
- Ideas the user showed interest in: grade utility beyond flashes, positioning/rotation moves, CT reactions in the simulation (rotate on contact, retreat), more line-ups, a hand-made Vertigo layer, Train/Vertigo lower-level layers, a GitHub Pages build (without demo review), FACEIT matches (needs a FACEIT API key).
- Calibration: travel times come from geometry and the fight model is hand-tuned. Nothing is fitted to pro demo data yet; the review grades are estimates.

---

## Credits

Radar images and overview data are © Valve Corporation, taken from the CS2 game files via [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons). Demo parsing by [LaihoE/demoparser](https://github.com/LaihoE/demoparser). Counter-Strike is a trademark of Valve Corporation; this project is not affiliated with Valve.
