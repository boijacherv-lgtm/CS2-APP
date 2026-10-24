import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DemoData } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { useStore } from '../store';
import { delItem, getItem, gunzipJson, gzipJson, setItem } from './localStore';
import { DEMO_PASSES, readDemoInBrowser } from './readDemo';
import { PARSE_V } from '../../tools/demo-core.mjs';
import { steamFetch } from './steamApi';

/**
 * Website: "Your CS2 demo folder". You pick CS2's replays folder once (Chrome / Edge remember it); the page lists your
 * recent demos, reads the newest ones by itself in the background (in the browser, nothing uploaded), keeps the
 * results in this browser, and picks up new demos a few seconds after CS2 downloads them. No bot, no server.
 */

const AUTO_READ = 5; // newest demos read automatically; older ones on click
const RESCAN_MS = 8000;
const SHOW = 20;
// saved games are read again when the reader changes (PARSE_V) or the site's own summary does (V)
const V = 5; // 5: micro detail (stance, weapon, ammo; shot speed)
const KEY = (v: number, p: number) => `${v}${p ? `.${p}` : ''}`; // p 0: saved before PARSE_V was part of the key
const DEMO = (name: string) => `demo${KEY(V, PARSE_V)}:${name}`, SUM = (name: string) => `sum${KEY(V, PARSE_V)}:${name}`;
/** Older copies of a saved game, deleted once it's read again. */
const oldKeys = (name: string) => [
  ...Array.from({ length: V }, (_, i) => i + 1).map(v => `${v > 1 ? v : ''}`),
  ...Array.from({ length: PARSE_V }, (_, p) => KEY(V, p)).filter(k => k !== `${V}`),
].flatMap(k => [`demo${k}:${name}`, `sum${k}:${name}`]);

interface DemoFile { name: string; size: number; modified: number; handle: FileSystemFileHandle }
interface Summary {
  map: string; rounds: number;
  /** yours first when you played in it, otherwise the winner first */
  score: [number, number] | null; result: 'win' | 'loss' | 'tie' | null; kd: [number, number] | null;
  /** whose view the score is from (summaries made before you logged in are redone once you are) */
  checkedFor?: string | null;
}

// File System Access API (Chrome / Edge); not in TypeScript's DOM types yet
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};
const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// where CS2 keeps demos, from the folders people tend to pick (C:\, Program Files (x86), Steam, SteamLibrary, …)
const REPLAYS = ['steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'replays'];
const ROOTS = [['Program Files (x86)', 'Steam'], ['Program Files', 'Steam'], ['SteamLibrary'], ['Steam'], ['Games', 'SteamLibrary'], ['Games', 'Steam']];
const CHAINS = [...ROOTS.map(r => [...r, ...REPLAYS]), REPLAYS];

/** The replays folder inside whatever folder you picked: any folder on the way to it works. */
async function findReplays(picked: DirHandle): Promise<DirHandle | null> {
  if (picked.name.toLowerCase() === 'replays') return picked;
  const tried = new Set<string>();
  for (const chain of CHAINS) {
    // start from wherever the picked folder sits on this path (or from the top of it)
    const at = chain.findIndex(n => n.toLowerCase() === picked.name.toLowerCase());
    const rest = chain.slice(at + 1);
    if (tried.has(rest.join('/'))) continue;
    tried.add(rest.join('/'));
    let h: DirHandle | null = picked;
    for (const name of rest) {
      h = await h.getDirectoryHandle(name).then(x => x as DirHandle, () => null);
      if (!h) break;
    }
    if (h) return h;
  }
  return null;
}

/** Map, final score (from your team's side if you played in it, with W/L and your K/D). */
function summarize(d: DemoData, steamId: string | null): Summary {
  // follow the teams across halftime by their players: team A started on CT
  const r0 = d.rounds[0];
  const teamA = new Set(r0 ? Object.keys(r0.frames.players).filter(id => r0.frames.players[id].side === 'CT') : []);
  let a = 0, b = 0;
  for (const r of d.rounds) {
    if (!r.winner) continue;
    const ref = Object.keys(r.frames.players).find(id => teamA.has(id));
    const aSide = ref ? r.frames.players[ref].side : 'CT';
    if (r.winner === aSide) a++; else b++;
  }
  const played = !!steamId && d.rounds.some(r => r.frames.players[steamId]);
  if (!played) return { map: d.map, rounds: d.rounds.length, score: a + b ? [Math.max(a, b), Math.min(a, b)] : null, result: null, kd: null, checkedFor: steamId };
  const mine: [number, number] = teamA.has(steamId!) ? [a, b] : [b, a];
  const kills = d.rounds.reduce((n, r) => n + r.kills.filter(k => k.attacker === steamId && k.victim !== steamId).length, 0);
  const deaths = d.rounds.reduce((n, r) => n + r.kills.filter(k => k.victim === steamId).length, 0);
  return {
    map: d.map, rounds: d.rounds.length, score: mine,
    result: mine[0] > mine[1] ? 'win' : mine[0] < mine[1] ? 'loss' : 'tie',
    kd: [kills, deaths], checkedFor: steamId,
  };
}

export function DemoFolder() {
  const startReview = useStore(s => s.startReview);
  const [dir, setDir] = useState<DirHandle | null>(null);
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [files, setFiles] = useState<DemoFile[]>([]);
  const [sums, setSums] = useState<Record<string, Summary>>({});
  const [reading, setReading] = useState<{ name: string; pass: number } | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [steamId, setSteamId] = useState<string | null>(null);
  const busy = useRef(false);

  // who you are (for your score in each demo), if you're logged in with Steam
  useEffect(() => {
    steamFetch('/me').then(r => (r.ok ? r.json() : null)).then(j => setSteamId(j?.me?.steamId ?? null)).catch(() => {});
  }, []);

  // the folder you connected last time
  useEffect(() => {
    if (!supported) return;
    getItem<DirHandle>('replaysDir').then(async h => {
      if (!h) return;
      setDir(h);
      setPerm(await h.queryPermission({ mode: 'read' }).catch(() => 'prompt' as PermissionState));
    });
  }, []);

  const scan = useCallback(async () => {
    if (!dir || perm !== 'granted') return;
    try {
      const out: DemoFile[] = [];
      for await (const h of dir.values()) {
        if (h.kind !== 'file' || !/\.dem$/i.test(h.name)) continue;
        const f = await (h as FileSystemFileHandle).getFile();
        out.push({ name: h.name, size: f.size, modified: f.lastModified, handle: h as FileSystemFileHandle });
      }
      out.sort((a, b) => b.modified - a.modified);
      const known: Record<string, Summary> = {};
      for (const f of out.slice(0, SHOW)) {
        let s = await getItem<Summary>(SUM(f.name));
        // made before we knew who you are (or by an older version): redo it from the saved game
        if (s && (s.checkedFor === undefined || (steamId && s.checkedFor !== steamId))) {
          const blob = await getItem<Blob>(DEMO(f.name));
          if (blob) { s = summarize(await gunzipJson<DemoData>(blob), steamId); await setItem(SUM(f.name), s); }
        }
        if (s) known[f.name] = s;
      }
      // together, so the auto-reader never sees a saved game without its summary (and reads it again)
      setSums(prev => ({ ...prev, ...known }));
      setFiles(out);
    } catch (e) {
      setMsg(`Couldn't read the folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [dir, perm, steamId]);

  useEffect(() => {
    scan();
    if (perm !== 'granted') return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') scan(); }, RESCAN_MS);
    return () => clearInterval(t);
  }, [scan, perm]);

  /** Reads one demo in the browser and keeps the result here. */
  const read = useCallback(async (f: DemoFile) => {
    if (busy.current) return;
    busy.current = true;
    setReading({ name: f.name, pass: 0 });
    try {
      const file = await f.handle.getFile();
      // a demo CS2 is still writing keeps growing: wait until it's finished
      if (Date.now() - file.lastModified < 5000) throw new Error('still downloading');
      const data = await readDemoInBrowser(file, pass => setReading({ name: f.name, pass }));
      if (file.lastModified) data.playedAt = file.lastModified; // when it was played (CS2 saves it right after)
      if (!MAPS.some(m => m.id === data.map)) throw new Error(`${data.map} isn't one of the supported maps`);
      await setItem(DEMO(f.name), await gzipJson(data));
      const s = summarize(data, steamId);
      await setItem(SUM(f.name), s);
      for (const k of oldKeys(f.name)) delItem(k);
      setSums(prev => ({ ...prev, [f.name]: s }));
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (why !== 'still downloading') setFailed(prev => ({ ...prev, [f.name]: why }));
    } finally {
      busy.current = false;
      setReading(null);
    }
  }, [steamId]);

  // read the newest demos by themselves, one at a time
  useEffect(() => {
    if (reading || busy.current) return;
    const next = files.slice(0, AUTO_READ).find(f => !sums[f.name] && !failed[f.name]);
    if (next) read(next);
  }, [files, sums, failed, reading, read]);

  const open = async (f: DemoFile) => {
    const blob = await getItem<Blob>(DEMO(f.name));
    if (!blob) return read(f);
    startReview(await gunzipJson<DemoData>(blob));
  };

  const connect = async () => {
    setMsg(null);
    try {
      const picked = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'cs2-replays', mode: 'read' });
      const h = await findReplays(picked);
      if (!h) { setMsg(`No CS2 demo folder inside "${picked.name}". Pick your Steam folder (or SteamLibrary), or CS2's replays folder itself.`); return; }
      await setItem('replaysDir', h);
      setDir(h);
      setPerm('granted');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg(`Couldn't open that folder: ${(e as Error).message}`);
    }
  };
  const reconnect = async () => { if (dir) setPerm(await dir.requestPermission({ mode: 'read' })); };
  const disconnect = async () => { await delItem('replaysDir'); setDir(null); setPerm(null); setFiles([]); };

  if (!supported) {
    return (
      <section className="steam">
        <div className="steam-head"><h2>Your CS2 demo folder</h2></div>
        <p className="muted">Open this page in <b>Chrome</b> or <b>Edge</b> to connect CS2's demo folder (this browser can't). You can still drop demos into the box above.</p>
      </section>
    );
  }

  return (
    <section className="steam">
      <div className="steam-head">
        <h2>Your CS2 demo folder</h2>
        {dir && perm === 'granted' && <button onClick={() => scan()}>Refresh</button>}
        {dir && <button onClick={disconnect} title="Forget the folder (the games already read stay)">Disconnect</button>}
      </div>

      {!dir && (
        <div className="steam-profile">
          <p>Pick your <b>Steam</b> folder (or <b>SteamLibrary</b>) once: the site finds CS2's demos inside it, and your downloaded games show up here by themselves, read and ready to review. Nothing is uploaded.</p>
          <div className="row"><button className="primary" onClick={connect}>Choose your Steam folder</button></div>
          <p className="muted">
            Usually <code>C:\Program Files (x86)\Steam</code> or <code>D:\SteamLibrary</code> (where CS2 is installed). Picking{' '}
            <code>…\csgo\replays</code> itself works too. CS2 saves a demo there when you press
            Download in Watch → Your Matches (or <b>Download in CS2</b> below).
          </p>
        </div>
      )}
      {dir && perm !== 'granted' && (
        <div className="row"><button className="primary" onClick={reconnect}>Reconnect "{dir.name}"</button><span className="muted">the browser asks once per visit</span></div>
      )}
      {msg && <p className="warn-text">{msg}</p>}
      {reading && <p className="muted">Reading {reading.name}… step {reading.pass} of ~{DEMO_PASSES}</p>}

      {dir && perm === 'granted' && (files.length === 0
        ? <p className="muted">No demos in "{dir.name}" yet. Download one in CS2 and it appears here.</p>
        : (
          <table className="steam-list">
            <tbody>
              {files.slice(0, SHOW).map(f => {
                const s = sums[f.name];
                return (
                  <tr key={f.name} className={s?.result ?? ''} style={{ '--radar': s ? `url(/images/maps/${s.map}.png)` : 'none' } as CSSProperties}>
                    <td>{new Date(f.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{s ? MAPS.find(m => m.id === s.map)?.name ?? s.map : <span className="muted">{(f.size / 1e6).toFixed(0)} MB</span>}</td>
                    <td className={s?.result ?? ''}>{s?.score ? `${s.score[0]}–${s.score[1]}${s.result ? ` ${s.result.toUpperCase()}` : ''}` : s ? `${s.rounds} rounds` : ''}</td>
                    <td className="muted">{s?.kd ? `${s.kd[0]}/${s.kd[1]}` : ''}</td>
                    <td>
                      {s ? <button onClick={() => open(f)}>Review</button>
                        : reading?.name === f.name ? <span className="muted">reading…</span>
                        : failed[f.name] ? <span className="warn-text" title={failed[f.name]}>couldn't read</span>
                        : <button onClick={() => read(f)} disabled={!!reading}>Read</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </section>
  );
}
