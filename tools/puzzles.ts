// Premade puzzles from other players' matches: the engine runs over FACEIT level-10 CS2 demos (their saved reads in a
// training folder) and high-rank Deadlock matches (tools/.cache/dl-matches, from dl:play), and keeps the moments with
// one clearly best answer — the best option well ahead of the next — both mistakes (the player did something else)
// and good calls (they found it). Spread over maps and heroes. Writes src/moments/generated/puzzles.json, which the
// Puzzles page loads when you pick "Top players".
//
//   npm run puzzles -- <cs2 training folder> [--cs2 160 --dl 160 --demos 80]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { newestParsed, PARSE_V } from './learn-lib';
import type { DemoData } from '../src/engine/recap';
import { getEngine, MAPS } from '../src/map/catalog';
import { searchRound } from '../src/engine/search';
import { matchFromMetadata } from '../src/deadlock/match';
import { engineReview } from '../src/deadlock/engineReview';
import { cs2Moment, dlMoment, placeOf } from '../src/moments/build';
import type { Moment } from '../src/moments/moments';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string, d: number) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const WANT = { cs2: opt('cs2', 160), dl: opt('dl', 160) }, DEMOS = opt('demos', 80);
const OUT = path.resolve(import.meta.dirname, '../src/moments/generated/puzzles.json');
const DL_CACHE = path.resolve(import.meta.dirname, '.cache/dl-matches');

/** How far the best option is ahead of the next: the bigger, the clearer the puzzle. */
const margin = (m: Moment) => { const v = m.options.map(o => o.value).sort((a, b) => b - a); return v[0] - v[1]; };
/** Mistakes and good calls (about 7 to 3), the clearest first, at most `per` from one map or hero. */
function pick(all: Moment[], want: number, min: number, per: number): Moment[] {
  // one per moment of a match (in a fight, every player in it has the same one)
  const seen = new Set<string>();
  const ok = all.filter(m => margin(m) >= min && new Set(m.options.map(o => placeOf(o.label))).size === m.options.length)
    .sort((a, b) => margin(b) - margin(a)).filter(m => { const k = `${m.id.split('#')[0]}@${m.when}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const by = (good: boolean) => ok.filter(m => (m.played === 0) === good).sort((a, b) => margin(b) - margin(a));
  const out: Moment[] = [], count = new Map<string, number>();
  // no one answer for most of them: plant answers at most a fifth
  const isPlant = (m: Moment) => /plant/i.test(m.options[0].label), maxPlants = Math.round(want * 0.2);
  const take = (xs: Moment[], n: number) => { for (const m of xs) {
    if (n <= 0) break;
    const k = m.match;
    if ((count.get(k) ?? 0) >= per || (isPlant(m) && out.filter(isPlant).length >= maxPlants)) continue;
    count.set(k, (count.get(k) ?? 0) + 1); out.push(m); n--;
  } };
  take(by(false), Math.round(want * 0.7)); take(by(true), want - out.length);
  return out;
}
const slim = (m: Moment, who: string): Moment => ({ ...m, id: `p:${m.id}`, who, at: 0,
  dots: m.dots.map(d => ({ ...d, x: +d.x.toFixed(3), y: +d.y.toFixed(3) })), options: m.options.map(o => ({ ...o, value: +o.value.toFixed(3) })), cost: +m.cost.toFixed(3) });

// ---- CS2 ----------------------------------------------------------------------------------------------------------
const cs2: Moment[] = [];
if (folder && fs.existsSync(folder)) {
  const files = [...newestParsed(folder)].filter(([, p]) => p.v === PARSE_V).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const step = Math.max(1, Math.floor(files.length / DEMOS));
  const chosen = files.filter((_, i) => i % step === 0).slice(0, DEMOS);
  console.log(`CS2: ${files.length} demos read before; using ${chosen.length}.`);
  for (const [n, [, p]] of chosen.entries()) {
    let d: DemoData;
    try { d = JSON.parse(zlib.gunzipSync(fs.readFileSync(p.file)).toString('utf8')) as DemoData; } catch { continue; }
    if (!MAPS.some(m => m.id === d.map)) continue;
    const engine = getEngine(d.map, 0);
    // a few rounds from each demo, spread through it
    const rounds = d.rounds.map((r, i) => ({ r, i })).filter(x => x.r.winner).filter((_, k, a) => k % Math.max(1, Math.floor(a.length / 5)) === 0);
    for (const { r, i } of rounds) {
      let rs;
      try { rs = searchRound(engine, r, 4, 'flagged'); } catch { continue; }
      for (const m of rs.moments) {
        if (m.cls !== 'Best' && m.cls !== 'Mistake' && m.cls !== 'Blunder') continue;
        const x = cs2Moment(d, i, m);
        if (!x) continue;
        // the engine's known blind spot: "go plant" valued highly from across the map. A plant answer only when the
        // site is close (within 12% of the map)
        const me = x.dots.find(p => p.me), to = x.options[0].to;
        if (/plant/i.test(x.options[0].label) && (!me || !to || Math.hypot(me.x - to.x, me.y - to.y) > 0.12)) continue;
        cs2.push(x);
      }
    }
    if ((n + 1) % 10 === 0) console.log(`  ${n + 1}/${chosen.length} demos, ${cs2.length} candidates`);
  }
} else console.log('CS2: no training folder given, skipped (npm run puzzles -- <folder>).');

// ---- Deadlock -----------------------------------------------------------------------------------------------------
const dl: Moment[] = [];
const dlFiles = fs.existsSync(DL_CACHE) ? fs.readdirSync(DL_CACHE).filter(f => f.endsWith('.json.gz')).sort() : [];
const dlStep = Math.max(1, Math.floor(dlFiles.length / DEMOS));
const dlChosen = dlFiles.filter((_, i) => i % dlStep === 0).slice(0, DEMOS);
console.log(`Deadlock: ${dlFiles.length} matches cached; using ${dlChosen.length}.`);
for (const [n, f] of dlChosen.entries()) {
  let m;
  try { m = matchFromMetadata(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DL_CACHE, f))).toString())); } catch { continue; }
  for (const p of m.players) {
    let rv;
    try { rv = engineReview(m, null, p.slot); } catch { continue; }
    for (const x of [...rv.worst, ...rv.best]) {
      if (x.cls !== 'Best' && x.cls !== 'Mistake' && x.cls !== 'Blunder') continue;
      // the engine's known blind spot: backing off to base while your side has the numbers in a fight close by
      if (x.options[0].action === 'base' && x.options.some(o => o.sides && o.sides[0] > o.sides[1])) continue;
      const mm = dlMoment(m, x, p.slot);
      if (mm) dl.push(mm);
    }
  }
  if ((n + 1) % 10 === 0) console.log(`  ${n + 1}/${dlChosen.length} matches, ${dl.length} candidates`);
}

const out = {
  made: new Date().toISOString().slice(0, 10),
  cs2: pick(cs2, WANT.cs2, 0.06, 30).map(m => slim(m, 'FACEIT level 10')),
  deadlock: pick(dl, WANT.dl, 0.015, 8).map(m => slim(m, 'Phantom+ match')),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`→ ${path.relative(process.cwd(), OUT)}: ${out.cs2.length} CS2 and ${out.deadlock.length} Deadlock puzzles (${kb} KB)`);
for (const g of ['cs2', 'deadlock'] as const) {
  const xs = out[g];
  if (xs.length) console.log(`  ${g}: margin ${margin(xs[xs.length - 1]).toFixed(3)}–${margin(xs[0]).toFixed(3)}, ${xs.filter(m => m.played === 0).length} good calls`);
}
