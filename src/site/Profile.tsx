import { letterStyle } from '../engine/notes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STEAM_AVAILABLE } from '../env';
import { GOAL_CHOICES, goalInfo, habits } from '../engine/habits';
import { focusOf, loadMoments } from '../moments/moments';
import { EmptyArt } from '../ui/Art';
import { averages, fullMatches, FREE_HISTORY, premierOf, goalSeries, hasPro, mapStats, MAX_GOALS, type Averages, type GoalId, LETTERS, type Letter, type ProfileMatch } from '../engine/profile';
import { biggestLeak, SKILL_MAP_FROM, skillMap, superpower } from '../engine/profileView';
import { matchKey } from '../engine/profile';
import { useStore } from '../store';
import { navigate } from '../shell/router';
import { openCs2Sample } from '../ui/sample';
import { Icon } from '../ui/Icon';
import { findFriend, setGoals, useProfile, type PublicProfile } from '../ui/profileApi';
import { steamFetch } from '../ui/steamApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { plural, fmtDate, fmtInt, fmtKd, mapName, pct } from './format';
import { copyCard, drawShareCard, shareFileName } from './shareCard';
import { AddMatches } from './AddMatches';
import { AreaChart, MiniLine, StretchLine } from './charts';
import { applyGame, gameOf, type GameId } from '../ui/tokens';
import { DlProfile } from '../deadlock/DlProfile';
import { steamId3 } from '../deadlock/api';

/** The header strip: matches reviewed, the average grade, and your grades match by match (last 10). */
function ProfileStrip({ matches }: { matches: ProfileMatch[] }) {
  const recent = [...matches].sort((a, b) => a.at - b.at).slice(-10);
  const idx = (l: Letter) => LETTERS.indexOf(l);
  const avgIdx = Math.round(matches.reduce((a, m) => a + idx(m.level ?? m.lobby), 0) / matches.length);
  const avgLetter = LETTERS[Math.max(0, Math.min(LETTERS.length - 1, avgIdx))];
  return (
    <section className="profile-strip" aria-label="Your matches in short">
      <div><span>Matches reviewed</span><b className="num">{matches.length}</b></div>
      <div title="Your average match grade (level grade where the match has one, else the lobby grade)"><span>Average grade</span><b className="letter-chip big" style={letterStyle(avgLetter)}>{avgLetter}</b></div>
      {recent.length >= 2 && <div className="ps-trend"><span>Grades, last {recent.length}</span>
        <MiniLine values={recent.map(m => LETTERS.length - 1 - idx(m.level ?? m.lobby))} good={null} /></div>}
    </section>
  );
}

/** The hero card: the habit that costs you most, what it costs, rounds to watch, and what to do about it. */
function LeakCard({ matches }: { matches: ProfileMatch[] }) {
  const leak = useMemo(() => biggestLeak(matches), [matches]);
  const goals = useProfile(s => s.data.goals);
  if (!leak) return null;
  const id = leak.row.id as GoalId, goal = goals.find(g => g.id === id);
  const ids = goals.map(g => g.id);
  // a goal's progress: its average before the goal against since
  const progress = (() => {
    if (!goal) return null;
    const val = (m: ProfileMatch) => goalSeries([m], id)[0];
    const pick = (ms: ProfileMatch[]) => ms.map(val).filter((v): v is number => v !== null);
    const was = pick(matches.filter(m => m.at < goal.since)), now = pick(matches.filter(m => m.at >= goal.since));
    if (!was.length || !now.length) return null;
    const a = was.reduce((x, y) => x + y, 0) / was.length, b = now.reduce((x, y) => x + y, 0) / now.length;
    return { a, b, since: goal.since };
  })();
  return (
    <section className="site-card leak-card">
      <span className="eyebrow">Biggest leak</span>
      <h2>{leak.title}</h2>
      <p className="leak-num">{leak.cost !== null && leak.cost > 0
        ? <>Costs you <b>~{Math.round(leak.cost * 100)}% win chance</b> a match</>
        : <>You: <b>{leak.row.fmt(leak.row.you)}</b> · level 10: {leak.row.fmt(leak.row.lvl10)}</>}</p>
      {leak.clip && (
        <p className="leak-clips">
          {leak.clip.rounds.map(n => <RoundLink key={n} match={leak.clip!.match} n={n} />)}
          <span className="muted small">{mapName(leak.clip.match.map)}, {fmtDate(leak.clip.match.at)}</span>
        </p>
      )}
      {progress && <p className={`leak-progress ${progress.b < progress.a === !goalInfo(id).higherBetter ? 'up' : 'down'}`}>
        {progress.b < progress.a ? 'Down' : 'Up'} from {goalInfo(id).fmt(progress.a)} to {goalInfo(id).fmt(progress.b)} since {fmtDate(progress.since)}</p>}
      <div className="hero-cta">
        <a className="cta" href="/puzzles">Practise in Puzzles</a>
        {!goal && <button className="cta primary" disabled={ids.length >= MAX_GOALS} title={ids.length >= MAX_GOALS ? `You have ${MAX_GOALS} goals already` : undefined}
          onClick={() => setGoals([...ids, id])}>Make it a goal</button>}
      </div>
    </section>
  );
}

/** A round of one of your matches: straight to it when that match is open in Review, else to Review to open it. */
function RoundLink({ match, n }: { match: ProfileMatch; n: number }) {
  const open = useStore(st => st.review);
  const here = !!open && matchKey(open.data.map, open.data.rounds) === match.id;
  const i = here ? open!.data.rounds.findIndex(r => r.n === n) : -1;
  return here && i >= 0
    ? <button className="chip" title={`Watch round ${n}`} onClick={() => { useStore.getState().setReviewRound(i); navigate({ page: 'cs2', mode: 'review' }); }}>R{n}</button>
    : <a className="chip" href="/cs2/review" title={`Round ${n}: open this match (${mapName(match.map)}, ${fmtDate(match.at)}) in Review to watch it`}>R{n}</a>;
}

/** Your best habit, and how many level-10 players you beat at it. */
function SuperCard({ matches }: { matches: ProfileMatch[] }) {
  const sp = useMemo(() => superpower(matches), [matches]);
  if (!sp) return null;
  return (
    <section className="site-card super-card">
      <span className="eyebrow">Your superpower</span>
      <h2>{sp.title}</h2>
      <p className="muted">Better than <b>{sp.better}%</b> of level-10 players</p>
      <p className="muted small">You: {sp.row.fmt(sp.row.you)} · level 10: {sp.row.fmt(sp.row.lvl10)}</p>
    </section>
  );
}

/** The 6 skills as dots on a track (0–100 against level 10, 50 = typical level 10), a trend arrow, details on a tap. */
function SkillMapCard({ matches }: { matches: ProfileMatch[] }) {
  const map = useMemo(() => skillMap(matches), [matches]);
  const [open, setOpen] = useState<string | null>(null);
  if (!map) {
    const left = SKILL_MAP_FROM - matches.length;
    return (
      <section className="site-card">
        <div className="card-head"><h2>Skill map</h2></div>
        <p className="muted">{plural(left, 'more match', 'more matches')} to unlock your skill map.</p>
        <div className="unlock-bar"><i style={{ width: `${(matches.length / SKILL_MAP_FROM) * 100}%` }} /></div>
      </section>
    );
  }
  return (
    <section className="site-card skill-map">
      <div className="card-head"><h2>Skill map</h2><span className="muted small">against FACEIT level 10 · 50 = typical level 10</span></div>
      <ul>
        {map.map(sk => (
          <li key={sk.name} className={open === sk.name ? 'open' : ''}>
            <button className="sk-row" onClick={() => setOpen(open === sk.name ? null : sk.name)} aria-expanded={open === sk.name} disabled={!sk.rows.length}>
              <b>{sk.name}</b>
              {sk.pct !== null
                ? <span className="sk-track" aria-label={`${sk.pct} out of 100`}><i className="sk-mid" /><i className="sk-dot" style={{ left: `${sk.pct}%` }} /></span>
                : <span className="sk-track none muted small">{sk.clutch ? (sk.clutch[0] ? `${sk.clutch[1]} of ${sk.clutch[0]} won · no level-10 number yet` : 'Not measured yet (newer matches only)') : 'Not measured yet'}</span>}
              <span className="sk-pct num">{sk.pct ?? ''}</span>
              <span className={`sk-trend ${sk.trend ?? ''}`} title={sk.trend ? 'Your last 5 matches against the 5 before' : undefined}>
                {sk.trend === 'up' ? <Icon name="trendUp" size={14} /> : sk.trend === 'down' ? <Icon name="trendDown" size={14} /> : sk.trend === 'flat' ? '–' : ''}</span>
            </button>
            {open === sk.name && (
              <ul className="sk-detail">
                {sk.rows.map(r => {
                  // the habit's costliest rounds in your newest match that has them
                  const m = matches.find(x => (x.leaks?.[r.id as GoalId]?.[1].length ?? 0) > 0);
                  return (
                    <li key={r.id}><span>{r.label}</span><span className={`num ${r.z >= 0 ? 'up' : 'down'}`}>{r.fmt(r.you)}</span><span className="muted small">level 10: {r.fmt(r.lvl10)}</span>
                      {m && r.z < 0 && <span className="sk-rounds">{m.leaks![r.id as GoalId]![1].map(n => <RoundLink key={n} match={m} n={n} />)}<span className="muted small">{mapName(m.map)}</span></span>}</li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Your profile: your last matches, how they trend, your goals, your maps, a friend next to you, and share cards. */
export function Profile() {
  const { me, data, remote, loaded, error } = useProfile();
  const pro = hasPro();
  const [all, setAll] = useState(false);
  const [share, setShare] = useState<ProfileMatch | null>(null);
  const matches = fullMatches(data.matches).sort((a, b) => b.at - a.at);
  const shown = all && pro ? matches : matches.slice(0, FREE_HISTORY);
  const last = averages(matches.slice(0, FREE_HISTORY));
  const name = me?.name ?? 'Your profile';
  // stats per game: CS2 or Deadlock (the game you were last in first); switching also dresses the page in its colours
  const [game, setGame] = useState<GameId>(() => gameOf('profile'));
  const pickGame = (g: GameId) => { setGame(g); applyGame(gameOf(g)); };

  return (
    <div className="page profile">
      <header className="profile-head">
        {me?.avatar ? <img className="avatar" src={me.avatar} alt="" width={64} height={64} /> : <span className="avatar empty"><Icon name="user" size={34} /></span>}
        <div className="profile-id">
          {/* the badge sits next to the heading, not in it (a screen reader read "Your profilePRO"); only when logged in */}
          <div className="profile-title"><h1>{name}</h1>{pro && me && <span className="pro-badge" title="Pro is free during early access">PRO</span>}</div>
          <p className="muted">
            {remote ? <><Icon name="shield" size={13} /> Saved to your Steam account{game === 'cs2' && ` · ${matches.length} CS2 match${matches.length === 1 ? '' : 'es'}`}</>
              : <span className="pill-small">{STEAM_AVAILABLE && !me ? 'Saved in this browser · Log in to sync' : 'Saved in this browser'}</span>}
          </p>
          {error && me && <p className="warn-text small">Your account's profile couldn't be loaded ({error}); showing this browser's copy.</p>}
        </div>
        <div className="profile-actions">
          <a className="cta" href="/settings"><Icon name="gear" size={14} /> Settings</a>
        </div>
      </header>

      <nav className="recap-tabs profile-games" aria-label="Game">
        <div className="recap-tabs-list" role="tablist">
          {(['cs2', 'deadlock'] as GameId[]).map(g => (
            <button key={g} role="tab" aria-selected={game === g} className={game === g ? 'on' : ''} onClick={() => pickGame(g)}>{g === 'cs2' ? 'Counter-Strike 2' : 'Deadlock'}</button>
          ))}
        </div>
      </nav>

      <FocusBanner game={game} />

      {game === 'deadlock' ? <DlProfile account={me?.steamId ? steamId3(me.steamId) : null} /> : <>
      {!matches.length ? (
        <section className="empty-card">
          <EmptyArt />
          <h2>No matches yet.</h2>
          <div className="hero-cta"><button className="cta" onClick={() => void openCs2Sample()}>Watch a sample</button><a className="cta primary" href="/cs2/review">Review my match</a></div>
        </section>
      ) : null}
      <AddMatches />
      {!matches.length ? null : (
        <>
          <ProfileStrip matches={matches} />
          <div className="leak-row">
            <LeakCard matches={matches} />
            <SuperCard matches={matches} />
          </div>
          <SkillMapCard matches={matches.slice(0, pro ? matches.length : FREE_HISTORY * 2)} />
          <section className="site-card">
            <div className="card-head">
              <h2>{all && pro ? 'All matches' : 'Matches'}</h2>
              <span className="wl-row" aria-label="Results, oldest first">{[...shown].reverse().map(m => <i key={m.id} className={m.result} title={`${mapName(m.map)} ${m.score[0]}:${m.score[1]}`} />)}</span>
              {matches.length > FREE_HISTORY && (pro
                ? <button className="ghost small-btn" onClick={() => setAll(!all)}>{all ? 'Show the last 5' : `Show all ${matches.length}`}</button>
                : <a className="muted small" href="/pricing"><Icon name="lock" size={12} /> {matches.length - FREE_HISTORY} older with Pro</a>)}
            </div>
            <div className="match-list">
              {shown.map(m => <MatchRow key={m.id} m={m} onShare={() => setShare(m)} />)}
            </div>
          </section>
          <div className="profile-grid">
            <Goals matches={matches} />
            <MapStats matches={matches} />
            <Friend mine={last} />
          </div>
          <PremierTrend matches={matches} />
        </>
      )}
      {!matches.length && <Friend mine={last} />}
      </>}
      {share && <ShareDialog m={share} player={me?.name ?? share.name ?? 'Me'} onClose={() => setShare(null)} />}
    </div>
  );
}


/** Your Premier rating match by match (or your ADR when the demos have no ratings). */
function PremierTrend({ matches }: { matches: ProfileMatch[] }) {
  const chrono = [...matches].sort((a, b) => a.at - b.at);
  const rated = chrono.filter(m => premierOf(m) !== null);
  // Premier when the demos have it (all of them, or at least two to draw); otherwise damage per round
  const usePremier = rated.length >= 2 || (rated.length > 0 && rated.length === chrono.length);
  const pts = (usePremier ? rated : chrono).slice(-20).map(m => ({
    label: new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: usePremier ? premierOf(m)! : m.adr,
    note: `${mapName(m.map)} ${m.score[0]}:${m.score[1]}`,
  }));
  if (pts.length < 2) return null; // the line starts at two matches
  return (
    <section className="site-card dash-wide">
      <div className="card-head">
        <h2><Icon name="trendUp" size={16} /> {usePremier ? 'Premier rating' : 'Damage per round'}</h2>
        <span className="muted small">{usePremier ? 'going into each match' : 'no Premier ratings in these demos'} · last {pts.length}</span>
      </div>
      <AreaChart points={pts} fmt={v => (usePremier ? fmtInt(v) : v.toFixed(0))} />
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
      <span className="letter-chip" style={letterStyle(grade)} title={m.level ? 'Level: B = a typical level-10 game, S = a typical pro game' : 'Grade among the lobby'}>{grade}</span>
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
          <p className="muted">No goals yet. Pick up to {MAX_GOALS} habits, or take the coach's picks: each new match shows if they got better.</p>
          {suggested.length > 0 && (
            <button className="cta" onClick={() => setGoals(suggested.slice(0, MAX_GOALS))}>Use the coach's picks: {suggested.slice(0, MAX_GOALS).map(id => goalInfo(id).label.toLowerCase()).join(', ')}</button>
          )}
        </div>
      ) : (
        <div className="goal-list">{goals.map(g => <GoalRow key={g.id} id={g.id} matches={matches} />)}</div>
      )}
    </section>
  );
}

function GoalRow({ id, matches }: { id: GoalId; matches: ProfileMatch[] }) {
  const info = goalInfo(id);
  // your last 10 matches, oldest first
  const series = goalSeries(matches.slice(0, 10), id);
  const vals = series.filter((v): v is number => v !== null);
  const now = vals.at(-1) ?? null;
  const better = (a: number, b: number) => (info.higherBetter ? a > b : a < b);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // the trend: your last 3 matches against the 3 before (small changes are noise)
  const recent = vals.slice(-3), before = vals.slice(-6, -3);
  const scale = Math.max(...vals.map(Math.abs), Math.abs(info.lvl10 ?? 0), 1e-9);
  const trend = before.length < 2 ? null : Math.abs(avg(recent) - avg(before)) < scale * 0.05 ? 'flat' : better(avg(recent), avg(before)) ? 'up' : 'down';
  const vsLvl10 = now === null || info.lvl10 === null ? null : better(now, info.lvl10) || now === info.lvl10;
  return (
    <div className="goal-row">
      <div className="goal-top">
        <b>{info.label}</b>
        <span className={`num ${vsLvl10 === null ? '' : vsLvl10 ? 'up' : 'down'}`}>{now !== null ? info.fmt(now) : '–'}</span>
      </div>
      {vals.length >= 2 ? (
        <div className="goal-chart">
          <span className="goal-axis">better</span>
          <StretchLine values={series} target={info.lvl10} invert={!info.higherBetter} height={64} dots="all"
            tone={v => (info.lvl10 === null ? 'flat' : better(v, info.lvl10) || v === info.lvl10 ? 'up' : 'down')} />
          <span className="goal-axis low">worse</span>
        </div>
      ) : <p className="muted small">One more match and the trend starts.</p>}
      <div className="goal-foot">
        {vsLvl10 !== null && <span className={vsLvl10 ? 'up' : 'down'}>{vsLvl10 ? 'At level 10 or better' : 'Worse than level 10'} ({info.fmt(info.lvl10!)}, dashed line)</span>}
        {trend && <span className={trend === 'flat' ? 'muted' : trend}>{trend === 'up' ? 'Improving' : trend === 'down' ? 'Getting worse' : 'Steady'} over your last 3</span>}
      </div>
      <p className="muted small">{info.tip}</p>
    </div>
  );
}

function MapStats({ matches }: { matches: ProfileMatch[] }) {
  const rows = useMemo(() => mapStats(matches), [matches]);
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="map" size={16} /> Maps</h2><span className="muted small">{matches.length === 1 ? '1 match' : `all ${plural(matches.length, 'match')}`}</span></div>
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
              <td>{r.best && <span className="letter-chip small" style={letterStyle(r.best)}>{r.best}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  // your Steam friends who use the site with a public profile: one click to compare (Worker /friends)
  const [onSite, setOnSite] = useState<{ steamId: string; matches: number; name: string | null; avatar: string | null }[] | null>(null);
  const [onSiteNote, setOnSiteNote] = useState<string | null>(null);
  useEffect(() => {
    if (!me || !remote) return;
    let live = true;
    (async () => {
      const r = await steamFetch('/friends').then(x => (x.ok ? x.json() : null)).catch(() => null) as { friends: { steamId: string; matches: number }[]; note: string | null } | null;
      if (!r || !live) return;
      const names = r.friends.length ? await steamFetch(`/profiles?ids=${r.friends.slice(0, 20).map(f => f.steamId).join(',')}`).then(x => (x.ok ? x.json() : null)).catch(() => null) : null;
      if (!live) return;
      setOnSite(r.friends.slice(0, 20).map(f => ({ ...f, name: names?.profiles?.[f.steamId]?.name ?? null, avatar: names?.profiles?.[f.steamId]?.avatar ?? null })));
      setOnSiteNote(r.note);
    })();
    return () => { live = false; };
  }, [me, remote]);
  const compareWith = async (id: string) => {
    setQ(id); setBusy(true); setErr(null);
    try { setFriend(await findFriend(id)); } catch (x) { setFriend(null); setErr(x instanceof Error ? x.message : String(x)); }
    setBusy(false);
  };
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
          <div className="empty-art-row"><EmptyArt size={72} /><p className="muted">No friends added. Log in with Steam, add one and see who's better. They need a public profile (Settings → Public profile).</p></div>
          {STEAM_AVAILABLE && !me && <SteamLoginButton compact />}
        </div>
      ) : (
        <>
          {onSite && onSite.length > 0 && (
            <div className="friend-chips" role="group" aria-label="Your Steam friends on RageView">
              <span className="muted small">Your friends here:</span>
              {onSite.map(f => (
                <button key={f.steamId} className={`chip ${friend && q === f.steamId ? 'on' : ''}`} onClick={() => void compareWith(f.steamId)} disabled={busy}>
                  {f.avatar && <img src={f.avatar} alt="" width={16} height={16} />} {f.name ?? 'A friend'} <span className="muted small">{f.matches}</span>
                </button>
              ))}
            </div>
          )}
          {onSite && !onSite.length && onSiteNote && <p className="muted small">{onSiteNote}</p>}
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

/** The next match's one thing (the most frequent mistake lately, from your moments) and whether you're fixing it. */
function FocusBanner({ game }: { game: GameId }) {
  const f = useMemo(() => focusOf(loadMoments(), game), [game]);
  if (!f) return null;
  return (
    <a className="site-card focus-banner" href="/puzzles">
      <Icon name="goal" size={20} />
      <span><span className="muted small">Next match, one thing</span><b>{f.kind}</b></span>
      <span className={`focus-streak ${f.streak ? 'up' : ''}`}>{f.streak ? `Fixing it: ${f.streak} in a row` : 'Practise it in Puzzles'}</span>
      <Icon name="arrowRight" size={14} />
    </a>
  );
}
