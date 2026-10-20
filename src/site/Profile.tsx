import { useEffect, useMemo, useRef, useState } from 'react';
import { STEAM_AVAILABLE } from '../env';
import { GOAL_CHOICES, goalInfo, habits } from '../engine/habits';
import { averages, FREE_HISTORY, premierOf, goalSeries, hasPro, mapStats, MAX_GOALS, type Averages, type GoalId, type ProfileMatch } from '../engine/profile';
import { LETTER_COLOR } from '../engine/recap';
import { Icon } from '../ui/Icon';
import { findFriend, setGoals, useProfile, type PublicProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { fmtDate, fmtInt, fmtKd, mapName, pct } from './format';
import { copyCard, drawShareCard, shareFileName } from './shareCard';
import { AddMatches } from './AddMatches';

/** Your profile: your last matches, how they trend, your goals, your maps, a friend next to you, and share cards. */
export function Profile() {
  const { me, data, remote, loaded, error } = useProfile();
  const pro = hasPro();
  const [all, setAll] = useState(false);
  const [share, setShare] = useState<ProfileMatch | null>(null);
  const matches = data.matches;
  const shown = all && pro ? matches : matches.slice(0, FREE_HISTORY);
  const last = averages(matches.slice(0, FREE_HISTORY)), before = averages(matches.slice(FREE_HISTORY, FREE_HISTORY * 2));
  const name = me?.name ?? 'Your profile';

  return (
    <div className="page profile">
      <header className="profile-head">
        {me?.avatar ? <img className="avatar" src={me.avatar} alt="" width={64} height={64} /> : <span className="avatar empty"><Icon name="user" size={34} /></span>}
        <div className="profile-id">
          <h1>{name}{pro && <span className="pro-badge" title="Pro is free during early access">PRO</span>}</h1>
          <p className="muted">
            {remote ? <><Icon name="shield" size={13} /> Saved to your Steam account · {matches.length} match{matches.length === 1 ? '' : 'es'}</>
              : <>Kept in this browser{matches.length ? ` · ${matches.length} match${matches.length === 1 ? '' : 'es'}` : ''}{STEAM_AVAILABLE && !me ? '. Log in with Steam to keep it on every device.' : ''}</>}
          </p>
          {error && me && <p className="warn-text small">Your account's profile couldn't be loaded ({error}); showing this browser's copy.</p>}
        </div>
        <div className="profile-actions">
          {STEAM_AVAILABLE && loaded && !me && <SteamLoginButton compact />}
          <a className="cta" href="#/settings"><Icon name="gear" size={14} /> Settings</a>
        </div>
      </header>

      {!matches.length ? (
        <section className="empty-card">
          <Icon name="trophy" size={30} />
          <h2>Review a match you played</h2>
          <p className="muted">Drop one of your demos in Review and pick yourself (Mine…, or This is me in the recap). Once it's graded it shows up here, with your
            numbers, your trends and your goals.</p>
          <a className="cta primary" href="#/cs2/review">Review a match</a>
        </section>
      ) : null}
      <AddMatches />
      {!matches.length ? null : (
        <>
          {last && <Kpis now={last} was={before} />}

          <section className="site-card">
            <div className="card-head">
              <h2>{all && pro ? 'All matches' : `Last ${Math.min(FREE_HISTORY, matches.length)} matches`}</h2>
              {matches.length > FREE_HISTORY && (pro
                ? <button className="ghost small-btn" onClick={() => setAll(!all)}>{all ? 'Show the last 5' : `Show all ${matches.length}`}</button>
                : <a className="muted small" href="#/pricing"><Icon name="lock" size={12} /> {matches.length - FREE_HISTORY} older with Pro</a>)}
            </div>
            <div className="match-list">
              {shown.map(m => <MatchRow key={m.id} m={m} onShare={() => setShare(m)} />)}
            </div>
          </section>

          <div className="profile-grid">
            <Goals matches={matches} />
            <MapStats matches={matches} />
          </div>
          <Habits matches={matches.slice(0, pro ? matches.length : FREE_HISTORY)} />
        </>
      )}
      <Friend mine={last} />
      {share && <ShareDialog m={share} player={me?.name ?? share.name ?? 'Me'} onClose={() => setShare(null)} />}
    </div>
  );
}

function Kpis({ now, was }: { now: Averages; was: Averages | null }) {
  const items: { label: string; v: string; d: number | null; good?: boolean }[] = [
    { label: 'Win rate', v: pct(now.winRate), d: was ? now.winRate - was.winRate : null },
    { label: 'K/D', v: fmtKd(now.kd), d: was && now.kd !== null && was.kd !== null ? now.kd - was.kd : null },
    { label: 'ADR', v: now.adr.toFixed(0), d: was ? now.adr - was.adr : null },
    { label: 'KAST', v: `${now.kast.toFixed(0)}%`, d: was ? now.kast - was.kast : null },
    { label: 'Headshots', v: `${now.hs.toFixed(0)}%`, d: was ? now.hs - was.hs : null },
  ];
  return (
    <section className="kpi-strip" aria-label={`Averages over your last ${now.matches} matches`}>
      <div className="kpi-tile premier" title="Your in-game Premier rating at the start of your newest reviewed match">
        <span>Premier</span>
        <b>{now.premier !== null ? fmtInt(now.premier) : '–'}</b>
        {now.premierMoved !== null && now.premierMoved !== 0
          ? <i className={now.premierMoved > 0 ? 'up' : 'down'}><Icon name={now.premierMoved > 0 ? 'trendUp' : 'trendDown'} size={12} /> {now.premierMoved > 0 ? '+' : '−'}{fmtInt(Math.abs(now.premierMoved))} over these {now.matches}</i>
          : <i className="muted">{now.premier !== null ? `over these ${now.matches}` : 'not in these demos'}</i>}
      </div>
      {items.map(i => (
        <div key={i.label} className="kpi-tile">
          <span>{i.label}</span>
          <b>{i.v}</b>
          {i.d !== null && Math.abs(i.d) > 1e-9
            ? <i className={i.d > 0 ? 'up' : 'down'}><Icon name={i.d > 0 ? 'trendUp' : 'trendDown'} size={12} /> {i.label === 'Win rate' ? pct(Math.abs(i.d)) : i.label === 'K/D' ? Math.abs(i.d).toFixed(2) : fmtInt(Math.abs(i.d))} vs the {was!.matches} before</i>
            : <i className="muted">last {now.matches}</i>}
        </div>
      ))}
    </section>
  );
}

function MatchRow({ m, onShare }: { m: ProfileMatch; onShare: () => void }) {
  const grade = m.level ?? m.lobby;
  return (
    <div className={`match-row ${m.result}`}>
      <img className="match-map" src={`/images/maps/${m.map}.png`} alt="" />
      <div className="match-main">
        <b>{mapName(m.map)}</b>
        <span className="muted">{fmtDate(m.at)} · {m.rounds} rounds</span>
      </div>
      <span className={`match-score ${m.result}`}>{m.score[0]}:{m.score[1]}</span>
      <span className="match-stat"><small>K/D</small>{m.kills}/{m.deaths}</span>
      <span className="match-stat"><small>ADR</small>{m.adr.toFixed(0)}</span>
      <span className="match-stat" title="Your Premier rating going into this match"><small>Premier</small>{premierOf(m) !== null ? fmtInt(premierOf(m)!) : '–'}</span>
      <span className="letter-chip" style={{ background: LETTER_COLOR[grade] }} title={m.level ? 'Level: B = a typical level-10 game, S = a typical pro game' : 'Grade among the lobby'}>{grade}</span>
      <button className="ghost icon-btn" onClick={onShare} title="Share card" aria-label="Share card"><Icon name="share" size={16} /></button>
    </div>
  );
}

/** Up to 3 habits to fix, each traced match by match against level 10. */
function Goals({ matches }: { matches: ProfileMatch[] }) {
  const goals = useProfile(s => s.data.goals);
  const [editing, setEditing] = useState(false);
  const ids = goals.map(g => g.id);
  // the coach's suggestion: your worst habits, when nothing is picked yet
  const suggested = useMemo(() => habits(matches)?.work.map(r => r.id as GoalId) ?? [], [matches]);
  const toggle = (id: GoalId) => setGoals(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(0, MAX_GOALS));
  return (
    <section className="site-card goals">
      <div className="card-head">
        <h2><Icon name="goal" size={16} /> Goals</h2>
        <button className="ghost small-btn" onClick={() => setEditing(!editing)}>{editing ? 'Done' : ids.length ? 'Change' : 'Pick goals'}</button>
      </div>
      {editing ? (
        <div className="goal-pick">
          <p className="muted small">Up to {MAX_GOALS}. {suggested.length ? 'The coach suggests the highlighted ones: they cost you most.' : ''}</p>
          <div className="chips">
            {GOAL_CHOICES.map(id => (
              <button key={id} className={`chip ${ids.includes(id) ? 'on' : ''} ${suggested.includes(id) ? 'hint' : ''}`} aria-pressed={ids.includes(id)}
                disabled={!ids.includes(id) && ids.length >= MAX_GOALS} onClick={() => toggle(id)}>{goalInfo(id).label}</button>
            ))}
          </div>
        </div>
      ) : !ids.length ? (
        <div className="goal-empty">
          <p className="muted">Pick up to {MAX_GOALS} habits to work on: each new match shows whether they got better.</p>
          {suggested.length > 0 && (
            <button className="cta" onClick={() => setGoals(suggested.slice(0, MAX_GOALS))}>Use the coach's picks: {suggested.slice(0, MAX_GOALS).map(id => goalInfo(id).label.toLowerCase()).join(', ')}</button>
          )}
        </div>
      ) : (
        <div className="goal-list">{goals.map(g => <GoalRow key={g.id} id={g.id} since={g.since} matches={matches} />)}</div>
      )}
    </section>
  );
}

function GoalRow({ id, since, matches }: { id: GoalId; since: number; matches: ProfileMatch[] }) {
  const info = goalInfo(id);
  const series = goalSeries(matches.slice(0, 10), id);
  const vals = series.filter((v): v is number => v !== null);
  const now = vals.at(-1) ?? null;
  const startIdx = [...matches.slice(0, 10)].sort((a, b) => a.at - b.at).findIndex(m => m.at >= since);
  const atStart = startIdx > 0 ? series.slice(0, startIdx).filter((v): v is number => v !== null).at(-1) ?? null : null;
  const better = (a: number, b: number) => (info.higherBetter ? a > b : a < b);
  const verdict = now === null ? 'Not measured yet'
    : atStart !== null ? (better(now, atStart) ? 'Better than when you set it' : now === atStart ? 'Same as when you set it' : 'Worse than when you set it')
    : info.lvl10 !== null ? (better(now, info.lvl10) ? 'At level 10 or better' : 'Below level 10') : '';
  return (
    <div className="goal-row">
      <div className="goal-top">
        <b>{info.label}</b>
        <span className="num">{now !== null ? info.fmt(now) : '–'}</span>
      </div>
      <Spark values={series} target={info.lvl10} higherBetter={info.higherBetter} />
      <div className="goal-foot">
        <span className={now !== null && info.lvl10 !== null && better(now, info.lvl10) ? 'up' : 'muted'}>{verdict}</span>
        {info.lvl10 !== null && <span className="muted">level 10: {info.fmt(info.lvl10)}</span>}
      </div>
      <p className="muted small">{info.tip}</p>
    </div>
  );
}

/** A goal's value per match (oldest left), with the level-10 value as a dashed line. */
function Spark({ values, target, higherBetter }: { values: (number | null)[]; target: number | null; higherBetter: boolean }) {
  const W = 260, H = 54, P = 5;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 1) return <div className="spark empty muted small">One more match and the trend starts.</div>;
  const all = target !== null ? [...nums, target] : nums;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (i: number) => P + (values.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (values.length - 1));
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const pts = values.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => !!p);
  const lastV = nums.at(-1)!, good = target === null ? null : higherBetter ? lastV >= target : lastV <= target;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Trend over your recent matches">
      {target !== null && <line x1={0} x2={W} y1={y(target)} y2={y(target)} className="spark-target" />}
      <polyline points={pts.map(p => p.join(',')).join(' ')} className="spark-line" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2} className={i === pts.length - 1 ? `spark-now ${good === null ? '' : good ? 'up' : 'down'}` : 'spark-pt'} />)}
    </svg>
  );
}

function MapStats({ matches }: { matches: ProfileMatch[] }) {
  const rows = useMemo(() => mapStats(matches), [matches]);
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="map" size={16} /> Maps</h2><span className="muted small">all {matches.length} matches</span></div>
      <table className="site-table">
        <thead><tr><th>Map</th><th>Played</th><th>Won</th><th>ADR</th><th>K/D</th><th>Best</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.map}>
              <td><b>{mapName(r.map)}</b></td>
              <td className="num">{r.matches}</td>
              <td className={`num ${r.matches >= 2 ? (r.winRate >= 0.55 ? 'up' : r.winRate <= 0.45 ? 'down' : '') : ''}`}>{pct(r.winRate)}</td>
              <td className="num">{r.adr.toFixed(0)}</td>
              <td className="num">{fmtKd(r.kd)}</td>
              <td>{r.best && <span className="letter-chip small" style={{ background: LETTER_COLOR[r.best] }}>{r.best}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** What the coach sees across the matches: the habits to fix and to keep. */
function Habits({ matches }: { matches: ProfileMatch[] }) {
  const h = useMemo(() => habits(matches), [matches]);
  if (!h || (!h.work.length && !h.good.length)) return null;
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="star" size={16} /> Your habits</h2><span className="muted small">across {h.matches} matches, against FACEIT level 10</span></div>
      <div className="habit-cols">
        <div>{h.work.map(r => <div key={r.id} className="habit work"><b>{r.label}: {r.fmt(r.you)}</b><span className="muted">level 10: {r.fmt(r.lvl10)}</span><p>{r.tip}</p></div>)}</div>
        <div>{h.good.map(r => <div key={r.id} className="habit good"><b>{r.label}: {r.fmt(r.you)}</b><span className="muted">level 10: {r.fmt(r.lvl10)}</span></div>)}</div>
      </div>
    </section>
  );
}

/** A friend's last matches next to yours (their profile must be public). */
function Friend({ mine }: { mine: Averages | null }) {
  const me = useProfile(s => s.me), remote = useProfile(s => s.remote);
  const [q, setQ] = useState('');
  const [friend, setFriend] = useState<PublicProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const theirs = friend ? averages(friend.matches) : null;
  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) { setErr('Paste a Steam profile link, a custom URL name or a SteamID.'); return; }
    setBusy(true); setErr(null);
    try { setFriend(await findFriend(q)); } catch (x) { setFriend(null); setErr(x instanceof Error ? x.message : String(x)); }
    setBusy(false);
  };
  const rows: [string, (a: Averages) => string, (a: Averages) => number | null][] = [
    ['Win rate', a => pct(a.winRate), a => a.winRate], ['K/D', a => fmtKd(a.kd), a => a.kd], ['ADR', a => a.adr.toFixed(0), a => a.adr],
    ['KAST', a => `${a.kast.toFixed(0)}%`, a => a.kast], ['Headshots', a => `${a.hs.toFixed(0)}%`, a => a.hs],
    ['Impact', a => `${a.impact >= 0 ? '+' : ''}${a.impact.toFixed(1)}%`, a => a.impact], ['Premier', a => (a.premier !== null ? fmtInt(a.premier) : '–'), a => a.premier],
  ];
  return (
    <section className="site-card friend">
      <div className="card-head"><h2><Icon name="friends" size={16} /> Compare with a friend</h2></div>
      {!me || !remote ? (
        <div className="goal-empty">
          <p className="muted">Log in with Steam to look up a friend. They need a public profile (Settings → Public profile).</p>
          {STEAM_AVAILABLE && !me && <SteamLoginButton compact />}
        </div>
      ) : (
        <>
          <form className="friend-form" onSubmit={look}>
            <input type="text" value={q} onChange={e => { setQ(e.target.value); setErr(null); }} placeholder="steamcommunity.com/id/yourfriend" aria-label="Friend's Steam profile" />
            <button className="cta primary" type="submit" disabled={busy}>{busy ? 'Looking…' : 'Compare'}</button>
          </form>
          {err && <p className="warn-text small">{err}</p>}
          {friend && (theirs ? (
            <table className="site-table compare">
              <thead><tr><th /><th>You</th><th>{friend.avatar && <img src={friend.avatar} alt="" width={18} height={18} />} {friend.name ?? 'Friend'}</th></tr></thead>
              <tbody>{rows.map(([label, fmt, val]) => {
                const a = mine ? val(mine) : null, b = val(theirs);
                const win = a !== null && b !== null && a !== b ? (a > b ? 'a' : 'b') : null;
                return <tr key={label}><td>{label}</td><td className={`num ${win === 'a' ? 'up' : ''}`}>{mine ? fmt(mine) : '–'}</td><td className={`num ${win === 'b' ? 'up' : ''}`}>{fmt(theirs)}</td></tr>;
              })}</tbody>
            </table>
          ) : <p className="muted">{friend.name ?? 'They'} haven't reviewed any matches yet.</p>)}
        </>
      )}
    </section>
  );
}

/** The share card for one match: a preview, Download and Copy. */
export function ShareDialog({ m, player, onClose }: { m: ProfileMatch; player: string; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    const c = canvas.current!;
    drawShareCard(c, m, player).then(() => setUrl(c.toDataURL('image/png')));
  }, [m, player]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Share card" onClick={e => e.stopPropagation()}>
        <div className="card-head"><h2>Share card</h2><button className="ghost icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button></div>
        <canvas ref={canvas} className="share-canvas" />
        <div className="dialog-actions">
          {url && <a className="cta primary" href={url} download={shareFileName(m)}><Icon name="download" size={14} /> Download</a>}
          <button className="cta" onClick={async () => setCopied(await copyCard(canvas.current!))}><Icon name="copy" size={14} /> Copy image</button>
          {copied !== null && <span className="muted small">{copied ? 'Copied: paste it in Discord.' : 'This browser can\'t copy images; use Download.'}</span>}
        </div>
      </div>
    </div>
  );
}
