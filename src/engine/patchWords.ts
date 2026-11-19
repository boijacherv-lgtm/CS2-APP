/**
 * Reading patch notes, for any game: each line marked a buff, a nerf or neither from its wording and numbers, and the
 * lines summed up per hero or item. Deadlock's notes (deadlock/patches.ts) and Dota 2's (dota2/meta.ts) both use it.
 */
export type Dir = -1 | 0 | 1;
export interface PatchChange { kind: 'hero' | 'item' | 'general'; id: number | null; name: string; ability: string | null; text: string; dir: Dir }

// a number going up is bad for these (a longer cooldown is a nerf)
const LOWER_IS_BETTER = /\b(cooldown|cost|charge delay|cast time|deploy time|delay|time to spawn|spawn time|recharge|reload time|wind-?up|startup|channel time|cast delay|lockout|downtime|cast point|attack point|base attack time|respawn time)\b/i;
const UP = /\b(increased|improved|raised|faster|now also|now grants?|now gives?|added)\b/i;
const DOWN = /\b(reduced|decreased|lowered|slower|no longer|removed|now only)\b/i;
const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));
/** "15/20/25/30%": the values at each level, added up (a single number is one level). */
const levels = (s: string) => s.split('/').map(num).reduce((a, v) => a + v, 0);

/** Buff (+1), nerf (−1) or neither (0) from one line's wording and numbers. */
export function direction(text: string): Dir {
  if (/\b(fixed|bug|ui |indicator|visual|sound|vfx|description)\b/i.test(text)) return 0;
  // a bonus taken away or added (whatever the stat: a "-0.3s spawn time" bonus is still a bonus)
  if (/\bno longer (has|have|gives?|grants?|provides?)\b/i.test(text)) return -1;
  if (/\bnow also (has|have|gives?|grants?|provides?|lets?|applies)\b/i.test(text)) return 1;
  const worseUp = LOWER_IS_BETTER.test(text);
  // "from A to B", or by level "from 10/20/30 to 12/20/28": the numbers say which way it went
  const ft = text.match(/from\s+([+-]?[\d.]+(?:%?\/[+-]?[\d.]+)*)[^\d+-]*?\s+to\s+([+-]?[\d.]+(?:%?\/[+-]?[\d.]+)*)/i);
  let up: boolean | null = null;
  if (ft && Number.isFinite(levels(ft[1])) && Number.isFinite(levels(ft[2])) && levels(ft[1]) !== levels(ft[2])) up = Math.abs(levels(ft[2])) > Math.abs(levels(ft[1]));
  else if (/\b(can|will) no longer\b/i.test(text)) return -1;
  else if (UP.test(text) && !DOWN.test(text)) up = true;
  else if (DOWN.test(text) && !UP.test(text)) up = false;
  if (up === null) return 0;
  return (up !== worseUp ? 1 : -1) as Dir;
}

/** Per hero or item: how many buffs and nerfs, and the lines. */
export function tally(changes: PatchChange[], kind: 'hero' | 'item') {
  const out = new Map<number, { buffs: number; nerfs: number; lines: PatchChange[] }>();
  for (const c of changes) {
    if (c.kind !== kind || c.id === null) continue;
    const t = out.get(c.id) ?? { buffs: 0, nerfs: 0, lines: [] };
    if (c.dir > 0) t.buffs++; else if (c.dir < 0) t.nerfs++;
    t.lines.push(c);
    out.set(c.id, t);
  }
  return out;
}
/** A one-word read of a hero's or item's changes. */
export const verdict = (t: { buffs: number; nerfs: number }) =>
  t.buffs && !t.nerfs ? 'buffed' : t.nerfs && !t.buffs ? 'nerfed' : t.buffs - t.nerfs >= 2 ? 'buffed' : t.nerfs - t.buffs >= 2 ? 'nerfed' : t.buffs || t.nerfs ? 'mixed' : 'changed';
