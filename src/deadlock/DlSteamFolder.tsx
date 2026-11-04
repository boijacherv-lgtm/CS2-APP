import { useCallback, useEffect, useRef, useState } from 'react';
import { Loading } from '../ui/Loading';
import { delItem, getItem, setItem } from '../ui/localStore';
import { Icon } from '../ui/Icon';
import { loadMatch } from './api';
import { heroOf } from './data';
import type { DlMatch } from './match';

/**
 * Review: "Your Steam folder". Like CS2's demo folder: you pick your Steam folder once (Chrome / Edge remember it), and
 * the page reads Steam's download cache (appcache/httpcache) for the Deadlock matches Steam fetched when you played
 * them or opened them in Match history: their links hold each match's keys (salts). Only those keys go to deadlock-api
 * (its public ingest), which then fetches the match and, when Valve kept one, its replay. Nothing else leaves your PC.
 * The folder is looked at again every 30 s while the page is open, so new matches come in by themselves.
 * (The same as deadlock-api's own "upload your Steam cache", deadlock-api.com/ingest-cache.)
 */

const API = 'https://api.deadlock-api.com';
const RESCAN_MS = 30_000;
const SHOW = 12;
/** A Deadlock match file link in the cache: replay<cluster>.valve.net/1422450/<match>_<salt>.(meta|dem).bz2 */
const LINK = /replay(\d+)\.valve\.net\/1422450\/(\d+)_(\d+)\.(meta|dem)\.bz2/g;
const SENT = 'stratboard.dlsalts.sent';

export interface Found { match_id: number; cluster_id: number; metadata_salt: number | null; replay_salt: number | null; seen: number;
  /** A replay file Deadlock downloaded (its replays folder): no keys, the match is loaded by its ID. */
  file?: boolean }

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};
const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// Steam's cache folder and Deadlock's replays folder from wherever you picked: the folder itself, any folder on the way
// to it (the Steam folder, a SteamLibrary, steamapps, Deadlock), or a drive / home above it
const CACHE = ['appcache', 'httpcache'];
const REPLAYS = ['steamapps', 'common', 'Deadlock', 'game', 'citadel', 'replays'];
const ROOTS = [['Program Files (x86)', 'Steam'], ['Program Files', 'Steam'], ['Steam'], ['Library', 'Application Support', 'Steam'], ['Application Support', 'Steam'], ['.steam', 'steam'], ['.local', 'share', 'Steam']];
const LIBRARIES = [...ROOTS, ['SteamLibrary'], ['Games', 'SteamLibrary'], ['Games', 'Steam']];
const findCache = (picked: DirHandle) => findIn(picked, [...ROOTS.map(r => [...r, ...CACHE]), CACHE]);
const findReplays = (picked: DirHandle) => findIn(picked, [...LIBRARIES.map(r => [...r, ...REPLAYS]), REPLAYS]);
async function findIn(picked: DirHandle, chains: string[][]): Promise<DirHandle | null> {
  if (picked.name.toLowerCase() === chains[0].at(-1)!.toLowerCase()) return picked;
  for (const chain of chains) {
    const at = chain.findIndex(n => n.toLowerCase() === picked.name.toLowerCase());
    let h: DirHandle | null = picked;
    for (const name of chain.slice(at + 1)) {
      h = await h.getDirectoryHandle(name).then(x => x as DirHandle, () => null);
      if (!h) break;
    }
    if (h) return h;
  }
  return null;
}

/** Adds the match links in some text (a cached file's start) to `into`: the data file's key, or the replay's. */
export function matchLinks(text: string, seen: number, into: Map<number, Found>) {
  for (const m of text.matchAll(LINK)) {
    const id = Number(m[2]), f = into.get(id) ?? { match_id: id, cluster_id: Number(m[1]), metadata_salt: null, replay_salt: null, seen: 0 };
    if (m[4] === 'meta') f.metadata_salt = Number(m[3]); else f.replay_salt = Number(m[3]);
    f.seen = Math.max(f.seen, seen);
    into.set(id, f);
  }
  return into;
}
/** The match links in one cached file (they're in its first few hundred bytes). */
async function linksIn(file: File, into: Map<number, Found>) {
  const head = new Uint8Array(await file.slice(0, 400).arrayBuffer());
  matchLinks(String.fromCharCode(...head), file.lastModified, into);
}
async function scanDir(dir: FileSystemDirectoryHandle, into: Map<number, Found>, known: Map<string, number>, path = '') {
  for await (const h of (dir as DirHandle).values()) {
    const p = `${path}/${h.name}`;
    if (h.kind === 'directory') await scanDir(h as FileSystemDirectoryHandle, into, known, p);
    else {
      const f = await (h as FileSystemFileHandle).getFile();
      // unchanged since the last look: already counted
      if (known.get(p) === f.lastModified) continue;
      known.set(p, f.lastModified);
      await linksIn(f, into);
    }
  }
}
/** A replay file's match: Deadlock names them by match ID (`<match>.dem`; any long number in the name is taken). */
export function replayFile(name: string, seen: number, into: Map<number, Found>) {
  const id = /\.dem$/i.test(name) ? Number(name.match(/(\d{6,})/)?.[1]) : 0;
  if (!id) return into;
  const f = into.get(id) ?? { match_id: id, cluster_id: 0, metadata_salt: null, replay_salt: null, seen: 0 };
  f.file = true; f.seen = Math.max(f.seen, seen);
  into.set(id, f);
  return into;
}
async function scanReplays(dir: FileSystemDirectoryHandle, into: Map<number, Found>) {
  for await (const h of (dir as DirHandle).values()) {
    if (h.kind === 'file' && /\.dem$/i.test(h.name)) replayFile(h.name, (await (h as FileSystemFileHandle).getFile()).lastModified, into);
  }
}
/** A dropped folder (any browser): its files, through the old entries API (replay files by name, the rest read). */
async function scanEntry(entry: FileSystemEntry, into: Map<number, Found>): Promise<void> {
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    return /\.dem$/i.test(f.name) ? void replayFile(f.name, f.lastModified, into) : linksIn(f, into);
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) return;
    for (const e of batch) await scanEntry(e, into);
  }
}

const sentSet = (): Set<number> => { try { return new Set(JSON.parse(localStorage.getItem(SENT) ?? '[]')); } catch { return new Set(); } };
/** Hands matches' keys to deadlock-api (the ones not sent from this browser before). */
async function submit(found: Found[]) {
  const sent = sentSet(), fresh = found.filter(f => !sent.has(f.match_id));
  if (!fresh.length) return 0;
  const res = await fetch(`${API}/v1/matches/salts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fresh.map(f => ({ match_id: f.match_id, cluster_id: f.cluster_id, metadata_salt: f.metadata_salt, replay_salt: f.replay_salt, username: 'rageview' }))),
  });
  if (!res.ok) throw new Error(`deadlock-api answered ${res.status}.`);
  for (const f of fresh) sent.add(f.match_id);
  try { localStorage.setItem(SENT, JSON.stringify([...sent].slice(-2000))); } catch { /* full: sent again next time, harmless */ }
  return fresh.length;
}

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function DlSteamFolder({ account, open, busy }: { account: string | null; open: (id: number) => void; busy: number | null }) {
  const [dir, setDir] = useState<DirHandle | null>(null);
  const [replays, setReplays] = useState<DirHandle | null>(null);
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [matches, setMatches] = useState<Record<number, DlMatch | 'missing'>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [drag, setDrag] = useState(false);
  const all = useRef(new Map<number, Found>()), known = useRef(new Map<string, number>()), tried = useRef(new Map<number, number>());

  // the folder picked last time
  useEffect(() => {
    if (!supported) return;
    Promise.all([getItem<DirHandle>('dlSteamCache'), getItem<DirHandle>('dlReplays')]).then(async ([h, r]) => {
      const first = h ?? r;
      if (!first) return;
      setDir(h ?? null); setReplays(r ?? null);
      setPerm(await first.queryPermission({ mode: 'read' }).catch(() => 'prompt' as PermissionState));
    });
  }, []);

  /** New matches found: send their keys, then list them (newest first). */
  const take = useCallback(async () => {
    const list = [...all.current.values()].filter(f => f.metadata_salt !== null || f.file).sort((a, b) => b.seen - a.seen);
    setFound(list);
    try {
      const n = await submit(list.filter(f => f.metadata_salt !== null));
      if (n) setMsg(`${n} new match${n === 1 ? '' : 'es'} sent to deadlock-api.`);
    } catch (e) { setMsg(`Couldn't send the matches: ${e instanceof Error ? e.message : String(e)}`); }
  }, []);

  const scan = useCallback(async () => {
    if ((!dir && !replays) || perm !== 'granted' || scanning) return;
    setScanning(true);
    try {
      if (dir) await scanDir(dir, all.current, known.current);
      if (replays) await scanReplays(replays, all.current);
      await take();
    } catch (e) { setMsg(`Couldn't read the folder: ${e instanceof Error ? e.message : String(e)}`); }
    setScanning(false);
  }, [dir, replays, perm, scanning, take]);

  useEffect(() => {
    if (perm !== 'granted') return;
    void scan();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void scan(); }, RESCAN_MS);
    return () => clearInterval(t);
  }, [perm, dir, replays]); // eslint-disable-line react-hooks/exhaustive-deps

  // the newest few: read each match (deadlock-api has it now) for its hero, score and result
  useEffect(() => {
    let live = true;
    (async () => {
      for (const f of found.slice(0, SHOW)) {
        // read once; one deadlock-api hadn't fetched yet is tried again after 2 minutes
        const had = matches[f.match_id];
        if (!live || (had && had !== 'missing') || Date.now() - (tried.current.get(f.match_id) ?? 0) < 120_000) continue;
        tried.current.set(f.match_id, Date.now());
        const m = await loadMatch(f.match_id).catch(() => 'missing' as const);
        if (live) setMatches(x => ({ ...x, [f.match_id]: m }));
      }
    })();
    return () => { live = false; };
  }, [found]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pick a folder: the Steam folder (its cache, and Deadlock's replays when Deadlock is installed there), or the
   * library / Deadlock / replays folder when Deadlock is on another drive. */
  const connect = async () => {
    setMsg(null);
    try {
      const picked = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'steam-deadlock', mode: 'read' });
      const [h, r] = await Promise.all([findCache(picked), findReplays(picked)]);
      if (!h && !r) { setMsg(`No Steam cache or Deadlock replays inside "${picked.name}". Pick your Steam folder, or the SteamLibrary where Deadlock is installed.`); return; }
      if (h) { await setItem('dlSteamCache', h); setDir(h); }
      if (r) { await setItem('dlReplays', r); setReplays(r); }
      setPerm('granted');
      setMsg([h ? 'Steam\'s cache found' : null, r ? 'Deadlock\'s replays found' : 'Deadlock\'s replays not in there (installed on another drive? add its folder below)'].filter(Boolean).join(' · '));
    } catch (e) { if ((e as Error).name !== 'AbortError') setMsg(`Couldn't open that folder: ${(e as Error).message}`); }
  };
  const reconnect = async () => {
    const st = await Promise.all([dir, replays].filter((x): x is DirHandle => !!x).map(h => h.requestPermission({ mode: 'read' })));
    setPerm(st.every(x => x === 'granted') ? 'granted' : 'denied');
  };
  const disconnect = async () => { await delItem('dlSteamCache'); await delItem('dlReplays'); setDir(null); setReplays(null); setPerm(null); };
  // a folder dropped on the card (any browser; read once)
  const drop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false); setMsg(null);
    const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    if (!entries.length) return;
    setScanning(true);
    try { for (const en of entries) await scanEntry(en, all.current); await take(); } catch (err) { setMsg(`Couldn't read that folder: ${err instanceof Error ? err.message : String(err)}`); }
    setScanning(false);
  };

  const row = (f: Found) => {
    const m = matches[f.match_id];
    const me = m && m !== 'missing' && account ? m.players.find(p => String(p.account) === account) : null;
    const h = me ? heroOf(me.hero) : null, won = me && m && m !== 'missing' ? m.winner === me.team : null;
    return (
      <li key={f.match_id}>
        <button className={`dl-row ${won === null ? '' : won ? 'win' : 'loss'}`} onClick={() => open(f.match_id)} disabled={busy !== null || m === 'missing'}>
          {h?.card ? <img src={h.card} alt="" width={36} height={36} loading="lazy" /> : <span className="dl-hero-dot" />}
          <span className="dl-row-hero"><b>{h?.name ?? `Match ${f.match_id}`}{f.file ? <span className="dl-row-demo read" title="You downloaded its replay in Deadlock">Replay file</span> : f.replay_salt !== null && <span className="dl-row-demo listed" title="Steam had its replay link">Demo</span>}</b>
            <span className="muted small">{m && m !== 'missing' ? `${new Date(m.start * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${mins(m.duration)}` : m === 'missing' ? 'deadlock-api hasn\'t fetched it yet' : 'reading…'}</span></span>
          {won !== null && <span className={`dl-row-result ${won ? 'win' : 'loss'}`}>{won ? 'Win' : 'Loss'}</span>}
          {me && <span className="dl-row-kda num">{me.kills}/{me.deaths}/{me.assists}</span>}
          {me && <span className="dl-row-souls num muted">{(me.netWorth / 1000).toFixed(1)}k souls</span>}
          <span className="dl-row-go">{busy === f.match_id ? 'Loading…' : <Icon name="arrowRight" size={14} />}</span>
        </button>
      </li>
    );
  };

  return (
    <section className={`site-card dl-folder ${drag ? 'drag' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop}>
      <div className="card-head">
        <h2>Your Steam folder</h2>
        {(dir || replays) && perm === 'granted' && <button className="ghost small-btn" disabled={scanning} onClick={() => void scan()}>{scanning ? 'Looking…' : 'Refresh'}</button>}
        {(dir || replays) && <button className="ghost small-btn" onClick={disconnect} title="Forget the folders (matches already found stay on deadlock-api)">Disconnect</button>}
      </div>
      {(dir || replays) && perm === 'granted' && (
        <p className="dl-folder-where muted small">
          Watching {[dir ? 'Steam\'s cache' : null, replays ? 'Deadlock\'s replays' : null].filter(Boolean).join(' and ')}.
          {!replays && supported && <> <button className="link-btn" onClick={connect}>Add Deadlock's folder</button></>}
          {!dir && supported && <> <button className="link-btn" onClick={connect}>Add your Steam folder</button></>}
        </p>
      )}
      {!dir && !replays && (
        <div className="dl-folder-intro">
          <p className="muted small">Pick it once: your matches and downloaded replays load here by themselves. Only match IDs leave your PC.</p>
          <div className="row">
            {supported && <button className="cta primary" onClick={connect}>Choose your Steam folder</button>}
            <span className="muted small" title="Usually C:\Program Files (x86)\Steam. Deadlock on another drive? Pick that drive's SteamLibrary too.">{supported ? 'or drop' : 'Drop'} it here</span>
          </div>
        </div>
      )}
      {(dir || replays) && perm !== 'granted' && <div className="row"><button className="cta primary" onClick={reconnect}>Reconnect your folders</button><span className="muted small">the browser asks once per visit</span></div>}
      {msg && <p className="muted small">{msg}</p>}
      {scanning && !found.length && <Loading>Looking through Steam's cache…</Loading>}
      {found.length > 0 && <ul className="dl-rows">{found.slice(0, SHOW).map(row)}</ul>}
      {((dir || replays) && perm === 'granted') && !scanning && !found.length && <p className="empty-state">No matches yet. Open one in Deadlock's Match history and it shows up here.</p>}
    </section>
  );
}
