/**
 * A small neural network for the play model: dense features plus a learned embedding of the map spot (one per
 * map, side and callout), two hidden ReLU layers, softmax over the actions. Trained offline with mini-batch Adam
 * (tools/learn-analyst.ts); the weights ship as JSON and run in the browser (a few thousand multiply-adds a moment).
 */
export interface Mlp {
  /** spot key ("de_mirage|T|Window") → row of `emb`; unknown spots use the average row. */
  vocab: Record<string, number>;
  emb: number[][];
  w1: number[][]; b1: number[];
  w2: number[][]; b2: number[];
  w3: number[][]; b3: number[];
  /** The dense features' mean and spread (inputs are standardized). */
  mu: number[]; sd: number[];
}

const relu = (v: number) => (v > 0 ? v : 0);
function layer(x: number[], w: number[][], b: number[], act: boolean): number[] {
  const out = new Array(b.length);
  for (let j = 0; j < b.length; j++) {
    let z = b[j];
    const wj = w[j];
    for (let i = 0; i < x.length; i++) z += wj[i] * x[i];
    out[j] = act ? relu(z) : z;
  }
  return out;
}
const softmax = (z: number[]) => { const m = Math.max(...z); const e = z.map(v => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map(v => v / s); };

const avgRow = new WeakMap<Mlp, number[]>();
function embOf(net: Mlp, spot: string | undefined): number[] {
  const i = spot !== undefined ? net.vocab[spot] : undefined;
  if (i !== undefined) return net.emb[i];
  let a = avgRow.get(net);
  if (!a) { a = net.emb[0].map((_, k) => net.emb.reduce((s, r) => s + r[k], 0) / net.emb.length); avgRow.set(net, a); }
  return a;
}
export function mlpInput(net: Pick<Mlp, 'mu' | 'sd'>, f: number[], e: number[]): number[] {
  return [...f.map((v, i) => (v - net.mu[i]) / (net.sd[i] || 1)), ...e];
}
/** Action probabilities for one moment. */
export function mlpPredict(net: Mlp, f: number[], spot?: string): number[] {
  const x = mlpInput(net, f, embOf(net, spot));
  return softmax(layer(layer(layer(x, net.w1, net.b1, true), net.w2, net.b2, true), net.w3, net.b3, false));
}

// ---- training ---------------------------------------------------------------------------------------------
/** A deterministic random number generator (so a training run can be repeated). */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export interface TrainSet { x: number[][]; spot: string[]; y: number[] }
export interface MlpOptions { classes: number; embDim?: number; h1?: number; h2?: number; epochs?: number; batch?: number; lr?: number; l2?: number; minSpot?: number; seed?: number; log?: (s: string) => void }

/** Trains the network; `test` (held out) picks the best epoch and is reported. */
export function trainMlp(train: TrainSet, test: TrainSet, o: MlpOptions): { net: Mlp; testLoss: number; testAcc: number } {
  const K = o.classes, E = o.embDim ?? 8, H1 = o.h1 ?? 48, H2 = o.h2 ?? 24, EP = o.epochs ?? 8, B = o.batch ?? 256, LR = o.lr ?? 0.002, L2 = o.l2 ?? 1e-5;
  const rand = rng(o.seed ?? 7), gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const D = train.x[0].length, IN = D + E;
  // spots seen often enough get their own embedding; the rest share the average
  const counts = new Map<string, number>();
  for (const s of train.spot) counts.set(s, (counts.get(s) ?? 0) + 1);
  const vocab: Record<string, number> = {};
  for (const [s, n] of counts) if (n >= (o.minSpot ?? 40)) vocab[s] = Object.keys(vocab).length;
  const V = Math.max(1, Object.keys(vocab).length);
  const mu = Array.from({ length: D }, (_, i) => train.x.reduce((a, r) => a + r[i], 0) / train.x.length);
  const sd = Array.from({ length: D }, (_, i) => Math.sqrt(train.x.reduce((a, r) => a + (r[i] - mu[i]) ** 2, 0) / train.x.length) || 1);
  const init = (rows: number, cols: number, scale: number) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => gauss() * scale));
  const net: Mlp = {
    vocab, emb: init(V, E, 0.1),
    w1: init(H1, IN, Math.sqrt(2 / IN)), b1: new Array(H1).fill(0),
    w2: init(H2, H1, Math.sqrt(2 / H1)), b2: new Array(H2).fill(0),
    w3: init(K, H2, Math.sqrt(1 / H2)), b3: new Array(K).fill(0),
    mu, sd,
  };
  // Adam state for each parameter array
  const zeros = (m: number[][]) => m.map(r => r.map(() => 0));
  const st = { m: { emb: zeros(net.emb), w1: zeros(net.w1), b1: net.b1.map(() => 0), w2: zeros(net.w2), b2: net.b2.map(() => 0), w3: zeros(net.w3), b3: net.b3.map(() => 0) }, v: { emb: zeros(net.emb), w1: zeros(net.w1), b1: net.b1.map(() => 0), w2: zeros(net.w2), b2: net.b2.map(() => 0), w3: zeros(net.w3), b3: net.b3.map(() => 0) } };
  let step = 0;
  const adam = (p: number[], g: number[], m: number[], v: number[]) => {
    const c1 = 1 - 0.9 ** step, c2 = 1 - 0.999 ** step;
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] + L2 * p[i];
      m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi;
      p[i] -= (LR * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + 1e-8);
    }
  };
  const evalSet = (set: TrainSet) => {
    let loss = 0, hit = 0;
    for (let i = 0; i < set.x.length; i++) {
      const p = mlpPredict(net, set.x[i], set.spot[i]);
      loss -= Math.log(Math.max(1e-7, p[set.y[i]]));
      if (p.indexOf(Math.max(...p)) === set.y[i]) hit++;
    }
    return { loss: loss / set.x.length, acc: hit / set.x.length };
  };
  const order = train.x.map((_, i) => i);
  let best = { loss: Infinity, acc: 0, snap: '' };
  for (let ep = 0; ep < EP; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let b0 = 0; b0 < order.length; b0 += B) {
      step++;
      const gw1 = zeros(net.w1), gb1 = net.b1.map(() => 0), gw2 = zeros(net.w2), gb2 = net.b2.map(() => 0), gw3 = zeros(net.w3), gb3 = net.b3.map(() => 0);
      const gemb = new Map<number, number[]>();
      const idx = order.slice(b0, b0 + B), n = idx.length;
      for (const s of idx) {
        const vi = vocab[train.spot[s]];
        const e = vi !== undefined ? net.emb[vi] : embOf(net, undefined);
        const x = mlpInput(net, train.x[s], e);
        const z1 = net.b1.map((b, j) => b + net.w1[j].reduce((a, w, k) => a + w * x[k], 0)), a1 = z1.map(relu);
        const z2 = net.b2.map((b, j) => b + net.w2[j].reduce((a, w, k) => a + w * a1[k], 0)), a2 = z2.map(relu);
        const p = softmax(net.b3.map((b, j) => b + net.w3[j].reduce((a, w, k) => a + w * a2[k], 0)));
        // backward
        const d3 = p.map((v, j) => (v - (j === train.y[s] ? 1 : 0)) / n);
        const d2 = new Array(H2).fill(0);
        for (let j = 0; j < K; j++) { gb3[j] += d3[j]; for (let k = 0; k < H2; k++) { gw3[j][k] += d3[j] * a2[k]; d2[k] += d3[j] * net.w3[j][k]; } }
        for (let k = 0; k < H2; k++) if (z2[k] <= 0) d2[k] = 0;
        const d1 = new Array(H1).fill(0);
        for (let j = 0; j < H2; j++) { if (!d2[j]) continue; gb2[j] += d2[j]; for (let k = 0; k < H1; k++) { gw2[j][k] += d2[j] * a1[k]; d1[k] += d2[j] * net.w2[j][k]; } }
        for (let k = 0; k < H1; k++) if (z1[k] <= 0) d1[k] = 0;
        const dx = new Array(IN).fill(0);
        for (let j = 0; j < H1; j++) { if (!d1[j]) continue; gb1[j] += d1[j]; for (let k = 0; k < IN; k++) { gw1[j][k] += d1[j] * x[k]; dx[k] += d1[j] * net.w1[j][k]; } }
        if (vi !== undefined) { const g = gemb.get(vi) ?? new Array(E).fill(0); for (let k = 0; k < E; k++) g[k] += dx[D + k]; gemb.set(vi, g); }
      }
      for (let j = 0; j < H1; j++) adam(net.w1[j], gw1[j], st.m.w1[j], st.v.w1[j]);
      adam(net.b1, gb1, st.m.b1, st.v.b1);
      for (let j = 0; j < H2; j++) adam(net.w2[j], gw2[j], st.m.w2[j], st.v.w2[j]);
      adam(net.b2, gb2, st.m.b2, st.v.b2);
      for (let j = 0; j < K; j++) adam(net.w3[j], gw3[j], st.m.w3[j], st.v.w3[j]);
      adam(net.b3, gb3, st.m.b3, st.v.b3);
      for (const [vi, g] of gemb) adam(net.emb[vi], g, st.m.emb[vi], st.v.emb[vi]);
    }
    avgRow.delete(net);
    const r = evalSet(test);
    o.log?.(`  epoch ${ep + 1}/${EP}: unseen demos ${Math.round(r.acc * 100)}% right, log loss ${r.loss.toFixed(4)}`);
    if (r.loss < best.loss) best = { loss: r.loss, acc: r.acc, snap: JSON.stringify(net) };
  }
  const round = (m: number[][]) => m.map(r => r.map(v => +v.toFixed(5)));
  const out = JSON.parse(best.snap) as Mlp;
  return {
    net: { ...out, emb: round(out.emb), w1: round(out.w1), w2: round(out.w2), w3: round(out.w3), b1: out.b1.map(v => +v.toFixed(5)), b2: out.b2.map(v => +v.toFixed(5)), b3: out.b3.map(v => +v.toFixed(5)), mu: out.mu.map(v => +v.toFixed(5)), sd: out.sd.map(v => +v.toFixed(5)) },
    testLoss: +best.loss.toFixed(4), testAcc: +best.acc.toFixed(3),
  };
}
