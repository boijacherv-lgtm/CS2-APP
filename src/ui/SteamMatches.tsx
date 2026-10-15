import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoData } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { useStore } from '../store';
import type { SteamMatch, SteamStatus } from '../../tools/steam.mjs';

/**
 * "Your matches from Steam" on the review start page: sign in to Steam once (QR in the Steam mobile
 * app, or login + Steam Guard), then your recent matchmaking games are listed with one click to
 * download and review. The dev server does the Steam side (tools/steam.mjs).
 * Layout is plain on purpose; styling is up to the design pass.
 */
export function SteamMatches() {
  const startReview = useStore(s => s.startReview);
  const [st, setSt] = useState<SteamStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  const synced = useRef(false);

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

  const act = useCallback(async (route: string, body?: unknown) => {
    setMsg(null);
    try { await post(route, body); } catch (e) { setMsg(errText(e)); }
    refresh();
  }, [post, refresh]);

  const sync = useCallback(async () => {
    setMsg('Checking Steam for new matches…');
    try {
      const r = await post<{ found: number; diag: string[] }>('sync');
      setMsg(r.found ? null : `No matches found on your Steam match history pages (${r.diag.join(' · ') || 'no answer'}).`);
    } catch (e) { setMsg(errText(e)); }
    refresh();
  }, [post, refresh]);

  useEffect(() => { refresh(); }, [refresh]);
  // poll fast while signing in (waiting for the QR scan / approval), slowly otherwise
  const signingIn = !!st && st.login.state !== 'idle' && st.login.state !== 'error';
  useEffect(() => {
    const t = setInterval(refresh, signingIn || st?.syncing ? 1500 : 30000);
    return () => clearInterval(t);
  }, [refresh, signingIn, st?.syncing]);
  // look for new games once per visit when signed in
  const signedIn = !!st?.account;
  useEffect(() => { if (signedIn && !synced.current) { synced.current = true; sync(); } }, [signedIn, sync]);

  const open = async (m: SteamMatch) => {
    setLoadingId(m.id);
    setMsg(m.demo === 'ready' ? 'Opening…' : 'Downloading the demo from Valve and reading it… (about a minute the first time, instant after)');
    try {
      const data = await post<DemoData>('load', { id: m.id });
      if (!MAPS.some(x => x.id === data.map)) throw new Error(`${data.map} isn't one of the supported maps.`);
      setMsg(null);
      startReview(data);
    } catch (e) { setMsg(errText(e)); refresh(); }
    finally { setLoadingId(null); }
  };

  if (offline || !st) return null; // static build without the dev server: only manual demos

  return (
    <section className="steam">
      <div className="steam-head">
        <h2>Your matches from Steam</h2>
        {signedIn && <>
          <span className="muted">Signed in{st.account?.name ? ` as ${st.account.name}` : ''}</span>
          <button onClick={sync} disabled={st.syncing}>{st.syncing ? 'Checking…' : 'Check for new matches'}</button>
          <button onClick={() => act('signout')} title="Forget the Steam sign-in on this computer">Sign out</button>
        </>}
      </div>

      {!signedIn && <SignIn st={st} usePassword={usePassword} setUsePassword={setUsePassword} act={act} />}

      {msg && <p className="muted">{msg}</p>}

      {signedIn && st.matches.length > 0 && (
        <table className="steam-list">
          <tbody>
            {st.matches.map(m => (
              <tr key={m.id}>
                <td>{m.time ? new Date(m.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</td>
                <td className="muted">{m.mode}</td>
                <td>{MAPS.find(x => x.id === m.map)?.name ?? m.mapName ?? ''}</td>
                <td className={m.result ?? ''}>{m.scores.length === 2 ? `${m.scores[0]}–${m.scores[1]}` : ''} {m.result ? m.result.toUpperCase() : ''}</td>
                <td>
                  {m.demo === 'ready'
                    ? <button disabled={!!loadingId} onClick={() => open(m)}>{loadingId === m.id ? 'Opening…' : 'Review'}</button>
                    : m.hasDemo && m.demo !== 'expired'
                      ? <button disabled={!!loadingId} onClick={() => open(m)}>{loadingId === m.id ? 'Loading…' : 'Download & review'}</button>
                      : <span className="muted" title="Valve keeps demos for about a month">demo expired</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SignIn({ st, usePassword, setUsePassword, act }: {
  st: SteamStatus; usePassword: boolean; setUsePassword: (v: boolean) => void; act: (route: string, body?: unknown) => Promise<void>;
}) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const l = st.login;

  if (l.state === 'qr' || l.state === 'scanned') return (
    <div className="steam-signin">
      {l.qr && <img src={l.qr} alt="Steam sign-in QR code" width={200} height={200} />}
      <div>
        <p>{l.state === 'scanned' ? 'Scanned. Tap Approve in the Steam app.' : 'Open the Steam app on your phone → Steam Guard → scan this code, then approve.'}</p>
        <p className="muted">The app only reads your match history. It can't play, trade or change anything.</p>
        <button onClick={() => act('cancel')}>Cancel</button>
      </div>
    </div>
  );

  if (l.state === 'guard' && l.guard) return (
    <form className="steam-signin col" onSubmit={e => { e.preventDefault(); act('guard', { code }); setCode(''); }}>
      {l.guard.approve && <p>Approve the sign-in in your Steam mobile app{l.guard.code ? ', or enter the code:' : '.'}</p>}
      {!l.guard.approve && l.guard.code && <p>Enter the Steam Guard code from your {l.guard.code}:</p>}
      {l.guard.code && <div className="row">
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="CODE" maxLength={8} autoComplete="one-time-code" autoFocus />
        <button type="submit" disabled={code.length < 5}>Sign in</button>
      </div>}
      <button type="button" onClick={() => act('cancel')}>Cancel</button>
    </form>
  );

  return (
    <div className="steam-signin col">
      <p>Sign in to Steam once and your recent Premier, Competitive and Wingman matches show up here, ready to review.</p>
      <div className="row">
        <button className="primary" onClick={() => act('login/qr')}>Sign in with the Steam app (QR code)</button>
        <button onClick={() => setUsePassword(!usePassword)}>{usePassword ? 'Hide' : 'Use login and password'}</button>
      </div>
      {usePassword && (
        <form className="row" onSubmit={e => { e.preventDefault(); act('login/password', { user, pass }); setPass(''); }}>
          <input value={user} onChange={e => setUser(e.target.value)} placeholder="Steam login" autoComplete="username" />
          <input value={pass} onChange={e => setPass(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" />
          <button type="submit" disabled={!user || !pass}>Sign in</button>
        </form>
      )}
      <p className="muted">
        Your password goes straight to Steam and is never stored; this computer keeps only Steam's sign-in token
        (in <code>.steam-cache/</code>, never uploaded). It's a web sign-in, so it won't log you out of CS2.
      </p>
      {l.state === 'error' && l.error && <p className="warn-text">{l.error}</p>}
    </div>
  );
}

const errText = (e: unknown) => `Couldn't do that: ${e instanceof Error ? e.message : String(e)}`;
