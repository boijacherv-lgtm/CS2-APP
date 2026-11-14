import { letterStyle } from '../engine/notes';
import { useSiteConfig } from './siteConfig';
import { CountUp } from './CountUp';
import { useEffect, useMemo, useState } from 'react';
import { SplitChart } from '../site/charts';
import { closeCs2Match } from './closeMatch';
import { Collapse } from './Collapse';
import { matchCurve } from '../engine/matchChance';
import { sideSwitches } from './Playback';
import { coach, modelFor, type CoachNote, type Coaching, type Deviation, type FeatureId, type FeatureSet } from '../engine/coach';
import { analystReport, type Finding, type Topic } from '../engine/analystBench';
import { analystBench, proAnalystAvailable } from '../engine/analystModel';
import { matchAnalysis, type AnalysisItem } from '../engine/analysis';
import { COACH_MODEL, modelOf, PRO_MODEL, type Level } from '../engine/coachModels';
import type { LevelGrade } from '../engine/level';
import { buildMatchReport, IMPACT_PER_POINT, type MatchReport, type PlayerReport, type RoundLine, type RoundSummary } from '../engine/match';
import { LETTER_COLOR, RATING_SCALE, type DemoData, type Letter, type PlayKey } from '../engine/recap';
import { ACTION_TEXT, PLAY_MODEL } from '../engine/playModel';
import { habits } from '../engine/habits';
import { useProfile } from './profileApi';
import { rageSummary } from '../engine/rage';
import { matchKey } from '../engine/profile';
import { percentile, SKILLS, skillMap } from '../engine/profileView';
import { ShareDialog } from '../site/Profile';
import { SEARCH_COLOR, type SearchMoment } from '../engine/search';
import { MAPS } from '../map/catalog';
import { navigate } from '../shell/router';
import { rageNow, useStore, whoAmI } from '../store';
import { ReviewStart } from './Recap';
import { Icon, type IconName } from './Icon';

/**
 * Match recap, read top to bottom: the result → your game (grade, rating, key numbers) and the coach → everyone's
 * stats → every round's grades. Rounds are graded in a worker (Shell → useMatchGrader) and it all fills in as they
 * finish. Clicking a player anywhere makes them the one the top cards are about.
 */
export function MatchReportPage() {
  const report = useStore(s => s.report);
  const view = useMemo(() => (report ? buildMatchReport(report.data, report.rounds) : null), [report]);
  const [picked, setPicked] = useState<string | null>(null);
  // you: logged in with Steam, or picked with "This is me" (opens on your game when you played in this match)
  const me = useStore(whoAmI);
  // a round the coach points at (hovering R12 outlines that column in the grid)
  const [hotRound, setHotRound] = useState<number | null>(null);
  // your default comparison (Settings), when the pro models are there
  const [level, setLevel] = useState<Level>(() => (useProfile.getState().data.prefs.compare === 'pro' && (!!PRO_MODEL || proAnalystAvailable) ? 'pro' : 'lvl10'));
  const [fullBoard, setFullBoard] = useState(false);
  const [tab, setTab] = useState<RecapTab>(() => { try { const t = localStorage.getItem(LS_TAB); if (t === 'analyst' || t === 'positions' || t === 'engine') return 'coach'; return t && RECAP_TABS.some(x => x.id === t) ? t as RecapTab : 'overview'; } catch { return 'overview'; } });
  const pickTab = (t: RecapTab) => { setTab(t); try { localStorage.setItem(LS_TAB, t); } catch { /* private mode */ } document.querySelector('.report')?.scrollTo({ top: 0 }); };
  // the overview's short version: the coach's summary, the three things to fix first, two to keep
  const overviewFor = useMemo(() => {
    const p = view?.players.find(x => x.id === ([picked, me].find(id => id && view.players.some(q => q.id === id)) ?? view.players[0]?.id));
    if (!p) return { summary: '', fix: [] as CoachNote[], keep: [] as CoachNote[] };
    const c = coach(p, modelOf(level));
    return { summary: c.summary, fix: c.improve.slice(0, 3), keep: c.strengths.slice(0, 2) };
  }, [view, picked, me, level]);
  const overview = overviewFor;
  if (!report || !view) return (
    <div className="page not-found"><h1>Open a match first.</h1><p className="muted">Match recap shows a match you've opened in Review.</p><p><a className="cta primary" href="/cs2/review">Review a match</a></p></div>
  );

  // the pro level, once it's trained (HLTV demos): the coach and the analyst compare with it instead
  const hasPro = !!PRO_MODEL || proAnalystAvailable;
  const focusId = [picked, me].find(id => id && view.players.some(p => p.id === id)) ?? view.players[0]?.id;
  const focus = view.players.find(p => p.id === focusId)!;
  const data = report.data;
  const openRound = (i: number) => {
    useStore.getState().setReviewRound(i);
    navigate({ page: 'cs2', mode: 'review' });
  };

  const watch = (rounds: number[]) => rounds.slice(0, 6).map(i => (
    <button key={i} className="round-link" onClick={() => openRound(i)} onMouseEnter={() => setHotRound(i)} onMouseLeave={() => setHotRound(null)} title="Open this round in Review">R{i + 1}</button>
  ));
  return (
    <div className="report">
      <MatchHeader data={data} view={view} me={me} done={report.done} error={report.error} verdict={report.done ? overview?.summary : undefined} />

      {/* the categories: one at a time, so the page is short; the bar stays at the top */}
      <nav className="recap-tabs" aria-label="Recap">
        <div className="recap-tabs-list" role="tablist">
          {RECAP_TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pickTab(t.id)}>
              <Icon name={t.icon} size={14} /> {t.label}
            </button>
          ))}
        </div>
        {hasPro && (
          <div className="seg-mini level-toggle" role="group" aria-label="Compare with" title="Who the coach and analyst compare you with">
            <button className={level === 'lvl10' ? 'on' : ''} onClick={() => setLevel('lvl10')} title="FACEIT level-10 players">Lvl 10</button>
            <button className={level === 'pro' ? 'on' : ''} onClick={() => setLevel('pro')} title="Pro players (HLTV demos)">Pro</button>
          </div>
        )}
      </nav>

      {tab === 'overview' && focus && (
        <>
          {!report.done && (
            <section className="top3 skel" aria-busy="true" aria-label={`Coach notes · ${view.graded}/${view.total} rounds`}>
              {['Costliest moment', 'Best play', 'Fix next'].map(l => <div key={l} className="top3-card"><span className="eyebrow">{l}</span><i className="skel-line" /><i className="skel-line short" /><span className="muted small">Coach notes · {view.graded}/{view.total} rounds</span></div>)}
            </section>
          )}
          {report.done && <TopThree p={focus} fix={overview.fix[0] ?? null} onWatch={(i, t) => { openRound(i); if (t !== null) useStore.getState().setTime(Math.max(0, t - 2)); }} />}
          <Performance p={focus} players={view.players} me={me} onPlayer={setPicked} />
          {report.done && <RoundCallouts p={focus} onRound={openRound} />}
          <MatchChance data={data} team={focus.team as 0 | 1} onRound={i => openRound(i)} />
          <div className="recap-two">
          {report.done && <Collapse title="Side by side" hint="you next to another player"><DuoCard a={focus} players={view.players} /></Collapse>}
          <section className="recap-card overview">
            {/* half-graded notes read like verdicts: wait for every round */}
            {!report.done && <p className="ov-summary muted">The coach's notes appear once every round is graded ({view.graded}/{view.total}).</p>}
            {/* the summary is the header's one line (recap-verdict): not repeated here */}
            <Collapse title="More to work on and keep" hint="the other fixes and what you already do well">
            {/* the first fix is the header's line and the Fix next card: the list adds only what comes after it */}
            {report.done && overview.fix.length > 1 && (
              <>
                <h3>Also work on</h3>
                <ol className="ov-list" start={2}>
                  {overview.fix.slice(1).map(n => (
                    <li key={n.title}>
                      <b>{n.title}</b>
                      {n.rounds.length > 0 && <span className="coach-rounds">{watch(n.rounds)}</span>}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {report.done && overview.keep.length > 0 && (
              <>
                <h3>Keep doing</h3>
                <ul className="ov-list keep">{overview.keep.map(n => <li key={n.title}><b>{n.title}</b></li>)}</ul>
              </>
            )}
            </Collapse>
          </section>
          </div>
        </>
      )}
      {/* one Coach tab (was Coach, Analyst, Positions and Engine): the notes, the engine's moments, the numbers, where you stood */}
      {tab === 'coach' && focus && (
        <>
          <CoachCard p={focus} level={level} done={report.done} onRound={openRound} onHotRound={setHotRound} />
          <DecisionsCard rounds={report.rounds} player={focus.id} onRound={openRound} onHotRound={setHotRound} />
          {/* the numbers behind the notes: three parts in one card (round analysis, where you stood, your habits) */}
          <section className="recap-card numbers">
            <div className="coach-head"><h2 className="display">Numbers</h2><span className="muted" title={`vs FACEIT level 10, from the coach's model (${modelOf(level).trainedOn} player-games)`}>6 skills</span></div>
            <NumbersTable p={focus} level={level} onRound={openRound} />
            <details className="all-numbers"><summary className="muted">Full analysis</summary>
            <AnalystCard data={data} rounds={report.rounds} player={focus.id} level={level} done={report.done} onRound={openRound} onHotRound={setHotRound} />
            <PositioningCard data={data} rounds={report.rounds} player={focus.id} done={report.done} onRound={openRound} onHotRound={setHotRound} />
            {me && view.players.some(p => p.id === me) && <HabitsCard />}
            </details>
          </section>
        </>
      )}
      {tab === 'scoreboard' && (
        <section className="recap-card">
          <div className="coach-head">
            <h2 className="display">Scoreboard</h2>
            <button className="ghost sb-more" onClick={() => setFullBoard(!fullBoard)} aria-expanded={fullBoard}>{fullBoard ? 'Fewer columns' : 'More columns'}</button>
          </div>
          {([0, 1] as const).map(t => (
            <Scoreboard key={t} team={t} players={view.players.filter(p => p.team === t)} score={view.score[t]} focus={focusId} onPick={setPicked} full={fullBoard} />
          ))}
        </section>
      )}
      {tab === 'rounds' && <RoundGrid data={data} players={view.players} focus={focusId} hot={hotRound} onPick={setPicked} onRound={openRound} />}
    </div>
  );
}

type RecapTab = 'overview' | 'coach' | 'scoreboard' | 'rounds';
const RECAP_TABS: { id: RecapTab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' },
  { id: 'coach', label: 'Coach', icon: 'chat' },
  { id: 'scoreboard', label: 'Scoreboard', icon: 'list' },
  { id: 'rounds', label: 'Timeline', icon: 'grid' },
];
const LS_TAB = 'stratboard.recapTab';

/** Map art, the final score (yours first when you played) and the result. */
function MatchHeader({ data, view, me, done, error, verdict }: { data: DemoData; view: MatchReport; me: string | null; done: boolean; error?: string; verdict?: string }) {
  const map = MAPS.find(m => m.id === data.map);
  const mine = me ? view.players.find(p => p.id === me) : undefined;
  const [a, b] = mine && mine.team === 1 ? [view.score[1], view.score[0]] : view.score;
  const result = mine ? (a > b ? 'Victory' : a < b ? 'Defeat' : 'Draw') : null;
  const delta = mine && mine.gameRating !== null && mine.rank !== null ? mine.gameRating - mine.rank : null;
  const ranked = Object.keys(data.ranks ?? {}).length;
  // your match, once it's on your profile: a share card
  const key = matchKey(data.map, data.rounds);
  const saved = useProfile(s => s.data.matches.find(m => m.id === key)), profileName = useProfile(s => s.me?.name ?? null);
  const [share, setShare] = useState(false);
  return (
    <header className="recap-head" style={{ '--map-art': map ? `url(${map.levels[0].image})` : 'none' } as React.CSSProperties}>
      <div className="recap-head-main">
        <h1 className="recap-map display">{map?.name ?? data.map} <span className="sr-only">{a}–{b}</span></h1>{data.sample && <span className="chip">Sample match · names replaced</span>}
        <span className="recap-score display">
          <b className={mine ? (mine.team === 0 ? 'ct' : 't') : 'ct'}>{a}</b><i>:</i><b className={mine ? (mine.team === 0 ? 't' : 'ct') : 't'}>{b}</b>
        </span>
        {result && <span className={`recap-result ${result.toLowerCase()}`}>{result}</span>}
        {mine && done && <span className="recap-grade" title="Your grade for this match: how it compares with a typical FACEIT level-10 game"><span className="perf-letter display reveal" style={letterStyle(matchGrade(mine))}>{matchGrade(mine)}</span><span className="muted small">your grade</span></span>}
        {saved && <button className="recap-share" onClick={() => setShare(true)}><Icon name="share" size={14} /> Share</button>}
        <button className="ghost small-btn recap-close" onClick={closeCs2Match}><Icon name="close" size={13} /> Close match</button>
      </div>
      {share && saved && <ShareDialog m={saved} player={profileName ?? saved.name ?? 'Me'} onClose={() => setShare(false)} />}
      <p className="muted">
        {data.rounds.length} rounds · {mine ? `you started ${mine.team === 0 ? 'CT' : 'T'}${result ? ` · ${result === 'Victory' ? 'won' : result === 'Defeat' ? 'lost' : 'drew'} ${a}–${b}` : ''}` : `Team A started CT · ${a}–${b} (pick yourself below for "you")`}
        {mine && mine.gameRating !== null && <> · you: game rating <b>{fmt(mine.gameRating)}</b>{delta !== null && <span className={delta >= 0 ? 'up' : 'down'}> ({delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))} vs your Premier)</span>}</>}
        {!ranked && <span title="No Premier ratings in this demo: estimates use a 10,000 player as base"> · No Premier ratings</span>}
        {!done && <> · <b>grading rounds {view.graded}/{view.total}…</b></>}
        {done && error && <> · <b className="down">grading stopped after {view.graded}/{view.total} rounds: {error}</b></>}
      </p>
      {!done && <div className="report-progress"><i style={{ width: `${(view.graded / view.total) * 100}%` }} /></div>}
      {verdict && <p className="recap-verdict">{verdict}</p>}
    </header>
  );
}

/** The match's shape: the chance to win from the score, round by round (the same chart as Deadlock's chance to win). */
function MatchChance({ data, team, onRound }: { data: DemoData; team: 0 | 1; onRound: (i: number) => void }) {
  const swaps = useMemo(() => new Set(sideSwitches(data)), [data]);
  const curve = useMemo(() => {
    let flip = false;
    const winners = data.rounds.map((r, i) => {
      if (swaps.has(i) && i > 0) flip = !flip;
      if (!r.winner) return null;
      const t0 = (r.winner === 'CT') !== flip;   // team 0 started CT: it's CT before the switch, T after
      return (t0 ? 0 : 1) as 0 | 1;
    });
    return matchCurve(winners, team);
  }, [data, swaps, team]);
  if (data.rounds.length < 4) return null;
  const vs = curve.map(p => p.v), peak = Math.max(...vs), low = Math.min(...vs), end = vs[vs.length - 1], won = end > 50;
  const peakAt = curve[vs.indexOf(peak)].t, lowAt = curve[vs.indexOf(low)].t, last = curve[curve.length - 1].t;
  const story = `Peaked ${Math.round(peak)}% in R${peakAt}${low < 50 ? ` · fell to ${Math.round(low)}% by R${lowAt}` : ''} · ${won ? (low < 35 ? 'a comeback' : 'won as expected') : (peak > 65 ? 'lost from ahead' : 'never really ahead')}`;
  const first = [...swaps].find(i => i > 0);
  return (
    <section className="recap-card match-chance">
      <div className="coach-head"><h2 className="display">Chance to win</h2><span className="chip takeaway">{story}</span></div>
      <SplitChart caption="Your team's chance to win the match, round by round" base={50} top={100} bottom={0} colors={['var(--good)', 'var(--bad)']}
        height={132} points={curve} fmt={v => `${Math.round(v)}%`} xfmt={t => (t === 0 ? 'Start' : `R${t}`)} xticks={Array.from({ length: Math.floor(last / 3) + 1 }, (_, k) => k * 3)} divider={first ? { t: first, label: 'Sides switched' } : null}
        onPick={t => onRound(Math.max(0, Math.min(data.rounds.length - 1, t - 1)))} />
    </section>
  );
}

/** A player's one grade for the match: against level 10 when the coach can say, else in the lobby. */
export const matchGrade = (p: PlayerReport): Letter => (p.level?.letter ?? p.lvl10?.letter ?? p.letter) as Letter;
const gradeKey = (l: string) => (l === 'S+' ? 'splus' : l.toLowerCase());

/** The overview's first row: the costliest move, the best one, and the habit to fix next, each with Watch. */
function TopThree({ p, fix, onWatch }: { p: PlayerReport; fix: CoachNote | null; onWatch: (round: number, t: number | null) => void }) {
  const pick = (k: 'worst' | 'best') => p.rounds.reduce<{ i: number; m: NonNullable<RoundLine['worst']> } | null>((acc, l, i) => {
    const m = l?.[k];
    return m && (!acc || Math.abs(m.gain) > Math.abs(acc.m.gain)) ? { i, m } : acc;
  }, null);
  const worst = pick('worst'), best = pick('best');
  const pct = (g: number) => `${g >= 0 ? '+' : '−'}${Math.round(Math.abs(g) * 100)}%`;
  const card = (cls: string, label: string, body: React.ReactNode, watch: (() => void) | null) => (
    <div className={`top3-card ${cls}`}>
      <span className="eyebrow">{label}</span>
      {body}
      {watch && <button className="cta small-btn" onClick={watch}><Icon name="play" size={12} /> Watch</button>}
    </div>
  );
  return (
    <section className="top3">
      {card('leak', 'Costliest moment', worst ? <><b>{worst.m.title}</b><span className="muted small">Round {worst.i + 1} · {pct(worst.m.gain)} win chance</span></> : <span className="muted">No costly move. Clean game.</span>, worst ? () => onWatch(worst.i, worst.m.t) : null)}
      {card('best', 'Best play', best ? <><b>{best.m.title}</b><span className="muted small">Round {best.i + 1} · {pct(best.m.gain)} win chance</span></> : <span className="muted">No big swing in your favour this time.</span>, best ? () => onWatch(best.i, best.m.t) : null)}
      {card('fix', 'Fix next', fix ? <><b>{fix.rounds.length ? 'See where it happened' : 'Open the Coach tab'}</b><span className="muted small">{fix.rounds.length ? `Rounds ${fix.rounds.slice(0, 4).map(r => r + 1).join(', ')}` : 'Details are in the Coach tab'}</span></> : <span className="muted">Nothing stands out against level 10.</span>, fix?.rounds.length ? () => onWatch(fix.rounds[0], null) : null)}
    </section>
  );
}

/** The focused player's game: match grade, game rating against their real rating, and three key numbers vs normal. */
function Performance({ p, players, me, onPlayer }: { p: PlayerReport; players: PlayerReport[]; me: string | null; onPlayer: (id: string) => void }) {
  const normal = useNormal(p);
  const kpi = (id: FeatureId, label: string, value: string, v: number) => {
    const m = normal[id];
    const z = (v - m.baseline) / m.spread;
    return (
      <div className="kpi" title={`Normal: ${id === 'impact' ? `${m.baseline}%` : Math.round(m.baseline)}`}>
        <span>{label}</span>
        <b className="num"><CountUp text={value} id={`${p.id}:${id}:${value}`} /></b>
        <i className={z > 0.5 ? 'up' : z < -0.5 ? 'down' : ''}><Icon name={z > 0.5 ? 'up' : z < -0.5 ? 'down' : 'dot'} size={9} /> {z > 0.5 ? 'above normal' : z < -0.5 ? 'below normal' : 'normal'}</i>
      </div>
    );
  };
  return (
    <section className="recap-card perf">
      <div className="perf-head">
        <select value={p.id} onChange={e => onPlayer(e.target.value)} title="Whose game">
          {players.map(x => <option key={x.id} value={x.id}>{x.name}{x.id === me ? ' (you)' : ''}</option>)}
        </select>
        <span className="muted">{rolesText(p, false)}</span>
        {p.id !== me && (
          <button className="ghost this-is-me" onClick={() => { useStore.getState().setClaimed(p.id); onPlayer(p.id); }}
            title="Open your own game first and evaluate only your moves in Review (remembered in this browser)">This is me</button>
        )}
      </div>
      <div className="perf-tiles">
        <div className="kpi perf-grade-tile" title={whyTitle(p)}>
          <span>Grade</span>
          {/* the reveal: the badge flips in once; S+ gets a short confetti burst (no motion with reduced motion) */}
          <span className="perf-reveal">
            <span className={`perf-letter display reveal g-${gradeKey(matchGrade(p))}`} style={letterStyle(matchGrade(p))}>{matchGrade(p)}</span>
            {matchGrade(p) === 'S+' && <span className="confetti" aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${(i * 360) / 14}deg`, '--d': `${38 + (i % 3) * 10}px` } as React.CSSProperties} />)}</span>}
          </span>
          <i>{p.level || p.lvl10 ? 'vs level 10' : 'in this lobby'}{NICK[matchGrade(p)] ? ` · ${NICK[matchGrade(p)]}` : ''}</i>
        </div>
        {p.gameRating !== null && (
          <div className="kpi" title="Estimated rating for this match (duel performance + round impact); the change is against their real Premier rating">
            <span>Premier</span>
            <b className="num"><CountUp text={fmt(p.gameRating)} id={`${p.id}:rating`} /></b>
            {p.rank !== null ? <i className={p.gameRating >= p.rank ? 'up' : 'down'}>{p.gameRating >= p.rank ? '▲' : '▼'} {fmt(Math.abs(p.gameRating - p.rank))}</i> : <i>estimate</i>}
          </div>
        )}
        {kpi('adr', 'ADR', p.adr.toFixed(0), p.adr)}
        {kpi('kast', 'KAST', `${p.kast.toFixed(0)}%`, p.kast)}
        {kpi('impact', 'Impact', `${p.impactPerRound >= 0 ? '+' : ''}${p.impactPerRound.toFixed(1)}%`, p.impactPerRound)}
      </div>
      <p className="muted perf-line num">{p.kills} kills · {p.deaths} deaths · {p.hs.toFixed(0)}% HS · openings {p.openingKills}–{p.openingDeaths}{p.clutches ? ` · ${p.clutches} clutch kill${p.clutches === 1 ? '' : 's'}` : ''}</p>
    </section>
  );
}

/** Game rating as a half dial from 0 to 30,000, with their real Premier rating as a tick. */
function Gauge({ rating, rank }: { rating: number | null; rank: number | null }) {
  const MAX = 30000;
  const ang = (v: number) => Math.PI * (1 - Math.max(0, Math.min(1, v / MAX)));
  const pt = (v: number, r: number) => [60 + Math.cos(ang(v)) * r, 60 - Math.sin(ang(v)) * r];
  const arc = (v: number) => { const [x, y] = pt(v, 48); return `M 12 60 A 48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`; };
  const delta = rating !== null && rank !== null ? rating - rank : null;
  return (
    <div className="gauge" title="Estimated rating for this game (the tick is their real Premier rating)">
      <svg viewBox="0 0 120 66" aria-hidden>
        <path d="M 12 60 A 48 48 0 0 1 108 60" fill="none" stroke="var(--surface-3)" strokeWidth="6" strokeLinecap="round" />
        {rating !== null && <path d={arc(rating)} fill="none" stroke="var(--text-1)" strokeWidth="6" strokeLinecap="round" />}
        {rank !== null && (() => { const [x1, y1] = pt(rank, 40); const [x2, y2] = pt(rank, 56); return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--t)" strokeWidth="2.5" />; })()}
      </svg>
      <b className="display num">{rating !== null ? fmt(rating) : '–'}</b>
      <span className="muted">game rating{delta !== null && <> · <span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))}</span> vs {fmt(rank!)}</>}</span>
    </div>
  );
}

/** The same six skills as the profile, for this match: you against level 10, with a row that opens to what to work on (three rounds at most). */
function NumbersTable({ p, level, onRound }: { p: PlayerReport; level: Level; onRound: (i: number) => void }) {
  const c = useMemo(() => coach(p, modelOf(level)), [p, level]);
  const matches = useProfile(s => s.data.matches);
  const map = useMemo(() => skillMap(matches), [matches]);
  const [open, setOpen] = useState<string | null>(null);
  const skills = SKILLS.filter(sk => sk.ids.length).map(sk => {
    const rows = c.profile.filter(d => sk.ids.includes(d.feature));
    const z = rows.length ? rows.reduce((a, d) => a + d.z, 0) / rows.length : null;
    const notes = c.improve.filter(n => sk.ids.includes(n.feature as string));
    const trend = map?.find(m => m.name === sk.name)?.trend ?? null;
    return { name: sk.name, pct: z === null ? null : percentile(z), notes, trend, worst: [...rows].sort((a, b) => a.z - b.z)[0] };
  });
  return (
    <ul className="num-rows" aria-label="Six skills against FACEIT level 10, 50 is a typical level-10 player">
      <li className="num-head" aria-hidden="true"><span>Skill</span><span className="num-axis"><span>worse</span><span>level 10</span><span>better</span></span><span>You</span><span /></li>
      {skills.map(k => (
        <li key={k.name} className={open === k.name ? 'open' : ''}>
          <button className="num-row" onClick={() => setOpen(open === k.name ? null : k.name)} aria-expanded={open === k.name}>
            <b>{k.name}</b>
            <span className="sk-track" aria-hidden="true"><i className="sk-mid" />{k.pct !== null && <i className="sk-dot" style={{ left: `${Math.max(0, Math.min(100, k.pct))}%` }} />}</span>
            <span className="num-val num">{k.pct ?? '–'}</span>
            <span className="num-trend">{k.trend === 'up' ? <Icon name="trendUp" size={14} /> : k.trend === 'down' ? <Icon name="trendDown" size={14} /> : null}</span>
          </button>
          {open === k.name && (
            <div className="num-more">
              {k.notes.length ? k.notes.slice(0, 2).map(n => <p key={n.title}><b>{n.title}.</b> <span className="muted">{n.detail}</span></p>) : <p className="muted">{k.worst ? `${k.worst.label}: ${k.worst.value} (level 10: ${k.worst.normal}). Nothing to work on here.` : 'Nothing measured.'}</p>}
              {k.notes[0] && k.notes[0].rounds.length > 0 && <div className="coach-rounds"><span className="muted">Watch:</span>{k.notes[0].rounds.slice(0, 3).map(i => <button key={i} className="round-link" onClick={() => onRound(i)}>R{i + 1}</button>)}</div>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The coach: one line of summary, then every number as a bar from "normal": better to the right, worse to the left. */
function CoachCard({ p, level, done, onRound, onHotRound }: { p: PlayerReport; level: Level; done: boolean; onRound: (i: number) => void; onHotRound: (i: number | null) => void }) {
  const model = modelOf(level);
  const c: Coaching = useMemo(() => coach(p, model), [p, model]);
  const role = p.roles[0]?.role ?? 'Rifler';
  const byRole = modelFor(model, role).byRole;
  const [open, setOpen] = useState<FeatureId | null>(null);
  const rage = useStore(rageNow); useSiteConfig();
  // five bars: your three worst against level 10 and your two best; every number is in "All numbers"
  const byZ = [...c.profile].sort((a, b) => a.z - b.z);
  const rows = [...byZ.filter(d => d.z < -0.3).slice(0, 3), ...[...byZ].reverse().filter(d => d.z > 0.3).slice(0, 2)];
  const restRows = c.profile.filter(d => !rows.includes(d));
  const side = (v: number | null) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  return (
    <section className="recap-card coach">
      <div className="coach-head">
        <h2 className="display">Coach</h2>
        <span className="muted" title="How much you changed your team's chance to win the round, on average, on each side">Impact per round: CT {side(c.sides.CT)} · T {side(c.sides.T)}</span>
      </div>
      {model.trainedOn > 0 && (
        <p className="coach-vs muted" title={`Compared with ${model.name ?? 'trained'} players${byRole ? ` (${role.toLowerCase()}s)` : ''}. Learned from ${model.trainedOn} player-games${model.source ? ` in ${model.source.demos} demos` : ''}`}>
          vs {level === 'pro' ? 'pros' : 'level 10'}
        </p>
      )}
      {(() => { const top = c.improve[0], dev = top && c.profile.find(d => d.feature === top.feature), stat = dev ? `${dev.value} (level 10: ${dev.normal})` : '', t = rageSummary(top?.feature ?? null, !!top?.title.startsWith('Your '), rage, stat); return t ? <p className="coach-rage">{t}</p> : null; })()}
      {c.improve[0] && (() => { const dev = c.profile.find(d => d.feature === c.improve[0].feature); return dev ? <p className="coach-top"><b>{c.improve[0].title}</b>: {dev.label.toLowerCase()} {dev.value} (level 10: {dev.normal})</p> : null; })()}
      <div className="dev-axis muted"><span>worse</span><span>← level 10 →</span><span>better</span></div>
      <div className="dev-list">
        {rows.map(d => <DevRow key={d.feature} d={d} open={open === d.feature} onToggle={() => setOpen(open === d.feature ? null : d.feature)}
          onRound={onRound} onHotRound={onHotRound} />)}
      </div>
      {restRows.length > 0 && (
        <details className="all-numbers"><summary className="muted">All numbers ({restRows.length} more)</summary>
          <div className="dev-list">{restRows.map(d => <DevRow key={d.feature} d={d} open={open === d.feature} onToggle={() => setOpen(open === d.feature ? null : d.feature)} onRound={onRound} onHotRound={onHotRound} />)}</div>
        </details>
      )}
    </section>
  );
}

function DevRow({ d, open, onToggle, onRound, onHotRound }: {
  d: Deviation; open: boolean; onToggle: () => void; onRound: (i: number) => void; onHotRound: (i: number | null) => void;
}) {
  const w = Math.min(1, Math.abs(d.z) / 3) * 50; // % of the row, from the middle
  const kind = d.z > 0.8 ? 'up' : d.z < -0.8 ? 'down' : 'flat';
  return (
    <div className={`dev ${kind} ${open ? 'open' : ''} ${d.note ? 'has-note' : ''}`}>
      <button className="dev-row ghost" onClick={onToggle} aria-expanded={open} title={d.note ? 'What to do about it' : `Normal: ${d.normal}`}>
        <span className="dev-label">{d.note?.kind === 'improve' && <i className="dev-flag">!</i>}{d.label}</span>
        <span className="dev-bar"><i style={{ [d.z >= 0 ? 'left' : 'right']: '50%', width: `${w}%` }} /></span>
        <span className="dev-val num">{d.value}</span>
      </button>
      {open && (
        <div className="dev-detail">
          {d.note ? <><b>{d.note.title}</b><p>{d.note.detail}</p></> : <p>Normal is {d.normal}; yours was {d.value}.</p>}
          {d.note && d.note.rounds.length > 0 && (
            <div className="coach-rounds">
              <span className="muted">Watch:</span>
              {d.note.rounds.slice(0, 10).map(i => (
                <button key={i} className="round-link" onClick={() => onRound(i)} onMouseEnter={() => onHotRound(i)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">R{i + 1}</button>
              ))}
              {d.note.rounds.length > 10 && <span className="muted">+{d.note.rounds.length - 10}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** What's normal for this player (their role's numbers when the model has them). */
function useNormal(p: PlayerReport): FeatureSet {
  return modelFor(COACH_MODEL, p.roles[0]?.role ?? 'Rifler').features;
}

const TOPICS: Topic[] = ['Micro', 'Trades', 'Duels', 'Openings', 'Map control', 'Rotations', 'Round plans', 'Utility', 'Economy', 'Post-plant'];

/**
 * The analyst report: what a pro team's analyst looks at (trades, duels, openings, map control, rotations, round plans,
 * utility, economy, post-plants), for the player and their team, next to FACEIT level-10 benchmarks
 * (engine/analyst.ts + analystBench.ts, learned by tools/learn-analyst.ts): findings first, then the numbers per topic.
 */
function AnalystCard({ data, rounds, player, level, done, onRound, onHotRound }: {
  data: DemoData; rounds: (RoundSummary | null)[]; player: string; level: Level; done: boolean; onRound: (i: number) => void; onHotRound: (i: number | null) => void;
}) {
  const bench = analystBench(data.map, level);
  const rep = useMemo(() => (bench ? analystReport(rounds.map(r => r?.analyst), player, i => data.rounds[i]?.frames.players[player]?.side ?? null, bench, data.map) : null), [bench, rounds, player, data]);
  const [topic, setTopic] = useState<Topic>('Trades');
  if (!bench || !rep) return null;
  const work = rep.findings.filter(f => !f.good).slice(0, 6), good = rep.findings.filter(f => f.good).slice(0, 3);
  const card = (f: Finding) => (
    <div key={f.title} className={`pos-item ${f.good ? 'good' : 'work'}`}>
      <details>
        <summary><span className="muted an-topic">{f.topic}</span><b>{f.title}</b></summary>
        <p>{f.detail}</p>
      </details>
      {f.rounds.length > 0 && (
        <div className="coach-rounds">
          <span className="muted">Watch:</span>
          {f.rounds.slice(0, 10).map(i => <button key={i} className="round-link" onClick={() => onRound(i)} onMouseEnter={() => onHotRound(i)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">R{i + 1}</button>)}
        </div>
      )}
    </div>
  );
  return (
    <div className="numbers-part analyst">
      <div className="coach-head">
        <h3 className="display">Round analysis</h3>
        <span className="muted">vs {level === 'pro' && proAnalystAvailable ? 'pro players' : 'FACEIT level 10'} · {bench.rounds} rounds in {bench.demos} matches</span>
      </div>
      {work.length > 0 && <><h4>Work on</h4><div className="pos-items">{work.map(card)}</div></>}
      {good.length > 0 && <><h4>Keep</h4><div className="pos-items">{good.map(card)}</div></>}
      {!work.length && !good.length && <p className="muted">Nothing stands out yet.</p>}
      <details className="an-more">
      <summary>All the numbers, by topic</summary>
      <div className="tabs an-tabs" role="tablist">
        {TOPICS.map(t => <button key={t} role="tab" aria-selected={topic === t} className={topic === t ? 'on' : ''} onClick={() => setTopic(t)}>{t}</button>)}
      </div>
      <table className="an-stats">
        <thead><tr><th /><th>{['Round plans', 'Map control', 'Utility', 'Economy', 'Post-plant'].includes(topic) ? 'Your team' : 'You'}</th><th>Level 10</th></tr></thead>
        <tbody>
          {(rep.stats[topic] ?? []).map(s => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td className={s.better === null ? '' : s.better ? 'hi' : 'lo'}>{s.you}</td>
              <td className="muted">{s.pro}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </details>
    </div>
  );
}

/**
 * The decision coach's write-up: the player's positioning over the match against FACEIT level-10 players in the same
 * situations (engine/analysis.ts): a summary, what to change (with the rounds to watch) and what to keep.
 */
function PositioningCard({ data, rounds, player, done, onRound, onHotRound }: {
  data: DemoData; rounds: (RoundSummary | null)[]; player: string; done: boolean; onRound: (i: number) => void; onHotRound: (i: number | null) => void;
}) {
  const a = useMemo(() => {
    const won = data.rounds.map((r, i) => !!rounds[i] && !!r.winner && r.frames.players[player]?.side === r.winner);
    return matchAnalysis(data.map, player, rounds.map(r => r?.decisions), won);
  }, [data, rounds, player]);
  if (!a) return null;
  const item = (x: AnalysisItem, kind: 'work' | 'good') => (
    <div key={x.title} className={`pos-item ${kind}`}>
      <details>
        <summary><b>{x.title}</b></summary>
        <p>{x.detail}</p>
      </details>
      {x.rounds.length > 0 && (
        <div className="coach-rounds">
          <span className="muted">Watch:</span>
          {x.rounds.slice(0, 10).map(i => <button key={i} className="round-link" onClick={() => onRound(i)} onMouseEnter={() => onHotRound(i)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">R{i + 1}</button>)}
        </div>
      )}
    </div>
  );
  return (
    <div className="numbers-part positioning">
      <div className="coach-head">
        <h3 className="display">Positioning</h3>
        <span className="muted">vs FACEIT level 10 in the same situations · {a.demos} matches on this map{a.likePros !== null ? ` · ${Math.round(a.likePros * 100)}% level-10 decisions` : ''}</span>
      </div>
      <p className="coach-summary" title={a.summary}>{a.summary.split(/(?<=\.)\s/)[0]}</p>
      {a.worst.length > 0 && (
        <><h4>Spots where level-10 players win more from elsewhere</h4>
          <div className="pos-worst">
            {a.worst.slice(0, 3).map((w, i) => (
              <button key={i} className="ghost" onClick={() => onRound(w.round)} onMouseEnter={() => onHotRound(w.round)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">
                <span className="muted num">R{w.round + 1} {Math.floor(w.t / 60)}:{String(Math.floor(w.t % 60)).padStart(2, '0')}</span>
                <b>{w.what}</b>
                <span className="muted">better: <b>{w.best}</b>, +{Math.round(w.loss * 100)}% rounds won</span>
              </button>
            ))}
          </div></>
      )}
      {a.work.length > 0 && <><h4>Work on</h4><div className="pos-items">{a.work.map(x => item(x, 'work'))}</div></>}
      {a.good.length > 0 && <><h4>Keep</h4><div className="pos-items">{a.good.map(x => item(x, 'good'))}</div></>}
    </div>
  );
}

/**
 * Step 4 of the coach: every 2 s of the player's rounds against what a level-10 player does in the same situation
 * (playModel.ts): how often their choice was one level-10 players make, and the clearest times it wasn't.
 */
function DecisionsCard({ rounds, player, onRound, onHotRound }: {
  rounds: (RoundSummary | null)[]; player: string; onRound: (i: number) => void; onHotRound: (i: number | null) => void;
}) {
  const a = useMemo(() => {
    let n = 0, usual = 0;
    const key: (PlayKey & { round: number })[] = [];
    rounds.forEach((r, i) => {
      const st = r?.play?.stats[player];
      if (st) { n += st.n; usual += st.usual; }
      for (const k of r?.play?.key ?? []) if (k.player === player) key.push({ ...k, round: i });
    });
    // the search engine: accuracy over the match and its clearest mistakes
    let en = 0, ea = 0;
    const ekey: (SearchMoment & { round: number })[] = [];
    rounds.forEach((r, i) => {
      const st = r?.search?.players[player];
      if (st) { en += st.n; ea += st.accuracy * st.n; }
      for (const m of r?.search?.key ?? []) if (m.player === player) ekey.push({ ...m, round: i });
    });
    const engine = en ? { accuracy: ea / en, n: en, key: ekey.sort((x, y) => y.cost - x.cost).slice(0, 6) } : null;
    return n || en ? { n, usual: n ? usual / n : 0, key: key.sort((x, y) => (y.agree - y.share) - (x.agree - x.share)).slice(0, 6), engine } : null;
  }, [rounds, player]);
  if (!a || (!PLAY_MODEL && !a.engine)) return null;
  const pro = PLAY_MODEL?.bench.usual ?? 0.82;
  const diff = a.usual - pro;
  return (
    <section className="recap-card positioning">
      <div className="coach-head">
        <h2 className="display">Key moments</h2>
        <span className="muted">{a.engine ? `Accuracy ${a.engine.accuracy.toFixed(1)} (level 10 ≈ 88)` : `${a.n} moments`}</span>
      </div>
      {/* five rows, two columns: the costliest moments of the coach's search plus the rare choices, each with a size-coloured chip */}
      {(() => {
        const mm = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
        const rows = [
          ...(a.engine?.key ?? []).map(m => ({ round: m.round, t: m.t, did: m.did.label, better: m.options[0].label, cost: m.cost, rare: false })),
          ...a.key.map(k => ({ round: k.round, t: k.t, did: `Chose to ${ACTION_TEXT[k.did]}`, better: `level 10: ${ACTION_TEXT[k.best]} (${Math.round(k.agree * 100)}%)`, cost: k.agree - k.share, rare: true })),
        ].sort((x, y) => y.cost - x.cost).slice(0, 5);
        return rows.length ? (
          <ul className="km-list">
            {rows.map((m, i) => {
              const pctc = Math.round(Math.abs(m.cost) * 100), tone = pctc >= 12 ? 'bad' : pctc >= 5 ? 'warn' : 'flat';
              return (
                <li key={i}>
                  <button className="ghost km-row" onClick={() => onRound(m.round)} onMouseEnter={() => onHotRound(m.round)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">
                    <span className="num muted">R{m.round + 1} {mm(m.t)}</span>
                    <span className="km-text"><b>{m.did}</b><span className="muted"> → better: {m.better}</span>{m.rare && <span className="chip small"> rare choice</span>}</span>
                    <span className={`chip small km-chip ${tone}`}>−{pctc}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">No standout moments.</p>;
      })()}
    </section>
  );
}

/**
 * Your habits across matches (habits.ts): every match you open as yourself is summed up and kept in this browser;
 * with two or more, what you do differently from level-10 players match after match, and what to work on first.
 */
function HabitsCard() {
  // your profile's matches (this one is added once it's graded: Shell.tsx)
  const list = useProfile(s => s.data.matches);
  const h = useMemo(() => habits(list), [list]);
  return (
    <div className="numbers-part positioning-habits">
      <div className="coach-head">
        <h3 className="display">Your habits</h3>
        <span className="muted">across the {list.length} match{list.length === 1 ? '' : 'es'} on your <a href="/profile">profile</a>, against FACEIT level 10{PRO_MODEL ? ' and pros' : ''}</span>
      </div>
      {!h ? <p className="muted">Open another of your matches: from two on, this shows what you do differently match after match (one match is noise, several are a habit).</p> : (
        <>
          {h.work.length > 0 && <><h4>Work on</h4><div className="pos-items">{h.work.map(r => (
            <div key={r.id} className="pos-item work"><b>{r.label}: {r.fmt(r.you)}</b><p>Level 10: {r.fmt(r.lvl10)}{r.pro !== null ? `, pros: ${r.fmt(r.pro)}` : ''}. {r.tip}</p></div>
          ))}</div></>}
          {h.good.length > 0 && <><h4>Your strengths</h4><div className="pos-items">{h.good.map(r => (
            <div key={r.id} className="pos-item good"><b>{r.label}: {r.fmt(r.you)}</b><p>Level 10: {r.fmt(r.lvl10)}{r.pro !== null ? `, pros: ${r.fmt(r.pro)}` : ''}.</p></div>
          ))}</div></>}
          <details className="habits-all"><summary className="muted">All numbers</summary>
            <table className="habits-table"><thead><tr><th /><th>You</th><th>Level 10</th>{PRO_MODEL && <th>Pros</th>}</tr></thead>
              <tbody>{h.rows.map(r => (
                <tr key={r.id} className={r.z <= -0.25 ? 'lo' : r.z >= 0.4 ? 'hi' : ''}><td>{r.label}</td><td className="num">{r.fmt(r.you)}</td><td className="num">{r.fmt(r.lvl10)}</td>{PRO_MODEL && <td className="num">{r.pro !== null ? r.fmt(r.pro) : '–'}</td>}</tr>
              ))}</tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

/** "Far from normal" for the scoreboard: only outliers get colour. */
function tone(id: FeatureId, v: number) {
  const m = COACH_MODEL.features[id];
  const z = (v - m.baseline) / m.spread;
  return z > 1 ? 'hi' : z < -1 ? 'lo' : '';
}

/** The players' numbers: the main ones, or every column with `full`. */
function Scoreboard({ team, players, score, focus, onPick, full }: { team: 0 | 1; players: PlayerReport[]; score: number; focus: string; onPick: (id: string) => void; full: boolean }) {
  const hasEngine = full && players.some(p => p.engineAccuracy !== null);
  // no column of dashes: Premier ratings and the game rating show only when the demo has them
  const hasRank = players.some(p => p.rank !== null), hasGame = players.some(p => p.gameRating !== null), hasDelta = hasRank && hasGame;
  return (
    <div className="sb-wrap">
      <table className="sb">
        <thead>
          {full && <tr className="sb-groups">
            <th className={team === 0 ? 'ct' : 't'}>{team === 0 ? 'Team A' : 'Team B'} <span className="num">{score}</span></th>
            <th colSpan={1 + (hasRank ? 1 : 0) + (hasGame ? 1 : 0) + (full && hasDelta ? 1 : 0) + (hasEngine ? 1 : 0)}>Rating</th><th colSpan={5}>Fights</th><th colSpan={3}>Openings & clutches</th><th colSpan={2}>Utility</th><th colSpan={3}>Impact</th><th />
          </tr>}
          <tr>
            <th className="sb-name muted">{full ? (team === 0 ? 'started CT' : 'started T') : <span className={team === 0 ? 'ct' : 't'}>{team === 0 ? 'Team A' : 'Team B'} <span className="num">{score}</span></span>}</th>
            {hasRank && <th title="Premier rating at the start of the match">Premier</th>}
            {hasGame && <th title="Estimated rating for this match: duel performance + round impact">This match</th>}
            {full && hasDelta && <th title="Game rating minus their real rating">±</th>}
            <th title="The match grade, the same one as in the header and Side by side: duel and round performance, plus mechanics when the demo has them">Grade</th>
            {hasEngine && <th title="Accuracy: every 2 s, what they did against the best option the coach found (100 = always the best; level-10 players average about 88)">Acc</th>}
            <th>K</th><th>D</th><th title="Average damage a round">ADR</th><th title="Rounds with a kill, assist, survival or trade">KAST</th>
            {full && <><th>HS%</th>
              <th title="Opening kills – opening deaths">Open</th><th title="Clutch kills (last alive vs 2+)">Clutch</th><th title="Rounds with 3+ kills">3K+</th>
              <th title="HE + fire damage">Dmg</th><th title="Kills on enemies they flashed">Flash</th></>}
            <th title="Win chance added per round">Impact</th>
            {full && <><th title="Died right after spraying and missing">Whiffs</th><th title="Duels won against much higher-rated players">Upsets</th>
              <th>Roles</th></>}
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const delta = p.gameRating !== null && p.rank !== null ? p.gameRating - p.rank : null;
            const n = Math.max(1, p.played);
            return (
              <tr key={p.id} className={p.id === focus ? 'focus' : ''} onClick={() => onPick(p.id)} title="Show their game in the cards above">
                <td className="sb-name"><b className={team === 0 ? 'ct' : 't'}>{p.name}</b></td>
                {hasRank && <td>{p.rank !== null ? fmt(p.rank) : <span className="muted" title="No Premier rating in the demo (unranked, or not played this season)">–</span>}</td>}
                {hasGame && <td title={p.duelRating !== null ? `Duels ${p.duelsWon}–${p.duelsLost} vs avg ${fmt(p.avgOpponent ?? 0)} → ${fmt(p.duelRating)}; impact ${p.pointsPerRound >= 0 ? '+' : ''}${p.pointsPerRound.toFixed(1)} pts/round` : 'No duels yet'}>
                  <b>{p.gameRating !== null ? fmt(p.gameRating) : '–'}</b>
                </td>}
                {full && hasDelta && <td className={delta === null ? '' : delta >= 1000 ? 'hi' : delta <= -1000 ? 'lo' : ''}>{delta === null ? '' : `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}`}</td>}
                <td title={whyTitle(p)}><LetterChip letter={matchGrade(p)} /></td>
                {hasEngine && <td className={p.engineAccuracy === null ? '' : p.engineAccuracy >= 90 ? 'hi' : p.engineAccuracy < 82 ? 'lo' : ''} title={`${p.engineMoments} moments`}>{p.engineAccuracy !== null ? p.engineAccuracy.toFixed(0) : ''}</td>}
                <td className="sep">{p.kills}</td><td>{p.deaths}</td>
                <td className={tone('adr', p.adr)}>{p.adr.toFixed(0)}</td>
                <td className={tone('kast', p.kast)}>{p.kast.toFixed(0)}%</td>
                {full && <><td className={tone('hs', p.hs)}>{p.hs.toFixed(0)}%</td>
                  <td className="sep">{p.openingKills}–{p.openingDeaths}</td><td>{p.clutches || ''}</td><td>{p.multiKills || ''}</td>
                  <td className={`sep ${tone('utilDamage', p.utilDamage / n)}`}>{p.utilDamage || ''}</td>
                  <td className={tone('flashAssists', p.flashAssists / n)}>{p.flashAssists || ''}</td></>}
                <td className={`sep ${tone('impact', p.impactPerRound)}`}>{p.impactPerRound >= 0 ? '+' : ''}{p.impactPerRound.toFixed(1)}%</td>
                {full && <><td>{p.whiffs || ''}</td><td>{p.upsets || ''}</td>
                  <td className="muted sb-roles">{rolesText(p, true)}</td></>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Their main roles: the top two, and the AWP whenever they had it for a few rounds (the coach talks about it then). */
function rolesText(p: PlayerReport, counts: boolean) {
  const top = p.roles.slice(0, 2);
  const awp = p.roles.find(r => r.role === 'AWPer' && r.rounds >= 2 && !top.includes(r));
  return [...top, ...(awp ? [awp] : [])].map(r => (counts || r === awp ? `${r.role} ×${r.rounds}` : r.role)).join(counts ? ', ' : ' / ');
}

/** One line on why this is the grade (the same grade everywhere on the recap). */
function whyGrade(p: PlayerReport): string {
  const word = (v: number | null) => (v === null ? null : v >= 0.5 ? 'above' : v <= -0.5 ? 'below' : 'near');
  if (p.level) {
    const a = word(p.level.perf), b = word(p.level.mech);
    return `${a === 'near' ? 'Duels and impact near' : `Duels and impact ${a}`} a level-10 game${b ? `, mechanics ${b === 'near' ? 'near it' : b + ' it'}` : ''}`;
  }
  const z = p.lvl10?.z ?? p.lobbyZ, w = word(z);
  return `${p.lvl10 ? 'Stats' : 'Stats in this lobby'} ${w === 'near' ? 'near' : w} ${p.lvl10 ? 'a level-10 player' : 'the average'}`;
}
const whyTitle = (p: PlayerReport) => (p.level ? levelText(p.level) : p.lvl10 ? lvl10Text(p.lvl10.z) : lobbyText(p.lobbyZ));

const spreads = (z: number) => `${Math.abs(z).toFixed(1)} spreads`;
function lobbyText(z: number) {
  return Math.abs(z) < 0.15 ? 'about the middle of the lobby' : `${spreads(z)} ${z > 0 ? 'above' : 'below'} the lobby's average`;
}
/** The level grade explained: where on the ladder, and from what. */
function levelText(l: LevelGrade) {
  const where = l.score >= l.proAt ? 'at or above a typical pro game' : l.score >= 0 ? `between a typical level-10 game and a typical pro game (${Math.round((l.score / l.proAt) * 100)}% of the way)` : 'below a typical level-10 game';
  const part = (v: number | null) => (v === null ? 'not measured' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
  const cap = l.capped ? ` Held at A: this lobby averages ${l.capped.toLocaleString('en-US')} Premier, and a pro-level grade needs a lobby near level-10 strength.` : '';
  return `This match against a typical FACEIT level-10 game: ${where}.${cap} Performance ${part(l.perf)}, mechanics (reaction, crosshair, sound, counter-strafing) ${part(l.mech)}, in level-10 spreads.`;
}

function lvl10Text(z: number) {
  return Math.abs(z) < 0.1 ? 'on par with a typical level-10 player' : `${spreads(z)} ${z > 0 ? 'better' : 'worse'} than a typical level-10 player`;
}

/** What each round grade means (recap.ts roundGrade), shown under the grid. */
const ROUND_LEGEND: [Letter, string][] = [
  ['S+', 'won a clutch or held a site with a big round'], ['S', '3+ kills'], ['A', 'a double kill, a key trade or great utility'],
  ['B', 'an impact kill, the plant or useful utility'], ['C', 'no real impact'], ['D', 'died early untraded, or a costly mistake'],
  ['F', 'a round-losing blunder'],
];

const REASON_ICON: Record<string, IconName> = { ct_killed: 'skull', t_killed: 'skull', bomb_exploded: 'bomb', bomb_defused: 'scissors', target_saved: 'timer' };

/** Every player's grade in every round: the focused player's row stands out, a gap marks the side switch. */
function RoundGrid({ data, players, focus, hot, onPick, onRound }: {
  data: DemoData; players: PlayerReport[]; focus: string; hot: number | null; onPick: (id: string) => void; onRound: (i: number) => void;
}) {
  // sides switch where a player's side changes from one round to the next
  const ref = players[0]?.id;
  const swap = data.rounds.map((r, i) => i > 0 && !!ref && !!r.frames.players[ref] && !!data.rounds[i - 1].frames.players[ref]
    && r.frames.players[ref].side !== data.rounds[i - 1].frames.players[ref].side);
  return (
    <section className="recap-card">
      <div className="coach-head"><h2 className="display">Round grades</h2>
        <details className="help-pop"><summary aria-label="What the colours mean">?</summary>
          <p className="rg-legend muted">{ROUND_LEGEND.map(([l, t]) => <span key={l}><LetterChip letter={l} /> {t}</span>)}</p>
          <p className="muted small">Click a name to focus that player; click a cell to watch the round in Review.</p>
        </details></div>
      <div className="sb-wrap">
        <table className="rg">
          <thead>
            <tr>
              <th />
              {data.rounds.map((r, i) => (
                <th key={i} className={`${r.winner === 'CT' ? 'ctw' : r.winner === 'T' ? 'tw' : ''} ${swap[i] ? 'half' : ''} ${hot === i ? 'hot' : ''}`}
                  title={`Round ${r.n} · ${r.winner ?? '?'} won${r.reason ? ` (${r.reason.replace(/_/g, ' ')})` : ''}`}>
                  <span>{r.n === 1 || r.n % 3 === 0 ? r.n : ''}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...players].sort((a, b) => Number(b.id === focus) - Number(a.id === focus)).map(p => (
              <tr key={p.id} className={p.id === focus ? 'focus' : ''}>
                <td className="name" onClick={() => onPick(p.id)}><i className={`rg-dot ${p.team === 0 ? 'ct' : 't'}`} />{p.name}</td>
                {p.rounds.map((l, i) => (
                  <td key={i} onClick={() => onRound(i)} className={`cell ${swap[i] ? 'half' : ''} ${hot === i ? 'hot' : ''}`}
                    title={l ? `${l.side} · ${l.role} · ${l.kills}K ${l.deaths}D · ${Math.round(l.damage)} dmg · ${l.points >= 0 ? '+' : ''}${l.points.toFixed(0)} pts${l.tags.length ? ` · ${[...new Set(l.tags)].join(', ')}` : ''}` : 'not graded yet'}>
                    {l ? <span className="hc" data-l={l.letter} style={{ background: LETTER_COLOR[l.letter] }} /> : <span className="muted">·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LetterChip({ letter }: { letter: Letter }) {
  return <span className="letter" style={letterStyle(letter)}>{letter}</span>;
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

/** Duo review: the graded player next to a friend from the same match, number by number (the better one lit). */
function DuoCard({ a, players }: { a: PlayerReport; players: PlayerReport[] }) {
  const mates = players.filter(p => p.id !== a.id && p.played);
  const [bId, setB] = useState<string | null>(null);
  // by default the enemy who played the same role (your opposite number), else any enemy
  const role = a.roles[0]?.role;
  const b = mates.find(p => p.id === bId) ?? mates.find(p => p.team !== a.team && p.roles[0]?.role === role) ?? mates.find(p => p.team !== a.team) ?? mates[0];
  if (!b) return null;
  const rows: [string, (p: PlayerReport) => number | null, (v: number) => string, boolean?][] = [
    ['Kills / deaths', p => p.kills / Math.max(1, p.deaths), v => v.toFixed(2)],
    ['ADR', p => p.adr, v => v.toFixed(0)],
    ['KAST', p => p.kast, v => `${Math.round(v)}%`],
    ['Impact a round', p => p.impactPerRound, v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`],
    ['Headshots', p => p.hs, v => `${Math.round(v)}%`],
    ['Opening duels won', p => p.openingKills / Math.max(1, p.openingKills + p.openingDeaths), v => `${Math.round(v * 100)}%`],
    ['Accuracy', p => p.engineAccuracy, v => v.toFixed(1)],
    ['Utility damage', p => p.utilDamage, v => v.toFixed(0)],
  ];
  return (
    <section className="recap-card duo">
      <div className="duo-head">
        <h3>Side by side</h3>
        <label className="muted small">with <select value={b.id} onChange={e => setB(e.target.value)}>{mates.map(p => <option key={p.id} value={p.id}>{p.name}{p.team === a.team ? ' (teammate)' : ' (enemy)'}</option>)}</select></label>
      </div>
      <table className="duo-table">
        <thead><tr><th /><th>{a.name}</th><th>{b.name}</th></tr></thead>
        <tbody>
          <tr><td>Grade</td><td><b>{matchGrade(a)}</b></td><td><b>{matchGrade(b)}</b></td></tr>
          {rows.map(([label, f, fmt]) => {
            const x = f(a), y = f(b);
            return <tr key={label}><td>{label}</td>
              <td className={x !== null && y !== null && x > y ? 'hi' : ''}>{x === null ? '–' : fmt(x)}</td>
              <td className={x !== null && y !== null && y > x ? 'hi' : ''}>{y === null ? '–' : fmt(y)}</td></tr>;
          })}
        </tbody>
      </table>
    </section>
  );
}

/** A word for the lobby grade (the Rage brand's voice): S+ and F get the loudest. */
const NICK: Partial<Record<string, string>> = { 'S+': 'Clutch god', S: 'Carried', A: 'Clean', B: 'Solid', C: 'Meh', D: 'Rough', F: 'Uninstall?' };

/** The graded player's best and worst round, one line each, with a jump to it. */
function RoundCallouts({ p, onRound }: { p: PlayerReport; onRound: (i: number) => void }) {
  const lines = p.rounds.map((l, i) => (l ? { i, l } : null)).filter((x): x is { i: number; l: RoundLine } => !!x);
  if (lines.length < 3) return null;
  const best = lines.reduce((a, b) => (b.l.points > a.l.points ? b : a)), worst = lines.reduce((a, b) => (b.l.points < a.l.points ? b : a));
  const top = best.l.letter === 'S+' || best.l.letter === 'S', low = worst.l.letter === 'D' || worst.l.letter === 'F';
  if (!top && !low) return null;
  return (
    <div className="round-callouts">
      {top && <button className="callout good" onClick={() => onRound(best.i)}>Round {best.i + 1}: <b>{best.l.letter}</b>. Screenshot that.</button>}
      {low && <button className="callout bad" onClick={() => onRound(worst.i)}>Round {worst.i + 1}: <b>{worst.l.letter}</b>. We need to talk.</button>}
    </div>
  );
}
