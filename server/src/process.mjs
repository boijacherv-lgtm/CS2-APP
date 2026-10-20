// One match: demo link from the bot → download .dem.bz2 from Valve → unpack → parse with the app's own parser
// (tools/demo.mjs) → gzip → store in the Worker, plus this player's map / score / K-D for their match list, and
// the coach's grading of it for their profile (gradedMatch).
// A demo is parsed once and kept on disk; teammates and opponents who use the site get it without re-parsing.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { DATA, ROOT } from './config.mjs';
import { parseDemo } from '../../tools/demo.mjs';

const require = createRequire(import.meta.url);
const unbzip2 = require('unbzip2-stream');
const PARSED = path.join(DATA, 'parsed'), GRADED = path.join(DATA, 'graded');
fs.mkdirSync(PARSED, { recursive: true });
fs.mkdirSync(GRADED, { recursive: true });

export class Gone extends Error {}

/** The parsed match, gzipped (from disk, or downloaded and parsed now). */
export async function parsedDemo(outcomeId, info, log) {
  const file = path.join(PARSED, `${outcomeId}.json.gz`);
  if (fs.existsSync(file)) return { gz: fs.readFileSync(file), fresh: false };
  if (!info.url) throw new Gone('Valve has no demo for this match (they keep them about a month).');
  const res = await fetch(info.url);
  if (res.status === 404) throw new Gone('The demo has expired on Valve\'s servers.');
  if (!res.ok || !res.body) throw new Error(`Demo download failed (${res.status}).`);
  const dem = path.join(DATA, `${outcomeId}.dem`);
  const t0 = Date.now();
  try {
    await pipeline(Readable.fromWeb(res.body), unbzip2(), fs.createWriteStream(dem));
    log(`  downloaded ${(fs.statSync(dem).size / 1e6).toFixed(0)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const data = parseDemo(dem);
    const gz = zlib.gzipSync(JSON.stringify(data), { level: 9 });
    fs.writeFileSync(file, gz);
    log(`  parsed ${data.map}, ${data.rounds.length} rounds → ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
    return { gz, fresh: true };
  } finally {
    fs.rmSync(dem, { force: true }); // demos are 100–250 MB; only the parsed copy is kept
  }
}

/** Map, score, result and K/D from one player's side, for their match list. */
export function summary(gz, steamId, time) {
  const d = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  const played = d.rounds.filter(r => r.winner && r.frames.players[steamId]);
  const won = played.filter(r => r.frames.players[steamId].side === r.winner).length, lost = played.length - won;
  const kills = d.rounds.reduce((a, r) => a + r.kills.filter(k => k.attacker === steamId && k.victim !== steamId).length, 0);
  const deaths = d.rounds.reduce((a, r) => a + r.kills.filter(k => k.victim === steamId).length, 0);
  return {
    time: time ?? null,
    map: d.map,
    scores: played.length ? [won, lost] : null,
    result: !played.length ? null : won > lost ? 'win' : won < lost ? 'loss' : 'tie',
    kd: played.length ? [kills, deaths] : null,
  };
}

// ---- profiles: the coach's grading of the match, the same numbers the website adds when you review it ----------
const APP = path.resolve(ROOT, '..');
const VITE_NODE = path.join(APP, 'node_modules', 'vite-node', 'vite-node.mjs');
export const canGrade = () => fs.existsSync(VITE_NODE);

/**
 * Every player's profile entry for this match ({ steamId: entry }), graded once (about 20–60 s) and kept on disk.
 * Runs the app's grading (tools/grade-profile.ts); needs the app's full install (npm ci in the repo, not --omit=dev).
 */
export async function gradedMatch(outcomeId, gz, playedAt, log) {
  const file = path.join(GRADED, `${outcomeId}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const input = path.join(PARSED, `${outcomeId}.json.gz`);
  if (!fs.existsSync(input)) fs.writeFileSync(input, gz);
  // a separate process, so the bot stays connected to Steam while it grades
  const out = await new Promise(resolve => {
    const p = spawn(process.execPath, [VITE_NODE, path.join(APP, 'tools', 'grade-profile.ts'), input, file, ...(playedAt ? ['--played', String(playedAt)] : [])], { cwd: APP });
    let text = '';
    p.stdout.on('data', d => { text += d; });
    p.stderr.on('data', d => { text += d; });
    p.on('close', code => resolve({ code, text: text.trim() }));
    p.on('error', e => resolve({ code: -1, text: e.message }));
  });
  if (out.code !== 0 || !fs.existsSync(file)) throw new Error(`grading failed: ${out.text.split('\n').slice(-2).join(' ')}`);
  log(`  ${out.text.split('\n').pop()}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
