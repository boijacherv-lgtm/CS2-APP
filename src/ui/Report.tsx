import { useEffect, useMemo, useState } from 'react';
import { coach, modelFor, type Coaching, type Deviation, type FeatureId, type FeatureSet } from '../engine/coach';
import { CLASS_COLOR } from '../engine/engineEval';
import { analystReport, type Finding, type Topic } from '../engine/analystBench';
import { analystBench, proAnalystAvailable } from '../engine/analystModel';
import { matchAnalysis, type AnalysisItem } from '../engine/analysis';
import { COACH_MODEL, modelOf, PRO_MODEL, type Level } from '../engine/coachModels';
import type { LevelGrade } from '../engine/level';
import { buildMatchReport, IMPACT_PER_POINT, type MatchReport, type PlayerReport, type RoundSummary } from '../engine/match';
import { LETTER_COLOR, RATING_SCALE, type DemoData, type Letter, type PlayKey } from '../engine/recap';
import { ACTION_TEXT, PLAY_MODEL } from '../engine/playModel';
import { habits, loadHabits, saveMatch, summarizeMatch, type MatchSummary } from '../engine/habits';
import { SEARCH_COLOR, type SearchMoment } from '../engine/search';
import { MAPS } from '../map/catalog';
import { navigate } from '../shell/router';
import { useStore } from '../store';
import { ReviewStart } from './Recap';
import { Icon, type IconName } from './Icon';
import { steamFetch } from './steamApi';

/**
 * Match recap, read top to bottom: the result → your game (grade, rating, key numbers) and the coach → everyone's
 * stats → every round's grades. Rounds are graded in a worker (Shell → useMatchGrader) and it all fills in as they
 * finish. Clicking a player anywhere makes them the one the top cards are about.
 */
export function MatchReportPage() {
  const report = useStore(s => s.report);
  const view = useMemo(() => (report ? buildMatchReport(report.data, report.rounds) : null), [report]);
  const [picked, setPicked] = useState<string | null>(null);
  // you, if you're logged in with Steam and played in this match
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    steamFetch('/me').then(r => (r.ok ? r.json() : null)).then(j => setMe(j?.me?.steamId ?? null)).catch(() => {});
  }, []);
  // a round the coach points at (hovering R12 outlines that column in the grid)
  const [hotRound, setHotRound] = useState<number | null>(null);
  if (!report || !view) return <div className="app single"><ReviewStart /></div>;

  // the pro level, once it's trained (HLTV demos): the coach and the analyst compare with it instead
  const hasPro = !!PRO_MODEL || proAnalystAvailable;
  const [level, setLevel] = useState<Level>('lvl10');
  const focusId = [picked, me].find(id => id && view.players.some(p => p.id === id)) ?? view.players[0]?.id;
  const focus = view.players.find(p => p.id === focusId)!;
  const data = report.data;
  const openRound = (i: number) => {
    useStore.getState().setReviewRound(i);
    navigate({ page: 'cs2', mode: 'review' });
  };

  return (
    <div className="report">
      <MatchHeader data={data} view={view} me={me} done={report.done} />

      {hasPro && (
        <div className="seg-mini level-toggle" role="group" aria-label="Compare with">
          <span className="muted">Compare with</span>
          <button className={level === 'lvl10' ? 'on' : ''} onClick={() => setLevel('lvl10')} title="FACEIT level-10 players">Level 10</button>
          <button className={level === 'pro' ? 'on' : ''} onClick={() => setLevel('pro')} title="Pro players (HLTV demos)">Pro</button>
        </div>
      )}
      {focus && (
        <div className="recap-top">
          <Performance p={focus} players={view.players} me={me} onPlayer={setPicked} />
          <CoachCard p={focus} level={level} done={report.done} onRound={openRound} onHotRound={setHotRound} />
        </div>
      )}
      {me && view.players.some(p => p.id === me) && <HabitsCard data={data} rounds={report.rounds} done={report.done} me={me} player={view.players.find(p => p.id === me)!} />}
      {focus && <AnalystCard data={data} rounds={report.rounds} player={focus.id} level={level} done={report.done} onRound={openRound} onHotRound={setHotRound} />}
      {focus && <PositioningCard data={data} rounds={report.rounds} player={focus.id} done={report.done} onRound={openRound} onHotRound={setHotRound} />}
      {focus && <DecisionsCard rounds={report.rounds} player={focus.id} onRound={openRound} onHotRound={setHotRound} />}

      <section className="recap-card">
        <h2 className="display">Scoreboard</h2>
        {([0, 1] as const).map(t => (
          <Scoreboard key={t} team={t} players={view.players.filter(p => p.team === t)} score={view.score[t]} focus={focusId} onPick={setPicked} />
        ))}
      </section>

      <RoundGrid data={data} players={view.players} focus={focusId} hot={hotRound} onPick={setPicked} onRound={openRound} />

      <section className="report-how muted">
        <h2 className="display">How the estimate works</h2>
        <p>
          <b>Game rating</b> is a performance rating, like in chess: the Premier rating at which this player's duels (every kill a win,
          every death a loss, against each opponent's real rating) would be exactly the expected result. Then it adds {IMPACT_PER_POINT} points
          per point of average round impact, so round-winning plays count and empty kills count less.
          A {Math.round(RATING_SCALE * 0.3)}-point gap makes the higher-rated player a 2:1 favourite in a single duel.
        </p>
        <p>
          <b>Round grades</b> (S+ … F) come from how much the player changed their team's win chance, plus bonuses for clutches and
          multi-kills and penalties for team damage, team flashes and dying with unused grenades. The <b>coach</b> compares each number
          with what's normal for a Premier player; the bars show how far, better (right) or worse (left).
        </p>
      </section>
    </div>
  );
}

/** Map art, the final score (yours first when you played) and the result. */
function MatchHeader({ data, view, me, done }: { data: DemoData; view: MatchReport; me: string | null; done: boolean }) {
  const map = MAPS.find(m => m.id === data.map);
  const mine = me ? view.players.find(p => p.id === me) : undefined;
  const [a, b] = mine && mine.team === 1 ? [view.score[1], view.score[0]] : view.score;
  const result = mine ? (a > b ? 'Victory' : a < b ? 'Defeat' : 'Draw') : null;
  const delta = mine && mine.gameRating !== null && mine.rank !== null ? mine.gameRating - mine.rank : null;
  const ranked = Object.keys(data.ranks ?? {}).length;
  return (
    <header className="recap-head" style={{ '--map-art': map ? `url(${map.levels[0].image})` : 'none' } as React.CSSProperties}>
      <div className="recap-head-main">
        <span className="recap-map display">{map?.name ?? data.map}</span>
        <span className="recap-score display">
          <b className={mine ? (mine.team === 0 ? 'ct' : 't') : 'ct'}>{a}</b><i>:</i><b className={mine ? (mine.team === 0 ? 't' : 'ct') : 't'}>{b}</b>
        </span>
        {result && <span className={`recap-result ${result.toLowerCase()}`}>{result}</span>}
      </div>
      <p className="muted">
        {data.rounds.length} rounds · {mine ? 'your team first' : 'team that started CT first'}
        {mine && mine.gameRating !== null && <> · you: game rating <b>{fmt(mine.gameRating)}</b>{delta !== null && <span className={delta >= 0 ? 'up' : 'down'}> ({delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))} vs your Premier)</span>}</>}
        {!ranked && ' · no ratings in this demo (estimates are relative to an average 10,000 player)'}
        {!done && <> · <b>grading rounds {view.graded}/{view.total}…</b></>}
      </p>
      {!done && <div className="report-progress"><i style={{ width: `${(view.graded / view.total) * 100}%` }} /></div>}
    </header>
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
        <b className="num">{value}</b>
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
        <span className="muted">{p.roles.slice(0, 2).map(r => r.role).join(' / ')}</span>
      </div>
      <div className="perf-main">
        <div className="perf-grades">
          <div className="perf-grade" title={`Against the other players in this lobby (round grades, impact, ADR, KAST, duels): ${lobbyText(p.lobbyZ)}`}>
            <span className="perf-letter display" style={{ background: LETTER_COLOR[p.letter] }}>{p.letter}</span>
            <span className="muted">Lobby</span>
          </div>
          {p.level ? (
            <div className="perf-grade" title={levelText(p.level)}>
              <span className="perf-letter display small" style={{ background: LETTER_COLOR[p.level.letter] }}>{p.level.letter}</span>
              <span className="muted">Level</span>
            </div>
          ) : p.lvl10 && (
            <div className="perf-grade" title={`Against FACEIT level-10 players (the coach's numbers): ${lvl10Text(p.lvl10.z)}`}>
              <span className="perf-letter display small" style={{ background: LETTER_COLOR[p.lvl10.letter] }}>{p.lvl10.letter}</span>
              <span className="muted">vs Lvl 10</span>
            </div>
          )}
        </div>
        <Gauge rating={p.gameRating} rank={p.rank} />
      </div>
      <div className="kpis">
        {kpi('adr', 'ADR', p.adr.toFixed(0), p.adr)}
        {kpi('kast', 'KAST', `${p.kast.toFixed(0)}%`, p.kast)}
        {kpi('impact', 'Impact', `${p.impactPerRound >= 0 ? '+' : ''}${p.impactPerRound.toFixed(1)}%`, p.impactPerRound)}
      </div>
      <p className="muted perf-line num">{p.kills} kills · {p.deaths} deaths · {p.hs.toFixed(0)}% HS · openings {p.openingKills}–{p.openingDeaths}{p.clutches ? ` · ${p.clutches} clutch kills` : ''}</p>
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
        <path d="M 12 60 A 48 48 0 0 1 108 60" fill="none" stroke="var(--surface-3)" strokeWidth="9" strokeLinecap="round" />
        {rating !== null && <path d={arc(rating)} fill="none" stroke="var(--text-1)" strokeWidth="9" strokeLinecap="round" />}
        {rank !== null && (() => { const [x1, y1] = pt(rank, 40); const [x2, y2] = pt(rank, 56); return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--t)" strokeWidth="2.5" />; })()}
      </svg>
      <b className="display num">{rating !== null ? fmt(rating) : '–'}</b>
      <span className="muted">game rating{delta !== null && <> · <span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))}</span> vs {fmt(rank!)}</>}</span>
    </div>
  );
}

/** The coach: one line of summary, then every number as a bar from "normal": better to the right, worse to the left. */
function CoachCard({ p, level, done, onRound, onHotRound }: { p: PlayerReport; level: Level; done: boolean; onRound: (i: number) => void; onHotRound: (i: number | null) => void }) {
  const model = modelOf(level);
  const c: Coaching = useMemo(() => coach(p, model), [p, model]);
  const role = p.roles[0]?.role ?? 'Rifler';
  const byRole = modelFor(model, role).byRole;
  const [open, setOpen] = useState<FeatureId | null>(null);
  const rows = c.profile.slice(0, 9);
  const side = (v: number | null) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  return (
    <section className="recap-card coach">
      <div className="coach-head">
        <h2 className="display">Coach</h2>
        <span className="muted">CT {side(c.sides.CT)} · T {side(c.sides.T)} win chance a round</span>
      </div>
      {model.trainedOn > 0 && (
        <p className="coach-vs muted" title={`Learned from ${model.trainedOn} player-games${model.source ? ` in ${model.source.demos} demos` : ''}`}>
          Compared with {model.name ?? 'trained'} players{byRole ? ` (${role.toLowerCase()}s)` : ''}
        </p>
      )}
      <p className="coach-summary">{c.summary}{!done && <span className="muted"> (updates while rounds are graded)</span>}</p>
      <div className="dev-axis muted"><span><Icon name="prev" size={10} /> worse than normal</span><span>better than normal <Icon name="next" size={10} /></span></div>
      <div className="dev-list">
        {rows.map(d => <DevRow key={d.feature} d={d} open={open === d.feature} onToggle={() => setOpen(open === d.feature ? null : d.feature)}
          onRound={onRound} onHotRound={onHotRound} />)}
      </div>
      {c.improve.some(n => !rows.some(r => r.note === n)) && (
        <p className="muted">{c.improve.filter(n => !rows.some(r => r.note === n)).map(n => n.title).join(' · ')}</p>
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
                <button key={i} onClick={() => onRound(i)} onMouseEnter={() => onHotRound(i)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">R{i + 1}</button>
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
  const rep = useMemo(() => (bench ? analystReport(rounds.map(r => r?.analyst), player, i => data.rounds[i]?.frames.players[player]?.side ?? null, bench) : null), [bench, rounds, player, data]);
  const [topic, setTopic] = useState<Topic>('Trades');
  if (!bench || !rep) return null;
  const work = rep.findings.filter(f => !f.good).slice(0, 6), good = rep.findings.filter(f => f.good).slice(0, 3);
  const card = (f: Finding) => (
    <div key={f.title} className={`pos-item ${f.good ? 'good' : 'work'}`}>
      <span className="muted an-topic">{f.topic}</span>
      <b>{f.title}</b>
      <p>{f.detail}</p>
      {f.rounds.length > 0 && (
        <div className="coach-rounds">
          <span className="muted">Watch:</span>
          {f.rounds.slice(0, 10).map(i => <button key={i} onClick={() => onRound(i)} onMouseEnter={() => onHotRound(i)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">R{i + 1}</button>)}
        </div>
      )}
    </div>
  );
  return (
    <section className="recap-card analyst">
      <div className="coach-head">
        <h2 className="display">Analyst report</h2>
        <span className="muted">vs {level === 'pro' && proAnalystAvailable ? 'pro players' : 'FACEIT level 10'} · {bench.rounds} rounds in {bench.demos} matches{!done ? ' · updating while rounds are graded' : ''}</span>
      </div>
      {work.length > 0 && <><h3>Work on</h3><div className="pos-items">{work.map(card)}</div></>}
      {good.length > 0 && <><h3>Keep</h3><div className="pos-items">{good.map(card)}</div></>}
      {!work.length && !good.length && <p className="muted">Nothing stands out yet.</p>}
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
    </section>
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
      <b>{x.title}</b>
      <p>{x.detail}</p>
      {x.rounds.length > 0 && (
        <div className="coach-rounds">
          <span className="muted">Watch:</span>
          {x.rounds.slice(0, 10).map(i => <button key={i} onClick={() => onRound(i)} onMouseEnter={() => onHotRound(i)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">R{i + 1}</button>)}
        </div>
      )}
    </div>
  );
  return (
    <section className="recap-card positioning">
      <div className="coach-head">
        <h2 className="display">Positioning</h2>
        <span className="muted">vs FACEIT level 10 in the same situations · {a.demos} matches on this map{a.accuracy !== null ? ` · accuracy ${a.accuracy}` : ''}{a.likePros !== null ? ` · ${Math.round(a.likePros * 100)}% level-10 decisions` : ''}</span>
      </div>
      <p className="coach-summary">{a.summary}{!done && <span className="muted"> (updates while rounds are graded)</span>}</p>
      {a.worst.length > 0 && (
        <><h3>Biggest positional mistakes</h3>
          <div className="pos-worst">
            {a.worst.map((w, i) => (
              <button key={i} className="ghost" onClick={() => onRound(w.round)} onMouseEnter={() => onHotRound(w.round)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">
                <span className="muted num">R{w.round + 1} {Math.floor(w.t / 60)}:{String(Math.floor(w.t % 60)).padStart(2, '0')}</span>
                <b>{w.what}</b>
                <span className="usual" style={{ color: CLASS_COLOR[w.cls], borderColor: CLASS_COLOR[w.cls] }}>{w.cls} −{Math.round(w.loss * 1000) / 10}%</span>
                <span className="muted">best: {w.best}</span>
              </button>
            ))}
          </div></>
      )}
      {a.work.length > 0 && <><h3>Work on</h3><div className="pos-items">{a.work.map(x => item(x, 'work'))}</div></>}
      {a.good.length > 0 && <><h3>Keep</h3><div className="pos-items">{a.good.map(x => item(x, 'good'))}</div></>}
    </section>
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
        <h2 className="display">Decisions</h2>
        <span className="muted">what a level-10 player does in the same situation, and the engine · every 2 s · {Math.max(a.n, a.engine?.n ?? 0)} moments</span>
      </div>
      {a.n > 0 && <p className="coach-summary">
        {Math.round(a.usual * 100)}% of your choices (hold, push, fall back, reposition, grenade, bomb) were ones level-10 players make in that
        situation; level-10 players themselves: {Math.round(pro * 100)}%. {diff >= -0.03 ? 'You read situations like they do.' : diff >= -0.08 ? 'A few of your choices are ones they rarely make.' : 'You often do what level-10 players almost never do in that spot: look at the moments below.'}
      </p>}
      {a.engine && (
        <>
          <h3>Engine</h3>
          <p className="coach-summary">
            Accuracy <b className="num">{a.engine.accuracy.toFixed(1)}</b> over {a.engine.n} moments: every 2 s, what you did against the best option the engine
            calculated from there (hold, move, peek, a grenade you had, the bomb). Level-10 players average about 88.
          </p>
          {a.engine.key.length > 0 && (
            <div className="pos-worst">
              {a.engine.key.map((m, i) => (
                <button key={i} className="ghost" onClick={() => onRound(m.round)} onMouseEnter={() => onHotRound(m.round)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review (turn on Engine lines to see it on the map)">
                  <span className="muted num">R{m.round + 1} {Math.floor(m.t / 60)}:{String(Math.floor(m.t % 60)).padStart(2, '0')}</span>
                  <b>{m.did.label}</b>
                  <span className="usual" style={{ color: SEARCH_COLOR[m.cls], borderColor: SEARCH_COLOR[m.cls] }}>{m.cls} −{(m.cost * 100).toFixed(1)}%</span>
                  <span className="muted">best: {m.options[0].label}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {a.key.length > 0 && (
        <><h3>Least level-10 choices</h3>
          <div className="pos-worst">
            {a.key.map((k, i) => (
              <button key={i} className="ghost" onClick={() => onRound(k.round)} onMouseEnter={() => onHotRound(k.round)} onMouseLeave={() => onHotRound(null)} title="Open this round in Review">
                <span className="muted num">R{k.round + 1} {Math.floor(k.t / 60)}:{String(Math.floor(k.t % 60)).padStart(2, '0')}</span>
                <b>{ACTION_TEXT[k.did]}</b>
                <span className="muted">level-10 players {ACTION_TEXT[k.best]} {Math.round(k.agree * 100)}% of the time, do this {Math.round(k.share * 100)}%</span>
              </button>
            ))}
          </div></>
      )}
    </section>
  );
}

/**
 * Your habits across matches (habits.ts): every match you open as yourself is summed up and kept in this browser;
 * with two or more, what you do differently from level-10 players match after match, and what to work on first.
 */
function HabitsCard({ data, rounds, done, me, player }: { data: DemoData; rounds: (RoundSummary | null)[]; done: boolean; me: string; player: PlayerReport }) {
  const [list, setList] = useState<MatchSummary[]>(() => loadHabits(me));
  useEffect(() => {
    if (!done || !player.played) return;
    // a match's identity: the map, the rounds and when its kills happened
    const id = `${data.map}|${data.rounds.length}|${data.rounds.slice(0, 3).map(r => r.kills.map(k => k.t.toFixed(1)).join(',')).join(';')}`;
    setList(saveMatch(me, summarizeMatch(id, data.map, player, rounds.map(r => r?.analyst))));
  }, [done, data, me, player, rounds]);
  const h = useMemo(() => habits(list), [list]);
  return (
    <section className="recap-card positioning habits">
      <div className="coach-head">
        <h2 className="display">Your habits</h2>
        <span className="muted">across your last {list.length} match{list.length === 1 ? '' : 'es'} in this browser, against FACEIT level 10{PRO_MODEL ? ' and pros' : ''}</span>
      </div>
      {!h ? <p className="muted">Open another of your matches: from two on, this shows what you do differently match after match (one match is noise, several are a habit).</p> : (
        <>
          {h.work.length > 0 && <><h3>Work on</h3><div className="pos-items">{h.work.map(r => (
            <div key={r.id} className="pos-item work"><b>{r.label}: {r.fmt(r.you)}</b><p>Level 10: {r.fmt(r.lvl10)}{r.pro !== null ? `, pros: ${r.fmt(r.pro)}` : ''}. {r.tip}</p></div>
          ))}</div></>}
          {h.good.length > 0 && <><h3>Your strengths</h3><div className="pos-items">{h.good.map(r => (
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
    </section>
  );
}

/** "Far from normal" for the scoreboard: only outliers get colour. */
function tone(id: FeatureId, v: number) {
  const m = COACH_MODEL.features[id];
  const z = (v - m.baseline) / m.spread;
  return z > 1 ? 'hi' : z < -1 ? 'lo' : '';
}

function Scoreboard({ team, players, score, focus, onPick }: { team: 0 | 1; players: PlayerReport[]; score: number; focus: string; onPick: (id: string) => void }) {
  const hasLevel = players.some(p => p.level);
  const hasLvl10 = !hasLevel && players.some(p => p.lvl10);
  const hasEngine = players.some(p => p.engineAccuracy !== null);
  return (
    <div className="sb-wrap">
      <table className="sb">
        <thead>
          <tr className="sb-groups">
            <th className={team === 0 ? 'ct' : 't'}>{team === 0 ? 'Team A' : 'Team B'} <span className="num">{score}</span></th>
            <th colSpan={(hasLvl10 || hasLevel ? 5 : 4) + (hasEngine ? 1 : 0)}>Rating</th><th colSpan={5}>Fights</th><th colSpan={3}>Openings & clutches</th><th colSpan={2}>Utility</th><th colSpan={3}>Impact</th><th />
          </tr>
          <tr>
            <th className="sb-name muted">{team === 0 ? 'started CT' : 'started T'}</th>
            <th title="Premier rating at the start of the match">Rank</th>
            <th title="Estimated rating for this game: duel performance + round impact">Game</th>
            <th title="Game rating minus their real rating">±</th>
            <th title="Grade among the players of this lobby">Lobby</th>
            {hasLevel && <th title="One grade from FACEIT level 10 to pro: B = a typical level-10 game, S = a typical pro game (performance and mechanics)">Level</th>}
            {hasLvl10 && <th title="Grade against FACEIT level-10 players">Lvl 10</th>}
            {hasEngine && <th title="Engine accuracy: every 2 s, what they did against the best option the engine calculated (100 = always the best; level-10 players average about 88)">Acc</th>}
            <th>K</th><th>D</th><th>ADR</th><th title="Rounds with a kill, assist, survival or trade">KAST</th><th>HS%</th>
            <th title="Opening kills – opening deaths">Open</th><th title="Clutch kills (last alive vs 2+)">Clutch</th><th title="Rounds with 3+ kills">3K+</th>
            <th title="HE + fire damage">Dmg</th><th title="Kills on enemies they flashed">Flash</th>
            <th title="Win chance added per round">Impact</th><th title="Died right after spraying and missing">Whiffs</th><th title="Duels won against much higher-rated players">Upsets</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const delta = p.gameRating !== null && p.rank !== null ? p.gameRating - p.rank : null;
            const n = Math.max(1, p.played);
            return (
              <tr key={p.id} className={p.id === focus ? 'focus' : ''} onClick={() => onPick(p.id)} title="Show their game in the cards above">
                <td className="sb-name"><b className={team === 0 ? 'ct' : 't'}>{p.name}</b></td>
                <td>{p.rank !== null ? fmt(p.rank) : <span className="muted">–</span>}</td>
                <td title={p.duelRating !== null ? `Duels ${p.duelsWon}–${p.duelsLost} vs avg ${fmt(p.avgOpponent ?? 0)} → ${fmt(p.duelRating)}; impact ${p.pointsPerRound >= 0 ? '+' : ''}${p.pointsPerRound.toFixed(1)} pts/round` : 'No duels yet'}>
                  <b>{p.gameRating !== null ? fmt(p.gameRating) : '–'}</b>
                </td>
                <td className={delta === null ? '' : delta >= 1000 ? 'hi' : delta <= -1000 ? 'lo' : ''}>{delta === null ? '' : `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}`}</td>
                <td title={lobbyText(p.lobbyZ)}><LetterChip letter={p.letter} /></td>
                {hasLvl10 && <td title={p.lvl10 ? lvl10Text(p.lvl10.z) : ''}>{p.lvl10 ? <LetterChip letter={p.lvl10.letter} /> : ''}</td>}
                {hasLevel && <td title={p.level ? levelText(p.level) : ''}>{p.level ? <LetterChip letter={p.level.letter} /> : ''}</td>}
                {hasEngine && <td className={p.engineAccuracy === null ? '' : p.engineAccuracy >= 90 ? 'hi' : p.engineAccuracy < 82 ? 'lo' : ''} title={`${p.engineMoments} moments`}>{p.engineAccuracy !== null ? p.engineAccuracy.toFixed(0) : ''}</td>}
                <td className="sep">{p.kills}</td><td>{p.deaths}</td>
                <td className={tone('adr', p.adr)}>{p.adr.toFixed(0)}</td>
                <td className={tone('kast', p.kast)}>{p.kast.toFixed(0)}%</td>
                <td className={tone('hs', p.hs)}>{p.hs.toFixed(0)}%</td>
                <td className="sep">{p.openingKills}–{p.openingDeaths}</td><td>{p.clutches || ''}</td><td>{p.multiKills || ''}</td>
                <td className={`sep ${tone('utilDamage', p.utilDamage / n)}`}>{p.utilDamage || ''}</td>
                <td className={tone('flashAssists', p.flashAssists / n)}>{p.flashAssists || ''}</td>
                <td className={`sep ${tone('impact', p.impactPerRound)}`}>{p.impactPerRound >= 0 ? '+' : ''}{p.impactPerRound.toFixed(1)}%</td>
                <td>{p.whiffs || ''}</td><td>{p.upsets || ''}</td>
                <td className="muted sb-roles">{p.roles.slice(0, 2).map(r => `${r.role} ×${r.rounds}`).join(', ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const spreads = (z: number) => `${Math.abs(z).toFixed(1)} spreads`;
function lobbyText(z: number) {
  return Math.abs(z) < 0.15 ? 'about the middle of the lobby' : `${spreads(z)} ${z > 0 ? 'above' : 'below'} the lobby's average`;
}
/** The level grade explained: where on the ladder, and from what. */
function levelText(l: LevelGrade) {
  const where = l.score >= l.proAt ? 'at or above a typical pro game' : l.score >= 0 ? `between a typical level-10 game and a typical pro game (${Math.round((l.score / l.proAt) * 100)}% of the way)` : 'below a typical level-10 game';
  const part = (v: number | null) => (v === null ? 'not measured' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
  return `Level, from FACEIT level 10 (B) to pro (S): ${where}. Performance ${part(l.perf)}, mechanics (reaction, crosshair, sound, counter-strafing) ${part(l.mech)}, in level-10 spreads.`;
}

function lvl10Text(z: number) {
  return Math.abs(z) < 0.1 ? 'on par with a typical level-10 player' : `${spreads(z)} ${z > 0 ? 'better' : 'worse'} than a typical level-10 player`;
}

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
      <h2 className="display">Round grades</h2>
      <p className="muted">Click a name to focus that player · click a grade to watch the round in Review.</p>
      <div className="sb-wrap">
        <table className="rg">
          <thead>
            <tr>
              <th />
              {data.rounds.map((r, i) => (
                <th key={i} className={`${r.winner === 'CT' ? 'ctw' : r.winner === 'T' ? 'tw' : ''} ${swap[i] ? 'half' : ''} ${hot === i ? 'hot' : ''}`}
                  title={`Round ${r.n} · ${r.winner ?? '?'} won${r.reason ? ` (${r.reason.replace(/_/g, ' ')})` : ''}`}>
                  <span>{r.n}</span><i>{REASON_ICON[r.reason] && <Icon name={REASON_ICON[r.reason]} size={10} />}</i>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(p => (
              <tr key={p.id} className={p.id === focus ? 'focus' : ''}>
                <td className="name" onClick={() => onPick(p.id)}><span className={p.team === 0 ? 'ct' : 't'}>{p.name}</span></td>
                {p.rounds.map((l, i) => (
                  <td key={i} onClick={() => onRound(i)} className={`cell ${swap[i] ? 'half' : ''} ${hot === i ? 'hot' : ''}`}
                    title={l ? `${l.side} · ${l.role} · ${l.kills}K ${l.deaths}D · ${Math.round(l.damage)} dmg · ${l.points >= 0 ? '+' : ''}${l.points.toFixed(0)} pts${l.tags.length ? ` · ${[...new Set(l.tags)].join(', ')}` : ''}` : 'not graded yet'}>
                    {l ? <LetterChip letter={l.letter} /> : <span className="muted">·</span>}
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
  return <span className="letter" style={{ background: LETTER_COLOR[letter] }}>{letter}</span>;
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
