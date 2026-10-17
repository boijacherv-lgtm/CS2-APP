# Stratboard: CS2 tactics board & match review

**https://tsakhstvo.xyz** · plan rounds, simulate fights, and review your own matches like a chess game.

Place CTs and Ts on Valve's real radar, give them routes, grenades and line-ups, and watch the round play out with fights. Or load one of your own matches: every round replays on the radar with a live win-chance bar, every move gets a chess-style mark (!! brilliant, ! good, book, ? mistake, ?? blunder), every player's round a grade from S+ to F, and a built-in coach tells you what to work on.

> **Working on this as an AI agent / new developer?** Read the [Agent guide](#agent-guide) first. It has the conventions, gotchas and open work that aren't obvious from the code.

---

## Why use it

- **Learn from your real games.** Every round replays with players, shots, grenades and the bomb. Each move pops up next to the player with a grade and the reasons (ISOLATED, TRADE, WHIFF, WASTED…), so you see exactly which moments won or lost the round.
- **A coach after every match.** The Match recap lists the 2–4 things you should work on, with the rounds to watch, and what went well.
- **Fair player ratings.** Each player gets an estimated rating for that game on the Premier scale, from who they beat (real opponent ratings) and how much they changed each round, not just K/D.
- **Plan before you play.** Draw a setup or an execute and see who sees whom, which entrance is weak, who wins the first fight and how map control shifts second by second. The fight simulation plays the round hundreds of times for kill chances and win rates.
- **Your games, no uploads.** Connect CS2's demo folder once and your downloaded matches appear by themselves, read right in your browser.
- **Safe for your Steam account.** Login is the official "Sign in through Steam": you log in on Steam's own page and the app only learns your SteamID. It never logs in to Steam itself and never sees your password.

## Website or desktop

| | **Website** (tsakhstvo.xyz) | **Desktop** (run it on your PC) |
|---|---|---|
| Setup | none, just open it | Node 18+, then `npm install`, `npm run dev` |
| Tactical board, simulation, analysis | ✅ | ✅ |
| Open a `.dem` | ✅ read in your browser (~10–25 s), nothing uploaded | ✅ |
| New demos show up by themselves | ✅ connect CS2's demo folder (Chrome / Edge) | ✅ watches CS2's replays folder |
| Log in with Steam + your match list | ✅ | ✅ |
| Review & Match recap | ✅ | ✅ |
| Grenade flights in Review | straight from throw to pop | exact path, bounces included |

Both read demos with the same parser (LaihoE/demoparser); the website uses a WebAssembly build of it. Its only gap is grenade bounces: the browser build doesn't record a grenade's flight, only where and when it was thrown and where it went off.

## How to use it

### Review your match
1. **Review** tab → drop a `.dem` (or a saved `.json`), or use **Your CS2 demo folder** below. FACEIT/HLTV demos work too (unzip first).
2. Press **Play** (or Space). The win-chance bar, the timeline and the grades reveal themselves as the round plays. **Reveal all** (or R) shows everything at once.
3. **The timeline** at the bottom is the round's story: the win chance as a curve (CT blue above the middle, T yellow below), kills as ticks in the killer's colour, annotated moves as their mark (!! ! ? ??), book moves as small dots, and the bomb icon at the plant. Click anywhere, or on a mark, to jump there.
4. The **previous / next** arrows (or ← →) step through the key moments of the match, across rounds, like moves in a chess game.
5. The panel on the right (**Panel** to show or hide it) has the rounds and three tabs: **Moves**, **Economy**, **Players**.

**Move marks**, like a chess game's analysis. They're decided from what happened, not from the win-chance number alone:

| Mark | Means | For example |
|---|---|---|
| **!!** Brilliant | exceptional, statistically unlikely | winning a 1v3+ clutch, a ninja defuse (enemies alive or under 1 s left), holding a site alone (3+ kills against a push), a pistol with no armour beating full gear, an HE for 150+ damage, a flash that sets up two kills |
| **!** Good move | swung the round | a trade within 3 s, a double or triple kill, the opening kill in a fair fight, a kill from behind, a 1v2 clutch, a flash that won a duel, an HE for 70+, a defuse |
| book | the expected, sound play (plain dot) | a standard smoke or molotov (a spot FACEIT level-10 players use), a plant; ordinary kills and deaths show as plain "Kill" / "Death" |
| **?** Mistake | cost the team | an untraded opening or isolated death, dying with two grenades, losing the AWP, flashing only your own team, an HE that hit nobody, a smoke that missed every standard spot and blocked nothing, a molotov on empty ground |
| **??** Blunder | round-losing | a team kill, dying to an eco while fully bought without throwing anything, a team flash that got a teammate killed |

**Round grades** (each player, each round), S+ … F:
- **S+** 3+ kills (or 300+ damage) and a critical objective: a won clutch, a solo anchor, the entry and the plant, a defuse
- **S** 3 kills; or 2 with the entry plus great utility or the plant / defuse; or a ninja defuse
- **A** a double kill, a brilliant move, a key trade, utility that carried the team, a defuse
- **B** did their job: an impact kill, an even trade with real damage, useful utility, the plant
- **C** no real impact · **D** an early untraded death or a mistake without an impact kill · **F** a blunder (team kill, eco death) with fewer than two kills

Each player also gets two **match grades** in Match recap:
- **Lobby:** against the other players of that match (round grades, impact, ADR, KAST and duels won, each compared with the lobby); B is about the lobby's middle.
- **vs Lvl 10:** against FACEIT level-10 players (the coach's trained numbers); B is on par with a typical level-10 player, A and up better, C and below worse.

**All / Mine** (in the playback bar) chooses which moves are evaluated on screen: **All** is every move (every kill, every death, every grenade and flash, book moves too), **Mine** is every move of yours (needs Log in with Steam, and you in the match). The map, the timeline, the killfeed, the cards and previous / next all follow it, so they always show the same moves. (The Players tab counts the annotated moves: !! ! ? ??.)

What you see on the map:
- **Players** move smoothly, with a view cone and a white arrow for where they look. The top bar shows each player's avatar and health, the score and the round / bomb timer, like in CS2.
- **Shots:** every bullet is a muzzle flash and a tracer, to whoever it hit or toward the wall it hit.
- **Grenades** fly as thrown and grow while they're in the air; then the smoke blooms, the fire burns, the flash bursts, the HE rings, each with its grade.
- **The bomb:** next to whoever carries it, dropped (dashed ring), planted (blinking faster as the fuse runs out), defused or exploded.
- **Killfeed** (top right, like CS2's): every kill as killer → weapon → victim, with the killer's mark in front and the victim's after their name (book moves stay plain). Click a kill to open its card.
- **Move cards** (bottom left, with a line to the player): while playing, each evaluated move's card opens by itself, one at a time and in order, and the replay goes into slow motion until it's read, so none are skipped. **Stop to read** freezes on it until **Continue**; clicking the card skips to the next. Paused, a card opens for a kill you click, a moment you step to with previous / next, or the move you stopped on; the players it's about light up and the rest of the map dims, and **‹ ›** pages through moves at the same moment.
- **Win chance** is the bar along the bottom of the map: CT from the left, T from the right.
- The **slow-motion** button (stopwatch) turns slow motion off (the card then just shows the latest move), and the **cards** button (speech bubble) turns the cards off altogether (both remembered in your browser).

### Your CS2 demo folder (website, Chrome / Edge)
1. **Review** tab → **Choose your Steam folder** → pick the Steam folder where CS2 is installed (e.g. `C:\Program Files (x86)\Steam` or `D:\SteamLibrary`; any folder on the way to `…\csgo\replays` works). A website can't search your disk, so you pick it once.
2. Your demos are listed newest first with map and final score (your score, W/L and K/D when you're logged in with Steam). The 5 newest are read by themselves, one at a time, in your browser and kept there; older ones have a **Read** button.
3. A demo CS2 downloads appears within seconds. After a browser restart, click **Reconnect** once (browsers ask for folder access again each visit).

### Match recap
**Match recap** tab, for the match loaded in Review, top to bottom:
- **The result:** map, final score (your team first when you're logged in with Steam), victory or defeat, your game rating against your Premier.
- **Your game** (or any player you pick): match grade, game rating on a dial (the yellow tick is their real Premier rating), and ADR / KAST / Impact against normal.
- **Coach:** every number as a bar from "normal": right and green is better, left and red is worse, longer is further off. **!** marks the things to work on; click a row for the tip and **Watch: R5 R12…** buttons that open those rounds (hovering one outlines that round in the grid below). It looks at untraded and isolated deaths, opening deaths, missed sprays, dying with grenades, flashes that blind nobody, team damage, losing the AWP, fighting while hurt, ADR, KAST, headshots, grenade damage, flash assists, trades, impact and a weak CT or T side.
- **Scoreboard:** both teams, columns grouped (Rating · Fights · Openings & clutches · Utility · Impact); only numbers far from normal are coloured. Click a player to see their game above.
- **Round grades** (S+ … F) for every player in every round, with who won each round and how; a gap marks the side switch. Click a grade to watch that round.

### Your matches (Steam match list)
1. **Log in with Steam** (top right). Steam's own page opens; scan the QR code with the Steam app (Steam Guard) and approve.
2. Once only: in **Your matches**, click **Open Steam Support (CS2 codes)**, create the authentication code if asked, select the whole page (Ctrl/Cmd+A), copy, and paste it into the box. The app picks out your **authentication code** and **latest match code**.
   - Desktop only: also paste your Steam Web API key page (steamcommunity.com/dev/apikey, domain `localhost`). The website uses its own key.
3. New matches appear in the list by themselves (checked every 5 minutes). **Download in CS2** opens CS2, which downloads the demo; it then shows up in **Your CS2 demo folder** (website) or is imported by itself (desktop).
4. Older games: Valve only lists matches *after* the code you gave it. Paste older share links (CS2 → Watch → Your Matches → copy link) to add them.
5. Valve deletes demos after about a month, so download the ones you want to keep.

### Plan a round (Tactical)
1. **Setup** (menu button) (top of the tool rail on the left) opens the map picker, **CT setups**, **T plays** and line-ups. A default CT setup is already placed.
2. **Move players:** drag them, double-click then click where they go, or select one and right-click the map. Turn them by clicking the white dot or with `[` `]`.
3. **Routes:** Route tool → click a player → click where they should go (Shift+click adds waypoints).
4. **Grenades:** Smoke / Flash / Molotov / HE tools, or **Line-up** for real throws. Every tool is on the rail with its key (V, C, T, S, F, M, H, P, L, E); undo and redo at the bottom.
5. Press **Play** (or Space). Callout names: the main ones show on the map; zoom in for the detailed spots (Boost, 90, Default…), or switch on **All callout names** in the layers menu. The **Standard** layers menu (top left of the map) chooses how much is drawn (Clean / Standard / Full, keys 1–3) and turns single layers on and off.
6. The right panel (**Panel** to show or hide it; it slides over the map on smaller screens) explains it. Selecting a player or grenade shows its settings at the top: weakest entrance, likely T plays, kill chances (200 simulated rounds), map control, what each grenade is worth. Select a CT and turn on **Best spots** to see where they should stand.

## Running it yourself (desktop)

```bash
npm install
npm run dev          # http://localhost:5173  (add `-- --host` to open it from other devices on your network)
npm test             # tests (vitest, a few seconds)
npm run build        # type-check + production build
npm run train:coach -- <folder>   # train the coach on a folder of demos (see Training the coach)
npm run learn:spots -- <folder>   # learn the standard smoke / molotov spots from the same demos
npm run build:maps   # regenerate src/map/generated/maps.json from public/images/maps/*.png (only after changing radars or tools/build-maps.mjs)
```

### Training the coach

The coach judges every player against FACEIT level-10 players, learned from their demos. Until that model has been
trained it uses hand-set Premier numbers. To train it:

1. Download demos of the group you want as the target (e.g. FACEIT level-10 matches: match room → Watch demo) into
   one folder outside the project. `.dem`, `.dem.gz` and `.dem.zst` all work, no unpacking. 30 demos is a start,
   60–100 is better; mix the maps.
2. Run `npm run train:coach -- ~/path/to/folder` (options: `--name faceit10 --label "FACEIT level 10" --min-rounds 12`).
   Every player who played at least 12 rounds counts as one sample; roles with 15+ samples get their own numbers
   (an AWPer is compared with AWPers). Takes about 15–30 s a demo; each demo is cached in the folder, so adding more
   later only reads the new ones.
3. It writes `src/engine/models/faceit10.json` and prints the new normals next to Premier's. Commit that file: from
   then on the coach (and the scoreboard colours) judge against it.
4. `npm run learn:spots -- ~/path/to/folder` learns where those players land smokes and molotovs (a spot is standard
   when 4+ grenades from 3+ matches land there) into `src/map/generated/util-spots.json`: the review calls a smoke on a
   standard spot book and one far from all of them that blocked nothing a missed smoke. Maps with few demos have
   few spots, so add demos of the maps you play.

Developed on macOS (Apple Silicon), also runs on Windows. Your Steam settings and imported matches stay in `.steam-cache/` (never committed).

## How the website is published (for the team)

**Every push to `main` updates https://tsakhstvo.xyz by itself**, a minute or two later (`.github/workflows/pages.yml`: tests → `VITE_ONLINE=1` build → GitHub Pages).

| Piece | Where | Setting |
|---|---|---|
| Website | GitHub Pages, repo **CS2-APP** | Settings → Pages → **Source: GitHub Actions** (not "Deploy from a branch"), custom domain `tsakhstvo.xyz`, Enforce HTTPS |
| Domain | Namecheap → Advanced DNS | four `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; `CNAME` `www` → `boijacherv-lgtm.github.io.` |
| Steam login + match list | Cloudflare Worker `stratboard-api` → https://stratboard-api.stratboard.workers.dev | code in `worker/` (setup and updates: [worker/README.md](worker/README.md)); secret `STEAM_API_KEY`; KV storage `SB`. After changing `worker/src`: `cd worker && npx wrangler deploy` |
| Link between them | GitHub → Settings → Secrets and variables → Actions → **Variables** | `API_URL` = `https://stratboard-api.stratboard.workers.dev` |
| Demo parser in the browser | `public/demoparser/` (WebAssembly, ~3 MB) | built by the GitHub Action **Build demo parser (browser)** from LaihoE/demoparser at a pinned commit (`PARSER_REV`) with two build patches (browser-safe clock, panic messages) |
| Demo bot | not hosted yet | code in `server/` ([server/README.md](server/README.md)): would download and read every new match by itself with its own bot Steam account; shares secret `SERVER_TOKEN` with the Worker |

**Keep secrets out of the repo and out of chats.** The Steam Web API key only ever goes into `npx wrangler secret put STEAM_API_KEY` (type the command exactly like that, then paste the key when asked) and, for desktop, into the app's own paste box. If a key is ever shown anywhere, revoke it on steamcommunity.com/dev/apikey and make a new one.

### Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Website is a blank page | Pages publishes the raw repo instead of the build | Settings → Pages → Source: **GitHub Actions**, then Actions → Deploy website → Run workflow |
| tsakhstvo.xyz doesn't open at all | the four `A` records are missing in Namecheap | add them back (table above) |
| Site still shows the old version | browser cache | Ctrl+Shift+R |
| No "Log in with Steam" on the website | `API_URL` variable missing, or the site wasn't rebuilt since | add the variable, re-run Deploy website |
| "Steam refused the site's Web API key" | the Worker's key was revoked or mistyped | new key → `npx wrangler secret put STEAM_API_KEY` |
| "Steam says your authentication code or match code doesn't belong to your account" | codes from another account, or the auth code was reset | paste the Steam Support page again |
| Only a few / no older matches | Valve only lists matches after the code you gave | paste older share links |
| No "Choose your Steam folder" button | the browser can't open folders | use Chrome or Edge |
| "No CS2 demo folder inside …" | picked a folder that doesn't contain CS2 | pick the Steam library where CS2 is installed |
| Website: reading a .dem fails or the tab crashes | very large demo on a low-memory device | try a desktop browser, or the desktop version |
| CT / T player button does nothing | that side already has 5 players | the 5/5 counter shows it; select a player first to move it, or Clear |

## Features

| Area | What it does |
|---|---|
| **Maps** | 10 maps: the 9 competitive ones (Mirage, Inferno, Dust II, Nuke, Ancient, Anubis, Overpass, Train, Vertigo) plus Cache, on Valve's radars, with upper/lower levels for Nuke, Train and Vertigo. |
| **Board** | CT/T players with view cones (106° FOV) and a look arrow; drag, double-click → click to move, right-click to send; turn with the white dot or `[` `]`; smokes, flashes, molotovs, HE grenades. |
| **Routes & timeline** | Shortest walkable paths with waypoints, leave time, run/walk. Round-time slider and Play (0.5–4×): positions, smokes, map control and fights all follow the clock. |
| **Guns** | 31 CS2 weapons with price, damage, fire rate, armour pen, movement speed, kill speed and range. Pick the exact gun per player; the simulation uses its stats. |
| **Combat** | Seeded fight simulation: reaction times, peeker's advantage, crossfires, gun stats, flashes, HE/molotov damage and HP. Re-roll (dice) for other outcomes. 200-round batches give kill chances and round win rates. |
| **Analysis** | Map control as territory with a front line, entry points (timing, holders, guns, crossfire, T pressure), predicted T plays, best spots for a selected CT, utility value. Hand-made layers for Mirage and Nuke, generated from geometry for the rest (Vertigo is rough). |
| **Line-ups** | Starter library (Mirage, Dust II) and your own line-ups saved in the browser. "Use" makes the selected player walk to the spot and throw it. |
| **Match review** | Demo rounds replay with smooth movement, look arrows, bullet tracers, grenades as thrown, the bomb, a CS2-style HUD and a live eval bar. Every kill, death, grenade, flash, plant and defuse gets a chess-style mark (!! ! book ? ??) plus context tags; each player gets a round grade and a match grade (S+ … F) and a role (Entry, Lurk, Support, AWPer, Anchor, Rotator, Rifler). Premier ratings shape the eval and duel grades (UPSET); grades weigh each team's economy and guns. Move windows with a reading queue and slow motion. |
| **Match recap** | Built-in coach (work on / keep doing, rounds to watch), estimated game rating per player (chess-style performance rating from duels against real opponent ratings + round impact), match grade, full stats and a grid of round grades. |
| **Demo folder** | Website: connect CS2's replays folder once; new demos are listed and read in the browser by themselves, results kept in IndexedDB. |
| **Your matches** | Log in with Steam (OpenID) + Valve's match-history API list your new matches; **Download in CS2** via Valve's `steam://` link. Codes and lists are per Steam account. |

---

## Agent guide

### How the user works with you
- Communicates casually and briefly ("push it to github", "try again"). Act on clear requests and report results plainly. **Commit and push only when asked.**
- **Uses a MacBook trackpad, often with tap-to-click, so press-and-drag is unreliable for them.** Every interaction must also work without dragging; that's why click-to-move, right-click-to-send and click-to-aim exist. Keep it that way.
- Wants to *see* things working: check UI changes in a browser (the ONLINE build: `VITE_ONLINE=1 npx vite build && npx vite preview`), and start the dev server when asked.
- Has another developer for visual design. The current design system (tokens, rail + drawer, overlay slots, timeline, move feed, recap layout) came from a design review the user asked for; they'll say what they don't like.
- **GitHub identity matters:** this repo belongs to **boijacherv-lgtm**. Commit and push only as that account (the local repo config uses its no-reply email and a dedicated SSH key, `core.sshCommand` → `~/.ssh/id_ed25519_boijacherv`). **Don't commit or push as any other account or with any other email.**
- Valve assets (radars) are deliberately committed to this public repo; this was the user's call.

### Architecture

```
src/
  shell/             app frame: nav bar (logo, game tabs, Tactical | Review | Match recap), home page, hash router
                     (#/ home · #/cs2/tactical · #/cs2/review · #/cs2/report). Brand name lives in shell/Logo.tsx (APP_NAME).
  engine/            pure TypeScript, no React: everything testable in Node
    types.ts         data model: MapDefinition, Player, Utility, Route, BoardState…
    grid.ts          MapGrid: walkability bitset, Dijkstra fields, A* shortestPath, line of sight, vision casting, popAt()
    predict.ts       TacticalEngine: timings, chokepoint threat, T-strategy Monte Carlo, facing; per map level
    strategies.ts    T strategy archetypes (Mirage) + priors by economy/phase
    autolayer.ts     generates lanes/chokepoints/strats/presets from geometry for maps without a hand-made layer
    timeline.ts      bakes routes onto the grid; player state at time t (no combat)
    guns.ts          weapon database, demo/inventory name matching, kill rate and range falloff
    combat.ts        round simulation → Simulation (per-step arrays); simStateAt() interpolates position and facing
    control.ts       map control: territory value per cell (+1 CT … −1 T), front line, ownership per area
    entries.ts       chokepoints explained: arrival timing, holders and guns, crossfire, T pressure
    killmap.ts       first-sight sweep of T movement + duel model (shared by spots)
    spots.ts         best spots for a selected CT (first duel, trade, exposure; keeps their entry covered)
    batch.ts         chunked many-round runs (kill chances, win rate) + utility impact
    recap.ts         demo → replay (Catmull-Rom movement, grenade flights, bombAt), eval curve, chess-style move grading,
                     tags, roles, ratings, key moments, and the reading queue for graded moves (calloutAt, readMs)
    match.ts         per-round summaries → per-player stats, performance rating, match grade
    match.worker.ts  grades every round of a loaded match off the main thread (started by Shell's useMatchGrader)
    coach.ts         the coach: coachFeatures (match → numbers) → CoachModel (what's normal, overall and per role) → coach()
                     notes; trainCoach() / trainCoachSet() learn the model from games
    coachModels.ts   COACH_MODEL: the trained level-10 model (models/faceit10.json), or the hand-set Premier one until it's trained
    sharecode.ts     share codes, CS2 download links, smart-paste extraction, OpenID login URL (no Node APIs: used by the site and the Worker)
    coords.ts / rng.ts
  map/
    catalog.ts       MAPS list, hand-made layers (EXTRAS) incl. per-level data, getEngine(map, level), presets, T plays
    lineups.ts       built-in + custom line-ups, flight-time model
    callouts.ts      callout names and positions for Ancient, Anubis, Cache, Dust II, Inferno, Overpass, Train (from
                     totalcsgo.com/callouts; main ones vs `minor` detailed spots). Mirage's are the team's own (catalog.ts)
    generated/maps.json   walkability grids + overview calibration (built by tools/build-maps.mjs)
  ui/
    Icon.tsx         <Icon name="play" />: interface icons from Phosphor (@phosphor-icons/react, bold / filled); equipment
                     (grenades, armour, bomb, defuse kit) as CS2's own pictograms; <GameIcon src="equipment/ak47" /> for
                     any game pictogram (drawn in currentColor with a CSS mask)
    cs2Icons.ts      the list of CS2 pictograms in public/images/icons/cs2 with each one's aspect ratio (regenerate when adding)
    tokens.ts        design tokens: every colour, the fonts; applyTokens() writes them to :root, Konva imports the same values
    Board.tsx        Konva stage: radar, overlays, players, routes, utility, bomb, tools, gestures; the overlay slots
                     (.board-ui: HUD, layers menu, killfeed, zoom, grenade feed / card, eval bar, playback dock) around the map
    MoveFeed.tsx     Review: KillFeed (every kill with its marks, top right) and the move card: opens by itself while playing
                     (reading queue, slow motion), or on click / previous-next / Stop to read when paused (store.feedPick); line to the player,
                     who it's about (onFocus dims the rest)
    shown.ts         the one rule for which moves are evaluated on screen (store.evalScope All / Mine, store.me); used by
                     the map, timeline, killfeed, cards, move list and moment stepping
    Shots.tsx        bullet tracers and muzzle flashes in Review
    Nades.tsx        grenade visuals: flights, smoke clouds, fire, flash burst, HE ring, countdowns, grade marks
    Panels.tsx       the tool rail (+ Setup flyout) and the right analysis panel (selection editor on top)
    Recap.tsx        review start page (drop zone) + review panel (eval graph, moves, economy, player grades, moment nav)
    Report.tsx       Match recap page: header, Performance + Gauge, CoachCard (deviation bars), Scoreboard, RoundGrid
    Playback.tsx     CS2-style round HUD and the playback dock (play, speed, All / Mine, cards, slow motion, Review timeline, combat)
    DemoFolder.tsx   website: CS2 replays folder (File System Access API), auto-read, cache versioned by V
    readDemo.ts      reads a .dem in demoWorker.ts (WebAssembly parser) off the main thread
    localStore.ts    IndexedDB key-value store + gzip helpers (CompressionStream)
    SteamMatches.tsx / SteamLogin.tsx / steamApi.ts   match list, Log in with Steam, and the backend client
                     (dev server /api/steam on desktop, the Worker with a session token on the website)
    Fold.tsx / Layers.tsx   collapsible panel sections; Clean / Standard / Full layer presets (keys 1 2 3)
  store.ts           zustand store: board per map level, tools, overlays, time/playback (incl. slow motion: readSlow,
                     slowUntil, slowSpeed, readHold), mode, the loaded match and its graded report
  App.tsx            wires engine ⇄ store; memoized analysis, simulation, control, kill map, batches; the playback loop
  env.ts             ONLINE (website build) and API_URL (the Worker) switches
tools/
  demo-core.mjs      .dem → per-round JSON, parser-agnostic (positions, kills, shots, hits, grenades + throws, bomb, economy, ranks)
  demo.mjs           demo-core with the native parser (desktop dev server, server/)
  demo-wasm.mjs      adapter for the WebAssembly parser (website)
  demoparser-node/   Node build of the WebAssembly parser (CI)
  steam.mjs          desktop Steam backend: OpenID, Valve match-history API, replays-folder auto-import, parsed demos (.steam-cache/)
  train-coach.ts     trains the coach on a folder of demos → src/engine/models/<name>.json (npm run train:coach)
  learn-spots.ts     standard smoke / molotov spots from a folder of demos → src/map/generated/util-spots.json
  build-maps.mjs     radar PNG → grid (alpha = floor; small grey shapes = props/walls; dark lines = walls on Nuke/Vertigo)
  overviews/         Valve's overview .txt per map (pos_x/pos_y/scale, spawns, bomb markers), read by build-maps
vite.config.ts       dev-server plugins: POST /api/demo parses a demo locally; /api/steam/* (me, status, openid, settings, sync, load…)
public/images/       every image the site shows
  maps/              Valve radars (de_*.png, de_*_lower.png for two-level maps)
  icons/cs2/         CS2 pictograms (equipment and weapons)
  logo.svg           site icon
public/demoparser/   WebAssembly demo parser for the website (built by CI)
worker/              Cloudflare Worker: Steam OpenID check, sessions, Valve match history with the site's key (worker/README.md)
server/              demo bot, not hosted (server/README.md)
.github/workflows/   pages.yml (test + ONLINE build + deploy), demoparser-wasm.yml (builds the WebAssembly parser)
```

**Modes:** the URL decides the CS2 mode (`Shell` calls `store.setMode`). Switching parks/restores the tactical board, and a loaded match survives switching back to Tactical. In Review with no match, `ReviewStart` replaces the board.

**Data flow:** `store.board` → (deferred) → `engine.analyze` / `simulate` / `computeControl` / `computeKillMap` / `runBatch` → props to `Board` and panels. In Review, `buildReplay()` replaces the board and the simulation with the real round, and `reviewRound()` grades it.

### Conventions and invariants
- **Coordinates:** all geometry is in **radar pixels (0–1024)**. Convert to world units only via `coords.ts` (`worldToRadar`, `radarToWorld`). Engine timings use `engine.secPerPx(side, weapon)`.
- **Grid:** `CELL = 4` px. `MapGrid.isWalkable`, `lineOfSight` (ray-marched, smokes as discs), `distanceField`, `shortestPath` (A* + string pulling).
- **Grenade timing:** always use `popAt(u)` and `lifeOf(u)`; never hard-code flight constants. Grading lives in `recap.ts`: each move's annotation (`Annotation`, `NOTE_INFO`) is decided by rules in `reviewRound` (kills and deaths in the kill loop, grenades in `gradeNade` and the flash loop, plant / defuse from `round.bomb`); `isMarked` = not book; tags from `TAG_INFO`; a player's round grade from `roundGrade(moves, roundFacts(...))`, the match grade from `matchLetter` (match.ts); roles from `playerRoles`. `gain` (win-chance change) still feeds impact, points and the game rating.
- **Facing:** radians in radar space (y down). `undefined` = auto-aim (`engine.facing(p)`). Demo yaw converts as `-yaw°`; interpolate angles the short way round.
- **Simulation shape:** `combat.Simulation` (per-player arrays at `SIM_DT = 0.1 s`) is the common format for playback, control, kill feed and demo replays. Reuse it.
- **Determinism:** everything random goes through `mulberry32(seed)`. Same board + seed = same round.
- **Demo data changes:** when `tools/demo-core.mjs` gains a field, bump `V` in `DemoFolder.tsx` so saved games are read again, and keep older data working (fields are optional in `DemoRound`).
- **Per-level maps:** `getEngine(mapId, level)`. The store keeps a separate board per `map:level`.
- **Callouts:** main callouts show with the Callouts layer; `minor: true` ones (detailed spots) only when zoomed in 1.6× or with "All callout names". Map-control areas use only the main ones. To move or add one, edit its `pos` (radar px) in `callouts.ts` / `catalog.ts`.
- **Tactical data:** hand-made layers live in `catalog.ts`. Prefer adding callouts/chokepoints there over editing the generator.
- **Design:** colours only from `ui/tokens.ts` (CSS `var(--…)`, Konva imports `T` / `SIDE_COLOR` / `UTIL_COLOR`). Only team, grenade and grade colours are colourful; the chrome is greyscale and white is the interactive colour. Rajdhani (`var(--font-display)`) for headings and big numbers, Inter for everything else, tabular digits in tables. Anything over the map goes into a `.board-ui` slot, on a solid `var(--overlay)` surface (no backdrop blur over the canvas).
- **Icons:** only from `ui/Icon.tsx`. Interface icons are Phosphor (bold; filled for playback). Grenades, armour, the bomb, the defuse kit and weapons are CS2's own pictograms (`public/images/icons/cs2`, from the game files via [Juknum/counter-strike-icons](https://github.com/Juknum/counter-strike-icons); the art is Valve's). No emoji anywhere in the UI.
- **Style:** match the surrounding code: small pure functions in `engine/`, short doc comments on the *why*, no new dependencies without asking the user.

### Testing
- `npm test`: 52 tests in `src/engine/__tests__/` (`engine.test.ts`: maps, layers, combat, grenades, guns, control, spots, line-ups, economy, review; `coach.test.ts`; `callout.test.ts`: the move-window queue; `modes.test.ts`; `steam.test.ts`).
- Add a test for every engine change. For UI changes, check the ONLINE build in a browser.
- Real demos: parse one with `tools/demo.mjs` into JSON and run a temporary vitest file over it (`buildReplay` + `reviewRound` per round) to check grading or playback logic on real data. Delete the temporary file afterwards.
- Browser checks: the File System Access picker can be stubbed with `window.showDirectoryPicker = async () => ({ … })`. Animations need the browser pane visible (requestAnimationFrame doesn't run in a hidden pane).

### Gotchas
- **Steam: official routes only.** An earlier version signed in to Steam with steam-session (posing as the mobile app) and Steam flagged that login as malicious. **Never add Steam login automation for a user's account** (steam-session, steam-user, QR or password logins, scraping logged-in pages). Use OpenID ("Sign in through Steam"), Valve's Web API and public profile XML, and `steam://` links for downloads. The only exception is the demo bot in `server/`: its own dedicated account, which the user logs in themselves.
- `.steam-cache/`, `.env`, `.dev.vars`, `server/data` and `server/.env` are git-ignored. Never commit or log them, and never return the key or auth code from `/api/steam/status`.
- Valve keeps demos for about a month; share-code links need CS2 (or the bot) to turn into a download.

### Status and open work
- **Coach training:** `trainCoach()` exists and is tested but nothing calls it yet. Next step the user is thinking about: train on their own games (e.g. a "Train on my games" button over the demo folder), later fit weights to round wins.
- **Demo bot** (`server/`) is written but not hosted; the user decided against Oracle/Azure for now.
- Ideas the user showed interest in: positioning/rotation moves, CT reactions in the simulation (rotate on contact, retreat), more line-ups, a hand-made Vertigo layer, lower-level layers for Train/Vertigo, FACEIT matches.
- Calibration: travel times come from geometry and the fight and grading models are hand-tuned; nothing is fitted to pro data yet.

---

## Credits

Radar images and overview data are © Valve Corporation, taken from the CS2 game files via [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons). Callout names and areas for most maps from [totalcsgo.com/callouts](https://totalcsgo.com/callouts). Weapon and equipment pictograms are © Valve Corporation, from the CS2 game files via [Juknum/counter-strike-icons](https://github.com/Juknum/counter-strike-icons). Demo parsing by [LaihoE/demoparser](https://github.com/LaihoE/demoparser). Interface icons by [Phosphor Icons](https://phosphoricons.com) (MIT). Counter-Strike is a trademark of Valve Corporation; this project is not affiliated with Valve.
