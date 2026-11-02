import { useEffect, useRef, useState } from 'react';
import './dl.css';
import { STEAM_AVAILABLE } from '../env';
import { useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { Icon } from '../ui/Icon';
import { loadMatch, matchHistory, steamId3, type DlHistoryRow } from './api';
import { demoState, loadDemo, NoDemo } from './demo';
import { heroOf } from './data';
import { DlBoard } from './DlBoard';
import { openMatch } from './open';
import { useDl } from './store';

/** How often the match list asks deadlock-api for new matches while it's open (a match shows up minutes to an hour
 * after it ends). */
const REFRESH_MS = 120_000;

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ago = (unix: number) => {
  const h = (Date.now() / 1000 - unix) / 3600;
  return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Deadlock Review: pick a match (yours, or any by its ID), then replay it on the map. */
export function DlReview() {
  const match = useDl(s => s.match);
  return match ? <DlBoard /> : <DlStart />;
}

function DlStart() {
  const me = useProfile(s => s.me);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<DlHistoryRow[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const account = me?.steamId ? steamId3(me.steamId) : null;
  // the list, then again every couple of minutes: new matches come in on their own (marked New)
  const [checked, setChecked] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [, tick] = useState(0);
  useEffect(() => {
    setRows(null); setHistErr(null); setFresh(new Set());
    if (!account) return;
    let live = true, first: Set<number> | null = null;
    const load = () => matchHistory(account).then(r => {
      if (!live) return;
      if (first) { const added = r.filter(x => !first!.has(x.match_id)).map(x => x.match_id); if (added.length) setFresh(f => new Set([...f, ...added])); }
      first = new Set([...(first ?? []), ...r.map(x => x.match_id)]);
      setRows(r); setChecked(Date.now()); setHistErr(null);
    }).catch(e => { if (live) setHistErr(e instanceof Error ? e.message : String(e)); });
    void load();
    const t = setInterval(load, REFRESH_MS), clock = setInterval(() => tick(n => n + 1), 30_000);
    return () => { live = false; clearInterval(t); clearInterval(clock); };
  }, [account]);

  // which of them have a demo (full detail): checked once per list. One that has a replay but isn't kept here yet
  // is read in the background, one after another, and kept in this browser: Valve deletes replays after a while,
  // so a demo saved now still works after that
  type DemoMark = 'read' | 'listed' | 'saving' | 'none';
  const [demos, setDemos] = useState<Record<number, DemoMark>>({});
  const demosRef = useRef(demos);
  demosRef.current = demos;
  useEffect(() => {
    if (!rows) return;
    let live = true;
    (async () => {
      // each refresh: the new ones, and recent ones without a demo yet (a replay can be listed a while after)
      const recent = (r: DlHistoryRow) => Date.now() / 1000 - r.start_time < 3 * 3600;
      const todo = rows.slice(0, 30).filter(r => !demosRef.current[r.match_id] || (demosRef.current[r.match_id] === 'none' && recent(r)));
      const xs = await Promise.all(todo.map(async r => [r.match_id, await demoState(r.match_id)] as const));
      if (!live) return;
      setDemos(d => ({ ...d, ...Object.fromEntries(xs) }));
      for (const [id, st] of xs) {
        if (!live || st !== 'listed') continue;
        setDemos(d => ({ ...d, [id]: 'saving' }));
        let now: DemoMark = 'listed';
        try { await loadDemo(await loadMatch(id)); now = 'read'; } catch (e) { if (e instanceof NoDemo) now = 'none'; }
        if (live) setDemos(d => ({ ...d, [id]: now }));
      }
    })();
    return () => { live = false; };
  }, [rows]);
  const DEMO_LABEL: Record<DemoMark, [string, string]> = {
    read: ['Demo', 'Demo saved in this browser: full detail'],
    listed: ['Demo', 'Has a demo: full detail (about a minute to read the first time)'],
    saving: ['Saving demo…', 'Reading this match\'s demo now to keep it in this browser (Valve deletes replays after a while)'],
    none: ['No demo', 'No demo: deadlock-api doesn\'t have this match\'s replay, or Valve has deleted it. It replays from the match data (heroes once a second, kills, items, objectives).'],
  };
  const open = async (matchId: number) => {
    setBusy(matchId); setErr(null);
    try {
      await openMatch(matchId);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };
  const typed = Number(id.replace(/\D/g, ''));

  return (
    <div className="page dl-start">
      <header className="rs-head">
        <h1 className="display">Review a Deadlock match</h1>
        <p className="muted">Every hero on the real map, second by second, with kills and objectives. Matches come from deadlock-api.com a few minutes to an hour after they end.</p>
      </header>
      <form className="dl-id" onSubmit={e => { e.preventDefault(); if (typed) void open(typed); }}>
        <label htmlFor="dl-match-id">Match ID</label>
        <input id="dl-match-id" inputMode="numeric" placeholder="e.g. 124566656 (in game: Match history → the match)" value={id} onChange={e => setId(e.target.value)} />
        <button className="cta primary" disabled={!typed || busy !== null}>{busy === typed ? 'Loading…' : 'Open'}</button>
      </form>
      {err && <p className="warn-text">{err}</p>}

      <section className="site-card dl-history">
        <div className="card-head"><h2>Your matches</h2>{rows && <span className="muted small">{rows.length} found{checked ? ` · checked ${Date.now() - checked < 60_000 ? 'just now' : `${Math.round((Date.now() - checked) / 60_000)} min ago`}, again every 2 min` : ''}</span>}</div>
        {!account ? (
          STEAM_AVAILABLE
            ? <div className="dl-login"><span className="muted">Log in with Steam to see your Deadlock matches here.</span><SteamLoginButton compact /></div>
            : <p className="muted">Paste a match ID above.</p>
        ) : histErr ? <p className="warn-text small">{histErr}</p> : !rows ? <p className="muted">Loading your matches…</p> : !rows.length ? (
          <p className="muted">No matches found for your account on deadlock-api yet.</p>
        ) : (
          <>
          {Date.now() / 1000 - rows[0].start_time > 86400 && (
            <p className="dl-history-note muted small">
              The newest match deadlock-api has for you is from {ago(rows[0].start_time)}. It lists a player's games right away only when their
              account is on Steam friends with one of its bots; otherwise a match shows up when deadlock-api happens to collect it, which can
              take days. To open a newer one now, paste its ID above (in game: Match history → the match): deadlock-api then fetches it from Steam (up to 3 new matches an hour).
            </p>
          )}
          <ul className="dl-rows">
            {rows.slice(0, 30).map(r => {
              const h = heroOf(r.hero_id), won = r.match_result === r.player_team;
              return (
                <li key={r.match_id}>
                  <button className={`dl-row ${won ? 'win' : 'loss'}`} onClick={() => open(r.match_id)} disabled={busy !== null}>
                    {h.card ? <img src={h.card} alt="" width={36} height={36} loading="lazy" /> : <span className="dl-hero-dot" style={{ background: h.color }} />}
                    <span className="dl-row-hero"><b>{h.name}{fresh.has(r.match_id) && <span className="dl-row-new">New</span>}{demos[r.match_id] && <span className={`dl-row-demo ${demos[r.match_id]}`} title={DEMO_LABEL[demos[r.match_id]][1]}>{DEMO_LABEL[demos[r.match_id]][0]}</span>}</b>
                      <span className="muted small">{ago(r.start_time)} · {mins(r.match_duration_s)}</span></span>
                    <span className={`dl-row-result ${won ? 'win' : 'loss'}`}>{won ? 'Win' : 'Loss'}</span>
                    <span className="dl-row-kda num">{r.player_kills}/{r.player_deaths}/{r.player_assists}</span>
                    <span className="dl-row-souls num muted">{(r.net_worth / 1000).toFixed(1)}k souls</span>
                    <span className="dl-row-go">{busy === r.match_id ? 'Loading…' : <Icon name="arrowRight" size={14} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          </>
        )}
      </section>
    </div>
  );
}
