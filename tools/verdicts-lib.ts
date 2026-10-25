// Scores the coach against a player's own verdicts on their moments: for each moment they judged, does the coach flag
// it as a mistake ("fault") or leave it alone ("ok") the way they did? Reads every verdict file in the folder:
// verdicts.json (moments judged in chat), verdicts-app-*.json (Review's "Coach wrong?", from Settings → Download) and
// disputes-*.json (moments checked by hand on the dev page, each with its round: the call there is the answer).
// A check for blind spots (context the coach is missing), not something to tune every number to: one player's
// verdicts aren't ground truth.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getEngine } from '../src/map/catalog';
import { buildReplay, matchFingerprint, reviewRound, type DemoData, type Move, type Review } from '../src/engine/recap';

type V = { match: string; round: number; t: number; kind: string; moveKind?: string; player?: string; verdict: 'fault' | 'ok'; why: string };

export function scoreVerdicts(dir: string): { right: number; total: number; lines: string[] } {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const moments: (V & { player: string })[] = [];
  for (const f of files.filter(f => /^verdicts.*\.json$/.test(f))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { player?: string; moments: V[] };
    for (const m of j.moments) if (m.player ?? j.player) moments.push({ ...m, player: (m.player ?? j.player)! });
  }
  // checked disputes: the owner's call decides (player's right: the player's answer; coach was right: the opposite),
  // each with its own round, so no read of the match is needed
  const own = new Map<string, DemoData>();
  for (const f of files.filter(f => /^disputes.*\.json$/.test(f))) {
    type D = { verdict: { round: number; t: number; kind: string; player: string; verdict: 'ok' | 'fault'; note?: string }; ruling?: { side: 'player' | 'coach'; reason?: string; note?: string }; demo: DemoData };
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { moments: D[] };
    j.moments.forEach((d, i) => {
      if (!d.ruling || !d.demo?.rounds?.length) return;
      const code = `${f}#${i}`;
      own.set(code, d.demo);
      const truth = d.ruling.side === 'player' ? d.verdict.verdict : d.verdict.verdict === 'ok' ? 'fault' : 'ok';
      moments.push({ match: code, round: 1, t: d.verdict.t, kind: 'move', moveKind: d.verdict.kind, player: d.verdict.player, verdict: truth,
        why: `checked: ${d.ruling.side === 'player' ? 'player' : 'coach'} right${d.ruling.reason ? ` (${d.ruling.reason})` : ''}${d.ruling.note ? `, ${d.ruling.note}` : d.verdict.note ? ` (${d.verdict.note})` : ''}` });
    });
  }
  // the reads in the folder, found by the code in their file name or by the match's fingerprint
  const reads = files.filter(f => f.endsWith('.json.gz'));
  const prints = new Map<string, string>();
  const dataOf = (f: string): DemoData => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
  const findRead = (code: string) => {
    const byName = reads.find(f => f.includes(code));
    if (byName) return byName;
    for (const f of reads) { if (!prints.has(f)) prints.set(f, matchFingerprint(dataOf(f))); if (prints.get(f) === code) return f; }
    return null;
  };
  const reviews = new Map<string, Review[]>();
  const reviewsOf = (code: string): Review[] | null => {
    if (reviews.has(code)) return reviews.get(code)!;
    const f = own.has(code) ? null : findRead(code);
    if (!f && !own.has(code)) return null;
    const d = own.get(code) ?? dataOf(f!);
    const e = getEngine(d.map, 0);
    const rv = d.rounds.map((_, i) => reviewRound(e, buildReplay(e, d, i, { userSide: 'CT', phase: 'early', economy: { user: 'full', enemy: 'full' } })));
    reviews.set(code, rv);
    return rv;
  };
  const bad = (m: Move) => m.note === '?' || m.note === '??';
  const near = (m: Move, t: number, w = 6) => Math.abs(m.t - t) <= w;
  let right = 0, total = 0;
  const lines: string[] = [];
  for (const v of moments) {
    const rv = reviewsOf(v.match);
    if (!rv) { lines.push(`skip ${v.match} (no read of this match in the folder)`); continue; }
    const mine = rv[v.round - 1].moves.filter(m => m.player === v.player);
    let flagged: boolean;
    switch (v.kind) {
      case 'move': { const m = mine.filter(x => x.kind === v.moveKind).sort((a, b) => Math.abs(a.t - v.t) - Math.abs(b.t - v.t))[0]; flagged = !!m && near(m, v.t, 1.5) && bad(m); break; }
      case 'death': { const d = mine.filter(m => m.kind === 'death').sort((a, b) => Math.abs(a.t - v.t) - Math.abs(b.t - v.t))[0]; flagged = !!d && bad(d); break; }
      case 'card': flagged = mine.some(m => m.kind === 'position' && near(m, v.t) && bad(m)); break;
      case 'card-opening': flagged = mine.some(m => m.kind === 'position' && m.t < 20 && bad(m)); break;
      case 'utility': flagged = mine.some(m => m.kind === 'utility' && near(m, v.t) && bad(m)); break;
      case 'utility-any': flagged = mine.some(m => m.kind === 'utility' && m.tags.includes('WASTED')); break;
      case 'notrade': flagged = mine.some(m => m.tags.includes('NO TRADE') && near(m, v.t, 8)); break;
      case 'teamflash': flagged = mine.some(m => m.tags.includes('TEAM FLASH') && near(m, v.t)); break;
      case 'teamflash-any': flagged = mine.some(m => m.tags.includes('TEAM FLASH')); break;
      case 'rotation': flagged = mine.some(m => (m.tags.includes('LATE ROTATION') || m.tags.includes('OVER-ROTATION')) && bad(m)); break;
      default: lines.push(`skip unknown kind ${v.kind}`); continue;
    }
    total++;
    const ok = flagged === (v.verdict === 'fault');
    if (ok) right++;
    lines.push(`${ok ? 'ok  ' : 'MISS'} ${v.match.slice(-4)} R${v.round} ${(v.moveKind ?? v.kind).padEnd(13)} you: ${v.verdict.padEnd(5)} coach: ${flagged ? 'flags it' : 'leaves it'}  (${v.why})`);
  }
  return { right, total, lines };
}
