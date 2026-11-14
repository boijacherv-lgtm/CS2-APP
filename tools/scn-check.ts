// Scenario balance: the CT / T win chance of every scenario's start (npm run … vite-node tools/scn-check.ts)
import { getEngine, MAPS, presetsFor, tPlaysFor } from '../src/map/catalog';
import { runBatch } from '../src/engine/batch';
import type { BoardState } from '../src/engine/types';
const ctx = { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } } as BoardState['context'];
for (const m of MAPS) {
  const engine = getEngine(m.id, 0), cts = Object.keys(presetsFor(m.id, 0)).filter(n => n !== 'Empty').slice(0, 2), ts = Object.keys(tPlaysFor(m.id, 0));
  for (const [i, t] of ts.entries()) {
    const ct = cts[i % cts.length];
    const board: BoardState = { players: [...presetsFor(m.id, 0)[ct](), ...tPlaysFor(m.id, 0)[t]()], utility: [], context: ctx };
    await new Promise<void>(res => runBatch(engine, board, 60, 100, (s, done) => { if (done) { console.log(`${m.id.padEnd(12)} ${t.padEnd(22)} vs ${ct.padEnd(16)} CT ${(s.ctWin * 100).toFixed(0)}%  T ${(s.tWin * 100).toFixed(0)}%  draw ${(s.draw * 100).toFixed(0)}%`); res(); } }));
  }
}
process.exit(0);
