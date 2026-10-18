#!/usr/bin/env node
// Stratboard: FACEIT demo download helper. Runs on any computer with Node.js 18+ (Windows, macOS, Linux), no
// install, no repo needed: copy this file and faceit-links.txt into one folder (see download-kit/README.md) and run
//
//   node faceit-download-helper.mjs [--out <folder>] [--downloads <your browser's download folder>] [--batch 3]
//
// It opens the match rooms in your browser a few at a time (--batch). You click "Watch demo" / download on each
// page yourself (you're logged in to FACEIT; nothing here touches your account). It watches the download folder,
// and as each demo lands it moves it into <out>/<map>/ and ticks it off. It stops a map once it has the
// "needed" count; if a needed match has no demo (expired, deleted), skip it and a "spare" of the same map takes its
// place. Progress is saved in <out>/progress.json, so you can stop (Ctrl+C) and run it again later to continue.
//
// Keys while it runs:  Enter = skip the oldest open match (no demo / won't download)   q = save and quit
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const home = p => p.replace(/^~(?=[/\\]|$)/, os.homedir());
const LINKS = path.resolve(home(opt('links', path.join(here, 'faceit-links.txt'))));
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
const OUT = path.resolve(home(opt('out', DISK ? path.join(DISK, 'faceit-demos') : path.join(here, 'faceit-demos'))));
const DOWNLOADS = path.resolve(home(opt('downloads', path.join(os.homedir(), 'Downloads'))));
const BATCH = Math.max(1, Number(opt('batch', '3')));
const MIN_FREE_GB = Number(opt('min-free-gb', '10'));
const NO_OPEN = args.includes('--no-open'); // just print the links (open them yourself)

if (!fs.existsSync(LINKS)) { console.error(`Can't find ${LINKS}. Put faceit-links.txt next to this script, or pass --links <file>.`); process.exit(1); }
if (!fs.existsSync(DOWNLOADS)) { console.error(`Can't find the download folder ${DOWNLOADS}. Pass --downloads <folder> (where your browser saves files).`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
if (DISK) console.log(`Found the disk "${DISK_LABEL}" at ${DISK}: demos are saved there.`);
else if (!opt('out')) console.log(`The disk "${DISK_LABEL}" isn't plugged in: demos are saved next to this script. (Plug it in and run again, or pass --out <folder>.)`);

// ---- the list --------------------------------------------------------------------------------------------
// tab-separated: map, room URL, needed|spare, source (a header line first)
const rows = fs.readFileSync(LINKS, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l => {
  const [map, url, kind] = l.split('\t');
  const id = url?.match(/room\/([0-9a-f-]+)/i)?.[1];
  return id ? { map, url, kind: kind === 'spare' ? 'spare' : 'needed', id } : null;
}).filter(Boolean);
const target = {};
for (const r of rows) if (r.kind === 'needed') target[r.map] = (target[r.map] ?? 0) + 1;

const PROGRESS = path.join(OUT, 'progress.json');
const progress = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : { done: {}, skipped: {} };
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
const doneOn = map => Object.values(progress.done).filter(d => d.map === map).length;
const full = map => doneOn(map) >= (target[map] ?? 0);
const queue = () => rows.filter(r => !progress.done[r.id] && !progress.skipped[r.id] && !full(r.map));

// ---- helpers ---------------------------------------------------------------------------------------------
function openInBrowser(url) {
  if (NO_OPEN) return;
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, a, { stdio: 'ignore', detached: true }).unref();
}
const freeGb = () => { try { const s = fs.statfsSync(OUT); return (s.bavail * s.bsize) / 1e9; } catch { return Infinity; } };
const PARTIAL = /\.(crdownload|part|download|tmp|opdownload)$/i;
const sizes = new Map(); // file -> [size, seen at] (a file is finished when its size stops changing)

/** Demo files in the download folder that belong to a match on the list, finished downloading. */
function arrived() {
  const out = [];
  for (const f of fs.readdirSync(DOWNLOADS)) {
    if (PARTIAL.test(f) || !/\.dem(\.zst|\.gz)?$/i.test(f)) continue;
    const row = rows.find(r => f.includes(r.id));
    if (!row || progress.done[row.id]) continue;
    const p = path.join(DOWNLOADS, f);
    let size; try { size = fs.statSync(p).size; } catch { continue; }
    const prev = sizes.get(p);
    if (!prev || prev[0] !== size) { sizes.set(p, [size, Date.now()]); continue; }
    if (Date.now() - prev[1] >= 2000 && size > 1e6) out.push({ row, file: p, name: f });
  }
  return out;
}
function move(from, to) {
  try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); fs.rmSync(from); } // another drive: copy
}
function status() {
  const maps = Object.keys(target).sort();
  return maps.map(m => `${m.replace('de_', '')} ${doneOn(m)}/${target[m]}`).join('  ');
}

// ---- run ------------------------------------------------------------------------------------------------
const open = []; // rows opened in the browser, waiting for their demo
let quitting = false;
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('keypress', (_, key) => {
  if (key?.name === 'q' || (key?.ctrl && key?.name === 'c')) { quitting = true; return; }
  if (key?.name === 'return' && open.length) {
    const r = open.shift();
    progress.skipped[r.id] = { map: r.map, at: Date.now() };
    save();
    console.log(`  skipped ${r.map} ${r.id}`);
  }
});

console.log(`Demos go to ${OUT}`);
console.log(`Watching ${DOWNLOADS} for downloads. Enter = skip the oldest open match, q = quit.\n`);
console.log(`Now: ${status()}\n`);

const tick = () => {
  for (const a of arrived()) {
    const dir = path.join(OUT, a.row.map);
    fs.mkdirSync(dir, { recursive: true });
    const ext = a.name.match(/\.dem(\.zst|\.gz)?$/i)[0];
    move(a.file, path.join(dir, `faceit-${a.row.id}${ext}`));
    progress.done[a.row.id] = { map: a.row.map, at: Date.now() };
    save();
    const i = open.findIndex(r => r.id === a.row.id);
    if (i >= 0) open.splice(i, 1);
    console.log(`  got ${a.row.map} ${a.row.id}  (${status()})`);
  }
  // keep BATCH rooms open
  while (!quitting && open.length < BATCH) {
    if (freeGb() < MIN_FREE_GB) { console.log(`\nUnder ${MIN_FREE_GB} GB free on the disk: stopping. Free some space and run again.`); quitting = true; break; }
    const next = queue().find(r => !open.some(o => o.id === r.id) && open.filter(o => o.map === r.map).length + doneOn(r.map) < target[r.map]);
    if (!next) break;
    open.push(next);
    console.log(`Opening ${next.map} (${next.kind}) ${next.url}`);
    openInBrowser(next.url);
  }
  if (quitting || (!open.length && !queue().length)) {
    save();
    console.log(`\n${queue().length ? 'Stopped' : 'All done'}: ${status()}`);
    console.log(`Demos are in ${OUT}. Run it again any time to continue.`);
    process.exit(0);
  }
};
setInterval(tick, 1000);
tick();
