import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoData } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { useStore } from '../store';
import type { SteamMatch, SteamStatus } from '../../tools/steam.mjs';

const SYNC_EVERY = 5 * 60 * 1000; // new games show up by themselves

/**
 * "Your matches" on the review start page. Paste your Steam profile link once; the list fills itself
 * from Leetify's public API (or Valve's match-history API under Advanced) and refreshes every few
 * minutes. "Download in CS2" uses Valve's own link; the dev server watches CS2's replays folder and
 * imports the demo by itself, then the row turns into "Review". No Steam sign-in anywhere.
 * Layout is plain on purpose; styling is up to the design pass.
 */
export function SteamMatches() {
  const startReview = useStore(s => s.startReview);
  const [st, setSt] = useState<SteamStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [profile, setProfile] = useState('');
  const [waiting, setWaiting] = useState<Set<string>>(new Set()); // clicked "Download in CS2"

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/steam/status');
      if (!res.ok) throw new Error();
      setSt(await res.json());
      setOffline(false);
    } catch { setOffline(true); }
  }, []);

  const post = useCallback(async <T,>(route: string, body?: unknown): Promise<T> => {
    const res = await fetch(`/api/steam/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? res.statusText);
    return out;
  }, []);

  const sync = useCallback(async (quiet = false) => {
    if (!quiet) setMsg('Looking for your matches…');
    try {
      const r = await post<{ added: number; note: string | null }>('sync');
      if (!quiet) setMsg(r.added ? `${r.added} new match${r.added > 1 ? 'es' : ''}.` : null);
    } catch (e) { if (!quiet) setMsg(errText(e)); }
    refresh();
  }, [post, refresh]);

  const hasProfile = !!st?.configured.steamId;
  // status every few seconds (imports land by themselves), match list every few minutes
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);
  const started = useRef(false);
  useEffect(() => {
    if (!hasProfile) return;
    if (!started.current) { started.current = true; sync(); }
    const t = setInterval(() => sync(true), SYNC_EVERY);
    return () => clearInterval(t);
  }, [hasProfile, sync]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try { await post('settings', { profile }); setProfile(''); started.current = false; await sync(); }
    catch (x) { setMsg(errText(x)); }
    refresh();
  };

  const open = async (m: SteamMatch) => {
    try {
      const data = await post<DemoData>('load', { outcomeId: m.outcomeId });
      if (!MAPS.some(x => x.id === data.map)) throw new Error(`${data.map} isn't one of the supported maps.`);
      startReview(data);
    } catch (e) { setMsg(errText(e)); }
  };

  if (offline || !st) return null; // static build without the dev server: only manual demos

  return (
    <section className="steam">
      <div className="steam-head">
        <h2>Your matches</h2>
        {hasProfile && <button onClick={() => sync()} disabled={st.syncing}>{st.syncing ? 'Checking…' : 'Refresh'}</button>}
        <button onClick={() => setAdvanced(!advanced)}>{advanced ? 'Close settings' : hasProfile ? 'Settings' : 'Advanced'}</button>
      </div>

      {!hasProfile && (
        <form className="steam-profile" onSubmit={saveProfile}>
          <p>Paste your Steam profile link and your recent matches show up here by themselves. No Steam sign-in, no password.</p>
          <div className="row">
            <input value={profile} onChange={e => setProfile(e.target.value)} placeholder="https://steamcommunity.com/id/yourname" spellCheck={false} />
            <button type="submit" className="primary" disabled={!profile.trim()}>Show my matches</button>
          </div>
          <p className="muted">Match lists come from <a href="https://leetify.com" target="_blank" rel="noreferrer">Leetify</a>'s public data, so you need a free Leetify account with match tracking on (Sign in through Steam on their site). No Leetify? Use the Valve setup under Advanced.</p>
        </form>
      )}

      {advanced && <Advanced st={st} post={post} onDone={() => { setAdvanced(false); started.current = false; refresh(); }} />}

      {msg && <p className="muted">{msg}</p>}
      {hasProfile && st.note && <p className="warn-text">{st.note}</p>}
      {st.importing.file && <p className="muted">Importing {st.importing.file} from CS2's replays folder…</p>}
      {st.importing.error && <p className="warn-text">Couldn't import {st.importing.error}</p>}

      {hasProfile && st.matches.length > 0 && (
        <>
          <p className="muted">
            {st.source === 'leetify' ? 'From Leetify' : 'From Valve'} · updates every few minutes.{' '}
            {st.replays.length
              ? <>Demos downloaded with <b>Download in CS2</b> are imported automatically.</>
              : <>CS2's replays folder wasn't found on this computer: drop downloaded demos in the box above (or set the folder under Settings).</>}
          </p>
          <table className="steam-list">
            <tbody>
              {st.matches.map(m => (
                <tr key={m.code}>
                  <td>{m.time ? new Date(m.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</td>
                  <td className="muted">{m.source.startsWith('matchmaking') ? '' : m.source}</td>
                  <td>{m.map ? MAPS.find(x => x.id === m.map)?.name ?? m.map : <span className="muted">not loaded yet</span>}</td>
                  <td className={m.result ?? ''}>{m.scores ? `${m.scores[0]}–${m.scores[1]}` : ''} {m.result ? m.result.toUpperCase() : ''}</td>
                  <td className="muted">{m.kd ? `${m.kd[0]}/${m.kd[1]}` : ''}</td>
                  <td>
                    {m.parsed
                      ? <button onClick={() => open(m)}>Review</button>
                      : m.download
                        ? <a className="btn" href={m.download} onClick={() => setWaiting(new Set(waiting).add(m.code))}
                            title="Opens CS2, which downloads the demo; the app imports it by itself">
                            {waiting.has(m.code) ? 'Downloading in CS2…' : 'Download in CS2'}
                          </a>
                        : <span className="muted" title="Not a Valve matchmaking game: get the demo from that platform and drop it above">no Valve demo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Profile, Valve's own match-history setup (fallback without Leetify) and the CS2 replays folder. */
function Advanced({ st, post, onDone }: { st: SteamStatus; post: <T>(route: string, body?: unknown) => Promise<T>; onDone: () => void }) {
  const c = st.configured;
  const [f, setF] = useState({ profile: '', apiKey: '', authCode: '', knownCode: '', replaysDir: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await post('settings', f); onDone(); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const forget = async () => { try { await post('forget'); onDone(); } catch (x) { setErr(errText(x)); } };
  const row = (k: keyof typeof f, label: string, ok: boolean, placeholder: string, help: React.ReactNode, secret = false) => (
    <label className="steam-field">
      <span>{ok ? '✓' : '○'} {label}</span>
      <input value={f[k]} onChange={set(k)} placeholder={ok ? 'saved (leave empty to keep)' : placeholder} type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} />
      <small className="muted">{help}</small>
    </label>
  );
  return (
    <form className="steam-setup" onSubmit={save}>
      {row('profile', 'Steam profile', c.steamId, 'https://steamcommunity.com/id/…', <>Your profile link or SteamID64.</>)}
      <p className="muted">
        <b>Without Leetify:</b> Valve's own match-history API (the one Leetify uses) works with these three, entered once.
        They stay on this computer (<code>.steam-cache/</code>, never uploaded) and are never shown again.
      </p>
      {row('apiKey', 'Steam Web API key', c.apiKey, '32 letters and digits',
        <>Create it yourself at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">steamcommunity.com/dev/apikey</a> (domain: <code>localhost</code>). Never give this key to any website.</>, true)}
      {row('authCode', 'Game authentication code', c.authCode, 'AAAA-AAAAA-AAAA',
        <>Steam Support → CS2 → <a href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128" target="_blank" rel="noreferrer">manage your game authentication code</a>.</>, true)}
      {row('knownCode', 'Share code of one recent match', c.knownCode, 'CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx',
        <>CS2 → Watch → Your Matches → a match → copy the share link.</>)}
      {row('replaysDir', 'CS2 replays folder', c.replays || st.replays.length > 0, 'found automatically',
        st.replays.length ? <>Watching: <code>{st.replays.join(' · ')}</code></> : <>Not found automatically. Usually <code>…/steamapps/common/Counter-Strike Global Offensive/game/csgo/replays</code>.</>)}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !Object.values(f).some(Boolean)}>Save</button>
        <button type="button" onClick={onDone}>Close</button>
        {(c.steamId || c.apiKey || c.authCode) && <button type="button" onClick={forget} title="Delete the saved settings and match list from this computer">Forget all</button>}
      </div>
      {err && <p className="warn-text">{err}</p>}
    </form>
  );
}

const errText = (e: unknown) => `Couldn't do that: ${e instanceof Error ? e.message : String(e)}`;
