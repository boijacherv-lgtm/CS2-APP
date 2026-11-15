import { BOUNTY_SPOTS, BUILDINGS, CAMPS, cellToMap, ITEM_ICONS, LAIRS, OBS_VISION, POWER_SPOTS, SIGHTS, TEAM_NAME, TORMENTOR_SPOTS, visionShape, type D2Team, type Pt } from './data';
import DATA from './generated/wardspots.json';

/** Where pros put their wards, from tools/dota-wards.ts: by side, part of the match and kind of ward. */
export type WardKind = 'obs' | 'sen';
export interface WardSpot { at: Pt; place: string; n: number; life: number; open: number }
export const WARD_SAMPLE = { matches: DATA.matches, days: DATA.days };
export const WARD_ICON: Record<WardKind, string> = { obs: `${ITEM_ICONS}/ward_observer.png`, sen: `${ITEM_ICONS}/ward_sentry.png` };

/** The minute each part of the match starts at, as the data was split. */
export const WARD_PHASES = [{ name: 'Laning', from: 0 }, { name: 'Mid game', from: 600 }, { name: 'Late game', from: 1500 }];
export const phaseAt = (t: number) => WARD_PHASES.reduce((p, f, i) => (t >= f.from ? i : p), 0);

/** What a player would call a part of the map, to name a spot by. */
const PLACES: { name: string; at: Pt }[] = [
  ...BUILDINGS.filter(b => b.kind === 'tower').map(b => ({ name: `${TEAM_NAME[b.team]} ${b.name}`, at: { x: b.x, y: b.y } })),
  ...LAIRS.map(([x, y], i) => ({ name: `${i ? 'Bottom' : 'Top'} Roshan lair`, at: cellToMap(x, y) })),
  ...BOUNTY_SPOTS.map(([x, y], i) => ({ name: `${i ? 'Radiant' : 'Dire'} bounty rune`, at: cellToMap(x, y) })),
  ...POWER_SPOTS.map(([x, y], i) => ({ name: `${i ? 'Bottom' : 'Top'} power rune`, at: cellToMap(x, y) })),
  ...TORMENTOR_SPOTS.map(([x, y]) => ({ name: 'Tormentor', at: cellToMap(x, y) })),
  ...SIGHTS.map(s => ({ name: s.name === 'Wisdom' ? 'Wisdom fountain' : s.name, at: s.at })),
  ...CAMPS.filter(c => c.tier === 'ancient').map(c => ({ name: 'ancient camp', at: { x: c.x, y: c.y } })),
];
/** Nearer than this (of the map's width) a spot simply is by the place; farther off, which way from it tells spots apart. */
const RIGHT_BY = 0.02;
const WAYS = ['East', 'South-east', 'South', 'South-west', 'West', 'North-west', 'North', 'North-east'];
/** A spot's name: what it's nearest to, and on which side of it. */
export function placeOf(at: Pt): string {
  let best = PLACES[0], bestD = Infinity;
  for (const p of PLACES) {
    const d = Math.hypot(p.at.x - at.x, p.at.y - at.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (bestD < RIGHT_BY) return `By ${best.name}`;
  const eighth = Math.round(Math.atan2(at.y - best.at.y, at.x - best.at.x) / (Math.PI / 4));
  return `${WAYS[(eighth + 8) % 8]} of ${best.name}`;
}

/** A ward this near a spot pros use (of the map's width) counts as on it. */
const ON_SPOT = 0.035;
/** Whether a ward stands where pros of that side put that kind of ward at that part of the match. */
export function onProSpot(team: D2Team, t: number, kind: WardKind, at: Pt): boolean {
  const phase = phaseAt(t);
  return DATA.spots.some(s => s.team === team && s.phase === phase && s.kind === kind && Math.hypot(s.x / 1000 - at.x, s.y / 1000 - at.y) < ON_SPOT);
}

/** How many spots to offer at once: more only hide each other. */
const SHOWN = 8;
/**
 * The best spots first. An observer is worth what it's used for, how long it stands and how much it can see past the trees;
 * a sentry only has to be there, so trees don't lower it.
 */
export function bestWards(team: D2Team, phase: number, kind: WardKind): WardSpot[] {
  const worth = (s: WardSpot) => s.n * s.life * (kind === 'obs' ? s.open : 1);
  return DATA.spots.filter(s => s.team === team && s.phase === phase && s.kind === kind).map(s => {
    const at = { x: s.x / 1000, y: s.y / 1000 };
    return { at, place: placeOf(at), n: s.n, life: s.life, open: visionShape(at, OBS_VISION).open };
  }).sort((a, b) => worth(b) - worth(a)).slice(0, SHOWN);
}
