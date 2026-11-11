// A moment: one graded decision frozen as a small snapshot (the map, everyone's dots, the options the engine weighed and
// what was really done). The same record feeds the puzzles (pick the best move), the mistake reel (your mistakes grouped
// by type), the next-match focus and a share link (the whole moment in the link, no server). Kept in this browser.
import type { SearchClass } from '../engine/search';

export type MomentGame = 'cs2' | 'deadlock';
export interface MomentDot { x: number; y: number; team: 0 | 1; me?: boolean }
/** `to`: where the move goes on the map (0–1; CS2's options have one). */
export interface MomentOption { label: string; value: number; to?: { x: number; y: number } }
/**
 * The clip: everyone's positions once a second from `from` seconds (−10: before the moment) to the end (+5 after),
 * per player x, y, x, y… (−1 where they're dead or not there yet). Before an answer only up to the moment is shown.
 */
export interface MomentClip { from: number; dots: { team: 0 | 1; me?: boolean; xy: number[] }[] }
export interface Moment {
  id: string; game: MomentGame; map: string;
  /** when the match was played (ms) and a short label for it ("Mirage", "Haze") */ at: number; match: string;
  /** "R11 1:02" / "33:40" */ when: string;
  /** positions 0–1 on the map image; `me` is the player whose move it is; team 0 is theirs */ dots: MomentDot[];
  /** the situation in words */ setup: string;
  /** best first, win chance 0–1 after each; `played` is the index of what was really done */ options: MomentOption[]; played: number;
  cls: SearchClass; /** win chance given up against the best (0–1) */ cost: number;
  /** the kind of mistake, for grouping ("Held instead of moving") */ kind: string;
  /** a premade puzzle's source ("FACEIT level 10"); none for your own */ who?: string;
  /** the engine's reasons, in words */ why?: string[];
  clip?: MomentClip;
  /** the situation at a glance: health, gun, grenades, the bomb, time left (CS2); the phase and level (Deadlock) */
  info?: string[];
  /** the kind of situation: "Retake", "Post-plant", "Clutch", "Teamfight"… */
  tag?: string;
}

const KEY = 'rageview.moments';
export const MAX_MOMENTS = 300;
const BAD = new Set<SearchClass>(['Inaccuracy', 'Mistake', 'Blunder']);
export const isMistake = (m: Moment) => BAD.has(m.cls);

const store = { get: (): Moment[] => { try { return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[]).map(cleanMoment).filter((m): m is Moment => !!m); } catch { return []; } },
  set: (ms: Moment[]) => { try { localStorage.setItem(KEY, JSON.stringify(ms)); } catch { /* full or private mode */ } } };
export const loadMoments = () => store.get();
/** Adds a match's moments (replacing that match's earlier ones), newest matches first, at most MAX_MOMENTS. */
export function saveMoments(ms: Moment[]) {
  if (!ms.length) return;
  const matches = new Set(ms.map(m => matchOf(m)));
  store.set([...ms, ...store.get().filter(m => !matches.has(matchOf(m)))].sort((a, b) => b.at - a.at).slice(0, MAX_MOMENTS));
}
/** Which match a moment is from (its id is "<match>#<when>"). */
export const matchOf = (m: Moment) => m.id.split('#')[0];

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
const CLASSES: SearchClass[] = ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
/** A moment from storage or a share link, checked field by field (a link is anyone's text). */
export function cleanMoment(raw: unknown): Moment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const point = (v: unknown) => { const o = v as Record<string, unknown> | null, x = num(o?.x, 0, 1), y = num(o?.y, 0, 1); return x !== null && y !== null ? { x, y } : null; };
  const game = r.game === 'cs2' || r.game === 'deadlock' ? r.game : null;
  const map = str(r.map, 40), id = str(r.id, 120), match = str(r.match, 60), when = str(r.when, 20), setup = str(r.setup, 300), kind = str(r.kind, 80);
  const at = num(r.at, 0, 4e12), played = num(r.played, 0, 7), cost = num(r.cost, 0, 1);
  const cls = CLASSES.includes(r.cls as SearchClass) ? r.cls as SearchClass : null;
  if (!game || !map || !/^[a-z0-9_]+$/.test(map) || !id || match === null || when === null || setup === null || kind === null || at === null || played === null || cost === null || !cls) return null;
  const options = Array.isArray(r.options) ? r.options.slice(0, 8).map(o => {
    const x = o as Record<string, unknown>, label = str(x?.label, 80), value = num(x?.value, 0, 1);
    const to = point(x?.to);
    return label !== null && value !== null ? { label, value, ...(to ? { to } : {}) } : null;
  }) : [];
  if (options.length < 2 || options.some(o => !o) || played >= options.length) return null;
  const dots = Array.isArray(r.dots) ? r.dots.slice(0, 12).map(d => {
    const x = d as Record<string, unknown>, px = num(x?.x, 0, 1), py = num(x?.y, 0, 1);
    return px !== null && py !== null ? { x: px, y: py, team: (x.team === 1 ? 1 : 0) as 0 | 1, ...(x.me === true ? { me: true } : {}) } : null;
  }).filter((d): d is MomentDot => !!d) : [];
  const c = r.clip as Record<string, unknown> | undefined, from = num(c?.from, -20, 0);
  const clipDots = c && from !== null && Array.isArray(c.dots) ? c.dots.slice(0, 12).map(d => {
    const o = d as Record<string, unknown>;
    const xy = Array.isArray(o?.xy) ? o.xy.slice(0, 64).map(v => num(v, -1, 1) ?? -1) : [];
    return xy.length >= 2 && xy.length % 2 === 0 ? { team: (o.team === 1 ? 1 : 0) as 0 | 1, ...(o.me === true ? { me: true } : {}), xy } : null;
  }).filter((d): d is MomentClip['dots'][number] => !!d) : [];
  const clip = clipDots.length && from !== null ? { from: Math.round(from), dots: clipDots } : null;
  const info = Array.isArray(r.info) ? r.info.slice(0, 6).map(w => str(w, 40)).filter((w): w is string => !!w) : [];
  const tag = str(r.tag, 24);
  const who = str(r.who, 40), why = Array.isArray(r.why) ? r.why.slice(0, 4).map(w => str(w, 200)).filter((w): w is string => !!w) : [];
  return { id, game, map, at, match, when, dots, setup, options: options as MomentOption[], played: Math.round(played), cls, cost, kind, ...(who ? { who } : {}), ...(why.length ? { why } : {}), ...(clip ? { clip } : {}), ...(info.length ? { info } : {}), ...(tag ? { tag } : {}) };
}

// ---- share links: the moment in the address (/m?c=<base64url>), nothing stored anywhere ----------------------------
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
export function shareCode(m: Moment): string {
  return b64url(JSON.stringify({ ...m, cost: round3(m.cost), dots: m.dots.map(d => ({ ...d, x: round3(d.x), y: round3(d.y) })), options: m.options.map(o => ({ ...o, value: round3(o.value), ...(o.to ? { to: { x: round3(o.to.x), y: round3(o.to.y) } } : {}) })),
    ...(m.clip ? { clip: { ...m.clip, dots: m.clip.dots.map(d => ({ ...d, xy: d.xy.map(round3) })) } } : {}) }));
}
export function fromShareCode(code: string): Moment | null {
  if (code.length > 16000) return null;
  try { return cleanMoment(JSON.parse(unb64url(code))); } catch { return null; }
}

// ---- the reel and the focus --------------------------------------------------------------------------------------
/** Your mistakes grouped by kind, the most frequent first (ties: the costlier). */
/**
 * A mistake's kind in plain words. "X instead of Y" with the same move on both sides ("Moved instead of moving": went
 * somewhere, the best was somewhere else) reads as nonsense: it's the wrong spot. Also fixes kinds saved before.
 */
export function kindLabel(kind: string): string {
  const m = /^(\w+) instead of (\w+)$/i.exec(kind.trim());
  if (!m) return kind;
  const did = m[1].toLowerCase(), best = m[2].toLowerCase();
  if (/^(moved|went)$/.test(did) && best === 'moving') return 'Moving to the wrong spot';
  if (/^(held|stayed)$/.test(did) && best === 'holding') return 'Holding the wrong spot';
  if (did === 'peeked' && best === 'peeking') return 'Peeking the wrong angle';
  return kind;
}

export function mistakeGroups(ms: Moment[]): { kind: string; moments: Moment[]; cost: number }[] {
  const by = new Map<string, Moment[]>();
  for (const m of ms.filter(isMistake)) by.set(kindLabel(m.kind), [...(by.get(kindLabel(m.kind)) ?? []), m]);
  return [...by].map(([kind, xs]) => ({ kind, moments: xs.sort((a, b) => b.cost - a.cost), cost: xs.reduce((a, m) => a + m.cost, 0) }))
    .sort((a, b) => b.moments.length - a.moments.length || b.cost - a.cost);
}
/**
 * The one thing to fix next match: the most frequent mistake over your last 10 matches of that game, and whether you're
 * fixing it — how many of your matches in a row, newest first, had fewer of it than your average before them.
 */
export function focusOf(ms: Moment[], game: MomentGame): { kind: string; moments: Moment[]; streak: number; matches: number } | null {
  const mine = ms.filter(m => m.game === game);
  const order = [...new Set(mine.sort((a, b) => b.at - a.at).map(matchOf))].slice(0, 10);
  const recent = mine.filter(m => order.includes(matchOf(m)));
  const top = mistakeGroups(recent)[0];
  if (!top) return null;
  const per = order.map(id => recent.filter(m => matchOf(m) === id && isMistake(m) && kindLabel(m.kind) === top.kind).length);
  let streak = 0;
  for (let i = 0; i < per.length - 1; i++) {
    const before = per.slice(i + 1), avg = before.reduce((a, v) => a + v, 0) / before.length;
    if (per[i] < avg) streak++; else break;
  }
  return { kind: top.kind, moments: top.moments.slice(0, 3), streak, matches: order.length };
}
