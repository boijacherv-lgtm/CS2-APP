import { useEffect, useState } from 'react';
import '../deadlock/dl.css';
import './d2.css';
import { STEAM_AVAILABLE } from '../env';
import { Icon } from '../ui/Icon';
import { useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { loadMatch, matchHistory, steamId3, type D2HistoryRow } from './api';
import { D2Board } from './D2Board';
import { heroOf, mins } from './data';
import { useD2 } from './store';

const ago = (unix: number) => {
  const h = (Date.now() / 1000 - unix) / 3600;
  return h < 1 ? 'just now' : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
};

/** Dota 2 Review: pick a match (yours, or any by its ID), then replay it on the map. */
export function D2Review() {
  const match = useD2(s => s.match);
  return match ? <D2Board /> : <D2Start />;
}

function D2Start() {
  const me = useProfile(s => s.me);
  const [id, setId] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<D2HistoryRow[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const account = me?.steamId ? steamId3(me.steamId) : null;
  useEffect(() => {
    setRows(null); setHistErr(null);
    if (!account) return;
    matchHistory(account).then(setRows).catch(e => setHistErr(e instanceof Error ? e.message : String(e)));
  }, [account]);

  const open = async (matchId: number) => {
    setBusy(matchId); setErr(null);
    try { useD2.getState().open(await loadMatch(matchId)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };
  const typed = Number(id.replace(/\D/g, ''));

  return (
    <div className="page dl-start">
      <header className="rs-head">
        <h1 className="display">Review a Dota 2 match</h1>
        <p className="muted">Every hero moving on the map, with wards, buildings, fights and the coach. Matches come from opendota.com, positions from the match's replay.</p>
      </header>
      <form className="dl-id" onSubmit={e => { e.preventDefault(); if (typed) void open(typed); }}>
        <label htmlFor="d2-match-id">Match ID</label>
        <input id="d2-match-id" inputMode="numeric" placeholder="e.g. 9068605888 (in game: Watch → Match history)" value={id} onChange={e => setId(e.target.value)} />
        <button className="cta primary" disabled={!typed || busy !== null}>{busy === typed && typed ? 'Loading…' : 'Open'}</button>
      </form>
      {err && <p className="warn-text">{err}</p>}

      <section className="site-card dl-history">
        <div className="card-head"><h2>Your matches</h2>{rows && <span className="muted small">{rows.length} found</span>}</div>
        {!account ? (
          STEAM_AVAILABLE
            ? <div className="dl-login"><span className="muted">Log in with Steam to see your Dota 2 matches here.</span><SteamLoginButton compact /></div>
            : <p className="muted">Paste a match ID above.</p>
        ) : histErr ? <p className="warn-text small">{histErr}</p> : !rows ? <p className="muted">Loading your matches…</p> : !rows.length ? (
          <p className="muted">No matches found for your account. In Dota 2, turn on Settings → Options → Social → Expose Public Match Data.</p>
        ) : (
          <ul className="dl-rows">
            {rows.map(r => {
              const h = heroOf(r.hero_id), won = r.radiant_win === (r.player_slot < 128);
              return (
                <li key={r.match_id}>
                  <button className={`dl-row ${won ? 'win' : 'loss'}`} onClick={() => open(r.match_id)} disabled={busy !== null}>
                    {h.icon ? <img src={h.icon} alt="" width={36} height={36} loading="lazy" /> : <span className="dl-hero-dot" style={{ background: '#666' }} />}
                    <span className="dl-row-hero"><b>{h.name}</b><span className="muted small">{ago(r.start_time)} · {mins(r.duration)}</span></span>
                    <span className={`dl-row-result ${won ? 'win' : 'loss'}`}>{won ? 'Win' : 'Loss'}</span>
                    <span className="dl-row-kda num">{r.kills}/{r.deaths}/{r.assists}</span>
                    <span className="dl-row-souls num muted small">{r.version ? 'Parsed' : 'Not parsed'}</span>
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
