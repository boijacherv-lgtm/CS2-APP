// Builds src/map/generated/maps.json from the official radar PNGs + overview .txt files
// in public/maps. Walkable floor = opaque radar pixels, rasterised to the engine grid.
//
//   node tools/build-maps.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'public/maps');
const OUT = path.join(ROOT, 'src/map/generated/maps.json');
const CELL = 4; // must match engine/grid.ts
const ALPHA = 200;
const MIN_COMPONENT = 150; // cells; drops the faint tick marks around the radar
// Props and thin walls are drawn as small neutral-grey shapes on top of the floor (e.g. the
// Dust II T-spawn wall, boxes). Big grey regions are floor (Mirage A, Nuke yard), so only
// compact grey blobs count as solid.
const PROP_MAX_AREA = 1800; // px
const PROP_MAX_SPAN = 170; // px
// Nuke paints whole rooms in neutral grey, so only small boxes count as props there.
const PROP_MAX_AREA_FOR = { de_nuke: 600, de_nuke_lower: 600 };
// Maps whose interior walls are drawn as dark lines over a lighter floor: pixels darker than
// this count as wall (per radar image).
const DARK_WALLS = { de_nuke: 92, de_nuke_lower: 92, de_vertigo: 52, de_vertigo_lower: 52 };
const DARK_WALL_PIXELS = 3; // a cell is solid if it holds at least this many wall pixels

const NAMES = {
  de_mirage: 'Mirage', de_inferno: 'Inferno', de_dust2: 'Dust II', de_nuke: 'Nuke', de_ancient: 'Ancient',
  de_anubis: 'Anubis', de_overpass: 'Overpass', de_train: 'Train', de_vertigo: 'Vertigo',
};

/** Minimal parser for Valve KeyValues overview files. */
function parseKV(text) {
  const tokens = [...text.replace(/\/\/[^\n]*/g, '').matchAll(/"([^"]*)"|([{}])/g)].map(m => m[1] ?? m[2]);
  let i = 0;
  const block = () => {
    const o = {};
    while (i < tokens.length && tokens[i] !== '}') {
      const key = tokens[i++];
      if (tokens[i] === '{') { i++; o[key] = block(); i++; } else o[key] = tokens[i++];
    }
    return o;
  };
  const root = block();
  return Object.values(root)[0];
}

/** Pixel mask of small grey props/walls drawn over the floor. */
function propMask(png, maxArea = PROP_MAX_AREA) {
  const W = png.width, H = png.height, n = W * H;
  const grey = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2], a = png.data[i * 4 + 3];
    const l = (r + g + b) / 3;
    if (a >= ALPHA && Math.max(r, g, b) - Math.min(r, g, b) <= 4 && l >= 70 && l <= 215) grey[i] = 1;
  }
  // Morphological opening (3x3): erase 1–2 px outlines so they don't glue props to walls.
  const morph = (src, keepIf) => {
    const dst = new Uint8Array(n);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += src[(y + dy) * W + x + dx];
        if (keepIf(c)) dst[y * W + x] = 1;
      }
    return dst;
  };
  const opened = morph(morph(grey, c => c === 9), c => c > 0);
  for (let i = 0; i < n; i++) grey[i] = grey[i] & opened[i];

  const out = new Uint8Array(n), seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (!grey[s] || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let k = 0; k < comp.length; k++) {
      const c = comp[k], x = c % W, y = (c / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && grey[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length >= 12 && comp.length <= maxArea && Math.max(x1 - x0, y1 - y0) <= PROP_MAX_SPAN) for (const c of comp) out[c] = 1;
  }
  return out;
}

function rasterise(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const darkThr = DARK_WALLS[path.basename(file, '.png')];
  const w = Math.ceil(png.width / CELL), h = Math.ceil(png.height / CELL);
  const walk = new Uint8Array(w * h);
  const props = propMask(png, PROP_MAX_AREA_FOR[path.basename(file, '.png')]);
  let propCells = 0;
  for (let cy = 0; cy < h; cy++)
    for (let cx = 0; cx < w; cx++) {
      let n = 0, prop = 0, dark = 0;
      for (let y = 0; y < CELL; y++)
        for (let x = 0; x < CELL; x++) {
          const px = cx * CELL + x, py = cy * CELL + y;
          const i = (py * png.width + px) * 4;
          if (png.data[i + 3] >= ALPHA) {
            n++;
            if (darkThr && (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3 < darkThr) dark++;
          }
          if (props[py * png.width + px]) prop++;
        }
      if (n >= (CELL * CELL) / 2 && prop < (CELL * CELL) / 2 && dark < DARK_WALL_PIXELS) walk[cy * w + cx] = 1;
      else if (prop >= (CELL * CELL) / 2) propCells++;
    }
  // drop tiny islands (grid ticks, labels)
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!walk[s] || seen[s]) continue;
    const comp = [s]; seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const c = comp[k], x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * w + nx;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && walk[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length < MIN_COMPONENT) for (const c of comp) walk[c] = 0;
  }
  // pack to base64 bitset
  const bytes = new Uint8Array(Math.ceil((w * h) / 8));
  walk.forEach((v, i) => { if (v) bytes[i >> 3] |= 1 << (i & 7); });
  return { size: png.width, w, h, bits: Buffer.from(bytes).toString('base64'), propCells };
}

const maps = [];
for (const id of Object.keys(NAMES)) {
  const kv = parseKV(fs.readFileSync(path.join(SRC, `${id}.txt`), 'utf8'));
  const num = k => (kv[k] !== undefined ? parseFloat(kv[k]) : undefined);
  const size = 1024;
  const norm = (x, y) => (num(x) !== undefined ? { x: num(x) * size, y: num(y) * size } : undefined);
  const levels = [{ id: 'upper', image: `/maps/${id}.png`, grid: rasterise(path.join(SRC, `${id}.png`)) }];
  const vs = kv.verticalsections;
  const lowerFile = path.join(SRC, `${id}_lower.png`);
  if (fs.existsSync(lowerFile)) levels.push({ id: 'lower', image: `/maps/${id}_lower.png`, grid: rasterise(lowerFile) });
  if (vs) {
    const sections = Object.values(vs);
    levels.forEach((l, i) => {
      const s = sections[i];
      if (s) l.altitude = [parseFloat(s.AltitudeMin), parseFloat(s.AltitudeMax)];
    });
  }
  maps.push({
    id, name: NAMES[id],
    radar: { sizePx: size, posX: num('pos_x'), posY: num('pos_y'), scale: num('scale') },
    spawns: { T: norm('TSpawn_x', 'TSpawn_y'), CT: norm('CTSpawn_x', 'CTSpawn_y') },
    bombs: { A: norm('bombA_x', 'bombA_y'), B: norm('bombB_x', 'bombB_y') },
    levels,
  });
  console.log(id.padEnd(12), `scale ${num('scale')}`, levels.map(l => `${l.id} (${l.grid.propCells} prop cells solid)`).join(' + '));
  for (const l of levels) delete l.grid.propCells;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(maps));
console.log('wrote', path.relative(ROOT, OUT), (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
