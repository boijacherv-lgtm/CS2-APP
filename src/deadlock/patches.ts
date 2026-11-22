/**
 * Deadlock's patch notes, read and understood: deadlock-api's feed of the official forum changelog and Steam news
 * (`/v2/patches`, full text). Each line of a gameplay update ("- Graves: Move speed reduced from 7 to 6.7") becomes a
 * change to a hero, an item or the game, marked as a buff, a nerf or neither. The meta uses the newest gameplay
 * update as the start of the patch (deadlock-api's hand-kept "big days" can lag) and the buffs and nerfs to lean its
 * early read before the new patch has many games.
 */
import { direction, type PatchChange } from '../engine/patchWords';
import { DL_HEROES } from './data';
import ITEMS from './generated/items.json';

export { direction, tally, verdict, type Dir, type PatchChange } from '../engine/patchWords';
export interface Patch { title: string; at: number; link: string; source: string; changes: PatchChange[]; gameplay: boolean }

/** Plain lines from the notes' HTML. */
export function textLines(html: string): string[] {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d|ul)>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean);
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
