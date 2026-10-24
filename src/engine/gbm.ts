/**
 * Gradient-boosted decision trees for a yes/no outcome (logistic loss): many small trees added up, each fixing what
 * the ones before it got wrong. Unlike a logistic formula (one weight per number, added up) the trees learn
 * combinations: "2v3 with the bomb down and 25 s left" isn't "2v3" plus "bomb down" plus "25 s".
 *
 * `fitGbm` runs in the learning tools (Node); `gbmLogit` is what the site runs: a few hundred tiny trees, each a
 * handful of comparisons. No dependencies.
 */
export interface GbmModel {
  features: string[];
  /** Log-odds before any tree. */
  base: number;
  /** Each tree as flat arrays: node i splits on feature f[i] at value v[i] (x ≤ v goes to l[i], else r[i]); a leaf has f = -1 and its value in v. */
  trees: { f: number[]; v: number[]; l: number[]; r: number[] }[];
}

/** The model's log-odds for one row. */
export function gbmLogit(m: GbmModel, x: number[]): number {
  let z = m.base;
  for (const t of m.trees) {
    let i = 0;
    while (t.f[i] >= 0) i = x[t.f[i]] <= t.v[i] ? t.l[i] : t.r[i];
    z += t.v[i];
  }
  return z;
}

export interface GbmOptions {
  trees?: number; depth?: number; rate?: number; minLeaf?: number; lambda?: number; bins?: number;
  /** Share of the rows each tree sees (speed, and less overfitting). */
  sample?: number;
  /** Rows to check on after every tree: stop once they stop getting better (and keep the best count). */
  valid?: { x: number[][]; y: number[] };
  patience?: number;
  log?: (s: string) => void;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const logLoss = (p: number, y: number) => { const q = Math.min(1 - 1e-7, Math.max(1e-7, p)); return y ? -Math.log(q) : -Math.log(1 - q); };

/** Fits the trees (histogram splits on up to `bins` quantile bins per feature). */
export function fitGbm(x: number[][], y: number[], features: string[], o: GbmOptions = {}): GbmModel {
  const T = o.trees ?? 400, D = o.depth ?? 4, rate = o.rate ?? 0.08, minLeaf = o.minLeaf ?? 300, lambda = o.lambda ?? 5, B = o.bins ?? 48;
  const sampleShare = o.sample ?? 0.6, patience = o.patience ?? 25;
  const n = x.length, k = features.length;
  // 1. bin edges per feature, from a sample of the rows; each row's bin per feature
  const edges: number[][] = [];
  for (let j = 0; j < k; j++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 50_000))) vals.push(x[i][j]);
    vals.sort((a, b) => a - b);
    const e: number[] = [];
    for (let b = 1; b < B; b++) { const v = vals[Math.floor((b / B) * vals.length)]; if (e[e.length - 1] !== v) e.push(v); }
    edges.push(e);
  }
  const bin = new Uint8Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) {
    const e = edges[j], v = x[i][j];
    let lo = 0, hi = e.length; // first edge ≥ v
    while (lo < hi) { const mid = (lo + hi) >> 1; if (e[mid] < v) lo = mid + 1; else hi = mid; }
    bin[i * k + j] = lo;
  }
  // 2. start from the overall rate
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const base = Math.log(mean / (1 - mean));
  const z = new Float64Array(n).fill(base);
  const vz = o.valid ? new Float64Array(o.valid.y.length).fill(base) : null;
  const trees: GbmModel['trees'] = [];
  let best = Infinity, bestAt = 0;
  const g = new Float64Array(n), h = new Float64Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < n; i++) { const p = sigmoid(z[i]); g[i] = p - y[i]; h[i] = Math.max(1e-6, p * (1 - p)); }
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (rnd() < sampleShare) rows.push(i);
    const tree = { f: [] as number[], v: [] as number[], l: [] as number[], r: [] as number[] };
    // grow depth-first; each node: the rows that reach it
    const grow = (idx: number[], depth: number): number => {
      const me = tree.f.length;
      tree.f.push(-1); tree.v.push(0); tree.l.push(-1); tree.r.push(-1);
      let G = 0, H = 0;
      for (const i of idx) { G += g[i]; H += h[i]; }
      tree.v[me] = (-G / (H + lambda)) * rate;
      if (depth >= D || idx.length < 2 * minLeaf) return me;
      // best split over every feature's histogram
      let bestGain = 0, bf = -1, bb = -1;
      const parent = (G * G) / (H + lambda);
      for (let j = 0; j < k; j++) {
        const nb = edges[j].length + 1;
        const hg = new Float64Array(nb), hh = new Float64Array(nb), hc = new Int32Array(nb);
        for (const i of idx) { const b = bin[i * k + j]; hg[b] += g[i]; hh[b] += h[i]; hc[b]++; }
        let gl = 0, hl = 0, cl = 0;
        for (let b = 0; b < nb - 1; b++) {
          gl += hg[b]; hl += hh[b]; cl += hc[b];
          const cr = idx.length - cl;
          if (cl < minLeaf || cr < minLeaf) continue;
          const gr = G - gl, hr = H - hl;
          const gain = (gl * gl) / (hl + lambda) + (gr * gr) / (hr + lambda) - parent;
          if (gain > bestGain) { bestGain = gain; bf = j; bb = b; }
        }
      }
      if (bf < 0) return me;
      const left: number[] = [], right: number[] = [];
      for (const i of idx) (bin[i * k + bf] <= bb ? left : right).push(i);
      tree.f[me] = bf; tree.v[me] = edges[bf][bb];
      tree.l[me] = grow(left, depth + 1);
      tree.r[me] = grow(right, depth + 1);
      return me;
    };
    grow(rows, 0);
    trees.push(tree);
    // every row moves by this tree (the ones it didn't see too)
    const one = { features, base: 0, trees: [tree] };
    for (let i = 0; i < n; i++) z[i] += gbmLogit(one, x[i]);
    if (o.valid && vz) {
      let loss = 0;
      for (let i = 0; i < vz.length; i++) { vz[i] += gbmLogit(one, o.valid.x[i]); loss += logLoss(sigmoid(vz[i]), o.valid.y[i]); }
      loss /= vz.length;
      if (loss < best - 1e-6) { best = loss; bestAt = t + 1; }
      if ((t + 1) % 25 === 0) o.log?.(`  tree ${t + 1}: held-out log loss ${loss.toFixed(4)}`);
      if (t + 1 - bestAt >= patience) break;
    }
  }
  return { features, base, trees: o.valid ? trees.slice(0, bestAt || trees.length) : trees };
}
