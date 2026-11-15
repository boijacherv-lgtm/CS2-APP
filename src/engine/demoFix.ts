import type { DemoData, DemoRound } from './recap';

// Small, dependency-free fixes applied to a demo when it is opened. They live apart from recap.ts so the store (which
// every page loads) does not pull the whole review engine into the front page's script.
const PLANT_SECONDS = 3.2, BOMB_TIME = 40;

/**
 * Older saved parses know when the bomb went down (`plant`) but not who planted it or where (no bomb events), so the plant
 * had no move, no bomb on the map and no card. Works the planter out as the living T who stood stillest over the plant
 * (planting takes 3.2 s standing), and puts the bomb where they stood. Rounds that already have the events are left alone.
 */
export function withPlants(data: DemoData): DemoData {
  if (!data.rounds.some(r => r.plant !== null && !(r.bomb ?? []).some(b => b.kind === 'plant'))) return data;
  return {
    ...data,
    rounds: data.rounds.map(r => {
      if (r.plant === null || (r.bomb ?? []).some(b => b.kind === 'plant')) return r;
      const T = r.frames.t, at = (t: number) => Math.max(0, Math.min(T.length - 1, T.findIndex(x => x >= t)));
      const i1 = at(r.plant), i0 = at(r.plant - PLANT_SECONDS);
      let best: { id: string; move: number; x: number; y: number } | null = null;
      for (const [id, f] of Object.entries(r.frames.players)) {
        if (f.side !== 'T' || !f.alive[i1]) continue;
        let move = 0;
        for (let i = i0 + 1; i <= i1; i++) move += Math.hypot(f.x[i] - f.x[i - 1], f.y[i] - f.y[i - 1]);
        if (!best || move < best.move) best = { id, move, x: f.x[i1], y: f.y[i1] };
      }
      if (!best) return r;
      const bomb: NonNullable<DemoData['rounds'][number]['bomb']> = [...(r.bomb ?? []), { t: r.plant, kind: 'plant', id: best.id, x: best.x, y: best.y }];
      if (/explod/i.test(r.reason) || r.reason === 'bomb_exploded') bomb.push({ t: Math.min(r.duration, r.plant + BOMB_TIME), kind: 'explode', id: best.id, x: best.x, y: best.y });
      return { ...r, bomb: bomb.sort((a, b) => a.t - b.t) };
    }),
  };
}
/** How long a round that ends in an explosion keeps playing after it, so the blast is seen (the demo's round ends at the bang). */
export const BLAST_TAIL_SECONDS = 2.5;
export function withBlastTail(data: DemoData): DemoData {
  const ends = (r: DemoRound) => (r.bomb ?? []).some(b => b.kind === 'explode' && r.duration - b.t < 1);
  if (!data.rounds.some(ends)) return data;
  return { ...data, rounds: data.rounds.map(r => (ends(r) ? { ...r, duration: r.duration + BLAST_TAIL_SECONDS } : r)) };
}
