// Every Deadlock hero's four abilities from deadlock-api's ability data (the game's own files): name, cooldown, the
// game's text, its main numbers and its three upgrade tiers in words ("+10 m Radius"). What each one does in plain
// words is written by hand in src/deadlock/abilityBook.ts (the ultimates in ultBook.ts); this keeps the numbers and tiers
// current, so a balance patch updates them on its own. Writes src/deadlock/generated/abilities.json. Run after a patch
// (after dl:assets); an ability missing from the books is listed.
//
//   npm run dl:abilities
import fs from 'node:fs';
import path from 'node:path';
import HEROES from '../src/deadlock/generated/heroes.json';
import { ABILITY_BOOK } from '../src/deadlock/abilityBook';
import { ULT_BOOK } from '../src/deadlock/ultBook';

const API = 'https://api.deadlock-api.com';
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/abilities.json');
type Prop = { value?: unknown; label?: string; postfix?: string; prefix?: string; css_class?: string };
type Ability = { class_name: string; name: string; image_webp?: string; properties?: Record<string, Prop>; description?: { desc?: string };
  upgrades?: { property_upgrades?: { name: string; bonus: unknown }[] }[] };
const res = await fetch(`${API}/v1/assets/items/by-type/ability`);
if (!res.ok) throw new Error(`deadlock-api answered ${res.status}`);
const byClass = new Map(((await res.json()) as Ability[]).map(a => [a.class_name, a]));

const plain = (html = '') => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+([.,])/g, '$1').replace(/\s+/g, ' ').trim();
const shown = (v: unknown) => String(v ?? '').replace(/m$/, '');
/** One upgrade in words: "+10 m Radius", "−4 s Cooldown". */
function upgrade(a: Ability, u: { name: string; bonus: unknown }): string | null {
  const p = a.properties?.[u.name], v = shown(u.bonus), n = parseFloat(v);
  if (!Number.isFinite(n) || n === 0) return p?.label ? `${p.label}` : null;
  const unit = p?.postfix === 'm' || String(u.bonus).endsWith('m') ? ' m' : p?.postfix === 's' ? ' s' : p?.postfix === '%' ? '%' : '';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}${unit} ${p?.label ?? u.name.replace(/([a-z])([A-Z])/g, '$1 $2')}`;
}
// the numbers worth showing next to an ability (not cast plumbing)
const SKIP = /^(AbilityCooldownBetweenCharge|AbilityResourceCost|AbilityUnitTargetLimit|ChannelMoveSpeed|TechPower|WeaponPower|AbilityPostCastDuration|.*Scale.*|.*Angle.*|.*Speed$|.*Height$|.*Interval$|.*Tick.*)$/;

const out: Record<number, { slot: number; name: string; ult: boolean; cd: number; img: string | null; text: string; numbers: string[]; tiers: string[][] }[]> = {};
const missing: string[] = [];
for (const h of HEROES as { id: number; name: string; abilities?: { cls: string; ult?: boolean }[] }[]) {
  out[h.id] = (h.abilities ?? []).map((k, i) => {
    const a = byClass.get(k.cls);
    if (!a) return null;
    if (!k.ult && !ABILITY_BOOK[h.name]?.[i]) missing.push(`${h.name}: ${a.name} (ability ${i + 1})`);
    if (k.ult && !ULT_BOOK[h.name]) missing.push(`${h.name}: ${a.name} (ultimate)`);
    const numbers = Object.entries(a.properties ?? {})
      .filter(([key, p]) => !SKIP.test(key) && p.label && !['0', '0.0', '-1', '', 'None'].includes(String(p.value ?? '')) && key !== 'AbilityCooldown')
      .slice(0, 6).map(([, p]) => `${p.label}: ${shown(p.value)}${p.postfix === 'm' ? ' m' : p.postfix === 's' ? ' s' : p.postfix ?? ''}`);
    return {
      slot: i + 1, name: a.name, ult: !!k.ult, cd: parseFloat(String(a.properties?.AbilityCooldown?.value ?? '0')) || 0, img: a.image_webp ?? null,
      text: plain(a.description?.desc), numbers,
      // one line per stat: the data can list a second (scaling) value under the same name ("+14% Fire Rate, +0.16% Fire Rate")
      tiers: (a.upgrades ?? []).slice(0, 3).map(t => {
        const seen = new Set<string>();
        return (t.property_upgrades ?? []).map(u => upgrade(a, u)).filter((x): x is string => !!x).filter(x => { const label = x.replace(/^[+−]?[\d.]+( m| s|%)? /, ''); if (seen.has(label)) return false; seen.add(label); return true; });
      }),
    };
  }).filter((x): x is NonNullable<typeof x> => !!x);
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`→ ${path.relative(process.cwd(), OUT)} (${Object.keys(out).length} heroes)`);
if (missing.length) console.log(`not in the books yet (write them in abilityBook.ts / ultBook.ts):\n  ${missing.join('\n  ')}`);
