// Each Deadlock hero's ultimate from deadlock-api's ability data: its name, its numbers (radius, range, stun, duration,
// cooldown) and the game's one-line text. What it does is written out by hand in src/deadlock/ultBook.ts; this keeps the
// numbers current, so a balance patch updates them on its own. Writes src/deadlock/generated/ults.json. Run after a patch
// (after dl:assets); a hero missing from ultBook.ts is listed.
//
//   npm run dl:ultkinds
import fs from 'node:fs';
import path from 'node:path';
import HEROES from '../src/deadlock/generated/heroes.json';
import { ULT_BOOK } from '../src/deadlock/ultBook';

const API = 'https://api.deadlock-api.com';
const OUT = path.resolve(import.meta.dirname, '../src/deadlock/generated/ults.json');
type Prop = { value?: unknown };
type Ability = { class_name: string; name: string; properties?: Record<string, Prop>; description?: { desc?: string }; behaviours?: string[] };
const res = await fetch(`${API}/v1/assets/items/by-type/ability`);
if (!res.ok) throw new Error(`deadlock-api answered ${res.status}`);
const byClass = new Map(((await res.json()) as Ability[]).map(a => [a.class_name, a]));

const plain = (html = '') => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** A property as a number (metres: "9m" → 9), or 0. */
const num = (a: Ability, k: string) => { const v = parseFloat(String(a.properties?.[k]?.value ?? '0')); return Number.isFinite(v) && v > 0 ? v : 0; };
const maxOf = (a: Ability, re: RegExp, skip: RegExp = /^$/) => Math.max(0, ...Object.keys(a.properties ?? {}).filter(k => re.test(k) && !skip.test(k)).map(k => num(a, k)));

const out: Record<number, { name: string; hero: string; cd: number; radius: number; range: number; stun: number; duration: number; summary: string }> = {};
for (const h of HEROES as { id: number; name: string; abilities?: { cls: string; ult?: boolean }[] }[]) {
  const cls = h.abilities?.find(a => a.ult)?.cls, a = cls ? byClass.get(cls) : undefined;
  if (!a) { console.log(`  ${h.name}: no ultimate in the data`); continue; }
  const text = plain(a.description?.desc);
  const radius = maxOf(a, /Radius|BeamLength|ConeAngle/, /RadiusMin|BallRadius|BallHitRadius|ShotRadius|BatSpawn|GroundAuraRadius|KnockupRadius|SearchRadius|ConeAngle/);
  const range = Math.max(num(a, 'AbilityCastRange'), num(a, 'Range'), num(a, 'DashRange'));
  const stun = Math.max(num(a, 'StunDuration'), num(a, 'SleepDuration'), num(a, 'PetrifyDuration'), num(a, 'SilenceDuration'), num(a, 'LiftDuration'));
  const duration = Math.min(30, Math.max(num(a, 'AbilityDuration'), num(a, 'AbilityChannelTime') < 100 ? num(a, 'AbilityChannelTime') : 0));
  if (!ULT_BOOK[h.name]) console.log(`  ${h.name}: not in ultBook.ts yet (write what ${a.name} does there)`);
  out[h.id] = { name: a.name, hero: h.name, cd: num(a, 'AbilityCooldown'), radius, range, stun, duration: +duration.toFixed(1),
    summary: (text.split(/(?<=\.)\s/)[0] ?? text).slice(0, 160) };
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const u of Object.values(out)) console.log(`${u.hero.padEnd(14)} ${u.name.padEnd(24)} cd ${u.cd} · radius ${u.radius} · range ${u.range} · stun ${u.stun} · ${u.duration} s`);
console.log(`→ ${path.relative(process.cwd(), OUT)} (${Object.keys(out).length} heroes)`);
