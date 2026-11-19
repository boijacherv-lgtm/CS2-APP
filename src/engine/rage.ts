import type { FeatureId } from './coach';
import REMARKS from './coach-remarks.json';
import type { Move, Tag } from './recap';

/**
 * Rage mode: the coach losing it at your plays, the way a teammate would on voice ("why the fuck did you go there?").
 * Opt-in (Settings / the Rage switch in Review), 18+. It swears at the play, never at who the player is: no insults
 * about identity, nothing about the person outside the game. The grade and the reasons don't change; this is one
 * extra line on the card, picked from the move's tags, and the same move always gets the same line. The lines are in
 * coach-remarks.json (edit them there): per situation a chance and weighted lines; Mild halves the chances, no swearing.
 */
type Situation = keyof typeof REMARKS.rage.moves;
/** When each situation applies, top to bottom: the first match picks the line (the lines themselves: coach-remarks.json). */
const WHEN: [Situation, (m: Move) => boolean][] = [
  // the worst first
  ['teamKill', m => m.tags.includes('TEAM KILL')],
  ['teamFlashDied', m => m.tags.includes('TEAM FLASH') && m.note === '??'],
  ['teamFlash', m => m.tags.includes('TEAM FLASH')],
  ['ecoDeath', m => m.tags.includes('ECO DEATH')],
  ['noTrade', m => m.tags.includes('NO TRADE')],
  ['lostToBlind', m => m.kind === 'death' && m.tags.includes('BLIND SHOT')],
  ['knifeOut', m => m.tags.includes('KNIFE OUT') && !m.tags.includes('OUTGUNNED')],
  ['whiff', m => m.tags.includes('WHIFF')],
  ['awpLost', m => m.tags.includes('AWP LOST')],
  ['dryPeek', m => m.tags.includes('DRY PEEK') || m.tags.includes('BAD PEEK')],
  ['lowHp', m => m.kind === 'death' && m.tags.includes('LOW HP')],
  ['loud', m => m.kind === 'death' && m.tags.includes('LOUD')],
  ['movingShot', m => m.kind === 'death' && m.tags.includes('MOVING SHOT')],
  ['noAmmo', m => m.kind === 'death' && m.tags.includes('NO AMMO')],
  ['openingDeath', m => m.kind === 'death' && m.tags.includes('OPENING') && m.note !== 'book'],
  ['isolated', m => m.kind === 'death' && m.tags.includes('ISOLATED') && m.note !== 'book'],
  ['wallbanged', m => m.kind === 'death' && m.tags.includes('WALLBANG')],
  ['smokeSprayed', m => m.kind === 'death' && m.tags.includes('THROUGH SMOKE')],
  ['wasted', m => m.tags.includes('WASTED')],
  ['lateRotation', m => m.tags.includes('LATE ROTATION')],
  ['overRotation', m => m.tags.includes('OVER-ROTATION')],
  ['badPosition', m => m.kind === 'position' && (m.note === '??' || m.note === '?')],
  ['inaccuracy', m => m.kind === 'position' && m.note === '?!'],
  // the good ones: grudging
  ['wallbang', m => m.kind === 'kill' && m.tags.includes('WALLBANG') && m.note !== 'book'],
  ['smokeKill', m => m.kind === 'kill' && m.tags.includes('THROUGH SMOKE') && m.note !== 'book'],
  ['brilliant', m => m.note === '!!'],
  ['good', m => m.note === '!'],
  // anything else that cost the team
  ['blunder', m => m.note === '??'],
  ['mistake', m => m.note === '?'],
];

export type RageLevel = 'off' | 'mild' | 'full';
/** Lines and chances set on the dev page (Content → Rage lines), over coach-remarks.json. */
let RAGE_OVERRIDE: Record<string, Partial<Kind>> = {};
export const setRageOverride = (o: Record<string, Partial<Kind>>) => { RAGE_OVERRIDE = o ?? {}; };
/** One line as written in coach-remarks.json: a plain string (weight 2), or { text, weight } (1 rare, 2 normal, 3 common). */
type Line = string | { text: string; weight?: number };
type Kind = { chance?: number; lines: Line[] };
/** Mild mode skips these lines (and halves every chance). */
const SWEAR = /\b(fuck\w*|shit\w*|damn|ass|bitch\w*|cunt|dick\w*|piss\w*|crap)\b/i;
/** At most one line per this many seconds of a round. */
export const RAGE_GAP = 10;

/** Two stable numbers in [0, 1) from the move (same move, same roll every time). */
function rolls(m: Move): [number, number] {
  let h = 0;
  for (const c of `${m.t}|${m.player}|${m.kind}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  const a = Math.abs(h), b = Math.abs(Math.imul(h ^ (h >>> 15), 0x2c1b3c6d));
  return [(a % 10007) / 10007, (b % 10009) / 10009];
}

/** The line a move would get on its own (its situation's chance and weights), or null. */
export function rageLine(m: Move, level: RageLevel = 'full'): string | null {
  if (level === 'off') return null;
  if (m.note === 'book' && !m.tags.some(t => (['NO TRADE', 'WASTED', 'TEAM FLASH'] as Tag[]).includes(t))) return null;
  const rule = WHEN.find(([, when]) => when(m));
  if (!rule) return null;
  const kind = { ...(REMARKS.rage.moves[rule[0]] as Kind), ...(RAGE_OVERRIDE[rule[0]] ?? {}) } as Kind;
  const lines = kind.lines.map(l => (typeof l === 'string' ? { text: l, weight: 2 } : { text: l.text, weight: l.weight ?? 2 }))
    .filter(l => l.weight > 0 && (level === 'full' || !SWEAR.test(l.text)));
  const [u1, u2] = rolls(m);
  if (!lines.length || u1 >= (kind.chance ?? 1) * (level === 'mild' ? 0.5 : 1)) return null;
  let x = u2 * lines.reduce((s, l) => s + l.weight, 0);
  return (lines.find(l => (x -= l.weight) < 0) ?? lines[lines.length - 1]).text;
}

/** The lines for one round's cards, spaced: at most one per RAGE_GAP seconds (the earlier move wins). */
export function rageLines(moves: Move[], level: RageLevel): Map<Move, string> {
  const out = new Map<Move, string>();
  let last = -Infinity;
  for (const m of [...moves].sort((a, b) => a.t - b.t)) {
    if (m.t - last < RAGE_GAP) continue;
    const line = rageLine(m, level);
    if (line) { out.set(m, line); last = m.t; }
  }
  return out;
}

/** The match coach's main point, shouted: one line per thing to work on (coach-remarks.json, rage.summary). */
/** `stat`: the real number for that habit ("17% of rounds (level 10: 11%)"), put where the line says {stat}. */
export function rageSummary(feature: FeatureId | null, side = false, level: RageLevel = 'full', stat = ''): string | null {
  const S = REMARKS.rage.summary as Record<string, string>;
  const line = (side ? S.side : feature ? S[feature] : null) ?? S.none;
  const text = line.includes('{stat}') ? (stat ? line.replace('{stat}', stat) : line.replace(/\{stat\}/g, 'too many rounds')) : line;
  return level === 'off' || (level === 'mild' && SWEAR.test(text)) ? null : text;
}
