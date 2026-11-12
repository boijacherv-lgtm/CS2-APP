/**
 * The current meta from deadlock-api's analytics (the Worker's 3-hourly copy when there is one, else called from the
 * browser and kept a day per query): heroes on this patch (win, pick and ban rates), each hero's builds and items, and
 * how heroes do against and with each other (for the draft). Everything is from matches since the last big patch, at the chosen ranks.
 */
import { tally, verdict, type Patch, type PatchChange } from './patches';
import { gameplayPatches } from './patchFeed';
import { filters, patchWindowFrom, RANKS, rankOf, type BanRow, type HeroRow, type MetaSnapshot, type RankBand } from './metaCore';
import { API_URL } from '../env';
const API = 'https://api.deadlock-api.com';

export { RANKS, rankOf, type RankBand };

const DAY = 86400e3;
async function cached<T>(key: string, url: string, slim: (v: T) => T = v => v): Promise<T> {
  const k = `stratboard.dlmeta.${key}`;
  try { const c = JSON.parse(localStorage.getItem(k) ?? 'null'); if (c && Date.now() - c.at < DAY) return c.v as T; } catch { /* read it again */ }
  const res = await fetch(API + url);
  if (res.status === 429) throw new Error('deadlock-api is busy: try again in a minute.');
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}.`);
  const v = slim((await res.json()) as T);
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })); } catch { /* full or private mode: just not kept */ }
  return v;
}

/**
 * When the current patch started, in Unix seconds: the newest gameplay update in the patch notes (patches.ts) or
 * deadlock-api's last "big day", whichever is later (the big days are kept by hand and can lag a patch behind).
 */
export async function patchStart(): Promise<number> {
  return (await patchWindow()).since;
}
/** The current patch's start, the previous patch's start (for "since last patch"), and the update itself: from the
 * Worker's snapshot when there is one (everyone sees the same), else worked out here. */
export async function patchWindow(): Promise<{ since: number; before: number; patch: Patch | null }> {
  const snap = await sharedMeta();
  if (snap) return { since: snap.since, before: snap.before, patch: snap.patches.find(p => Math.abs(p.at - snap.since) < 86400) ?? null };
  const [days, notes] = await Promise.all([
    cached<string[]>('patch', '/v1/patches/big-days').catch(() => [] as string[]),
    gameplayPatches().catch(() => [] as Patch[]),
  ]);
  return patchWindowFrom(days, notes);
}

/**
 * The meta the Worker reads every 3 hours (worker/src/dlMeta.ts): the same for everyone, and one request instead of
 * twenty right after a patch. Null without the Worker, or when its copy is missing or more than 12 hours old.
 */
let snapshot: Promise<MetaSnapshot | null> | null = null;
export function sharedMeta(): Promise<MetaSnapshot | null> {
  if (!API_URL) return Promise.resolve(null);
  return (snapshot ??= fetch(`${API_URL}/dl/meta`, { signal: AbortSignal.timeout(5000) })
    .then(r => (r.ok ? r.json() as Promise<MetaSnapshot> : null))
    .then(s => (s && Date.now() - s.at < 12 * 3600e3 ? s : null))
    .catch(() => null));
}

export interface HeroMeta { hero: number; matches: number; wins: number; winRate: number; pickRate: number; banRate: number | null;
  kda: [number, number, number]; soulsPerMin: number; tier: 'S' | 'A' | 'B' | 'C' | 'D';
  /** The patch notes on this hero (buffs, nerfs, the lines), when the current patch changed it. */
  patch?: { buffs: number; nerfs: number; verdict: string; lines: PatchChange[] };
  /** Win rate on the previous patch, and the change since (rising / falling). */
  before?: number; delta?: number;
  /** Few games on this patch yet: the win rate leans on the previous patch, moved by the patch notes. */
  early?: { games: number; raw: number } }
/** Games on the new patch before a hero's own numbers are trusted alone. */
const EARLY_GAMES = 3000;
/**
 * Every hero on this patch at these ranks. The tier is from the win rate pulled toward 50% by how few games there
 * are (a 56% from 300 games isn't a 56% from 30,000): S 52.5%+, A 51%+, B 49%+, C 47.5%+, D below.
 */
export async function heroMeta(band: RankBand): Promise<{ since: number; before: number; patch: Patch | null; early: boolean; rows: HeroMeta[] }> {
  const { since, before, patch } = await patchWindow(), f = filters(since, band);
  const snap = await sharedMeta(), kept = snap?.since === since ? snap.bands[band.id] : undefined;
  const [hs, bans, prev] = kept ? [kept.heroes, kept.bans, kept.prev] : await Promise.all([
    cached<HeroRow[]>(`heroes.${band.id}.${since}`, `/v1/analytics/hero-stats?${f}`),
    cached<BanRow[]>(`bans.${band.id}.${since}`, `/v1/analytics/hero-ban-stats?${f}`).catch(() => []),
    cached<HeroRow[]>(`heroesprev.${band.id}.${before}.${since}`, `/v1/analytics/hero-stats?${filters(before, band)}&max_unix_timestamp=${since}`).catch(() => [] as HeroRow[]),
  ]);
  const notes = patch ? tally(patch.changes, 'hero') : new Map();
  // a match has 12 heroes: the share of matches a hero is in
  const games = hs.reduce((a, h) => a + h.matches, 0) / 12;
  const PRIOR = 1500;
  const rows = hs.filter(h => h.matches > 0).map(h => {
    const b = bans.find(x => x.hero_id === h.hero_id), p = prev.find(x => x.hero_id === h.hero_id), n = notes.get(h.hero_id);
    const raw = h.wins / h.matches, wasRate = p && p.matches >= 500 ? p.wins / p.matches : null;
    // early in a patch: the previous patch's rate stands in for the games not played yet, moved by the notes
    // (each net buff about +0.4 points, at most 2)
    const shift = n ? Math.max(-0.02, Math.min(0.02, 0.004 * (n.buffs - n.nerfs))) : 0;
    const k = wasRate !== null ? Math.max(0, EARLY_GAMES - h.matches) : 0;
    const winRate = k ? (h.wins + k * (wasRate! + shift)) / (h.matches + k) : raw;
    const shrunk = (winRate * (h.matches + k) + PRIOR * 0.5) / (h.matches + k + PRIOR);
    return {
      hero: h.hero_id, matches: h.matches, wins: h.wins, winRate, pickRate: games ? h.matches / games : 0,
      ...(n ? { patch: { buffs: n.buffs, nerfs: n.nerfs, verdict: verdict(n), lines: n.lines } } : {}),
      ...(wasRate !== null ? { before: wasRate, delta: raw - wasRate } : {}),
      ...(k ? { early: { games: h.matches, raw } } : {}),
      banRate: b && b.matches ? b.bans / b.matches : null,
      kda: [h.total_kills / h.matches, h.total_deaths / h.matches, h.total_assists / h.matches] as [number, number, number],
      // net worth at the end over a typical 33 min match isn't exact: shown only as a rough "souls a minute"
      soulsPerMin: h.total_net_worth / h.matches / 33,
      tier: (shrunk >= 0.525 ? 'S' : shrunk >= 0.51 ? 'A' : shrunk >= 0.49 ? 'B' : shrunk >= 0.475 ? 'C' : 'D') as HeroMeta['tier'],
    };
  });
  return { since, before, patch, early: rows.some(r => r.early), rows: rows.sort((a, b) => b.winRate - a.winRate) };
}

export interface ItemMeta { item: number; matches: number; winRate: number; share: number; buyAt: number }
export interface BuildMeta { id: number; name: string; matches: number; winRate: number; players: number; items: number[] }
/**
 * One hero's builds and items: the in-game builds most played on this patch (with their real win rate and items),
 * the core items (in most games, in the order they're bought), and off-meta items: rarely bought (under 12% of
 * games) but winning clearly more than the hero does overall (3 points and up, with enough games to trust it).
 */
export async function heroBuilds(hero: number, band: RankBand) {
  const since = await patchStart(), f = filters(since, band);
  type I = { item_id: number; wins: number; matches: number; avg_buy_time_s: number };
  type B = { hero_build_id: number; wins: number; matches: number; players: number };
  const [items, builds, meta] = await Promise.all([
    cached<I[]>(`items.${hero}.${band.id}.${since}`, `/v1/analytics/item-stats?hero_id=${hero}&min_matches=100&${f}`),
    cached<B[]>(`builds.${hero}.${band.id}.${since}`, `/v1/analytics/hero-build-stats/${hero}?min_matches=200&${f}`).catch(() => [] as B[]),
    heroMeta(band),
  ]);
  const me = meta.rows.find(r => r.hero === hero);
  const games = me?.matches ?? Math.max(1, ...items.map(i => i.matches));
  const base = me?.winRate ?? 0.5;
  const all: ItemMeta[] = items.map(i => ({ item: i.item_id, matches: i.matches, winRate: i.wins / i.matches, share: i.matches / games, buyAt: i.avg_buy_time_s }));
  const core = all.filter(i => i.share >= 0.35).sort((a, b) => a.buyAt - b.buyAt);
  const offMeta = all.filter(i => i.share < 0.12 && i.matches >= Math.max(300, games * 0.004) && i.winRate >= base + 0.03 && i.buyAt < 2700)
    .sort((a, b) => b.winRate - a.winRate).slice(0, 12);
  // the most played builds, with their items (each build's details from the build browser)
  const top = [...builds].sort((a, b) => b.matches - a.matches).slice(0, 5);
  const details = await Promise.all(top.map(b => cached<{ hero_build: { name: string; details?: { mod_categories?: { mods?: { ability_id: number }[] }[] } } }[]>(
    `build.${b.hero_build_id}`, `/v1/builds?build_id=${b.hero_build_id}&only_latest=true`).catch(() => [])));
  const topBuilds: BuildMeta[] = top.map((b, i) => {
    const hb = details[i]?.[0]?.hero_build;
    const ids = (hb?.details?.mod_categories ?? []).flatMap(c => (c.mods ?? []).map(m => m.ability_id));
    return { id: b.hero_build_id, name: hb?.name?.trim() || `Build ${b.hero_build_id}`, matches: b.matches, winRate: b.wins / b.matches, players: b.players, items: [...new Set(ids)] };
  });
  return { since, base, games, core, offMeta, builds: topBuilds, all };
}

/** Your build on each hero: the in-game build you've won the most matches with (3+ matches), with its name. */
export interface MyBuild { hero: number; id: number; name: string; wins: number; matches: number }
export async function myBestBuilds(account: string, heroes: number[]): Promise<MyBuild[]> {
  type B = { hero_id: number; hero_build_id: number; wins: number; matches: number };
  const rows = await cached<B[]>(`mybuilds.${account}`, `/v1/analytics/hero-build-stats?account_id=${account}`);
  const best = heroes.map(h => pickMostWon(rows.filter(r => r.hero_id === h))).filter((b): b is B => !!b);
  const names = await Promise.all(best.map(b => cached<string>(`buildname.${b.hero_build_id}`, `/v1/builds?build_id=${b.hero_build_id}&only_latest=true`,
    v => (v as unknown as { hero_build?: { name?: string } }[])[0]?.hero_build?.name?.trim() ?? '').catch(() => '')));
  return best.map((b, i) => ({ hero: b.hero_id, id: b.hero_build_id, name: names[i] || `Build ${b.hero_build_id}`, wins: b.wins, matches: b.matches }));
}
/** The most wins (ties: the better win rate), 3 matches at least. */
export function pickMostWon<T extends { wins: number; matches: number }>(rows: T[]): T | null {
  return rows.filter(r => r.matches >= 3).sort((a, b) => b.wins - a.wins || b.wins / b.matches - a.wins / a.matches)[0] ?? null;
}

export interface PairStat { a: number; b: number; wins: number; matches: number }
/** How heroes do against each other (a vs b: a's wins) and together (a with b), for the draft. */
export async function draftStats(band: RankBand): Promise<{ counters: PairStat[]; synergy: PairStat[]; heroes: HeroMeta[] }> {
  const since = await patchStart(), f = filters(since, band);
  const [c, s, h] = await Promise.all([
    cached<{ hero_id: number; enemy_hero_id: number; wins: number; matches_played: number }[]>(`counters.${band.id}.${since}`, `/v1/analytics/hero-counter-stats?min_matches=30&${f}`),
    cached<{ hero_id1: number; hero_id2: number; wins: number; matches_played: number }[]>(`synergy.${band.id}.${since}`, `/v1/analytics/hero-synergy-stats?min_matches=30&${f}`),
    heroMeta(band),
  ]);
  return {
    counters: c.map(x => ({ a: x.hero_id, b: x.enemy_hero_id, wins: x.wins, matches: x.matches_played })),
    synergy: s.map(x => ({ a: x.hero_id1, b: x.hero_id2, wins: x.wins, matches: x.matches_played })),
    heroes: h.rows,
  };
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
/** A rate pulled toward `to` by `k` virtual games (few games say little). */
const shrink = (wins: number, n: number, to: number, k = 200) => (wins + k * to) / (n + k);

export interface DraftRead {
  /** Team 0's chance to win (team 1's is 1 − it). */
  p: number;
  /** Each team's parts: how strong its heroes are on this patch, how they go together, how they do against the other team. */
  parts: { meta: number; synergy: number; counters: number }[];
  /** Notable matchups and pairs, the biggest first. */
  notes: { team: 0 | 1; text: string; size: number }[];
  /** Each team's heroes fitted to positions (Pos 1–6, one hero each: the fit their real games make likeliest), and
   * the positions nobody fills. */
  roles: { pos: Record<number, number>; missing: number[] }[];
}
/**
 * Reads a draft (6 or fewer heroes a side): each hero's patch strength, each pair of teammates' synergy (how much more
 * they win together than their own rates say) and each hero's matchups against the enemy (how much better or worse
 * than the two heroes' strengths say), added up in log-odds. A model, not a promise: drafts decide part of a match.
 */
export function readDraft(teams: [number[], number[]], s: { counters: PairStat[]; synergy: PairStat[]; heroes: HeroMeta[]; spreadOf: (h: number) => number[] | null; posOf: (h: number) => number; nameOf: (h: number) => string }): DraftRead {
  const wr = (h: number) => { const r = s.heroes.find(x => x.hero === h); return r ? shrink(r.wins, r.matches, 0.5, 1500) : 0.5; };
  const parts = [0, 1].map(() => ({ meta: 0, synergy: 0, counters: 0 }));
  const notes: DraftRead['notes'] = [];
  const n = s.nameOf;
  teams.forEach((team, t) => {
    for (const h of team) parts[t].meta += logit(wr(h));
    for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
      const [a, b] = [team[i], team[j]];
      const st = s.synergy.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
      if (!st) continue;
      // together vs what their own rates would give: positive = they go together
      const expect = sigmoid((logit(wr(a)) + logit(wr(b))) / 2);
      const d = logit(shrink(st.wins, st.matches, expect)) - logit(expect);
      parts[t].synergy += d;
      if (Math.abs(d) > 0.06) notes.push({ team: t as 0 | 1, text: `${d > 0 ? 'Good' : 'Poor'} pair: ${n(a)} + ${n(b)} (${Math.round((st.wins / st.matches) * 100)}% together, ${st.matches} games)`, size: Math.abs(d) });
    }
    const other = teams[1 - t];
    for (const h of team) for (const e of other) {
      const st = s.counters.find(x => x.a === h && x.b === e);
      if (!st) continue;
      // against what their strengths alone would give (a strong enemy beats most heroes: that's the meta part, not
      // this matchup)
      const expect = sigmoid(logit(wr(h)) - logit(wr(e)));
      const d = logit(shrink(st.wins, st.matches, expect)) - logit(expect);
      parts[t].counters += d;
      if (d > 0.08) notes.push({ team: t as 0 | 1, text: `${n(h)} beats ${n(e)} (${Math.round((st.wins / st.matches) * 100)}% against, ${st.matches} games)`, size: d });
    }
  });
  // the meta part as the average hero (a 6-hero team isn't 6 times as strong): synergy and counters as they add up
  const total = (t: number) => (teams[t].length ? parts[t].meta / teams[t].length : 0) + parts[t].synergy + parts[t].counters / Math.max(1, teams[1 - t].length) * 2;
  const roles = teams.map(team => {
    const pos = fitPositions(team, s);
    const used = new Set(Object.values(pos));
    return { pos, missing: team.length >= 4 ? [1, 2, 3, 4, 5, 6].filter(p => !used.has(p)) : [] };
  });
  return { p: sigmoid(total(0) - total(1)), parts, notes: notes.sort((a, b) => b.size - a.size).slice(0, 8), roles };
}

/** The hero that would help a side most next (by the draft read), best first. */
export function suggest(teams: [number[], number[]], side: 0 | 1, pool: number[], s: Parameters<typeof readDraft>[1]): { hero: number; p: number }[] {
  const now = readDraft(teams, s).p;
  const taken = new Set([...teams[0], ...teams[1]]);
  return pool.filter(h => !taken.has(h)).map(h => {
    const next: [number[], number[]] = side === 0 ? [[...teams[0], h], teams[1]] : [teams[0], [...teams[1], h]];
    const p = readDraft(next, s).p;
    return { hero: h, p: side === 0 ? p - now : now - p };
  }).sort((a, b) => b.p - a.p).slice(0, 6);
}

/** A team's heroes on positions 1–6, one each: the fit with the highest chance by how often each hero plays each
 * position (every order of up to 6 heroes is tried: 720 at most). */
function fitPositions(team: number[], s: { spreadOf: (h: number) => number[] | null; posOf: (h: number) => number }): Record<number, number> {
  const odds = (h: number, p: number) => { const sp = s.spreadOf(h); return Math.log(sp ? Math.max(0.01, sp[p - 1]) : p === s.posOf(h) ? 0.5 : 0.1); };
  let best: number[] = [], bestScore = -Infinity;
  const go = (i: number, used: number[], score: number) => {
    if (i === team.length) { if (score > bestScore) { bestScore = score; best = [...used]; } return; }
    for (let p = 1; p <= 6; p++) if (!used.includes(p)) { used.push(p); go(i + 1, used, score + odds(team[i], p)); used.pop(); }
  };
  go(0, [], 0);
  return Object.fromEntries(team.map((h, i) => [h, best[i]]));
}

export interface CounterItem { item: number; lift: number; matches: number; vs: { hero: number; lift: number }[] }
/**
 * Items that do better than usual on a hero against these enemies: for each enemy, every item's win rate in games
 * against that enemy minus its win rate overall (less the typical shift for all items, which is just how the hero
 * fares against that enemy), shrunk toward 0 when there are few games; averaged over the enemies. Best first.
 */
export async function counterItems(hero: number, enemies: number[], band: RankBand): Promise<CounterItem[]> {
  const since = await patchStart(), f = filters(since, band);
  type I = { item_id: number; wins: number; matches: number };
  const slim = (xs: I[]) => xs.map(i => ({ item_id: i.item_id, wins: i.wins, matches: i.matches }));
  const base = await cached<I[]>(`items.${hero}.${band.id}.${since}`, `/v1/analytics/item-stats?hero_id=${hero}&min_matches=100&${f}`);
  const per = await Promise.all(enemies.map(e => cached<I[]>(`itemsvs.${hero}.${e}.${band.id}.${since}`,
    `/v1/analytics/item-stats?hero_id=${hero}&enemy_hero_ids=${e}&min_matches=50&${f}`, slim).then(r => [e, r] as const).catch(() => [e, [] as I[]] as const)));
  const wr = new Map(base.map(i => [i.item_id, i.wins / i.matches]));
  const lifts = new Map<number, { hero: number; lift: number; n: number }[]>();
  for (const [e, rows] of per) {
    const raw = rows.filter(r => wr.has(r.item_id) && r.matches >= 50).map(r => ({ id: r.item_id, n: r.matches, d: r.wins / r.matches - wr.get(r.item_id)! }));
    if (!raw.length) continue;
    const ds = raw.map(x => x.d).sort((a, b) => a - b), shift = ds[ds.length >> 1];
    for (const x of raw) { const l = ((x.d - shift) * x.n) / (x.n + 400); const arr = lifts.get(x.id) ?? []; arr.push({ hero: e, lift: l, n: x.n }); lifts.set(x.id, arr); }
  }
  return [...lifts.entries()].map(([item, xs]) => ({
    item, matches: xs.reduce((a, x) => a + x.n, 0),
    lift: xs.reduce((a, x) => a + x.lift, 0) / Math.max(1, enemies.length),
    vs: xs.filter(x => x.lift > 0.01).sort((a, b) => b.lift - a.lift).map(x => ({ hero: x.hero, lift: x.lift })),
  })).filter(x => x.lift > 0.005).sort((a, b) => b.lift - a.lift);
}
