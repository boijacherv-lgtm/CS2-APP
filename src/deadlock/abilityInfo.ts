/**
 * Everything the coach knows about a hero's four abilities: what each does (abilityBook.ts, and ultBook.ts for the
 * ultimate) with the game's current numbers and three upgrade tiers (tools/dl-abilities.ts → generated/abilities.json).
 */
import ABILITIES from './generated/abilities.json';
import { heroOf } from './data';
import { ABILITY_BOOK, type AbilityEntry } from './abilityBook';
import { ULT_BOOK, type UltEntry } from './ultBook';

export interface AbilityInfo {
  slot: number; name: string; ult: boolean; cd: number; img: string | null;
  /** the game's own text, its main numbers, and each upgrade tier's changes */ text: string; numbers: string[]; tiers: string[][];
  /** what it does in plain words (null when it isn't in the books yet) */ book: (AbilityEntry | (UltEntry & { unsure?: boolean })) | null;
}
type Generated = Omit<AbilityInfo, 'book'>;
const DATA = ABILITIES as unknown as Record<string, Generated[]>;

/** A hero's four abilities, in their slots (empty when the data doesn't have the hero). */
export function abilitiesOf(hero: number): AbilityInfo[] {
  const name = heroOf(hero).name;
  return (DATA[hero] ?? []).map(a => ({ ...a, book: a.ult ? ULT_BOOK[name] ?? null : ABILITY_BOOK[name]?.[a.slot - 1] ?? null }));
}
