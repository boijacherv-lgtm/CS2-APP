// A quick look at the coach on the CS2 sample: team-harm marks after a round is decided, grenade-in-hand deaths.
//   npx vite-node tools/check-sample.ts
import fs from 'node:fs';
import zlib from 'node:zlib';
import { getEngine } from '../src/map/catalog';
import { buildReplay, reviewRound, type DemoData } from '../src/engine/recap';

const d = JSON.parse(zlib.gunzipSync(fs.readFileSync('public/samples/cs2-mirage.json.gz')).toString()) as DemoData;
const e = getEngine(d.map, 0);
let harm = 0, late = 0, nades = 0, nadeOk = 0, decidedCards = 0;
d.rounds.forEach((r, i) => {
  const rv = reviewRound(e, buildReplay(e, d, i, { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } }));
  const sideOf = (id: string) => r.frames.players[id]?.side;
  const lastEnemyDeath = (side: string) => { const ks = r.kills.filter(k => sideOf(k.victim) && sideOf(k.victim) !== side); const n = Object.values(r.frames.players).filter(p => p.side !== side).length; return ks.length >= n ? ks[ks.length - 1].t : Infinity; };
  for (const m of rv.moves) {
    if (m.why[0] === 'Round already decided.') decidedCards++;
    if (m.tags.some(t => t === 'TEAM FLASH' || t === 'WASTED' || t === 'TEAM DAMAGE')) { harm++; if (m.t > lastEnemyDeath(m.side)) { late++; console.log(`R${r.n} ${m.t.toFixed(1)} ${m.title} after the last enemy died`); } }
    if (m.tags.includes('NADE IN HAND')) {
      nades++;
      const f = r.frames.players[m.player], ft = r.frames.t; let k = 0; while (k < ft.length - 1 && ft[k + 1] <= m.t - 0.2) k++;
      if (/flashbang|hegrenade|smokegrenade|molotov|incgrenade|decoy/.test(f.w?.[k] ?? '')) nadeOk++; else console.log(`R${r.n} ${m.t.toFixed(1)} NADE IN HAND but ${f.w?.[k]}`);
    }
  }
});
console.log({ harmMarks: harm, afterLastEnemy: late, decidedCards, nadeInHand: nades, nadeInHandChecked: nadeOk });
