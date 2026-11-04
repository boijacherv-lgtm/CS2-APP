// Reads each cached match's ultimates from its demo (deadlock-api's demo reader, three queries a match, ~30 s), for the
// fight model's ultimates (dl:fight). deadlock-api allows 200 demo queries an hour (3 a match): a match is first checked
// for a replay (its salts, free), and when the hour's queries are used up it waits for the next hour. Kept in
// tools/.cache/dl-ults so a match is read once (a match whose replay is gone is remembered too). Run after dl:play, before dl:fight. With --fetch N it also finds N more high-rank
// matches since the patch that have a replay (deadlock-api's salts say so: no replay key, no demo), keeps their match
// data in tools/.cache/dl-matches (where dl:fight reads them) and reads their ultimates.
//
//   npm run dl:ults [-- --matches 300] [-- --fetch 200]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { matchFromMetadata } from '../src/deadlock/match';
import { NoDemo, readUlts } from '../src/deadlock/demo';
import { gameplayPatches } from '../src/deadlock/patchFeed';

const args = process.argv.slice(2).filter(a => a !== '--');
const want = Number(args[args.indexOf('--matches') + 1]) || 300;
const fetchN = args.includes('--fetch') ? Number(args[args.indexOf('--fetch') + 1]) || 200 : 0;
const API = 'https://api.deadlock-api.com';
const MATCHES = path.resolve(import.meta.dirname, '.cache/dl-matches'), OUT = path.resolve(import.meta.dirname, '.cache/dl-ults');
const AT_ONCE = 2;
/** Whether deadlock-api has the match's replay (its salts; this doesn't count against the demo queries). */
async function hasReplay(id: number): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.deadlock-api.com/v1/matches/${id}/salts?disable_steam=true`).catch(() => null);
    if (res?.ok) return !!((await res.json()) as { replay_salt?: number | null }).replay_salt;
    if (res?.status === 404) return false;
    await sleep(3000 * (i + 1));
  }
  return false;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(MATCHES).filter(f => f.endsWith('.json.gz')).sort().reverse();
const done = () => fs.readdirSync(OUT).filter(f => f.endsWith('.json')).length;
const todo = files.filter(f => !fs.existsSync(path.join(OUT, f.replace('.json.gz', '.json')))).slice(0, Math.max(0, want - done()));
console.log(`${done()} matches read before, ${todo.length} to read`);
let next = 0, ok = 0, gone = 0, failed = 0;
const t0 = Date.now();
async function worker() {
  while (next < todo.length) {
    const f = todo[next++], out = path.join(OUT, f.replace('.json.gz', '.json'));
    const m = matchFromMetadata(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(MATCHES, f))).toString()));
    // no replay key: no demo (and no query spent finding out)
    if (!(await hasReplay(m.id))) { fs.writeFileSync(out, JSON.stringify({ ults: null })); gone++; continue; }
    for (let i = 0; ; i++) {
      try { fs.writeFileSync(out, JSON.stringify({ ults: await readUlts(m) })); ok++; break; }
      catch (e) {
        if (e instanceof NoDemo) { fs.writeFileSync(out, JSON.stringify({ ults: null })); gone++; break; }
        if (i >= 12) { failed++; console.log(`  ${m.id}: ${e instanceof Error ? e.message : e}`); break; }
        // the hour's queries are used up (or deadlock-api is busy): wait 10 minutes and try again
        if (i === 0) console.log(`  waiting for deadlock-api (${e instanceof Error ? e.message : e})`);
        await sleep(600000);
      }
    }
    if ((ok + gone + failed) % 10 === 0) console.log(`  ${ok} read, ${gone} without a demo, ${failed} failed (${Math.round((Date.now() - t0) / 60000)} min)`);
  }
}
await Promise.all(Array.from({ length: AT_ONCE }, worker));
console.log(`done: ${ok} read, ${gone} without a demo, ${failed} failed; ${done()} kept in total`);

// ---- more matches with a replay ------------------------------------------------------------------------------------------
if (fetchN) {
  const get = async <T,>(url: string): Promise<T | null> => {
    for (let i = 0; i < 6; i++) {
      const res = await fetch(API + url).catch(() => null);
      if (res?.ok) return res.json() as Promise<T>;
      if (res?.status === 404) return null;
      await sleep(3000 * (i + 1));
    }
    return null;
  };
  const patch = (await gameplayPatches())[0];
  const days = (await get<string[]>('/v1/patches/big-days')) ?? [];
  const since = Math.max(patch?.at ?? 0, Math.floor(Date.parse(days[0] ?? '') / 1000) || 0);
  const have = new Set(fs.readdirSync(MATCHES).map(f => Number(f.replace('.json.gz', ''))));
  let added = 0, maxId: number | undefined, looked = 0;
  console.log(`fetching ${fetchN} more matches with a replay (since ${new Date(since * 1000).toISOString().slice(0, 10)})`);
  while (added < fetchN) {
    const page = await get<{ match_id: number; players?: { abandon_match_time_s?: number }[] }[]>(`/v1/matches/metadata?include_player_info=true&game_mode=normal&min_average_badge=91`
      + `&min_unix_timestamp=${since}&min_duration_s=1200&order_by=match_id&order_direction=desc&limit=200${maxId ? `&max_match_id=${maxId - 1}` : ''}`);
    if (!page?.length) break;
    maxId = Math.min(...page.map(r => r.match_id));
    const fresh = page.filter(r => !have.has(r.match_id) && !(r.players ?? []).some(p => (p.abandon_match_time_s ?? 0) > 0)).map(r => r.match_id);
    let i = 0;
    const one = async () => {
      while (i < fresh.length && added < fetchN) {
        const id = fresh[i++];
        looked++;
        const salts = await get<{ replay_salt: number | null }>(`/v1/matches/${id}/salts?disable_steam=true`);
        if (!salts?.replay_salt) continue; // no replay: no demo to read
        const meta = await get<unknown>(`/v1/matches/${id}/metadata`);
        if (!meta) continue;
        const m = matchFromMetadata(meta);
        if (m.players.length !== 12) continue;
        try {
          const ults = await readUlts(m);
          fs.writeFileSync(path.join(MATCHES, `${id}.json.gz`), zlib.gzipSync(JSON.stringify(meta)));
          fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ ults }));
          have.add(id); added++;
          if (added % 10 === 0) console.log(`  ${added} added (${looked} looked at, ${Math.round((Date.now() - t0) / 60000)} min)`);
        } catch (e) { if (!(e instanceof NoDemo)) await sleep(600000); } // the hour's queries used up: wait
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, one));
  }
  console.log(`fetched: ${added} matches with their ultimates (${looked} looked at)`);
}
