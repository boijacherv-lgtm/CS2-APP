// Learns where good players (e.g. FACEIT level 10) stand and why they move, from a folder of their demos:
//   spots   per map, side and phase of the round: the callouts they hold, their share of the time, and how often
//           that side then won the round
//   moves   from one callout to another, how often, and what had just happened (a teammate died there, an enemy
//           was seen, the bomb went down): the "why" behind rotations and fall-backs
// Writes src/map/generated/positions.json, which the Review's "Pro positions" layer and the coach read.
//
//   npm run learn:positions -- <folder> [--map de_dust2]
//
// Each demo's decisions are cached in <folder>/.stratboard-positions-cache.json; adding demos later only reads the new ones.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadDemo, positionsFromDemo, POSITIONS_V } from './learn-lib';
import { getEngine, MAPS } from '../src/map/catalog';
import { equipValue, type DemoData } from '../src/engine/recap';
import { worldToRadar } from '../src/engine/coords';
import { roundWinChance } from '../src/engine/winprob';
import { isDecision, PHASES, roundDecisions, type Hold, type Move, type Phase } from '../src/engine/situations';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const only = opt('map');
if (!folder || !fs.existsSync(folder)) { console.error('Usage: npm run learn:positions -- <folder with demos> [--map de_dust2]'); process.exit(1); }
const OUT = path.resolve(import.meta.dirname, '../src/map/generated/positions.json');
const CACHE = path.join(folder, '.stratboard-positions-cache.json');
const CACHE_V = POSITIONS_V;

type Round = { winner: 'CT' | 'T' | null; holds: Hold[]; moves: Move[] };
type Cached = { map: string | null; rounds: Round[]; error?: string };
const stored = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const cache: Record<string, Cached> = stored.v === CACHE_V ? stored.demos : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify({ v: CACHE_V, demos: cache }));

// the map of each demo is cheap to read from the spots cache when it's there, so --map can skip the others
const spotsCache = fs.existsSync(path.join(folder, '.stratboard-spots-cache.json'))
  ? JSON.parse(fs.readFileSync(path.join(folder, '.stratboard-spots-cache.json'), 'utf8')) as Record<string, { map: string | null }> : {};

const files = fs.readdirSync(folder).filter(f => /\.dem(\.gz|\.zst)?$/i.test(f)).sort();
const keyOf = (f: string) => `${f.replace(/ \(\d+\)(?=\.dem)/, '')}|${fs.statSync(path.join(folder, f)).size}`;
const seen = new Set<string>();

const read = (f: string): Cached => positionsFromDemo(loadDemo(folder, f));

const t0 = Date.now();
files.forEach((f, i) => {
  const key = keyOf(f);
  if (seen.has(key)) return;
  seen.add(key);
  // read again what failed for a reason other than a broken file
  if (cache[key] && !(cache[key].error && !/MalformedMessage/.test(cache[key].error!))) return;
  if (only && spotsCache[key]?.map && spotsCache[key].map !== only) return;
  const t = Date.now();
  try { cache[key] = read(f); } catch (e) { cache[key] = { map: null, rounds: [], error: e instanceof Error ? e.message : String(e) }; }
  const c = cache[key];
  console.log(`[${i + 1}/${files.length}] ${f}  ${c.error ? `skipped: ${c.error}` : `${c.map}, ${c.rounds.length} rounds`}  ${((Date.now() - t) / 1000).toFixed(0)} s`);
  save();
});

// ---- learn -------------------------------------------------------------------------------------------
/**
 * `gain` = how much a choice changed the round for the players who made it: the average of (round won − the
 * side's win chance when they chose it), shrunk toward 0 by SHRINK virtual neutral examples so a handful of lucky
 * rounds can't look brilliant; `n` = how many choices it's measured on. This is what the "best move" ranks by.
 */
type SpotStat = { place: string; share: number; winRate: number; rounds: number; gain?: number; n?: number };
type MoveStat = { from: string; to: string; count: number; phases: Partial<Record<Phase, number>>; triggers: { why: string; n: number }[]; gain?: number };
type Reaction = { from: string; trigger: string; phase?: Phase; n: number; to: { place: string; n: number; gain?: number }[] };
const SHRINK = 20;
const gainOf = (diffs: number[]) => (diffs.length ? +(diffs.reduce((a, b) => a + b, 0) / (diffs.length + SHRINK)).toFixed(3) : undefined);
type MapStats = {
  demos: number; rounds: number;
  spots: Record<'CT' | 'T', Partial<Record<Phase, SpotStat[]>>>;
  /** The same per situation: `${phase}|${even|up|down}` (players alive, theirs vs the other side's). */
  situations: Record<'CT' | 'T', Record<string, SpotStat[]>>;
  moves: Record<'CT' | 'T', MoveStat[]>;
  /** Where they went from a spot right after a trigger (a teammate died at X, an enemy was seen at Y…). */
  reactions: Record<'CT' | 'T', Reaction[]>;
  /**
   * How holding a spot goes, per `${place}|${pressure 0/1/2}|${alone|team}`: how many such holds, how often the player
   * died there, fell back / moved, and where to; how often the side won the round.
   */
  risks: Record<'CT' | 'T', Record<string, Risk>>;
};
type Risk = { n: number; died: number; moved: number; won: number; to: { place: string; n: number }[] };
const riskKey = (place: string, pressure: number, alone: boolean) => `${place}|${Math.min(2, pressure)}|${alone ? "alone" : "team"}`;
const advOf = (alive: [number, number]) => (alive[0] > alive[1] ? 'up' : alive[0] < alive[1] ? 'down' : 'even');
const out: Record<string, MapStats> = {};

const byMap = new Map<string, Cached[]>();
for (const [k, c] of Object.entries(cache)) if (seen.has(k) && c.map && c.rounds.length) byMap.set(c.map, [...(byMap.get(c.map) ?? []), c]);
// leave out what isn't a decision (standing in spawn at the start of the round) and moves out of it
for (const demos of byMap.values())
  for (const d of demos)
    for (const r of d.rounds) {
      r.holds = r.holds.filter(isDecision);
      r.moves = r.moves.filter(m => isDecision({ place: m.from, from: m.t }));
    }
for (const [map, demos] of byMap) {
  if (only && map !== only) continue;
  const rounds = demos.flatMap(d => d.rounds);
  const stats: MapStats = { demos: demos.length, rounds: rounds.length, spots: { CT: {}, T: {} }, situations: { CT: {}, T: {} }, moves: { CT: [], T: [] }, reactions: { CT: [], T: [] }, risks: { CT: {}, T: {} } };
  /** Each callout's share of a group of holds, with the rounds it appeared in and how often the side won those. */
  const spotStats = (side: 'CT' | 'T', keep: (h: Hold) => boolean): SpotStat[] => {
    const secs = new Map<string, number>(), inRounds = new Map<string, Set<number>>(), diffs = new Map<string, number[]>();
    let total = 0;
    rounds.forEach((r, ri) => {
      for (const h of r.holds) {
        if (h.side !== side || !keep(h)) continue;
        if (h.ev !== undefined && r.winner) diffs.set(h.place, [...(diffs.get(h.place) ?? []), (r.winner === side ? 1 : 0) - h.ev]);
        const d = h.to - h.from;
        secs.set(h.place, (secs.get(h.place) ?? 0) + d);
        total += d;
        inRounds.set(h.place, (inRounds.get(h.place) ?? new Set()).add(ri));
      }
    });
    return [...secs]
      .map(([place, sec]) => {
        const rs = [...inRounds.get(place)!];
        const df = diffs.get(place) ?? [];
        return { place, share: +(sec / (total || 1)).toFixed(3), rounds: rs.length, winRate: +(rs.filter(ri => rounds[ri].winner === side).length / rs.length).toFixed(2), gain: gainOf(df), n: df.length };
      })
      .filter(x => x.share >= 0.01 && x.rounds >= 2)
      .sort((a, b) => b.share - a.share);
  };
  for (const side of ['CT', 'T'] as const) {
    for (const phase of PHASES) {
      stats.spots[side][phase] = spotStats(side, h => h.phase === phase);
      for (const adv of ['even', 'up', 'down'] as const) {
        const list = spotStats(side, h => h.phase === phase && advOf(h.alive) === adv);
        if (list.length) stats.situations[side][`${phase}|${adv}`] = list;
        // after the plant it matters which site the bomb is on
        if (phase === 'post-plant')
          for (const site of ['A', 'B'] as const) {
            const bySite = spotStats(side, h => h.phase === phase && h.site === site && advOf(h.alive) === adv);
            if (bySite.length) stats.situations[side][`${phase}|${adv}|${site}`] = bySite;
            const any = spotStats(side, h => h.phase === phase && h.site === site);
            if (any.length) stats.situations[side][`${phase}|any|${site}`] = any;
          }
        // Ts before the plant: it matters which site the team is going for
        if (side === 'T' && phase !== 'post-plant')
          for (const target of ['A', 'B'] as const) {
            const list2 = spotStats(side, h => h.phase === phase && h.target === target && advOf(h.alive) === adv);
            if (list2.length) stats.situations[side][`${phase}|${adv}|go${target}`] = list2;
          }
      }
    }
    // how holding each spot goes, by pressure and support
    const risks = new Map<string, Risk>();
    rounds.forEach(r => {
      const sorted = r.holds.filter(h => h.side === side);
      for (const h of sorted) {
        const k = riskKey(h.place, h.pressure ?? 0, !!h.alone);
        const x = risks.get(k) ?? { n: 0, died: 0, moved: 0, won: 0, to: [] };
        x.n++;
        if (h.ended === 'died') x.died++;
        if (h.ended === 'moved') {
          x.moved++;
          const next = r.holds.filter(o => o.player === h.player && o.from > h.from).sort((a, b) => a.from - b.from)[0];
          if (next) { const d = x.to.find(y => y.place === next.place); if (d) d.n++; else x.to.push({ place: next.place, n: 1 }); }
        }
        if (r.winner === side) x.won++;
        risks.set(k, x);
      }
    });
    for (const [k, x] of risks) if (x.n >= 5) stats.risks[side][k] = { ...x, to: x.to.sort((a, b) => b.n - a.n).slice(0, 3) };
    const mv = new Map<string, MoveStat & { why: Map<string, number> }>();
    const moveDiffs = new Map<string, number[]>(), reactDiffs = new Map<string, number[]>();
    const won = (r: { winner: 'CT' | 'T' | null }) => (r.winner === side ? 1 : 0);
    for (const r of rounds)
      for (const m of r.moves) {
        if (m.side !== side) continue;
        const key = `${m.from}→${m.to}`;
        if (m.ev !== undefined && r.winner) moveDiffs.set(key, [...(moveDiffs.get(key) ?? []), won(r) - m.ev]);
        if (m.ev !== undefined && r.winner && m.trigger)
          for (const ph of ['', m.phase]) { const rk = `${m.from}|${m.trigger}|${ph}|${m.to}`; reactDiffs.set(rk, [...(reactDiffs.get(rk) ?? []), won(r) - m.ev]); }
        const x = mv.get(key) ?? { from: m.from, to: m.to, count: 0, phases: {}, triggers: [], why: new Map() };
        x.count++;
        x.phases[m.phase] = (x.phases[m.phase] ?? 0) + 1;
        const w = m.trigger ?? 'nothing visible';
        x.why.set(w, (x.why.get(w) ?? 0) + 1);
        mv.set(key, x);
      }
    const re = new Map<string, Reaction>();
    for (const r of rounds)
      for (const m of r.moves) {
        if (m.side !== side || !m.trigger) continue;
        // the same trigger means something else before and after the plant: keep both the phase's and the overall view
        for (const phase of [undefined, m.phase]) {
          const key = `${m.from}|${m.trigger}|${phase ?? ''}`;
          const x = re.get(key) ?? { from: m.from, trigger: m.trigger, n: 0, to: [], ...(phase ? { phase } : {}) };
          x.n++;
          const d = x.to.find(y => y.place === m.to);
          if (d) d.n++; else x.to.push({ place: m.to, n: 1 });
          re.set(key, x);
        }
      }
    stats.reactions[side] = [...re.values()].filter(x => x.n >= 3)
      .map(x => ({ ...x, to: x.to.sort((a, b) => b.n - a.n).slice(0, 8).map(d => ({ ...d, gain: gainOf(reactDiffs.get(`${x.from}|${x.trigger}|${x.phase ?? ''}|${d.place}`) ?? []) })) }))
      .sort((a, b) => b.n - a.n);
    stats.moves[side] = [...mv.values()].filter(x => x.count >= 2).sort((a, b) => b.count - a.count).slice(0, 400)
      .map(({ why, ...x }) => ({ ...x, gain: gainOf(moveDiffs.get(`${x.from}→${x.to}`) ?? []), triggers: [...why].map(([w, n]) => ({ why: w, n })).sort((a, b) => b.n - a.n).slice(0, 4) }));
  }
  out[map] = stats;
}

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
fs.writeFileSync(OUT, JSON.stringify({ ...prev, ...out }, null, 1) + '\n');
for (const [map, s] of Object.entries(out)) {
  console.log(`\n${map}: ${s.demos} demos, ${s.rounds} rounds`);
  for (const side of ['CT', 'T'] as const) {
    const early = s.spots[side].early ?? [];
    console.log(`  ${side} early: ${early.slice(0, 6).map(x => `${x.place} ${Math.round(x.share * 100)}% (wins ${Math.round(x.winRate * 100)}%)`).join(', ')}`);
    for (const m of s.moves[side].slice(0, 4)) console.log(`  ${side} ${m.from} → ${m.to}: ${m.count}×, mostly after "${m.triggers[0]?.why}"`);
  }
}
console.log(`\nSaved ${path.relative(process.cwd(), OUT)} in ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

// calibrate the positioning engine on these same decisions (a separate process, so it reads the new positions.json)
try { execFileSync('npx', ['vite-node', path.join(import.meta.dirname, 'calibrate-engine.ts'), folder], { stdio: 'inherit' }); }
catch { console.error('Calibration failed: run npm run calibrate:engine -- <folder> by hand.'); }
