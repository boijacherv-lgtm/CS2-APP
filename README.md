# CS2 Tactics Board

A 2D tactics board and round simulator for Counter-Strike 2. Place players, draw routes and
grenade line-ups on the official radars, watch the round play out with fights, and get
predictions, map control and kill chances. Load your own match demos and get every round
graded move by move, chess-engine style.

## Run it

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # engine tests
```

## What it does

- **All 9 competitive maps** on Valve's radars (Mirage, Inferno, Dust II, Nuke, Ancient, Anubis, Overpass, Train, Vertigo), with upper/lower levels.
- **Board:** CT/T players, view cones, routes (auto-routing along real paths), smokes, flashes, molotovs, HE grenades.
- **Simulation:** round timeline with playback, fights with reaction times, peeker's advantage, crossfires, flashes and grenade damage. Re-roll for different outcomes; 200-round batches for kill chances and round win rates.
- **Analysis:** live map control, chokepoint threat, predicted T plays, a kill map of strong/weak CT spots, and utility evaluation (what each grenade is worth).
- **Tactical layers:** hand-made for Mirage and Nuke (A upstairs, B downstairs); generated from the map geometry for the rest.
- **Line-ups:** a starter library (Mirage, Dust II) plus your own, saved in the browser.
- **Match review:** load a `.dem` (CS2 → Watch → Your matches, FACEIT, HLTV). Replays each round with a win-chance graph and grades kills, deaths and flashes: Brilliant !!, Great !, Good, Inaccuracy ?!, Mistake ?, Blunder ??. Demos are parsed locally by the dev server.

## Project layout

- `src/engine/` — grid, pathfinding, line of sight, prediction engine, combat sim, map control, kill map, round review
- `src/map/` — map catalog, hand-made tactical layers, line-ups, generated map data
- `src/ui/` — board (Konva), panels, review screen
- `tools/build-maps.mjs` — `npm run build:maps` turns radar images into walkable grids
- `tools/demo.mjs` — demo parsing (via [@laihoe/demoparser2](https://github.com/LaihoE/demoparser))

## Credits

Radar images and overview data are © Valve Corporation, taken from the CS2 game files via
[MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons). Counter-Strike is a trademark of Valve.
This project is not affiliated with Valve.
