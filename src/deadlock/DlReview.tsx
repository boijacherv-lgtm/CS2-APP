import { useEffect, useRef, useState } from 'react';
import { Loading } from '../ui/Loading';
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

/** A public Phantom+ match to try (also the front page's sample). */
const SAMPLE_MATCH = 131074890;
import { addLocalReplay, replayId } from './localReplays';
import { DlSteamFolder } from './DlSteamFolder';
import { BOT_ON, botFriend, botInfo, botMatches, type BotRelation } from './botApi';
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
  return match ? <><h1 className="sr-only">Deadlock match replay</h1><DlBoard /></> : <DlStart />;
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
    // deadlock-api's list, plus the bot's (newer matches show there first) when you're its friend
    const load = () => Promise.all([matchHistory(account), BOT_ON ? botMatches(account).catch(() => null) : Promise.resolve(null)]).then(([api, fromBot]) => {
      const seen = new Set(api.map(x => x.match_id));
      const r = [...(fromBot?.matches ?? []).filter(m => !seen.has(m.match_id)), ...api].sort((a, b) => b.start_time - a.start_time);
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
      const recent = (r: DlHistoryRow) => Date.now() / 1000 - r.start_time < 8 * 86400;
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
  // a replay file: its name is the match ID; the file is read here when the match opens
  const openFile = (f: File) => {
    const fid = replayId(f.name);
    if (!fid) { setErr(`"${f.name}" isn't named by its match ID (Deadlock saves replays as <match ID>.dem).`); return; }
    addLocalReplay(fid, f);
    void open(fid);
  };

  // the bot: who to add as a friend, and whether you are one (checked again every minute until you are)
  const [bot, setBot] = useState<{ steamId: string | null; pollMinutes: number } | null>(null);
  const [rel, setRel] = useState<BotRelation | null>(null);
  useEffect(() => {
    if (!BOT_ON || !account) return;
    let live = true;
    botInfo().then(b => live && setBot(b)).catch(() => {});
    const check = () => botFriend(account).then(r => live && setRel(r.relation)).catch(() => {});
    void check();
    const t = setInterval(() => { if (rel !== 'friend') void check(); }, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [account, rel]);

  return (
    <div className="page dl-start">
      <header className="rs-head">
        <h1 className="display">Review a Deadlock match</h1>
        <p className="muted">Replay any match on the map, second by second.</p>
      </header>
      <form className="dl-id" onSubmit={e => { e.preventDefault(); if (typed) void open(typed); }}>
        <label htmlFor="dl-match-id" className="sr-only">Match ID</label>
        <input id="dl-match-id" inputMode="numeric" placeholder="Match ID, e.g. 124566656" value={id} onChange={e => setId(e.target.value)} />
        <button className="cta primary" disabled={!typed || busy !== null}>{busy === typed ? 'Loading…' : 'Open'}</button>
        <label className="ghost dl-file" title="A replay from Deadlock's replays folder (<match ID>.dem): read here, nothing is uploaded">
          <Icon name="upload" size={14} />Replay file
          <input type="file" accept=".dem" className="sr-only" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openFile(f); }} />
        </label>
      </form>
      {/* where the number is, and a match to try without one */}
      <p className="dl-id-help muted small">
        Your match ID: open the match in Deadlock's match history, the ID is shown with it (or log in: your matches list below). Or{' '}
        <button className="link-btn" onClick={() => void open(SAMPLE_MATCH)} disabled={busy !== null}>open the Deadlock sample</button> (a Phantom+ match).
      </p>
      {err && <p className="warn-text">{err}</p>}
      {/* the same 3 steps as CS2's review page */}
      <div className="review-how dl-review-how">
        <div><b>1. Pick a match</b><span>Its match ID, a replay file you saved, or one of your matches below (log in with Steam).</span></div>
        <div><b>2. Open it</b><span>The match comes from deadlock-api; a replay file is read in your browser. Nothing is uploaded.</span></div>
        <div><b>3. Watch it back</b><span>Every hero on the map with a live win-chance bar. Every kill and death is graded from Brilliant to Blunder.</span></div>
      </div>

      <DlSteamFolder account={account} open={id => void open(id)} busy={busy} />

      <section className="site-card dl-history">
        <div className="card-head"><h2>Your matches</h2>{rows && <span className="muted small" title={checked ? `Checked ${Date.now() - checked < 60_000 ? 'just now' : `${Math.round((Date.now() - checked) / 60_000)} min ago`}, again every 2 min` : undefined}>{rows.length}</span>}</div>
        {account && BOT_ON && bot?.steamId && rel !== null && (
          rel === 'friend' ? (
            <div className="dl-bot on">
              <span className="muted small">New matches load by themselves every {bot.pollMinutes} min.</span>
            </div>
          ) : (
            <div className="dl-bot">
              <span><b>Load every match by itself.</b> <span className="muted small">{rel === 'pending' ? `Request sent: the bot accepts it within ${bot.pollMinutes} min.` : 'Add RageView bot as a Steam friend once.'}</span></span>
              <a className="cta primary small-btn" href={`steam://friends/add/${bot.steamId}`}>Add in Steam</a>
            </div>
          )
        )}
        {!account ? (
          STEAM_AVAILABLE
            ? <div className="dl-login"><span className="muted">Log in with Steam to see your Deadlock matches here.</span><SteamLoginButton compact /></div>
            : <p className="muted">Paste a match ID above.</p>
        ) : histErr ? <p className="warn-text small">{histErr}</p> : !rows ? <Loading>Loading your matches…</Loading> : !rows.length ? (
          <p className="empty-state">No matches found for your account on deadlock-api yet.</p>
        ) : (
          <>
          {rel !== 'friend' && Date.now() / 1000 - rows[0].start_time > 86400 && (
            <p className="dl-history-note muted small">Newest match here is from {ago(rows[0].start_time)}. For a newer one, paste its ID above.</p>
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
