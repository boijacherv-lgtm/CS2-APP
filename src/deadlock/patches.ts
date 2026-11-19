/**
 * Deadlock's patch notes, read and understood: deadlock-api's feed of the official forum changelog and Steam news
 * (`/v2/patches`, full text). Each line of a gameplay update ("- Graves: Move speed reduced from 7 to 6.7") becomes a
 * change to a hero, an item or the game, marked as a buff, a nerf or neither. The meta uses the newest gameplay
 * update as the start of the patch (deadlock-api's hand-kept "big days" can lag) and the buffs and nerfs to lean its
 * early read before the new patch has many games.
 */
import { DL_HEROES } from './data';
import ITEMS from './generated/items.json';


export type Dir = -1 | 0 | 1;
export interface PatchChange { kind: 'hero' | 'item' | 'general'; id: number | null; name: string; ability: string | null; text: string; dir: Dir }
export interface Patch { title: string; at: number; link: string; source: string; changes: PatchChange[]; gameplay: boolean }

/** Plain lines from the notes' HTML. */
export function textLines(html: string): string[] {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d|ul)>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean);
}

// a number going up is bad for these (a longer cooldown is a nerf)
const LOWER_IS_BETTER = /\b(cooldown|cost|charge delay|cast time|deploy time|delay|time to spawn|spawn time|recharge|reload time|wind-?up|startup|channel time|cast delay|lockout|downtime)\b/i;
const UP = /\b(increased|improved|raised|faster|now also|now grants?|now gives?|added)\b/i;
const DOWN = /\b(reduced|decreased|lowered|slower|no longer|removed|now only)\b/i;
const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));

/** Buff (+1), nerf (−1) or neither (0) from one line's wording and numbers. */
export function direction(text: string): Dir {
  if (/\b(fixed|bug|ui |indicator|visual|sound|vfx|description)\b/i.test(text)) return 0;
  // a bonus taken away or added (whatever the stat: a "-0.3s spawn time" bonus is still a bonus)
  if (/\bno longer (has|have|gives?|grants?|provides?)\b/i.test(text)) return -1;
  if (/\bnow also (has|have|gives?|grants?|provides?|lets?|applies)\b/i.test(text)) return 1;
  const worseUp = LOWER_IS_BETTER.test(text);
  // "from A to B": the numbers say which way it went
  const ft = text.match(/from\s+([+-]?[\d.]+)[^\d+-]*?\s+to\s+([+-]?[\d.]+)/i);
  let up: boolean | null = null;
  if (ft && Number.isFinite(num(ft[1])) && Number.isFinite(num(ft[2])) && num(ft[1]) !== num(ft[2])) up = Math.abs(num(ft[2])) > Math.abs(num(ft[1]));
  else if (/\b(can|will) no longer\b/i.test(text)) return -1;
  else if (UP.test(text) && !DOWN.test(text)) up = true;
  else if (DOWN.test(text) && !UP.test(text)) up = false;
  if (up === null) return 0;
  return (up !== worseUp ? 1 : -1) as Dir;
}

// names as the notes write them: ours, without "The", "&" as "and"
const HERO_NAMES = new Map<string, number>();
for (const h of DL_HEROES) for (const n of [h.name, h.name.replace(/^The\s+/i, ''), h.name.replace('&', 'and')]) HERO_NAMES.set(n.toLowerCase(), h.id);
const ITEM_NAMES = new Map((ITEMS as { id: number; name: string }[]).map(i => [i.name.toLowerCase(), i.id]));

/** The changes in one update's text: "- Name: [Ability - ]what changed", heroes and items by name, the rest general. */
export function parseChanges(lines: string[]): PatchChange[] {
  const out: PatchChange[] = [];
  for (const raw of lines) {
    if (!/^[-•*]\s*/.test(raw)) continue;
    const line = raw.replace(/^[-•*]\s*/, '');
    const m = line.match(/^([^:]{2,40}):\s*(.+)$/);
    const subject = m?.[1].trim() ?? '', rest = m?.[2].trim() ?? line;
    const heroId = HERO_NAMES.get(subject.toLowerCase()), itemId = ITEM_NAMES.get(subject.toLowerCase());
    // "Ability - change" after a hero's name
    const ab = heroId !== undefined ? rest.match(/^([^-–]{2,40})\s[-–]\s(.+)$/) : null;
    const text = ab ? ab[2] : rest;
    out.push({
      kind: heroId !== undefined ? 'hero' : itemId !== undefined ? 'item' : 'general',
      id: heroId ?? itemId ?? null, name: heroId !== undefined || itemId !== undefined ? subject : subject || 'General',
      ability: ab ? ab[1].trim() : null, text: heroId !== undefined || itemId !== undefined ? text : line, dir: direction(text),
    });
  }
  return out;
}

export type RawPatch = { title: string; pub_date: string; link: string; source: string; content: string };
/** deadlock-api's feed as updates with their changes, newest first. */
export function parsePatches(raw: RawPatch[]): Patch[] {
  return raw.map(p => {
    const changes = parseChanges(textLines(p.content ?? ''));
    // a gameplay update: several changes to heroes or items (news posts and cosmetic updates have none)
    return { title: p.title.trim(), at: Math.floor(Date.parse(p.pub_date) / 1000), link: p.link, source: p.source, changes, gameplay: changes.filter(c => c.kind !== 'general').length >= 5 };
  }).sort((a, b) => b.at - a.at);
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
