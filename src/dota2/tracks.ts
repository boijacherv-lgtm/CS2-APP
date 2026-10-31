/**
 * Where every hero really was, from the match's replay: fetched through our own proxy (Valve's server doesn't let a
 * web page read it), read in a background worker, kept in this browser so it's only ever read once.
 */
import { API_URL, ONLINE } from '../env';
import { getItem, gunzipJson, gzipJson, setItem } from '../ui/localStore';
import { cellToMap, type Pt } from './data';
import type { ReplayTracks, UnitKind } from './replay/parser';
import type { ReplayWorkerIn, ReplayWorkerOut } from './replay/worker';

const KEY = (id: number) => `d2tracks5:${id}`;
/** A way drawn behind a hero uses every this many samples. */
const TRAIL_STEP = 4;
/** A jump this long (in map cells) between two samples is a teleport or a respawn: no sliding across the map. */
const TELEPORT = 4;

export type TrackProgress = { step: 'download' | 'unpack' | 'read'; share: number };

/** The replay's address on the proxy: the dev server here, the Worker on the website (none: can't be fetched). */
function proxied(url: string): string | null {
  const q = `url=${encodeURIComponent(url)}`;
  if (!ONLINE) return `/api/dota-replay?${q}`;
  return API_URL ? `${API_URL}/dota-replay?${q}` : null;
}

/** A match's tracks: from this browser when read before, else from its replay. `stop` gives up on the way. */
export function loadTracks(matchId: number, replayUrl: string | null, onProgress: (p: TrackProgress) => void) {
  let worker: Worker | null = null;
  const done = (async (): Promise<ReplayTracks> => {
    const saved = await getItem<Blob>(KEY(matchId));
    if (saved) { try { return await gunzipJson<ReplayTracks>(saved); } catch { /* read it again */ } }
    if (!replayUrl) throw new Error('OpenDota has no replay address for this match yet.');
    const url = proxied(replayUrl);
    if (!url) throw new Error('Reading replays needs the site\'s server.');
    const tracks = await new Promise<ReplayTracks>((resolve, reject) => {
      worker = new Worker(new URL('./replay/worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ReplayWorkerOut>) => {
        const m = e.data;
        if ('tracks' in m) resolve(m.tracks);
        else if ('error' in m) reject(new Error(m.error));
        else onProgress(m);
      };
      worker.onerror = e => reject(new Error(e.message || 'The replay reader stopped.'));
      worker.postMessage({ url } satisfies ReplayWorkerIn);
    });
    void setItem(KEY(matchId), await gzipJson(tracks));
    return tracks;
  })();
  void done.catch(() => {}).finally(() => (worker as Worker | null)?.terminate());
  return { done, stop: () => (worker as Worker | null)?.terminate() };
}

export interface HeroPos { at: Pt; hp: number }
type Hero = ReplayTracks['heroes'][number];
/** A hero's position is averaged over this moment and those around it (s from it, weight): takes the corners off their way. */
const SMOOTH: [number, number][] = [[-0.4, 1], [-0.2, 2], [0, 3], [0.2, 2], [0.4, 1]];

/** The last sample at or before t. */
function rowAt(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Straight between the two samples around t, except across a teleport. */
function between(times: number[], h: Hero, t: number): { x: number; y: number } {
  const i = rowAt(times, t), j = Math.min(i + 1, times.length - 1);
  const x = h.x[i], y = h.y[i], dx = h.x[j] - x, dy = h.y[j] - y, span = times[j] - times[i];
  if (j === i || span <= 0 || t <= times[i] || Math.hypot(dx, dy) >= TELEPORT) return { x, y };
  const f = Math.min(1, (t - times[i]) / span);
  return { x: x + dx * f, y: y + dy * f };
}

/** Where a hero is at time t: gliding along their way, except across a teleport, which stays a jump. */
export function heroAt(tracks: ReplayTracks, heroId: number, t: number): HeroPos | null {
  const h = tracks.heroes.find(x => x.heroId === heroId);
  if (!h || !tracks.times.length) return null;
  const { times } = tracks, here = between(times, h, t);
  let x = 0, y = 0, sum = 0;
  for (const [dt, w] of SMOOTH) {
    const p = between(times, h, t + dt);
    // the other side of a teleport or a respawn isn't part of this stretch
    if (Math.hypot(p.x - here.x, p.y - here.y) >= TELEPORT) continue;
    x += p.x * w; y += p.y * w; sum += w;
  }
  return { at: cellToMap(x / sum, y / sum), hp: h.hp[rowAt(times, t)] };
}

/** What a hero carries at time t, by slot (see ReplayHero.items); null when the replay doesn't have them. */
export function itemsAt(tracks: ReplayTracks, heroId: number, t: number): (string | null)[] | null {
  const list = tracks.heroes.find(x => x.heroId === heroId)?.items;
  if (!list?.length) return null;
  let lo = 0, hi = list.length - 1;
  if (t < list[0].t) return list[0].slots;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return list[lo].slots;
}

export interface UnitNow { kind: UnitKind; team: number; at: Pt; hp?: number; rune?: number }

/** Every creep, Roshan, rune and courier alive at time t, sliding between their samples. */
export function unitsAt(tracks: ReplayTracks, t: number): UnitNow[] {
  const { unitTimes: times, units } = tracks, out: UnitNow[] = [];
  if (!times.length || t < times[0]) return out;
  const row = rowAt(times, t);
  for (const u of units) {
    if (row < u.from) continue;
    const i = Math.floor((row - u.from) / u.every);
    if (i >= u.x.length || !u.x[i]) continue;
    let x = u.x[i], y = u.y[i];
    const j = i + 1;
    if (j < u.x.length && u.x[j]) {
      const a = times[u.from + i * u.every], b = times[u.from + j * u.every], dx = u.x[j] - x, dy = u.y[j] - y;
      if (b > a && t > a && Math.hypot(dx, dy) < TELEPORT * 10) { const f = Math.min(1, (t - a) / (b - a)); x += dx * f; y += dy * f; }
    }
    out.push({ kind: u.kind, team: u.team, at: cellToMap(x / 10, y / 10), hp: u.hp?.[i], rune: u.rune });
  }
  return out;
}

/** A hero's way over the last `seconds`, as map points (cut at a teleport or a death, so it doesn't cross the map). */
export function heroTrail(tracks: ReplayTracks, heroId: number, t: number, seconds: number): Pt[] {
  const h = tracks.heroes.find(x => x.heroId === heroId);
  if (!h || !tracks.times.length) return [];
  const pts: Pt[] = [];
  const to = rowAt(tracks.times, t);
  for (let i = to; i >= 0 && t - tracks.times[i] <= seconds; i -= TRAIL_STEP) {
    if (!h.hp[i]) break;
    if (i < to && Math.hypot(h.x[i] - h.x[i + TRAIL_STEP], h.y[i] - h.y[i + TRAIL_STEP]) >= TELEPORT * 2) break;
    pts.push(cellToMap(h.x[i], h.y[i]));
  }
  return pts.reverse();
}
