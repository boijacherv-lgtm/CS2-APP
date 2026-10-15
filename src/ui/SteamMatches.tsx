import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoData } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { useStore } from '../store';
import type { SteamMatch, SteamStatus } from '../../tools/steam.mjs';
import { SteamLoginButton } from './SteamLogin';
import { steamFetch, steamSignOut } from './steamApi';
import { ONLINE } from '../env';

const SYNC_EVERY = 5 * 60 * 1000; // new games show up by themselves

/**
 * "Your matches" on the review start page, Valve's official way and nothing else:
 *   1. Log in with Steam (Steam OpenID, the app only learns your SteamID)
 *   2. once: game authentication code + one share code + your own Web API key → Valve's match-history API
 *   3. the list refreshes by itself; "Download in CS2" (Valve's link) downloads, the app imports it
 * Demos you've loaded always show here too. No Steam sign-in by the app, ever.
 * Layout is plain on purpose; styling is up to the design pass.
 */
export function SteamMatches() {
  const startReview = useStore(s => s.startReview);
  const [st, setSt] = useState<SteamStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState('');
  const [waiting, setWaiting] = useState<Set<string>>(new Set()); // clicked "Download in CS2"

  const refresh = useCallback(async () => {
    try {
      const res = await steamFetch('/status');
      if (!res.ok) throw new Error();
      setSt(await res.json());
      setOffline(false);
    } catch { setOffline(true); }
  }, []);

  const post = useCallback(async <T,>(route: string, body?: unknown): Promise<T> => {
    const res = await steamFetch(`/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? res.statusText);
    return out;
  }, []);

  const c = st?.configured;
  const loggedIn = !!c?.steamId;
  const ready = !!c && c.steamId && c.apiKey && c.authCode && c.knownCode;

  const sync = useCallback(async (quiet = false) => {
    if (!quiet) setMsg('Asking Valve for new matches…');
    try {
      const r = await post<{ added: number; note: string | null }>('sync');
      if (!quiet) setMsg(r.note ? null : r.added ? `${r.added} new match${r.added > 1 ? 'es' : ''}.` : 'No new matches since the last check.');
    } catch (e) { if (!quiet) setMsg(errText(e)); }
    refresh();
  }, [post, refresh]);

  // coming back from Steam's login page with a problem: show it once and tidy the URL
  useEffect(() => {
    const err = new URLSearchParams(location.hash.split('?')[1] ?? '').get('steam_error');
    if (err) { setMsg(`Log in with Steam didn't work: ${err}`); history.replaceState(null, '', '#/cs2/review'); }
  }, []);
  // status every few seconds (imports land by themselves), Valve every few minutes once set up
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);
  const started = useRef(false);
  useEffect(() => {
    if (!ready) { started.current = false; return; }
    if (!started.current) { started.current = true; sync(); }
    const t = setInterval(() => sync(true), SYNC_EVERY);
    return () => clearInterval(t);
  }, [ready, sync]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try { await post('settings', { profile }); setProfile(''); } catch (x) { setMsg(errText(x)); }
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
        {ready && <button onClick={() => sync()} disabled={st.syncing}>{st.syncing ? 'Checking…' : 'Refresh'}</button>}
        {loggedIn && <button onClick={() => setSettingsOpen(!settingsOpen)}>{settingsOpen ? 'Close settings' : 'Settings'}</button>}
      </div>

      {/* step 1: who you are */}
      {!loggedIn && (
        <form className="steam-profile" onSubmit={saveProfile}>
          <div className="row"><SteamLoginButton /></div>
          <p className="muted">
            Opens Steam's own login page (steamcommunity.com), where you can scan Steam's QR code with Steam Guard. Steam only tells
            the app your SteamID: no password, no access to your account.
          </p>
          <p className="muted">Or paste your profile link:</p>
          <div className="row">
            <input value={profile} onChange={e => setProfile(e.target.value)} placeholder="https://steamcommunity.com/id/yourname" spellCheck={false} />
            <button type="submit" disabled={!profile.trim()}>Use this profile</button>
          </div>
        </form>
      )}

      {/* step 2: Valve's match history, set up once (or changed later under Settings) */}
      {loggedIn && (!ready || settingsOpen) && <ValveSetup st={st} post={post} first={!ready} onDone={() => { setSettingsOpen(false); refresh(); }} />}

      {msg && <p className="muted">{msg}</p>}
      {ready && st.note && <p className="warn-text">{st.note}</p>}
      {st.importing.file && <p className="muted">Importing {st.importing.file} from CS2's replays folder…</p>}
      {st.importing.error && <p className="warn-text">Couldn't import {st.importing.error}</p>}

      {/* step 3: the list (Valve's matches + every demo you've loaded) */}
      {st.matches.length > 0 && (
        <>
          <p className="muted">
            {ready ? 'From Valve · updates every few minutes. Map and score show once the demo is in. '
              : loggedIn ? <><b>Only the demos you've already loaded are shown.</b> Do steps 1–2 above to list all your matches. </>
              : 'Demos you have loaded. '}
            {!loggedIn && 'Log in with Steam to see your score in each. '}
            {ready && ONLINE && <>After <b>Download in CS2</b>, open the demo in the desktop version (or save it there as .json and open that here). </>}
            {ready && !ONLINE && (st.replays.length
              ? <>Demos downloaded with <b>Download in CS2</b> are imported automatically.</>
              : <>CS2's replays folder wasn't found on this computer: drop downloaded demos in the box above (or set the folder under Settings).</>)}
          </p>
          <table className="steam-list">
            <tbody>
              {st.matches.map(m => (
                <tr key={m.code}>
                  <td>{m.time ? new Date(m.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                    : m.loadedAt ? <span className="muted">loaded {fmtDay(m.loadedAt)}</span>
                    : m.foundAt ? <span className="muted">found {fmtDay(m.foundAt)}</span> : ''}</td>
                  <td>{m.map ? MAPS.find(x => x.id === m.map)?.name ?? m.map : <span className="muted">demo not loaded yet</span>}</td>
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
                        : null}
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

/** Valve's own match-history API: three things, entered once on this computer. */
function ValveSetup({ st, post, first, onDone }: { st: SteamStatus; post: <T>(route: string, body?: unknown) => Promise<T>; first: boolean; onDone: () => void }) {
  const c = st.configured;
  const [f, setF] = useState({ authCode: '', knownCode: '', apiKey: '', replaysDir: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await post('settings', f); onDone(); } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  // smart paste: copy a whole Steam page, paste it here, the codes are picked out of it
  const [paste, setPaste] = useState('');
  const [found, setFound] = useState<string | null>(null);
  const [byHand, setByHand] = useState(!first);
  const submitPaste = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<{ found?: { authCode: boolean; apiKey: boolean; codes: number } } & SteamStatus['configured']>('settings', { paste: text });
      const got = [r.found?.authCode && 'authentication code', r.found?.codes && `${r.found.codes} match code${r.found.codes > 1 ? 's' : ''}`, r.found?.apiKey && 'Web API key'].filter(Boolean);
      setFound(`Found: ${got.join(', ')}.`);
      setPaste('');
      if (r.steamId && r.apiKey && r.authCode && r.knownCode) onDone();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const signOut = async () => { try { await steamSignOut(); onDone(); } catch (x) { setErr(errText(x)); } };
  const forget = async () => { try { await post('forget'); onDone(); } catch (x) { setErr(errText(x)); } };
  const row = (k: keyof typeof f, n: string, label: string, ok: boolean, placeholder: string, help: React.ReactNode, secret = false) => (
    <label className="steam-field">
      <span>{ok ? '✓' : n} {label}</span>
      <input value={f[k]} onChange={set(k)} placeholder={ok ? 'saved (leave empty to keep)' : placeholder} type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} />
      <small className="muted">{help}</small>
    </label>
  );
  return (
    <form className="steam-setup" onSubmit={save}>
      {first && (
        <p>
          Valve keeps match history private, so it needs these once. This is Valve's own official way (the same one
          Leetify and csstats use behind the scenes), nothing logs in to your account. They stay on this computer
          (<code>.steam-cache/</code>, never uploaded) and are never shown again.
        </p>
      )}
      <div className="steam-paste">
        <div className={`step ${c.authCode && c.knownCode ? 'done' : ''}`}>
          <b>{c.authCode && c.knownCode ? '✓' : '1.'}</b>
          <a className="btn" href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128" target="_blank" rel="noreferrer">Open Steam Support (CS2 codes)</a>
          <span className="muted">create the code if asked, then select the whole page (Ctrl/Cmd+A), copy it, paste below</span>
        </div>
        {/* the website uses its own Web API key (kept in the Worker); only the desktop version needs yours */}
        {!ONLINE && <div className={`step ${c.apiKey ? 'done' : ''}`}>
          <b>{c.apiKey ? '✓' : '2.'}</b>
          <a className="btn" href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">Open your API key page</a>
          <span className="muted">no key yet? register one with domain <code>localhost</code>; then copy the whole page and paste below</span>
        </div>}
        <textarea value={paste} placeholder={ONLINE ? 'Paste here: the site picks out your authentication code and match codes (CS2 share links work too)' : 'Paste here: the app picks out your authentication code, match codes and API key (CS2 share links work too)'}
          onChange={e => setPaste(e.target.value)} onPaste={e => { e.preventDefault(); submitPaste(e.clipboardData.getData('text')); }} rows={3} spellCheck={false} />
        {found && <p className="muted">{found}</p>}
      </div>
      <button type="button" className="linkish" onClick={() => setByHand(!byHand)}>{byHand ? 'Hide manual entry' : 'Or enter them by hand'}</button>
      {byHand && <>
      {row('authCode', '1.', 'Game authentication code', c.authCode, 'AAAA-AAAAA-AAAA',
        <>Open <a href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128" target="_blank" rel="noreferrer">Steam Support → CS2 → authentication code</a> and create / copy it.</>, true)}
      {row('knownCode', '2.', 'Share code of one recent match', c.knownCode, 'CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx',
        <>Valve lists matches <b>from this one forward</b>, so use the oldest match you want to see: CS2 → Watch → Your Matches → copy share link
          (the Steam Support page above also shows your most recent one). Demos older than about a month are deleted by Valve.</>)}
      {row('apiKey', '3.', 'Your Steam Web API key', c.apiKey, '32 letters and digits',
        <>Create it at <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer">steamcommunity.com/dev/apikey</a> (domain name: <code>localhost</code>). Keep it private: never paste it into any website.</>, true)}
      {!first && row('replaysDir', '·', 'CS2 replays folder', c.replays || st.replays.length > 0, 'found automatically',
        st.replays.length ? <>Watching: <code>{st.replays.join(' · ')}</code></> : <>Not found automatically. Usually <code>…/steamapps/common/Counter-Strike Global Offensive/game/csgo/replays</code>.</>)}
      </>}
      <div className="row">
        {byHand && <button type="submit" className="primary" disabled={busy || !Object.values(f).some(Boolean)}>{first ? 'Show my matches' : 'Save'}</button>}
        {!first && <button type="button" onClick={onDone}>Close</button>}
        <button type="button" onClick={signOut} title="Forget your Steam account on this computer (keeps the codes)">Log out</button>
        {(c.apiKey || c.authCode || c.knownCode) && <button type="button" onClick={forget} title="Delete everything saved: account, codes, key and match list">Forget all</button>}
      </div>
      {err && <p className="warn-text">{err}</p>}
    </form>
  );
}

const fmtDay = (t: number) => new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
const errText = (e: unknown) => `Couldn't do that: ${e instanceof Error ? e.message : String(e)}`;
