// Scores the coach against a player's own verdicts on their moments (my-demos/verdicts.json): for each moment they
// explained, does the coach flag it as a mistake ("fault") or leave it alone ("ok") the way they judged it?
// A check for blind spots (context the coach is missing), not something to tune every number to: one player's
// verdicts aren't ground truth.
//
//   npm run eval:verdicts -- [~/Desktop/APPS/my-demos]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { getEngine } from '../src/map/catalog';
import { buildReplay, reviewRound, type DemoData, type Move, type Review } from '../src/engine/recap';

const dir = (process.argv.slice(2).filter(a => a !== '--')[0] ?? path.join(os.homedir(), 'Desktop/APPS/my-demos')).replace(/^~/, os.homedir());
type V = { match: string; round: number; t: number; kind: string; verdict: 'fault' | 'ok'; why: string };
const { player, moments } = JSON.parse(fs.readFileSync(path.join(dir, 'verdicts.json'), 'utf8')) as { player: string; moments: V[] };

const reviews = new Map<string, Review[]>();
function reviewsOf(code: string): Review[] {
  if (reviews.has(code)) return reviews.get(code)!;
  const f = fs.readdirSync(dir).find(x => x.includes(code) && x.endsWith('.json.gz'));
  if (!f) throw new Error(`no read of match ${code} in ${dir}`);
  const d: DemoData = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
  const e = getEngine(d.map, 0);
  const rv = d.rounds.map((_, i) => reviewRound(e, buildReplay(e, d, i, { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } })));
  reviews.set(code, rv);
  return rv;
}
const bad = (m: Move) => m.note === '?' || m.note === '??';
const near = (m: Move, t: number, w = 6) => Math.abs(m.t - t) <= w;

let right = 0;
const lines: string[] = [];
for (const v of moments) {
  const mine = reviewsOf(v.match)[v.round - 1].moves.filter(m => m.player === player);
  let flagged: boolean;
  switch (v.kind) {
    case 'death': { const d = mine.filter(m => m.kind === 'death').sort((a, b) => Math.abs(a.t - v.t) - Math.abs(b.t - v.t))[0]; flagged = !!d && bad(d); break; }
    case 'card': flagged = mine.some(m => m.kind === 'position' && near(m, v.t) && bad(m)); break;
    case 'card-opening': flagged = mine.some(m => m.kind === 'position' && m.t < 20 && bad(m)); break;
    case 'utility': flagged = mine.some(m => m.kind === 'utility' && near(m, v.t) && bad(m)); break;
    case 'utility-any': flagged = mine.some(m => m.kind === 'utility' && m.tags.includes('WASTED')); break;
    case 'notrade': flagged = mine.some(m => m.tags.includes('NO TRADE') && near(m, v.t, 8)); break;
    case 'teamflash': flagged = mine.some(m => m.tags.includes('TEAM FLASH') && near(m, v.t)); break;
    case 'teamflash-any': flagged = mine.some(m => m.tags.includes('TEAM FLASH')); break;
    case 'rotation': flagged = mine.some(m => (m.tags.includes('LATE ROTATION') || m.tags.includes('OVER-ROTATION')) && bad(m)); break;
    default: throw new Error(`unknown kind ${v.kind}`);
  }
  const ok = flagged === (v.verdict === 'fault');
  if (ok) right++;
  lines.push(`${ok ? 'ok  ' : 'MISS'} ${v.match.slice(-4)} R${v.round} ${v.kind.padEnd(13)} you: ${v.verdict.padEnd(5)} coach: ${flagged ? 'flags it' : 'leaves it'}  (${v.why})`);
}
console.log(lines.join('\n'));
console.log(`\nAgrees with your verdicts on ${right} of ${moments.length} moments (${Math.round((100 * right) / moments.length)}%).`);
