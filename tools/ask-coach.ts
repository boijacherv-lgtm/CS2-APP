// "Coach asks": finds the moments the coach is least sure of in level-10 matches and sends them to the dev page
// (Dev → Disputes → Coach asks), where you judge them like "Coach wrong?" moments: a 20 s clip, mark right or wrong.
// Your calls go into the same rulings, so the coach learns from them (engine/corrections.ts) and eval:verdicts checks
// them. How unsure it is of a mark (0–1), from:
//   few calls     how many calls you've made on that kind of move (its pattern: kind, mark, deciding tags); none yet
//                 is the most useful to ask about
//   near a line   for the engine's position cards: how close its loss is to the Blunder line, where it starts
//                 flagging the move: a small change and there'd be no card
//   borderline    a ?! is the coach's own "maybe"; a ?? it's surest of
// It looks through --scan matches it hasn't asked about (default 40), picks the --max most unsure (default 10), at
// most one per match and two of the same kind, and sends each with its round. --dry-run only lists them.
//
//   npm run ask:coach -- [<folder>] [--max 10] [--scan 40] [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { getEngine, MAPS } from '../src/map/catalog';
import { buildReplay, reviewRound, type Annotation, type DemoData, type Move } from '../src/engine/recap';
import { patternOf, type CorrectionTable } from '../src/engine/corrections';
import { verdictKey, type MoveVerdict } from '../src/engine/profile';
import CALIBRATION from '../src/engine/models/search-calibration.json';
import { COST_SCALE } from '../src/engine/search';
import { matchIdOf, newestParsed } from './learn-lib';
import { workerLink } from './disputes-lib';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const folder = (args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) ?? '~/Desktop/APPS/faceit-demos').replace(/^~/, os.homedir());
const MAX = Number(opt('max', '10')), SCAN = Number(opt('scan', '40')), DRY = args.includes('--dry-run');

const link = workerLink();
if (!link && !DRY) { console.error('Not linked to the site yet: run npm run link:coach first (or --dry-run to only list).'); process.exit(1); }
const get = async <T>(p: string, auth = true): Promise<T> => {
  const res = await fetch(link!.url + p, auth ? { headers: { Authorization: `Bearer ${link!.token}` } } : {});
  if (!res.ok) throw new Error(`${p}: the site said ${res.status}`);
  return res.json() as Promise<T>;
};
// what you've ruled so far (per kind of move) and what the coach already asked about
const table: CorrectionTable = link ? (await get<{ table?: CorrectionTable }>('/corrections', false).catch(() => ({ table: {} }))).table ?? {} : {};
const asked = new Set(link ? (await get<{ keys: string[] }>('/internal/asks').catch(() => ({ keys: [] as string[] }))).keys : []);

// the engine's grade lines on what a move cost (Excellent | Good | Inaccuracy | Mistake | Blunder)
const TH = (CALIBRATION as { thresholds?: number[] }).thresholds ?? [0.01, 0.03, 0.06, 0.12];
const BORDER: Partial<Record<Annotation, number>> = { '?!': 0.8, '?': 0.5, '??': 0.3 };
const FLAGS: Annotation[] = ['?!', '?', '??'];

type Ask = { id: string; d: DemoData; round: number; m: Move; pattern: string; score: number; why: string };
function unsure(m: Move): { score: number; why: string } {
  const pattern = patternOf(m.kind, m.note, m.tags);
  const calls = (table[pattern]?.wrong ?? 0) + (table[pattern]?.right ?? 0);
  const few = 1 / (1 + calls / 2);
  const reasons = [calls ? `only ${calls} call${calls === 1 ? '' : 's'} on this kind of mark so far` : 'no calls on this kind of mark yet'];
  let edge = BORDER[m.note] ?? 0;
  if (m.kind === 'position') {
    // how close the engine's loss is to the Mistake / Blunder line (the grades are cut on the raw loss; the card shows
    // it as cost = loss × COST_SCALE): within 30% of it, a small change flips the grade
    const loss = -m.gain / COST_SCALE, line = TH[3], near = 1 - Math.min(1, Math.abs(loss - line) / line / 0.3);
    if (near > 0) reasons.push(`the engine's loss is ${loss >= line ? 'just past' : 'just short of'} the Blunder line, where it starts flagging (cost ${(-m.gain * 100).toFixed(2)}%, the line ${(line * COST_SCALE * 100).toFixed(2)}%)`);
    edge = Math.max(edge, near);
  }
  if (m.note === '?!') reasons.push('a ?! is the coach\'s "maybe"');
  const why = reasons.join('; ');
  return { score: +(0.5 * few + 0.5 * edge).toFixed(3), why: why.charAt(0).toUpperCase() + why.slice(1) + '.' };
}

// matches not asked about yet, in a different order every day so each run looks at new ones
const day = new Date().toISOString().slice(0, 10);
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const askedMatches = new Set([...asked].map(k => k.split('|')[0]));
const reads = [...newestParsed(folder)].filter(([id]) => !askedMatches.has(matchIdOf(id) ?? id.slice(-60)))
  .sort((a, b) => hash(day + a[0]) - hash(day + b[0])).slice(0, SCAN);
console.log(`${reads.length} matches to look through (${asked.size} moments asked about before, ${Object.keys(table).length} kinds of mark ruled on).`);

const found: Ask[] = [];
const t0 = Date.now();
for (const [id, { file }] of reads) {
  let d: DemoData;
  try { d = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch { continue; }
  if (!MAPS.some(x => x.id === d.map)) continue;
  const e = getEngine(d.map, 0);
  d.rounds.forEach((_, i) => {
    let moves: Move[];
    try { moves = reviewRound(e, buildReplay(e, d, i, { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } })).moves; } catch { return; }
    for (const m of moves) {
      if (!FLAGS.includes(m.note)) continue;
      found.push({ id, d, round: i + 1, m, pattern: patternOf(m.kind, m.note, m.tags), ...unsure(m) });
    }
  });
  // keep only the best one per kind of mark of each match in memory (so the kinds stay varied to pick from)
  const mine = found.filter(f => f.id === id).sort((a, b) => b.score - a.score), kept = new Set<string>();
  for (const f of mine) { if (kept.has(f.pattern)) found.splice(found.indexOf(f), 1); else kept.add(f.pattern); }
}
console.log(`Looked through them in ${((Date.now() - t0) / 60000).toFixed(1)} min: ${found.length} flagged moments considered.`);

// the most unsure, one per match and two per kind of mark
const picks: Ask[] = [];
const perPattern = new Map<string, number>();
for (const f of found.sort((a, b) => b.score - a.score)) {
  if (picks.length >= MAX) break;
  if (picks.some(p => p.id === f.id) || (perPattern.get(f.pattern) ?? 0) >= 2) continue;
  picks.push(f); perPattern.set(f.pattern, (perPattern.get(f.pattern) ?? 0) + 1);
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let sent = 0;
for (const p of picks) {
  const title = p.m.title;
  console.log(`${p.score.toFixed(2)}  ${p.d.map} R${p.round} ${clock(p.m.t)}  ${p.m.note}  ${title}\n      ${p.why}`);
  if (DRY) continue;
  const verdict: MoveVerdict = {
    match: matchIdOf(p.id) ?? p.id.slice(-60), map: p.d.map, round: p.round, t: Math.round(p.m.t * 100) / 100, player: p.m.player,
    kind: p.m.kind, title: title.slice(0, 160), coach: p.m.note, verdict: 'ok', reason: 'other', note: 'Coach asks', at: Date.now(),
  };
  if (asked.has(verdictKey(verdict))) continue;
  const body = JSON.stringify({
    verdict, card: { note: p.m.note, title, why: p.m.why, tags: p.m.tags }, demo: { ...p.d, rounds: [p.d.rounds[p.round - 1]] },
    ask: { why: p.why, score: p.score },
  });
  // a few tries: the connection can go stale while the matches are looked through
  let res: Response | null = null, err = '';
  for (let tryN = 0; tryN < 3 && !res; tryN++) {
    try { res = await fetch(`${link!.url}/internal/ask`, { method: 'POST', headers: { Authorization: `Bearer ${link!.token}`, 'Content-Type': 'application/json' }, body }); }
    catch (e) { err = e instanceof Error ? e.message : String(e); await new Promise(r => setTimeout(r, 1000 * (tryN + 1))); }
  }
  if (res?.ok) sent++; else console.log(`      not sent: ${res ? `the site said ${res.status} ${(await res.text()).slice(0, 120)}` : err}`);
}
console.log(DRY ? `\n${picks.length} moments picked (dry run: nothing sent).` : `\nSent ${sent} moments: judge them in Dev → Disputes → Coach asks.`);
