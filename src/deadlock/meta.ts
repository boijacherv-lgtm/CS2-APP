/**
 * The current meta from deadlock-api's analytics (called from the browser, kept a day per query): heroes on this
 * patch (win, pick and ban rates), each hero's builds and items, and how heroes do against and with each other (for
 * the draft). Everything is from matches since the last big patch, at the chosen ranks.
 */
const API = 'https://api.deadlock-api.com';

/** Rank bands, by the match's average badge (tier × 10 + subrank 1–6: Initiate 1x … Eternus 11x). */
export interface RankBand { id: string; label: string; min?: number; max?: number }
export const RANKS: RankBand[] = [
  { id: 'all', label: 'All ranks' },
  { id: 'low', label: 'Initiate – Arcanist', max: 46 },
  { id: 'mid', label: 'Ritualist – Emissary', min: 51, max: 66 },
  { id: 'high', label: 'Archon – Oracle', min: 71, max: 86 },
  { id: 'top', label: 'Phantom – Ascendant', min: 91, max: 106 },
  { id: 'eternus', label: 'Eternus', min: 111 },
];
export const rankOf = (id: string) => RANKS.find(r => r.id === id) ?? RANKS[0];

const DAY = 86400e3;
async function cached<T>(key: string, url: string): Promise<T> {
  const k = `stratboard.dlmeta.${key}`;
  try { const c = JSON.parse(localStorage.getItem(k) ?? 'null'); if (c && Date.now() - c.at < DAY) return c.v as T; } catch { /* read it again */ }
  const res = await fetch(API + url);
  if (res.status === 429) throw new Error('deadlock-api is busy: try again in a minute.');
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}.`);
  const v = (await res.json()) as T;
  try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), v })); } catch { /* full or private mode: just not kept */ }
  return v;
}

/** When the current patch started (the last "big day"), in Unix seconds. */
export async function patchStart(): Promise<number> {
  const days = await cached<string[]>('patch', '/v1/patches/big-days');
  const t = Date.parse(days[0] ?? '');
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000) - 14 * 86400;
}
const filters = (since: number, band: RankBand) => `min_unix_timestamp=${since}${band.min !== undefined ? `&min_average_badge=${band.min}` : ''}${band.max !== undefined ? `&max_average_badge=${band.max}` : ''}`;

export interface HeroMeta { hero: number; matches: number; wins: number; winRate: number; pickRate: number; banRate: number | null;
  kda: [number, number, number]; soulsPerMin: number; tier: 'S' | 'A' | 'B' | 'C' | 'D' }
/**
 * Every hero on this patch at these ranks. The tier is from the win rate pulled toward 50% by how few games there
 * are (a 56% from 300 games isn't a 56% from 30,000): S 52.5%+, A 51%+, B 49%+, C 47.5%+, D below.
 */
export async function heroMeta(band: RankBand): Promise<{ since: number; rows: HeroMeta[] }> {
  const since = await patchStart(), f = filters(since, band);
  type H = { hero_id: number; wins: number; matches: number; total_kills: number; total_deaths: number; total_assists: number; total_net_worth: number };
  const [hs, bans] = await Promise.all([
    cached<H[]>(`heroes.${band.id}.${since}`, `/v1/analytics/hero-stats?${f}`),
    cached<{ hero_id: number; bans: number; matches: number }[]>(`bans.${band.id}.${since}`, `/v1/analytics/hero-ban-stats?${f}`).catch(() => []),
  ]);
  // a match has 12 heroes: the share of matches a hero is in
  const games = hs.reduce((a, h) => a + h.matches, 0) / 12;
  const PRIOR = 1500;
  const rows = hs.filter(h => h.matches > 0).map(h => {
    const shrunk = (h.wins + PRIOR * 0.5) / (h.matches + PRIOR);
    const b = bans.find(x => x.hero_id === h.hero_id);
    return {
      hero: h.hero_id, matches: h.matches, wins: h.wins, winRate: h.wins / h.matches, pickRate: games ? h.matches / games : 0,
      banRate: b && b.matches ? b.bans / b.matches : null,
      kda: [h.total_kills / h.matches, h.total_deaths / h.matches, h.total_assists / h.matches] as [number, number, number],
      // net worth at the end over a typical 33 min match isn't exact: shown only as a rough "souls a minute"
      soulsPerMin: h.total_net_worth / h.matches / 33,
      tier: (shrunk >= 0.525 ? 'S' : shrunk >= 0.51 ? 'A' : shrunk >= 0.49 ? 'B' : shrunk >= 0.475 ? 'C' : 'D') as HeroMeta['tier'],
    };
  });
  return { since, rows: rows.sort((a, b) => b.winRate - a.winRate) };
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
  return { since, base, games, core, offMeta, builds: topBuilds };
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
  /** What each team has of each role, and what's missing. */
  roles: { count: Record<string, number>; missing: string[] }[];
}
const ROLES = ['brawler', 'marksman', 'mystic', 'assassin'];
/**
 * Reads a draft (6 or fewer heroes a side): each hero's patch strength, each pair of teammates' synergy (how much more
 * they win together than their own rates say) and each hero's matchups against the enemy (how much better or worse
 * than the two heroes' strengths say), added up in log-odds. A model, not a promise: drafts decide part of a match.
 */
export function readDraft(teams: [number[], number[]], s: { counters: PairStat[]; synergy: PairStat[]; heroes: HeroMeta[]; roleOf: (h: number) => string | null; nameOf: (h: number) => string }): DraftRead {
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
    const count: Record<string, number> = {};
    for (const h of team) { const r = s.roleOf(h) ?? 'none'; count[r] = (count[r] ?? 0) + 1; }
    return { count, missing: team.length >= 4 ? ROLES.filter(r => !count[r]) : [] };
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
