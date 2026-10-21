import type { FeatureId } from './coach';
import REMARKS from './coach-remarks.json';
import type { Move, Tag } from './recap';

/**
 * Rage mode: the coach losing it at your plays, the way a teammate would on voice ("why the fuck did you go there?").
 * Opt-in (Settings / the Rage switch in Review), 18+. It swears at the play, never at who the player is: no insults
 * about identity, nothing about the person outside the game. The grade and the reasons don't change; this is one
 * extra line on the card, picked from the move's tags, and the same move always gets the same line. The lines are in
 * coach-remarks.json (edit them there).
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
  ['knifeOut', m => m.tags.includes('KNIFE OUT') && !m.tags.includes('OUTGUNNED')],
  ['whiff', m => m.tags.includes('WHIFF')],
  ['awpLost', m => m.tags.includes('AWP LOST')],
  ['unusedUtil', m => m.tags.includes('UNUSED UTIL')],
  ['dryPeek', m => m.tags.includes('DRY PEEK') || m.tags.includes('BAD PEEK')],
  ['lowHp', m => m.kind === 'death' && m.tags.includes('LOW HP')],
  ['loud', m => m.kind === 'death' && m.tags.includes('LOUD')],
  ['movingShot', m => m.kind === 'death' && m.tags.includes('MOVING SHOT')],
  ['noAmmo', m => m.kind === 'death' && m.tags.includes('NO AMMO')],
  ['openingDeath', m => m.kind === 'death' && m.tags.includes('OPENING') && m.note !== 'book'],
  ['isolated', m => m.kind === 'death' && m.tags.includes('ISOLATED') && m.note !== 'book'],
  ['wasted', m => m.tags.includes('WASTED')],
  ['lateRotation', m => m.tags.includes('LATE ROTATION')],
  ['overRotation', m => m.tags.includes('OVER-ROTATION')],
  ['badPosition', m => m.kind === 'position' && (m.note === '??' || m.note === '?')],
  ['inaccuracy', m => m.kind === 'position' && m.note === '?!'],
  // the good ones: grudging
  ['brilliant', m => m.note === '!!'],
  ['good', m => m.note === '!'],
  // anything else that cost the team
  ['blunder', m => m.note === '??'],
  ['mistake', m => m.note === '?'],
];

/** Same move, same line (a stable pick from the move's time and player). */
function pick(lines: string[], m: Move) {
  let h = 0;
  for (const c of `${m.t}|${m.player}|${m.kind}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  return lines[Math.abs(h) % lines.length];
}

/** The coach's rant about one move, or null for a plain, expected move. */
export function rageLine(m: Move): string | null {
  if (m.note === 'book' && !m.tags.some(t => (['NO TRADE', 'WASTED', 'TEAM FLASH'] as Tag[]).includes(t))) return null;
  const rule = WHEN.find(([, when]) => when(m));
  const lines = rule ? REMARKS.rage.moves[rule[0]].lines : [];
  return lines.length ? pick(lines, m) : null;
}

/** The match coach's main point, shouted: one line per thing to work on (coach-remarks.json, rage.summary). */
export function rageSummary(feature: FeatureId | null, side = false): string {
  const S = REMARKS.rage.summary as Record<string, string>;
  return (side ? S.side : feature ? S[feature] : null) ?? S.none;
}
