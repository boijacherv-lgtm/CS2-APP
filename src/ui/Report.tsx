import { useEffect, useMemo, useState } from 'react';
import { coach, modelFor, type Coaching, type Deviation, type FeatureId, type FeatureSet } from '../engine/coach';
import { COACH_MODEL } from '../engine/coachModels';
import { buildMatchReport, IMPACT_PER_POINT, type MatchReport, type PlayerReport } from '../engine/match';
import { LETTER_COLOR, RATING_SCALE, type DemoData, type Letter } from '../engine/recap';
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

      {focus && (
        <div className="recap-top">
          <Performance p={focus} players={view.players} me={me} onPlayer={setPicked} />
          <CoachCard p={focus} done={report.done} onRound={openRound} onHotRound={setHotRound} />
        </div>
      )}

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
        <span className="perf-letter display" style={{ background: LETTER_COLOR[p.letter] }} title="Match grade from the round grades (S+ … F)">{p.letter}</span>
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
function CoachCard({ p, done, onRound, onHotRound }: { p: PlayerReport; done: boolean; onRound: (i: number) => void; onHotRound: (i: number | null) => void }) {
  const c: Coaching = useMemo(() => coach(p, COACH_MODEL), [p]);
  const role = p.roles[0]?.role ?? 'Rifler';
  const byRole = modelFor(COACH_MODEL, role).byRole;
  const [open, setOpen] = useState<FeatureId | null>(null);
  const rows = c.profile.slice(0, 9);
  const side = (v: number | null) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  return (
    <section className="recap-card coach">
      <div className="coach-head">
        <h2 className="display">Coach</h2>
        <span className="muted">CT {side(c.sides.CT)} · T {side(c.sides.T)} win chance a round</span>
      </div>
      {COACH_MODEL.trainedOn > 0 && (
        <p className="coach-vs muted" title={`Learned from ${COACH_MODEL.trainedOn} player-games${COACH_MODEL.source ? ` in ${COACH_MODEL.source.demos} demos` : ''}`}>
          Compared with {COACH_MODEL.name ?? 'trained'} players{byRole ? ` (${role.toLowerCase()}s)` : ''}
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

/** "Far from normal" for the scoreboard: only outliers get colour. */
function tone(id: FeatureId, v: number) {
  const m = COACH_MODEL.features[id];
  const z = (v - m.baseline) / m.spread;
  return z > 1 ? 'hi' : z < -1 ? 'lo' : '';
}

function Scoreboard({ team, players, score, focus, onPick }: { team: 0 | 1; players: PlayerReport[]; score: number; focus: string; onPick: (id: string) => void }) {
  return (
    <div className="sb-wrap">
      <table className="sb">
        <thead>
          <tr className="sb-groups">
            <th className={team === 0 ? 'ct' : 't'}>{team === 0 ? 'Team A' : 'Team B'} <span className="num">{score}</span></th>
            <th colSpan={4}>Rating</th><th colSpan={5}>Fights</th><th colSpan={3}>Openings & clutches</th><th colSpan={2}>Utility</th><th colSpan={3}>Impact</th><th />
          </tr>
          <tr>
            <th className="sb-name muted">{team === 0 ? 'started CT' : 'started T'}</th>
            <th title="Premier rating at the start of the match">Rank</th>
            <th title="Estimated rating for this game: duel performance + round impact">Game</th>
            <th title="Game rating minus their real rating">±</th>
            <th title="Match grade from the round grades (S+ … F)">Grade</th>
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
                <td><LetterChip letter={p.letter} /></td>
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
