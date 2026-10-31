// Builds our own Dota 2 map from the game's two map images (patch 7.41):
//   - the woods: trees found on the game-style image, written to src/dota2/generated/trees.json for the map to draw itself;
//   - the ground: the plain image recoloured dark, green on the Radiant's side and grey on the Dire's, to public/images/maps/dota2-dark.png.
//
//   npx vite-node tools/dota-map.ts [debug.png]
//
// Replays don't say where the trees are, and the art is the newest source there is for this patch. Sprites that overlap
// in a thick forest are told apart by spacing, so this is the shape of the woods rather than a list of every single tree.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const GAME = 'public/images/maps/dota2-game.png', PLAIN = 'public/images/maps/dota2-simple.png';
const TREES_OUT = 'src/dota2/generated/trees.json', GROUND_OUT = 'public/images/maps/dota2-dark.png';
/** The images' fit to map cells, as in data.ts. */
const FIT = { game: { a: 6.32, b: -295, c: -6.306, d: 1304 }, plain: { a: 6.93, b: -376, c: -6.918, d: 1393 } };
const VIEW = { left: 63, top: 192.5, span: 130 };
const toMap = (fit: typeof FIT.game, px: number, py: number) => ({
  x: ((px - fit.b) / fit.a - VIEW.left) / VIEW.span,
  y: (VIEW.top - (py - fit.d) / fit.c) / VIEW.span,
});

/* ---- the woods ---- */
/** Pixels across a sprite's body, and how much of it must look like tree to count. */
const R = 5, SPACING = 9.5, FILL = 0.42;
const LAIR = { x: 365, y: 390, r: 34 };

const game = PNG.sync.read(fs.readFileSync(GAME)), { width: W, height: H, data } = game;
const treeKind = (x: number, y: number) => {
  const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
  if (Math.hypot(x - LAIR.x, y - LAIR.y) < LAIR.r) return 0; // Roshan's lair is the same blue in places
  if (g > r * 1.3 && g > b * 1.7 && r < 125 && g > 45) return 1; // the Radiant's bright pines, not its yellower grass
  if (b > r * 1.4 && b > g * 1.14 && b > 46 && b < 170) return 2; // the Dire's blue pines, not its greyer ground or teal water
  return 0;
};
const kind = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) kind[y * W + x] = treeKind(x, y);

// summed tables: how much of each kind of tree in any box, at once
const table = (k: number) => {
  const sum = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum[(y + 1) * (W + 1) + x + 1] = (kind[y * W + x] === k ? 1 : 0) + sum[y * (W + 1) + x + 1] + sum[(y + 1) * (W + 1) + x] - sum[y * (W + 1) + x];
  return sum;
};
const sums = [table(1), table(2)];
const inBox = (sum: Int32Array, x: number, y: number) => {
  const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
  return (sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1] - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
};
const seeds: { x: number; y: number; d: number; dire: boolean }[] = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const green = inBox(sums[0], x, y), blue = inBox(sums[1], x, y);
  if (green + blue >= FILL) seeds.push({ x, y, d: green + blue, dire: blue > green });
}
seeds.sort((p, q) => q.d - p.d);

const CELL = Math.ceil(SPACING), grid = new Map<number, typeof seeds>();
const taken: typeof seeds = [];
for (const s of seeds) {
  const gx = Math.floor(s.x / CELL), gy = Math.floor(s.y / CELL);
  let free = true;
  for (let v = gy - 1; v <= gy + 1 && free; v++) for (let u = gx - 1; u <= gx + 1 && free; u++) {
    for (const o of grid.get(v * 4096 + u) ?? []) if (Math.hypot(o.x - s.x, o.y - s.y) < SPACING) { free = false; break; }
  }
  if (!free) continue;
  taken.push(s);
  const key = gy * 4096 + gx;
  grid.set(key, [...(grid.get(key) ?? []), s]);
}

// thousandths of the map: about a tenth of a cell. Sorted top to bottom, so nearer trees are drawn over farther ones
const onMap = taken.map(s => ({ ...toMap(FIT.game, s.x, s.y), dire: s.dire }))
  .filter(p => p.x > -0.01 && p.x < 1.01 && p.y > -0.01 && p.y < 1.01).sort((p, q) => p.y - q.y || p.x - q.x);
fs.writeFileSync(TREES_OUT, JSON.stringify(onMap.map(p => [Math.round(p.x * 1000), Math.round(p.y * 1000), p.dire ? 1 : 0])));
console.log(`${onMap.length} trees, ${fs.statSync(TREES_OUT).size} bytes`);

const debug = process.argv[2];
if (debug) {
  for (const p of taken) for (let a = 0; a < 16; a++) {
    const i = (Math.round(p.y + Math.sin(a / 16 * 6.283) * 3) * W + Math.round(p.x + Math.cos(a / 16 * 6.283) * 3)) * 4;
    data[i] = 255; data[i + 1] = 40; data[i + 2] = 200;
  }
  fs.writeFileSync(debug, PNG.sync.write(game));
}

/* ---- the ground ---- */
type RGB = [number, number, number];
const mix = (p: RGB, q: RGB, f: number): RGB => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
const step = (lo: number, hi: number, v: number) => { const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return f * f * (3 - 2 * f); };
const RADIANT: [RGB, RGB] = [[20, 38, 28], [96, 128, 92]], DIRE: [RGB, RGB] = [[32, 30, 38], [112, 104, 118]];
const WATER: [RGB, RGB] = [[16, 58, 96], [52, 148, 214]];

const plain = PNG.sync.read(fs.readFileSync(PLAIN));
const out = new PNG({ width: plain.width, height: plain.height });
for (let y = 0; y < plain.height; y++) for (let x = 0; x < plain.width; x++) {
  const i = (y * plain.width + x) * 4, r = plain.data[i], g = plain.data[i + 1], b = plain.data[i + 2];
  const light = 0.3 * r + 0.59 * g + 0.11 * b, at = toMap(FIT.plain, x, y);
  // the sides meet along the river, which runs a little flatter than the map's diagonal
  const radiant = step(-0.05, 0.05, at.y - (0.30 + 0.38 * at.x));
  const lit = step(45, 175, light);
  const ground = mix(mix(DIRE[0], DIRE[1], lit), mix(RADIANT[0], RADIANT[1], lit), radiant);
  const wet = b > 90 ? step(0.1, 0.24, (b - g) / b) : 0;
  const c = mix(ground, mix(WATER[0], WATER[1], step(70, 170, light)), wet);
  out.data[i] = c[0]; out.data[i + 1] = c[1]; out.data[i + 2] = c[2]; out.data[i + 3] = 255;
}
fs.writeFileSync(GROUND_OUT, PNG.sync.write(out, { colorType: 2, compressionLevel: 9 }));
console.log(`ground: ${(fs.statSync(GROUND_OUT).size / 1e6).toFixed(2)} MB`);
