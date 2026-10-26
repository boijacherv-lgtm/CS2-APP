import { useEffect, useState } from 'react';
import './dl.css';
import { STEAM_AVAILABLE } from '../env';
import { useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { Icon } from '../ui/Icon';
import { loadMatch, matchHistory, steamId3, steamNames, type DlHistoryRow } from './api';
import { heroOf } from './data';
import { DlBoard } from './DlBoard';
import { loadBenchmarks } from './coach';
import { useDl } from './store';

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
  useEffect(() => {
    setRows(null); setHistErr(null);
    if (!account) return;
    matchHistory(account).then(setRows).catch(e => setHistErr(e instanceof Error ? e.message : String(e)));
  }, [account]);

  const open = async (matchId: number) => {
    setBusy(matchId); setErr(null);
    try {
      const m = await loadMatch(matchId);
      useDl.getState().open(m);
      steamNames(m.players.map(p => p.account)).then(names => useDl.setState({ names })).catch(() => {});
      // the average player on each hero, for the laning grade
      loadBenchmarks(m.players.map(p => p.hero)).then(bench => { if (useDl.getState().match?.id === m.id) useDl.setState({ bench }); });
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
        <div className="card-head"><h2>Your matches</h2>{rows && <span className="muted small">{rows.length} found</span>}</div>
        {!account ? (
          STEAM_AVAILABLE
            ? <div className="dl-login"><span className="muted">Log in with Steam to see your Deadlock matches here.</span><SteamLoginButton compact /></div>
            : <p className="muted">Paste a match ID above.</p>
        ) : histErr ? <p className="warn-text small">{histErr}</p> : !rows ? <p className="muted">Loading your matches…</p> : !rows.length ? (
          <p className="muted">No matches found for your account on deadlock-api yet.</p>
        ) : (
          <ul className="dl-rows">
            {rows.slice(0, 30).map(r => {
              const h = heroOf(r.hero_id), won = r.match_result === r.player_team;
              return (
                <li key={r.match_id}>
                  <button className={`dl-row ${won ? 'win' : 'loss'}`} onClick={() => open(r.match_id)} disabled={busy !== null}>
                    {h.card ? <img src={h.card} alt="" width={36} height={36} loading="lazy" /> : <span className="dl-hero-dot" style={{ background: h.color }} />}
                    <span className="dl-row-hero"><b>{h.name}</b><span className="muted small">{ago(r.start_time)} · {mins(r.match_duration_s)}</span></span>
                    <span className={`dl-row-result ${won ? 'win' : 'loss'}`}>{won ? 'Win' : 'Loss'}</span>
                    <span className="dl-row-kda num">{r.player_kills}/{r.player_deaths}/{r.player_assists}</span>
                    <span className="dl-row-souls num muted">{(r.net_worth / 1000).toFixed(1)}k souls</span>
                    <span className="dl-row-go">{busy === r.match_id ? 'Loading…' : <Icon name="arrowRight" size={14} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
