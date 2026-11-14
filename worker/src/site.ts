/**
 * The site's content, controlled from the dev page without a deploy (spec §11): one JSON config the Worker serves at
 * /config and the site reads at load (banner, maintenance, feature flags, samples, the daily puzzle, Rage lines, the
 * hints version), and a log of every change made from the dev page, each with Undo. Plus the owner's tools that touch
 * KV directly: users (find, delete with a 7-day undo, keep off the leaderboard), pausing the bots, the coach's nightly
 * check results, and which secrets are set (never their values).
 */
export interface SiteKV {
  get(key: string, type: 'json'): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export interface SiteConfig {
  banner: { on: boolean; text: string; link: string; until: number | null };
  /** Pages showing "back soon" instead of themselves (route page names: cs2, deadlock, puzzles, profile …). */
  maintenance: string[];
  flags: { rage: boolean; proEarlyAccess: boolean; puzzlesBoard: boolean; comingSoon: string };
  samples: { cs2: string; deadlock: number };
  /** The daily puzzle: a pinned id, ids skipped as daily, ids hidden everywhere. */
  puzzles: { pin: string; skip: string[]; hide: string[] };
  /** Rage lines over coach-remarks.json, per situation: { chance, lines: [{ text, weight }] }. */
  rage: Record<string, { chance?: number; lines?: { text: string; weight: number }[] }>;
  /** Raise it and everyone sees the hints once more. */
  hintsVersion: number;
  /** SteamIDs kept off the puzzle leaderboards. */
  banned: string[];
  /** Footer links (round 10, G3): empty hides the link. */
  footer: { discord: string; contact: string };
  /** The price and when early access ends (shown on Pricing and Profile); empty: the built-in words. */
  pricing: { price: string; earlyEnds: string };
  /** The front page's headline and first line; empty: the built-in ones. */
  hero: { h1: string; lead: string };
  /** The front page's questions; empty: the built-in ones. (The static FAQ data and /llms.txt are built with the site.) */
  faq: { q: string; a: string }[];
  /** The game pages' headline and first line (cs2, deadlock); empty: the built-in ones. */
  games: Record<'cs2' | 'deadlock', { h1: string; lead: string }>;
  /** The guides' headline and opening line, by slug (download-cs2-demo, deadlock-match-id, adr-and-kast, where-players-die); empty: the built-in ones. */
  guides: Record<string, { h1: string; desc: string }>;
  /** What's new entries, newest first, shown above the file's: { date: 'Nov 14, 2026', items: [...] }. */
  changelog: { date: string; items: string[] }[];
}
export const DEFAULT_CONFIG: SiteConfig = {
  banner: { on: false, text: '', link: '', until: null },
  maintenance: [],
  flags: { rage: true, proEarlyAccess: true, puzzlesBoard: true, comingSoon: '' },
  samples: { cs2: '/samples/cs2-mirage.json.gz', deadlock: 131074890 },
  puzzles: { pin: '', skip: [], hide: [] },
  rage: {},
  hintsVersion: 1,
  banned: [],
  footer: { discord: '', contact: '' },
  pricing: { price: '', earlyEnds: '' },
  hero: { h1: '', lead: '' },
  faq: [],
  guides: {},
  games: { cs2: { h1: '', lead: '' }, deadlock: { h1: '', lead: '' } },
  changelog: [],
};
const CONFIG = 'site:config', LOG = 'site:log', MAX_LOG = 200;
const PAGES = ['home', 'cs2', 'deadlock', 'puzzles', 'profile', 'pricing', 'settings'];

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, max: number, len = 60) => (Array.isArray(v) ? v.map(x => str(x, len)).filter(Boolean).slice(0, max) : []);
/** An https address or empty. */
const url = (v: unknown) => { const t = str(v, 300); return /^https:\/\//.test(t) ? t : ''; };
/** An https address or a mailto: or empty. */
const contact = (v: unknown) => { const t = str(v, 300); return /^(https:\/\/|mailto:)/.test(t) ? t : ''; };
const bool = (v: unknown, or: boolean) => (typeof v === 'boolean' ? v : or);

/** Only what the site understands, within limits (the dev page is the owner's, but a typo shouldn't break the site). */
export function cleanConfig(raw: unknown, was: SiteConfig = DEFAULT_CONFIG): SiteConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const b = r.banner ?? was.banner, f = r.flags ?? was.flags, s = r.samples ?? was.samples, p = r.puzzles ?? was.puzzles;
  const link = str(b.link, 300);
  const rage: SiteConfig['rage'] = {};
  for (const [k, v] of Object.entries((r.rage ?? was.rage) as Record<string, any>).slice(0, 60)) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!/^[a-zA-Z]{2,30}$/.test(k) || !v || typeof v !== 'object') continue;
    const chance = typeof v.chance === 'number' && v.chance >= 0 && v.chance <= 1 ? v.chance : undefined;
    const lines = Array.isArray(v.lines) ? v.lines.slice(0, 20).map((l: any) => ({ text: str(l?.text ?? l, 200), weight: Math.max(0, Math.min(3, Math.round(+l?.weight || 2))) })).filter((l: { text: string }) => l.text) : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (chance !== undefined || lines?.length) rage[k] = { ...(chance !== undefined ? { chance } : {}), ...(lines?.length ? { lines } : {}) };
  }
  return {
    banner: { on: bool(b.on, false), text: str(b.text, 200), link: /^(https:\/\/|\/)/.test(link) ? link : '', until: typeof b.until === 'number' && b.until > 0 ? b.until : null },
    maintenance: strs(r.maintenance ?? was.maintenance, 10).filter(x => PAGES.includes(x)),
    flags: { rage: bool(f.rage, true), proEarlyAccess: bool(f.proEarlyAccess, true), puzzlesBoard: bool(f.puzzlesBoard, true), comingSoon: str(f.comingSoon, 40) },
    samples: { cs2: /^\/samples\/[\w.-]+\.json(\.gz)?$/.test(str(s.cs2, 120)) ? str(s.cs2, 120) : DEFAULT_CONFIG.samples.cs2, deadlock: Number.isInteger(+s.deadlock) && +s.deadlock > 0 ? +s.deadlock : DEFAULT_CONFIG.samples.deadlock },
    puzzles: { pin: str(p.pin, 80), skip: strs(p.skip, 100, 80), hide: strs(p.hide, 300, 80) },
    rage,
    hintsVersion: Number.isInteger(+(r.hintsVersion ?? was.hintsVersion)) ? Math.max(1, +(r.hintsVersion ?? was.hintsVersion)) : 1,
    banned: strs(r.banned ?? was.banned, 500, 17).filter(x => /^7656\d{13}$/.test(x)),
    footer: { discord: url(r.footer?.discord ?? was.footer.discord), contact: contact(r.footer?.contact ?? was.footer.contact) },
    pricing: { price: str(r.pricing?.price ?? was.pricing.price, 20), earlyEnds: str(r.pricing?.earlyEnds ?? was.pricing.earlyEnds, 40) },
    hero: { h1: str(r.hero?.h1 ?? was.hero.h1, 80), lead: str(r.hero?.lead ?? was.hero.lead, 240) },
    games: { cs2: { h1: str(r.games?.cs2?.h1 ?? was.games.cs2.h1, 80), lead: str(r.games?.cs2?.lead ?? was.games.cs2.lead, 240) }, deadlock: { h1: str(r.games?.deadlock?.h1 ?? was.games.deadlock.h1, 80), lead: str(r.games?.deadlock?.lead ?? was.games.deadlock.lead, 240) } },
    guides: Object.fromEntries(Object.entries((r.guides ?? was.guides ?? {}) as Record<string, { h1?: unknown; desc?: unknown }>).filter(([k]) => /^[a-z0-9-]{3,40}$/.test(k)).slice(0, 10).map(([k, v]) => [k, { h1: str(v?.h1, 80), desc: str(v?.desc, 300) }]).filter(([, v]) => (v as { h1: string; desc: string }).h1 || (v as { h1: string; desc: string }).desc)),
    faq: (Array.isArray(r.faq ?? was.faq) ? (r.faq ?? was.faq) as { q?: unknown; a?: unknown }[] : []).slice(0, 12).map(x => ({ q: str(x?.q, 120), a: str(x?.a, 600) })).filter(x => x.q && x.a),
    changelog: (Array.isArray(r.changelog ?? was.changelog) ? (r.changelog ?? was.changelog) as { date?: unknown; items?: unknown }[] : []).slice(0, 20).map(x => ({ date: str(x?.date, 30), items: strs(x?.items, 12, 300) })).filter(x => x.date && x.items.length),
  };
}

export async function loadConfig(kv: SiteKV): Promise<SiteConfig> {
  return cleanConfig(await kv.get(CONFIG, 'json'));
}

export interface LogEntry { at: number; who: string; what: string; before?: unknown; after?: unknown; undone?: boolean }
async function addLog(kv: SiteKV, e: LogEntry) {
  const rows = ((await kv.get(LOG, 'json')) as LogEntry[] | null) ?? [];
  await kv.put(LOG, JSON.stringify([e, ...rows].slice(0, MAX_LOG)));
}
export const siteLog = async (kv: SiteKV) => ({ rows: ((await kv.get(LOG, 'json')) as LogEntry[] | null) ?? [] });

/** A change to the config from the dev page: merged, cleaned, logged. */
export async function saveConfig(kv: SiteKV, who: string, patch: unknown, what = 'Changed the site config') {
  const before = await loadConfig(kv);
  const after = cleanConfig({ ...before, ...(patch && typeof patch === 'object' ? patch : {}) }, before);
  await kv.put(CONFIG, JSON.stringify(after));
  await addLog(kv, { at: Date.now(), who, what, before, after });
  return { config: after };
}

/** Undo a logged change: the config goes back to what it was before it; a deleted user comes back from the trash. */
export async function undo(kv: SiteKV, who: string, at: unknown) {
  const rows = ((await kv.get(LOG, 'json')) as LogEntry[] | null) ?? [];
  const e = rows.find(r => r.at === at);
  if (!e || e.undone) return { error: 'Nothing to undo there.' };
  if (e.what.startsWith('Deleted user ')) {
    const id = e.what.slice('Deleted user '.length);
    const trash = (await kv.get(`trash:${id}`, 'json')) as Record<string, string> | null;
    if (!trash) return { error: 'The 7 days to undo it are over.' };
    for (const [k, v] of Object.entries(trash)) await kv.put(k, v);
    await kv.delete(`trash:${id}`);
  } else if (e.before) await kv.put(CONFIG, JSON.stringify(cleanConfig(e.before)));
  e.undone = true;
  await kv.put(LOG, JSON.stringify(rows));
  await addLog(kv, { at: Date.now(), who, what: `Undid: ${e.what}` });
  return { ok: true, config: await loadConfig(kv) };
}

// ---- users ---------------------------------------------------------------------------------------------------------

async function keys(kv: SiteKV, prefix: string, cap = 5000) {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor });
    out.push(...page.keys.map(k => k.name));
    cursor = page.list_complete || out.length >= cap ? undefined : page.cursor;
  } while (cursor);
  return out;
}

interface Stats { matches?: { at: number; name?: string }[]; prefs?: { public?: boolean }; puzzles?: { tried?: number } | null; puzzlesDeadlock?: { tried?: number } | null }
/** Players with a profile, newest activity first; `q` narrows by SteamID or in-game name. */
export async function users(kv: SiteKV, q: string, banned: string[]) {
  const ids = (await keys(kv, 'stats:')).map(k => k.slice(6));
  const want = q.trim().toLowerCase();
  const rows = [];
  for (const id of ids) {
    if (rows.length >= 50) break;
    if (want && /^\d+$/.test(want) && !id.includes(want)) continue;
    const s = (await kv.get(`stats:${id}`, 'json')) as Stats | null;
    if (!s) continue;
    const name = s.matches?.find(m => m.name)?.name ?? null;
    if (want && !/^\d+$/.test(want) && !(name ?? '').toLowerCase().includes(want)) continue;
    rows.push({
      steamId: id, name, matches: s.matches?.length ?? 0, lastSeen: Math.max(0, ...(s.matches ?? []).map(m => m.at)),
      public: !!s.prefs?.public, puzzles: (s.puzzles?.tried ?? 0) + (s.puzzlesDeadlock?.tried ?? 0), banned: banned.includes(id),
    });
  }
  return { rows: rows.sort((a, b) => b.lastSeen - a.lastSeen), total: ids.length };
}

/** Deletes a player's data, kept in the trash for 7 days so the log's Undo can bring it back. */
export async function deleteUser(kv: SiteKV, who: string, id: unknown) {
  if (typeof id !== 'string' || !/^7656\d{13}$/.test(id)) return { error: 'Which player?' };
  const trash: Record<string, string> = {};
  for (const k of [`stats:${id}`, `user:${id}`]) { const v = await kv.get(k); if (v) trash[k] = v; }
  if (!Object.keys(trash).length) return { error: 'No data for that player.' };
  await kv.put(`trash:${id}`, JSON.stringify(trash), { expirationTtl: 7 * 86400 });
  for (const k of Object.keys(trash)) await kv.delete(k);
  await addLog(kv, { at: Date.now(), who, what: `Deleted user ${id}` });
  return { ok: true };
}

// ---- bots, coach, health -------------------------------------------------------------------------------------------

export const BOTS_PAUSED = 'bots:paused';
export async function setBotsPaused(kv: SiteKV, who: string, on: unknown) {
  if (on) await kv.put(BOTS_PAUSED, String(Date.now())); else await kv.delete(BOTS_PAUSED);
  await addLog(kv, { at: Date.now(), who, what: on ? 'Paused the bots' : 'Started the bots again' });
  return { paused: !!on };
}

export interface CoachEval { at: number; game: 'cs2' | 'deadlock'; right: number; total: number; sha: string; note: string }
const EVALS = 'coach:evals';
/** The nightly check (.github/workflows/coach-check.yml): how often the coach agrees with the owner's rulings. */
export async function addCoachEval(kv: SiteKV, raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const e: CoachEval = {
    at: Date.now(), game: r.game === 'deadlock' ? 'deadlock' : 'cs2', right: Math.max(0, Math.round(+(r.right as number) || 0)),
    total: Math.max(0, Math.round(+(r.total as number) || 0)), sha: str(r.sha, 40), note: str(r.note, 300),
  };
  const rows = ((await kv.get(EVALS, 'json')) as CoachEval[] | null) ?? [];
  await kv.put(EVALS, JSON.stringify([e, ...rows].slice(0, 120)));
  return { ok: true };
}
export const coachEvals = async (kv: SiteKV) => ({ rows: ((await kv.get(EVALS, 'json')) as CoachEval[] | null) ?? [] });

/** Which secrets and settings the Worker has (present or missing, never the values). */
export function health(env: Record<string, unknown>) {
  const has = (k: string) => typeof env[k] === 'string' && (env[k] as string).trim().length > 0;
  return {
    secrets: Object.fromEntries(['STEAM_API_KEY', 'SERVER_TOKEN', 'GH_TOKEN'].map(k => [k, has(k)])),
    owners: String(env.OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    origins: String(env.SITE_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    proForAll: env.PRO_FOR_ALL === '1',
    rateLimits: !!env.RATE_PUBLIC && !!env.RATE_USER,
  };
}

/** Puzzle answers as the Worker counted them (pz:<id>, worker/src/puzzles.ts): for the dev page's puzzle quality. */
export async function puzzleStats(kv: SiteKV) {
  const rows: { id: string; tried: number; right: number; skipped: number }[] = [];
  for (const k of await keys(kv, 'pz:', 2000)) {
    if (k === 'pz:reports') continue;
    const v = (await kv.get(k, 'json')) as { tried?: number; right?: number; skipped?: number } | null;
    if (v?.tried || v?.skipped) rows.push({ id: k.slice(3), tried: v.tried ?? 0, right: v.right ?? 0, skipped: v.skipped ?? 0 });
  }
  const reports = ((await kv.get('pz:reports', 'json')) ?? []) as { id: string; why: string; pick: string; at: number }[];
  return { rows: rows.sort((a, b) => b.tried - a.tried), reports };
}

/** Client numbers for the dev page's status pills: recap grading time and client errors, a day's worth, sampled by the
 * site (so the free plan's KV writes hold). One key a day, kept 3 days. */
const TEL = (day: string) => `tel:${day}`;
interface Tel { grade: number[]; errors: { msg: string; page: string; at: number }[] }
export async function addTelemetry(kv: SiteKV, raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>, day = new Date().toISOString().slice(0, 10);
  const t = ((await kv.get(TEL(day), 'json')) as Tel | null) ?? { grade: [], errors: [] };
  if (r.kind === 'grade' && typeof r.ms === 'number' && r.ms > 0 && r.ms < 3_600_000) t.grade = [...t.grade, Math.round(r.ms)].slice(-500);
  else if (r.kind === 'error') t.errors = [{ msg: str(r.msg, 160), page: str(r.page, 40), at: Date.now() }, ...t.errors].slice(0, 100);
  else return { ok: false };
  await kv.put(TEL(day), JSON.stringify(t), { expirationTtl: 3 * 86400 });
  return { ok: true };
}
export async function telemetry(kv: SiteKV) {
  const days = [0, 1].map(d => new Date(Date.now() - d * 86400e3).toISOString().slice(0, 10));
  const all = (await Promise.all(days.map(d => kv.get(TEL(d), 'json')))) as (Tel | null)[];
  const grade = all.flatMap(t => t?.grade ?? []).sort((a, b) => a - b);
  const q = (p: number) => (grade.length ? grade[Math.min(grade.length - 1, Math.floor(p * grade.length))] : null);
  const errors = all.flatMap(t => t?.errors ?? []).filter(e => Date.now() - e.at < 86400e3);
  return { grading: { n: grade.length, p50: q(0.5), p95: q(0.95) }, errors: { n: errors.length, recent: errors.slice(0, 10) } };
}
