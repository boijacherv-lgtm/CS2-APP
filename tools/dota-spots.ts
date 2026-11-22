// Learns where pros stand and which wards pay off, from their replays (src/dota2/spots.ts says how the site uses it).
// For each recent pro match OpenDota has a replay address for: the replay is downloaded from Valve and read with the
// site's own reader; every 5 s each living hero's spot goes on a grid by position and stage of the match, and every
// observer is checked against where the enemy heroes really were (seconds it showed them, enemies who died in sight).
// What a match gave is kept small in tools/.cache/dota-spots/<id>.json, so a stopped run picks up where it was and
// --again rebuilds without downloading. A tenth of the matches are kept back to test on. Writes generated/spots.json
// every 10 matches, so it's usable before the end.
//
//   npx vite-node tools/dota-spots.ts [-- --matches 300 --again --shard 0/2]
import fs from 'node:fs';
import path from 'node:path';
import { matchFromOpenDota, type RawMatch } from '../src/dota2/match';
import { readReplay } from '../src/dota2/replay/parser';
import { unpackReplay } from '../src/dota2/replay/unpack';
import { cellOf, phaseAt, positionsOf, SPOT_GRID, SPOT_PHASES, SPOT_STEP, wardDid, WARD_STAGES, wardStageAt, type SpotData } from '../src/dota2/spots';
import { heroAt } from '../src/dota2/tracks';

const API = 'https://api.opendota.com/api';
const args = process.argv.slice(2).filter(a => a !== '--');
const arg = (k: string, d: number) => Number(args[args.indexOf(k) + 1]) || d;
const WANTED = arg('--matches', 300), AGAIN = args.includes('--again');
// --shard 1/2: this run takes only the matches whose ID leaves 1 over 2, so two runs side by side never read the same one
const [SHARD, SHARDS] = (args.includes("--shard") ? args[args.indexOf("--shard") + 1] : "0/1").split("/").map(Number);
const OUT = path.resolve(import.meta.dirname, '../src/dota2/generated/spots.json');
const CACHE = path.resolve(import.meta.dirname, '.cache/dota-spots');
const CELLS = SPOT_GRID * SPOT_GRID;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function get<T>(p: string): Promise<T | null> {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(API + p).catch(() => null);
    if (res?.ok) return await res.json() as T;
    if (res?.status === 404) return null;
    await sleep(res?.status === 429 ? 60000 : 4000 * (i + 1));
  }
  return null;
}

/** What one match gave: each player's position, team and cell every 5 s (-1: dead or not known); each observer's worth. */
interface Summary {
  id: number; start: number; patch: number | null;
  players: { pos: number; team: 0 | 1; cells: number[] }[];
  wards: { team: 0 | 1; t: number; x: number; y: number; seen: number; kills: number }[];
}
const file = (id: number) => path.join(CACHE, `${id}.json`);
const isTest = (id: number) => id % 10 === 0;

async function summarise(id: number): Promise<Summary | 'skip'> {
  const raw = await get<RawMatch>(`/matches/${id}`);
  if (!raw?.replay_url || raw.duration < 15 * 60 || raw.players?.length !== 10) return 'skip';
  const m = matchFromOpenDota(raw);
  if (!m.parsed) return 'skip';
  const res = await fetch(raw.replay_url).catch(() => null);
  if (!res?.ok) return 'skip';
  const tracks = readReplay(unpackReplay(new Uint8Array(await res.arrayBuffer())));
  if (tracks.heroes.length < 10) return 'skip';
  const pos = positionsOf(m);
  const players = m.players.map(p => {
    const cells: number[] = [];
    for (let t = 0; t < m.duration; t += SPOT_STEP) {
      const h = heroAt(tracks, p.hero, t);
      cells.push(h && h.hp > 0 ? cellOf(h.at, p.team) : -1);
    }
    return { pos: pos.get(p.slot) ?? 0, team: p.team, cells };
  });
  const wards = m.wards.filter(w => w.kind === 'obs' && w.until > w.t).map(w => {
    const did = wardDid(m, w, tracks);
    return { team: w.team, t: w.t, x: +w.at.x.toFixed(4), y: +w.at.y.toFixed(4), seen: +did.seen.toFixed(2), kills: did.kills };
  });
  return { id, start: m.startTime, patch: m.patch ?? null, players, wards };
}

/** Everything learned so far, from the cached matches, tested on the kept-back tenth. */
function build() {
  const all = fs.readdirSync(CACHE).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')) as Summary | { id: number; skip: true });
  const got = all.filter((s): s is Summary => !('skip' in s));
  const train = got.filter(s => !isTest(s.id)), test = got.filter(s => isTest(s.id));
  const pos = [1, 2, 3, 4, 5].map(() => SPOT_PHASES.map(() => new Array<number>(CELLS).fill(0)));
  const wards = WARD_STAGES.map(() => ({ n: new Array<number>(CELLS).fill(0), seen: new Array<number>(CELLS).fill(0), kills: new Array<number>(CELLS).fill(0) }));
  for (const s of train) {
    for (const p of s.players) {
      if (!p.pos) continue;
      p.cells.forEach((c, i) => { if (c >= 0) pos[p.pos - 1][phaseAt(i * SPOT_STEP)][c]++; });
    }
    for (const w of s.wards) {
      const c = cellOf({ x: w.x, y: w.y }, w.team), st = wards[wardStageAt(w.t)];
      if (c < 0) continue;
      st.n[c]++; st.seen[c] += w.seen; st.kills[c] += w.kills;
    }
  }
  const data: SpotData = {
    since: got.length ? new Date(Math.min(...got.map(s => s.start)) * 1000).toISOString() : '', matches: train.length, grid: SPOT_GRID,
    pos, wards: wards.map(w => ({ n: w.n, seen: w.seen.map(v => +v.toFixed(1)), kills: w.kills })),
  };
  // the test, on the kept-back matches: how much of pros' time falls in the spots called usual (aimed at 85%), and how
  // well a spot's worth (the cell and its neighbours, as the site reads it) calls what a ward there really saw
  let inUsual = 0, alive = 0;
  const usual = pos.map(byPhase => byPhase.map(cells => {
    const total = cells.reduce((a, c) => a + c, 0), order = cells.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]), out = new Array<boolean>(CELLS).fill(false);
    let acc = 0;
    for (const [c, i] of order) { if (!c || acc / total >= 0.85) break; out[i] = true; acc += c; }
    return out;
  }));
  const pairs: [number, number][] = [];
  for (const s of test) {
    for (const p of s.players) if (p.pos) p.cells.forEach((c, i) => { if (c >= 0) { alive++; if (usual[p.pos - 1][phaseAt(i * SPOT_STEP)][c]) inUsual++; } });
    for (const w of s.wards) {
      const c = cellOf({ x: w.x, y: w.y }, w.team), st = wards[wardStageAt(w.t)];
      if (c < 0) continue;
      const allN = st.n.reduce((a, b) => a + b, 0), mean = allN ? st.seen.reduce((a, b) => a + b, 0) / allN : 0;
      let n = 0, seen = 0;
      const gx = c % SPOT_GRID, gy = Math.floor(c / SPOT_GRID);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= SPOT_GRID || y >= SPOT_GRID) continue;
        const k = dx || dy ? 0.5 : 1;
        n += st.n[y * SPOT_GRID + x] * k; seen += st.seen[y * SPOT_GRID + x] * k;
      }
      pairs.push([(seen + 6 * mean) / (n + 6), w.seen]);
    }
  }
  const corr = (() => {
    if (pairs.length < 3) return 0;
    const ma = pairs.reduce((a, p) => a + p[0], 0) / pairs.length, mb = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
    let ab = 0, aa = 0, bb = 0;
    for (const [a, b] of pairs) { ab += (a - ma) * (b - mb); aa += (a - ma) ** 2; bb += (b - mb) ** 2; }
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
  })();
  data.test = { wardCorr: +corr.toFixed(3), usualShare: alive ? +(inUsual / alive).toFixed(3) : 0, wards: pairs.length };
  fs.writeFileSync(OUT, `${JSON.stringify(data)}\n`);
  return { data, test };
}

fs.mkdirSync(CACHE, { recursive: true });
const done = () => fs.readdirSync(CACHE).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')) as { skip?: true }).filter(s => !s.skip).length;
const t0 = Date.now();
if (!AGAIN) {
  let before: number | undefined, read = 0;
  outer: while (done() < WANTED) {
    const list = await get<{ match_id: number }[]>(`/proMatches${before ? `?less_than_match_id=${before}` : ''}`);
    if (!list?.length) break;
    for (const { match_id: id } of list) {
      before = id;
      if (done() >= WANTED) break outer;
      if (id % SHARDS !== SHARD || fs.existsSync(file(id))) continue;
      const started = Date.now();
      let s: Summary | 'skip';
      try { s = await summarise(id); } catch (e) { console.log(`${id}: ${(e as Error).message}`); s = 'skip'; }
      fs.writeFileSync(file(id), JSON.stringify(s === 'skip' ? { id, skip: true } : s));
      if (s === 'skip') { await sleep(1100); continue; }
      read++;
      const n = done(), per = (Date.now() - t0) / read;
      console.log(`${n}/${WANTED} match ${id}: ${s.wards.length} observers, ${((Date.now() - started) / 1000).toFixed(0)} s; about ${Math.round(((WANTED - n) * per) / 60000)} min left`);
      if (n % 10 === 0) console.log("  test so far:", build().data.test);
    }
  }
}
const { data, test } = build();
console.log(`wrote spots.json from ${data.matches} matches; tested on ${test.length}:`, data.test);
