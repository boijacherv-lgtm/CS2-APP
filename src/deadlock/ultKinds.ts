/**
 * What each Deadlock hero's ultimate does: the book written out from the game's text (ultBook.ts: who it hits, its
 * effects, what it does, when to use it, how to play against it) with the game's current numbers (tools/dl-ultkinds.ts →
 * generated/ults.json). The fight model counts the ultimates ready on each side by kind (an area stun ready is a
 * different fight from a single-target one), and the coach uses the book to judge ultimates and name them in its reasons.
 */
import ULTS from './generated/ults.json';
import { heroOf } from './data';
import { ULT_BOOK, type UltEntry } from './ultBook';

export const ULT_KINDS = ['area', 'single', 'control', 'damage', 'protect', 'escape', 'range', 'power'] as const;
export type UltKind = (typeof ULT_KINDS)[number];
export const ULT_KIND_LABEL: Record<UltKind, string> = {
  area: 'hits several', single: 'single target', control: 'stuns or locks down', damage: 'damage', protect: 'protects', escape: 'escape', range: 'long range', power: 'powers up',
};
export interface UltInfo extends UltEntry { name: string; hero: string; kinds: UltKind[]; cd: number; radius: number; range: number; stun: number; duration: number; summary: string }
type Numbers = Omit<UltInfo, keyof UltEntry | 'kinds'>;
const NUMBERS = ULTS as unknown as Record<string, Numbers>;

const CONTROL = new Set(['stun', 'pull', 'sleep', 'silence', 'fear', 'petrify', 'disable', 'knockup', 'swap']);
/** The kinds an ultimate falls in, from the book: who it hits and what it does (and its range from the numbers). */
function kindsOf(b: UltEntry, n: Numbers): UltKind[] {
  const e = new Set<string>(b.effects), k = new Set<UltKind>();
  const hurts = e.has('damage') || [...e].some(x => CONTROL.has(x));
  if (['around', 'ahead', 'spot', 'bounce', 'map'].includes(b.target) && hurts) k.add('area');
  if (b.target === 'one') k.add('single');
  if ([...e].some(x => CONTROL.has(x))) k.add('control');
  if (e.has('damage')) k.add('damage');
  if (e.has('heal') || e.has('resist') || e.has('invulnerable') || e.has('untargetable') || e.has('revive')) k.add('protect');
  if (e.has('teleport') || e.has('untargetable') || b.target === 'ally') k.add('escape');
  if (b.target === 'map' || n.range >= 35) k.add('range');
  if (e.has('buff')) k.add('power');
  return ULT_KINDS.filter(x => k.has(x));
}
const BY_HERO: Record<string, UltInfo> = {};
for (const [id, n] of Object.entries(NUMBERS)) { const b = ULT_BOOK[n.hero]; if (b) BY_HERO[id] = { ...n, ...b, kinds: kindsOf(b, n) }; }

/** A hero's ultimate (null when the data or the book doesn't have it). */
export const ultOf = (hero: number): UltInfo | null => BY_HERO[hero] ?? null;

/** Ultimates ready on a side, counted by kind (each ultimate counts once in every kind it has). */
export function ultKindCounts(heroes: number[]): Record<UltKind, number> {
  const out = Object.fromEntries(ULT_KINDS.map(k => [k, 0])) as Record<UltKind, number>;
  for (const h of heroes) for (const k of ultOf(h)?.kinds ?? []) out[k]++;
  return out;
}

/** "Storm Cloud (Seven: a growing storm that hits everyone in sight)": an ultimate in a few words, for the coach's reasons. */
export function ultWords(hero: number): string {
  const u = ultOf(hero);
  return u ? `${u.name} (${u.hero}: ${u.short})` : `${heroOf(hero).name}'s ultimate`;
}
