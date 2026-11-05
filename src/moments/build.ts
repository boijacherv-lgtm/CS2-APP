// Moments from each game's engine: the CS2 search's flagged moments (recap.ts → search.ts) and the Deadlock engine's
// graded moves (engineReview.ts), frozen as snapshots (moments.ts).
import type { DemoData } from '../engine/recap';
import type { RoundSummary } from '../engine/match';
import type { OptionKind, SearchMoment, SearchOption } from '../engine/search';
import { worldToRadar } from '../engine/coords';
import { MAPS, radarOf } from '../map/catalog';
import { matchKey } from '../engine/profile';
import { heroOf } from '../deadlock/data';
import { playerAt, type DlMatch } from '../deadlock/match';
import type { EngineMove, EngineReview } from '../deadlock/engineReview';
import type { Action } from '../deadlock/playNet';
import { isMistake, type Moment, type MomentDot } from './moments';

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The clip: seconds before and after the moment. */
const CLIP_BEFORE = 10, CLIP_AFTER = 5;
/** How many moments a match keeps (its costliest). */
const PER_MATCH = 8;

const PRESENT: [RegExp, string][] = [[/^Went and planted\b/, 'Plant the bomb'], [/^Went\b/, 'Go'], [/^Held\b/, 'Hold'], [/^Moved\b/, 'Move'], [/^Peeked\b/, 'Peek'], [/^Flashed\b/, 'Flash'], [/^Smoked\b/, 'Smoke'], [/^Planted\b/, 'Plant'], [/^Defused\b/, 'Defuse'], [/^Threw\b/, 'Throw'], [/^Fell back\b/, 'Fall back'], [/^Pushed\b/, 'Push']];
/** Where a move goes, without how ("Peek B Site" and "Move to B Site" are both "b site"). */
export const placeOf = (l: string) => l.replace(/^(Move to|Peek|Hold|Go to)\s+/i, '').toLowerCase();
/** A move in the present ("Moved to Default" → "Move to Default"). */
export const asMove = (label: string) => PRESENT.reduce((s, [re, to]) => s.replace(re, to), label);
const DOING: Record<OptionKind, string> = { hold: 'holding', move: 'moving', peek: 'peeking', flash: 'flashing', smoke: 'smoking', molotov: 'a molotov', he: 'an HE', plant: 'planting', defuse: 'defusing', actual: 'that' };

/** CS2: one search moment as a snapshot (round index `i`). */
export function cs2Moment(data: DemoData, i: number, m: SearchMoment): Moment | null {
  const R = radarOf(data.map), demo = data.rounds[i];
  if (!R || !demo) return null;
  const mapName = MAPS.find(x => x.id === data.map)?.name ?? data.map, match = matchKey(data.map, data.rounds), at = data.playedAt ?? Date.now();
  const ft = demo.frames.t;
  let k = 0; while (k < ft.length - 1 && ft[k + 1] <= m.t) k++;
  const mine = demo.frames.players[m.player]?.side;
  const dots: MomentDot[] = [];
  let us = 0, them = 0;
  for (const [id, f] of Object.entries(demo.frames.players)) {
    if (!f.alive[k]) continue;
    const p = worldToRadar({ x: f.x[k], y: f.y[k] }, R), team = f.side === mine ? 1 : 0;
    if (team) us++; else them++;
    dots.push({ x: p.x / R.sizePx, y: p.y / R.sizePx, team, ...(id === m.player ? { me: true } : {}) });
  }
  // the top options, and what was done (it's among them, or added), all worded as moves ("Held A Site" is "Hold A
  // Site": a past tense would give the answer away, and the same move twice reads as two)
  const opts: SearchOption[] = m.options.slice(0, 3).map(o => ({ ...o, label: asMove(o.label) }));
  const did = asMove(m.did.label);
  // two ways to the same place ("Peek B Site", "Move to B Site") are one option: keep what was done, else the better
  for (let a = opts.length - 1; a > 0; a--) {
    const b = opts.findIndex((o, k) => k < a && placeOf(o.label) === placeOf(opts[a].label));
    if (b < 0 || b === 0) continue; // never merge into the best move: it stays the answer
    const keep = opts[a].label.toLowerCase() === did.toLowerCase() ? a : b;
    opts.splice(keep === a ? b : a, 1);
  }
  let played = opts.findIndex(o => o.label.toLowerCase() === did.toLowerCase());
  // planting is one move however it's worded ("Go plant on B", "Plant on B", what was done: "Plant the bomb")
  if (played < 0 && /plant/i.test(did)) played = opts.findIndex(o => /plant/i.test(o.label));
  if (played < 0) { opts.push({ ...m.did, label: did }); played = opts.length - 1; }
  const best = m.options[0];
  // the clip: everyone once a second, 10 s before to 5 s after (from the round's start at the earliest)
  const ids = Object.keys(demo.frames.players);
  const at3 = (v: number) => +v.toFixed(3);
  const secs: number[] = [];
  for (let s = -CLIP_BEFORE; s <= CLIP_AFTER; s++) if (m.t + s >= ft[0] && m.t + s <= ft[ft.length - 1]) secs.push(s);
  const clip = secs.length > 1 ? { from: secs[0], dots: ids.map(id => {
    const f = demo.frames.players[id];
    const xy = secs.flatMap(s => { let j = 0; while (j < ft.length - 1 && ft[j + 1] <= m.t + s) j++; if (!f.alive[j]) return [-1, -1]; const p = worldToRadar({ x: f.x[j], y: f.y[j] }, R); return [at3(p.x / R.sizePx), at3(p.y / R.sizePx)]; });
    return { team: (f.side === mine ? 1 : 0) as 0 | 1, ...(id === m.player ? { me: true } : {}), xy };
  }) } : undefined;
  const toMap = (o: SearchOption) => (o.to ? { to: { x: at3(o.to.x / R.sizePx), y: at3(o.to.y / R.sizePx) } } : {});
  return {
    ...(clip ? { clip } : {}),
    id: `${match}#R${i + 1} ${clock(m.t)}`, game: 'cs2', map: data.map, at, match: mapName, when: `R${i + 1} ${clock(m.t)}`, dots,
    setup: `Round ${i + 1}, ${clock(m.t)} in. You're ${m.side}, ${us} alive against ${them}. Your side's win chance: ${pct(m.before)}.`,
    options: opts.map(o => ({ label: o.label, value: o.win, ...toMap(o) })), played, cls: m.cls, cost: m.cost,
    kind: `${cap(m.did.label.split(' ')[0])} instead of ${DOING[best.kind as OptionKind] ?? 'the best move'}`,
  };
}

/** CS2: a player's flagged moments in a graded match, the costliest. */
export function cs2Moments(data: DemoData, rounds: (RoundSummary | null)[], player: string): Moment[] {
  const out: Moment[] = [];
  rounds.forEach((r, i) => { for (const m of r?.search?.key ?? []) if (m.player === player) { const x = cs2Moment(data, i, m); if (x) out.push(x); } });
  return out.sort((a, b) => b.cost - a.cost).slice(0, PER_MATCH);
}

const DO: Record<Action, string> = { fight: 'Take the fight', objective: 'Go for the objective', farm: 'Farm', lane: 'Stay in lane', base: 'Go to base', move: 'Move around' };

/** Deadlock: one graded move as a snapshot. */
export function dlMoment(match: DlMatch, x: EngineMove, slot: number): Moment | null {
  const me = match.players.find(p => p.slot === slot);
  if (!me) return null;
  const hero = heroOf(me.hero).name;
  const dots: MomentDot[] = [];
  for (const p of match.players) {
    const at = playerAt(match, p.slot, x.t);
    if (at) dots.push({ x: at.x, y: at.y, team: p.team === me.team ? 1 : 0, ...(p.slot === slot ? { me: true } : {}) });
  }
  const opts = x.options.slice(0, 3);
  let played = opts.findIndex(o => o.action === x.played.action);
  if (played < 0) { opts.push(x.played); played = opts.length - 1; }
  if (opts.length < 2) return null;
  const fight = x.options.find(o => o.sides);
  const secs: number[] = [];
  for (let s = -CLIP_BEFORE; s <= CLIP_AFTER; s++) if (x.t + s >= 0 && x.t + s <= match.duration) secs.push(s);
  const clip = { from: secs[0], dots: match.players.map(p => ({
    team: (p.team === me.team ? 1 : 0) as 0 | 1, ...(p.slot === slot ? { me: true } : {}),
    xy: secs.flatMap(s => { const a = playerAt(match, p.slot, x.t + s); return a ? [+a.x.toFixed(3), +a.y.toFixed(3)] : [-1, -1]; }),
  })) };
  return {
    clip,
    id: `${match.id}#${slot}#${clock(x.t)}`, game: 'deadlock', map: 'deadlock', at: match.start * 1000, match: hero, when: clock(x.t), dots,
    setup: `${clock(x.t)} in, as ${hero}. Your team's win chance: ${pct(x.before)}.${fight?.sides ? ` A fight nearby: your ${fight.sides[0]} against their ${fight.sides[1]}.` : ''}`,
    options: opts.map(o => ({ label: DO[o.action], value: o.value })), played, cls: x.cls, cost: Math.max(0, x.loss),
    kind: cap(x.title.replace(/^[^:]+: /, '')), why: x.why.slice(0, 3),
  };
}

/** Deadlock: a player's graded moves (the costliest mistakes, and their best calls). */
export function dlMoments(match: DlMatch, review: EngineReview, slot: number): Moment[] {
  return [...review.worst.slice(0, PER_MATCH - 2), ...review.best.slice(0, 2)].map(x => dlMoment(match, x, slot))
    .filter((m): m is Moment => !!m && (isMistake(m) || m.cls === 'Best'));
}
