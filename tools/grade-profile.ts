// Grades one parsed match (a .json.gz from the demo bot or a match read) and writes every player's profile entry:
// the same numbers the website adds when you review a match yourself. The demo bot (server/) runs this for each new
// match and sends each site user's entry to the Worker.
//
//   node node_modules/vite-node/vite-node.mjs tools/grade-profile.ts <match.json.gz> <out.json> [--played <ms>]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { profileMatchOf } from '../src/engine/habits';
import { buildMatchReport } from '../src/engine/match';
import { gradeRounds } from '../src/engine/gradeRounds';
import type { ProfileMatch } from '../src/engine/profile';
import type { DemoData } from '../src/engine/recap';

const args = process.argv.slice(2).filter(a => a !== '--');
const [input, out] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const played = Number(args[args.indexOf('--played') + 1]) || 0;
if (!input || !out) { console.error('Usage: grade-profile.ts <match.json.gz> <out.json> [--played <ms>]'); process.exit(1); }

const raw = fs.readFileSync(input);
const data: DemoData = JSON.parse((raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw).toString('utf8'));
if (played > 0) data.playedAt = played;
const t0 = Date.now();
const rounds = gradeRounds(data);
const view = buildMatchReport(data, rounds);
const entries: Record<string, ProfileMatch> = {};
for (const p of view.players) if (p.played) entries[p.id] = profileMatchOf(data, view, p, rounds.map(r => r?.analyst));
fs.writeFileSync(out, JSON.stringify(entries));
console.log(`graded ${data.map}, ${data.rounds.length} rounds, ${Object.keys(entries).length} players in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
