#!/usr/bin/env node
// Stratboard: HLTV pro demo download helper. Runs on any computer with Node.js 18+ (Windows, macOS, Linux), no
// install, no repo needed:
//
//   node hltv-download-helper.mjs [--per-map 60] [--months 6] [--stars 1] [--out <folder>] [--downloads <folder>]
//
// HLTV doesn't allow scraping and checks for bots, so this never reads HLTV itself. It opens HLTV's results page
// in your browser, filtered to recent top-tier matches that have a demo, on the map that still needs the most demos.
// You open matches there and click the demo download yourself. The helper watches your download folder: each
// archive (.rar / .zip, one demo per map of the series) is unpacked, every map's demo is sorted into
// <out>/<map>/ (compressed, about a third of the size), and maps that already have enough are dropped (unless --keep-all). Every pro demo has all ten
// players, so AWPers, entries, supports, lurkers and IGLs all come with it; the coach works out who played what.
//
// Keys while it runs:  n = open the results page for the map that needs demos most   q = save and quit
// Progress is in <out>/progress.json: stop any time and run it again to continue.
//
// Unpacking .rar needs one of: tar (built into Windows 10+ and macOS), 7-Zip (7z), or unar. If none can open an
// archive, the helper says so and leaves it in the download folder; install 7-Zip (7-zip.org) and run again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const home = p => p.replace(/^~(?=[/\\]|$)/, os.homedir());
// where demos go: --out, else the external disk (found by its name, --disk "Внешка") when it's plugged in, else
// next to this script
const DISK_LABEL = opt('disk', 'Внешка');
function findDisk(label) {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell', ['-NoProfile', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystemLabel | ConvertTo-Json'], { encoding: 'utf8' });
      const vols = [].concat(JSON.parse(r.stdout || '[]'));
      const v = vols.find(x => String(x.FileSystemLabel ?? '').trim() === label);
      return v ? `${v.DriveLetter}:\\` : null;
    }
    const mac = path.join('/Volumes', label);
    fs.accessSync(mac, fs.constants.W_OK); // a Mac can't write to an NTFS disk: then it doesn't count
    return mac;
  } catch { return null; }
}
const DISK = opt('out') ? null : findDisk(DISK_LABEL);
const OUT = path.resolve(home(opt('out', DISK ? path.join(DISK, 'pro-demos') : path.join(here, 'pro-demos'))));
const DOWNLOADS = path.resolve(home(opt('downloads', path.join(os.homedir(), 'Downloads'))));
const PER_MAP = Number(opt('per-map', '60'));
const MONTHS = Number(opt('months', '6'));
const STARS = Number(opt('stars', '1')); // HLTV's star rating: 1+ = matches between top teams
const MAPS = opt('maps', 'de_ancient,de_anubis,de_dust2,de_inferno,de_mirage,de_nuke,de_overpass,de_train').split(',').map(s => s.trim()).filter(Boolean);
const KEEP_ALL = args.includes('--keep-all');
const NO_OPEN = args.includes('--no-open');
const MIN_FREE_GB = Number(opt('min-free-gb', '10'));

if (!fs.existsSync(DOWNLOADS)) { console.error(`Can't find the download folder ${DOWNLOADS}. Pass --downloads <folder> (where your browser saves files).`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
if (DISK) console.log(`Found the disk "${DISK_LABEL}" at ${DISK}: demos are saved there.`);
else if (!opt('out')) console.log(`The disk "${DISK_LABEL}" isn't plugged in: demos are saved next to this script. (Plug it in and run again, or pass --out <folder>.)`);

const PROGRESS = path.join(OUT, 'progress.json');
const progress = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : { archives: {}, maps: {} };
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
const count = m => progress.maps[m] ?? 0;
const needed = () => MAPS.filter(m => count(m) < PER_MAP).sort((a, b) => count(a) - count(b));
const status = () => MAPS.map(m => `${m.replace('de_', '')} ${count(m)}/${PER_MAP}`).join('  ');

// ---- HLTV's results page, filtered ------------------------------------------------------------------------
const day = d => d.toISOString().slice(0, 10);
function resultsUrl(map) {
  const end = new Date(), start = new Date(); start.setMonth(start.getMonth() - MONTHS);
  return `https://www.hltv.org/results?content=demo&stars=${STARS}&map=${map}&startDate=${day(start)}&endDate=${day(end)}`;
}
function openInBrowser(url) {
  console.log(`Opening ${url}`);
  if (NO_OPEN) return;
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, a, { stdio: 'ignore', detached: true }).unref();
}
const openNext = () => {
  const m = needed()[0];
  if (!m) return;
  console.log(`\nMost needed: ${m} (${count(m)}/${PER_MAP}). On the page: open a match, click its demo download (GOTV demo). Series with several maps are fine.`);
  openInBrowser(resultsUrl(m));
};

// ---- unpacking and sorting -------------------------------------------------------------------------------
const PARTIAL = /\.(crdownload|part|download|tmp|opdownload)$/i;
const sizes = new Map();
const startedAt = Date.now() - 60_000; // only files downloaded since the helper started (and the minute before)
function extract(archive, dir) {
  const tries = [['tar', ['-xf', archive, '-C', dir]], ['7z', ['x', '-y', `-o${dir}`, archive]], ['7za', ['x', '-y', `-o${dir}`, archive]], ['unar', ['-f', '-o', dir, archive]]];
  for (const [cmd, a] of tries) {
    const r = spawnSync(cmd, a, { stdio: 'ignore' });
    if (r.status === 0 && walk(dir).some(f => /\.dem$/i.test(f))) return true;
  }
  return false;
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
/** The map of a demo: from the demo's header (the map name is in its first bytes), else from its file name. */
function mapOf(file) {
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(65536);
  fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
  // the map names we know, exactly (a byte right after the name in the header can look like part of it)
  const inHeader = buf.toString('latin1').match(/de_(ancient|anubis|dust2|inferno|mirage|nuke|overpass|train|vertigo|cache|split)/)?.[0];
  if (inHeader) return inHeader;
  return MAPS.concat(['de_vertigo', 'de_cache', 'de_split']).find(m => path.basename(file).toLowerCase().includes(m.replace('de_', ''))) ?? null;
}
/** Stores a demo compressed (zstd when this Node has it, else gzip; about a third of the size), then deletes the original. */
async function store(from, to) {
  const zstd = typeof zlib.createZstdCompress === 'function';
  const out = `${to}${zstd ? '.zst' : '.gz'}`;
  await pipeline(fs.createReadStream(from), zstd ? zlib.createZstdCompress() : zlib.createGzip({ level: 6 }), fs.createWriteStream(`${out}.part`));
  fs.renameSync(`${out}.part`, out);
  fs.rmSync(from, { force: true });
}

async function handle(file, name) {
  const key = `${name}|${fs.statSync(file).size}`;
  if (progress.archives[key]) { console.log(`  ${name}: already done`); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hltv-'));
  let demos;
  if (/\.dem$/i.test(name)) demos = [file];
  else if (!extract(file, tmp)) { console.log(`  ${name}: couldn't unpack it (install 7-Zip from 7-zip.org, then run again). Left in the download folder.`); fs.rmSync(tmp, { recursive: true, force: true }); progress.archives[key] = { failed: true }; return; }
  else demos = walk(tmp).filter(f => /\.dem$/i.test(f));
  const got = [];
  for (const d of demos) {
    const map = mapOf(d);
    if (!map) continue;
    if (!KEEP_ALL && (!MAPS.includes(map) || count(map) >= PER_MAP)) { got.push(`${map.replace('de_', '')} (not needed)`); continue; }
    const dir = path.join(OUT, map);
    fs.mkdirSync(dir, { recursive: true });
    const base = `hltv-${name.replace(/\.(rar|zip|dem)$/i, '')}-${path.basename(d)}`.replace(/[^\w.-]+/g, '_');
    await store(d, path.join(dir, base.endsWith('.dem') ? base : `${base}.dem`));
    progress.maps[map] = count(map) + 1;
    got.push(map.replace('de_', ''));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (file !== demos[0] || !/\.dem$/i.test(name)) fs.rmSync(file, { force: true }); // the archive, once unpacked
  progress.archives[key] = { at: Date.now(), maps: got };
  save();
  console.log(`  ${name}: ${got.join(', ') || 'no demos inside'}   (${status()})`);
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try { await scan(); } finally { busy = false; }
}
async function scan() {
  for (const f of fs.readdirSync(DOWNLOADS)) {
    if (PARTIAL.test(f) || !/\.(rar|zip|dem)$/i.test(f)) continue;
    const p = path.join(DOWNLOADS, f);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.mtimeMs < startedAt) continue;
    const prev = sizes.get(p);
    if (!prev || prev[0] !== st.size) { sizes.set(p, [st.size, Date.now()]); continue; }
    if (Date.now() - prev[1] < 2000 || prev[2]) continue;
    prev[2] = true; // handled
    await handle(p, f);
  }
  const free = (() => { try { const s = fs.statfsSync(OUT); return (s.bavail * s.bsize) / 1e9; } catch { return Infinity; } })();
  if (free < MIN_FREE_GB) { console.log(`\nUnder ${MIN_FREE_GB} GB free: stopping. Free some space and run again.`); quit(); }
  if (!needed().length) { console.log('\nEvery map has enough demos.'); quit(); }
}
function quit() {
  save();
  console.log(`\n${status()}\nDemos are in ${OUT}. Run again any time to continue.`);
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (_, key) => {
  if (key?.name === 'q' || (key?.ctrl && key?.name === 'c')) quit();
  if (key?.name === 'n') openNext();
});
console.log(`Pro demos go to ${OUT}, ${PER_MAP} per map. Watching ${DOWNLOADS}.`);
console.log(`Keys: n = open the results page for the most-needed map, q = quit.`);
console.log(`Now: ${status()}`);
openNext();
setInterval(tick, 1000);
