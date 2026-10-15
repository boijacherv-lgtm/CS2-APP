import { useEffect, useMemo, useState } from 'react';
import { coach, type CoachNote } from '../engine/coach';
import { buildMatchReport, IMPACT_PER_POINT, type PlayerReport } from '../engine/match';
import { LETTER_COLOR, RATING_SCALE, type Letter } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { navigate } from '../shell/router';
import { useStore } from '../store';
import { ReviewStart } from './Recap';
import { steamFetch } from './steamApi';

/**
 * Match recap: the coach's notes for a player (what to work on, what went well, rounds to watch), then every
 * player's estimated rating for this game, match grade, stats, and their grade in every round. Rounds are graded in
 * a worker (Shell → useMatchGrader) and everything fills in as they finish.
 */
export function MatchReportPage() {
  const report = useStore(s => s.report);
  const view = useMemo(() => (report ? buildMatchReport(report.data, report.rounds) : null), [report]);
  // clicking a player highlights their round grades and shows their coaching (click again to clear the highlight)
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (id: string) => setPicked(p => (p === id ? null : id));
  // you, if you're logged in with Steam and played in this match
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    steamFetch('/me').then(r => (r.ok ? r.json() : null)).then(j => setMe(j?.me?.steamId ?? null)).catch(() => {});
  }, []);
  const [coached, setCoached] = useState<string | null>(null);
  if (!report || !view) return <div className="app single"><ReviewStart /></div>;
  const coachId = [coached, picked, me].find(id => id && view.players.some(p => p.id === id)) ?? view.players[0]?.id;

  const data = report.data;
  const mapName = MAPS.find(m => m.id === data.map)?.name ?? data.map;
  const team = (t: 0 | 1) => view.players.filter(p => p.team === t);
  const openRound = (i: number) => {
    useStore.getState().setReviewRound(i);
    navigate({ page: 'cs2', mode: 'review' });
  };
  const ranked = Object.keys(data.ranks ?? {}).length;

  return (
    <div className="report">
      <header className="report-head">
        <h1>{mapName} · <span className="ct">Team A {view.score[0]}</span> – <span className="t">{view.score[1]} Team B</span></h1>
        <p className="muted">
          {data.rounds.length} rounds · {ranked ? `${ranked} of ${view.players.length} players have a Premier rating in the demo` : 'no ratings in this demo (estimates are relative to an average 10,000 player)'}
          {!report.done && <> · <b>grading rounds {view.graded}/{view.total}…</b></>}
        </p>
        {!report.done && <div className="report-progress"><i style={{ width: `${(view.graded / view.total) * 100}%` }} /></div>}
      </header>

      {coachId && (
        <CoachPanel players={view.players} id={coachId} me={me} done={report.done}
          onPlayer={id => { setCoached(id); setPicked(id); }} onRound={openRound} />
      )}

      {([0, 1] as const).map(t => (
        <section key={t} className="report-team">
          <h2>{t === 0 ? 'Team A (started CT)' : 'Team B (started T)'}</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th>Player</th>
                <th title="Premier rating at the start of the match">Rank</th>
                <th title="Estimated rating for this game: duel performance + round impact">Game rating</th>
                <th title="Game rating minus their real rating">±</th>
                <th title="Match grade from average round impact">Grade</th>
                <th title="Win chance added per round">Impact</th>
                <th>K</th><th>D</th><th>ADR</th>
                <th title="Rounds with a kill, assist, survival or trade">KAST</th>
                <th>HS%</th>
                <th title="Opening kills – opening deaths">Open</th>
                <th title="Clutch kills (last alive vs 2+)">Clutch</th>
                <th title="Rounds with 3+ kills">3K+</th>
                <th title="HE + fire damage">Util dmg</th>
                <th title="Kills on enemies they flashed">Flash ast</th>
                <th title="Died right after spraying and missing">Whiffs</th>
                <th title="Duels won against much higher-rated players">Upsets</th>
                <th>Roles</th>
              </tr>
            </thead>
            <tbody>{team(t).map(p => <PlayerRow key={p.id} p={p} picked={picked === p.id} onPick={() => pick(p.id)} />)}</tbody>
          </table>
        </section>
      ))}

      <section className="report-rounds">
        <h2>Round grades</h2>
        <p className="muted">Click a player to highlight their grades · click a grade to watch that round in Review.</p>
        <table className={`report-grid ${picked ? 'has-pick' : ''}`}>
          <thead>
            <tr>
              <th />
              {data.rounds.map((r, i) => (
                <th key={i} className={r.winner === 'CT' ? 'ctw' : r.winner === 'T' ? 'tw' : ''} title={`${r.winner ?? '?'} won${r.reason ? ` (${r.reason})` : ''}`}>{r.n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.players.map(p => (
              <tr key={p.id} className={picked === p.id ? 'pick' : ''}>
                <td className="name" onClick={() => pick(p.id)}><span className={p.team === 0 ? 'ct' : 't'}>{p.name}</span></td>
                {p.rounds.map((l, i) => (
                  <td key={i} onClick={() => openRound(i)} className="cell"
                    title={l ? `${l.side} · ${l.role} · ${l.kills}K ${l.deaths}D · ${Math.round(l.damage)} dmg · ${l.points >= 0 ? '+' : ''}${l.points.toFixed(0)} pts${l.tags.length ? ` · ${[...new Set(l.tags)].join(', ')}` : ''}` : 'not graded yet'}>
                    {l ? <LetterChip letter={l.letter} /> : <span className="muted">·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="report-how muted">
        <h2>How the estimate works</h2>
        <p>
          <b>Game rating</b> is a performance rating, like in chess: the Premier rating at which this player's duels (every kill a win,
          every death a loss, against each opponent's real rating) would be exactly the expected result. Then it adds {IMPACT_PER_POINT} points
          per point of average round impact, so round-winning plays count and empty kills count less.
          A {Math.round(RATING_SCALE * 0.3)}-point gap makes the higher-rated player a 2:1 favourite in a single duel.
        </p>
        <p>
          <b>Round grades</b> (S+ … F) come from how much the player changed their team's win chance, plus bonuses for clutches and
          multi-kills and penalties for team damage, team flashes and dying with unused grenades. Ratings also shape the grades:
          beating a higher-rated player counts for more (UPSET), losing to a lower-rated one costs more.
        </p>
      </section>
    </div>
  );
}

/** The coach's notes for one player. */
function CoachPanel({ players, id, me, done, onPlayer, onRound }: {
  players: PlayerReport[]; id: string; me: string | null; done: boolean; onPlayer: (id: string) => void; onRound: (i: number) => void;
}) {
  const p = players.find(x => x.id === id)!;
  const c = useMemo(() => coach(p), [p]);
  const side = (v: number | null) => (v === null ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  return (
    <section className="coach">
      <div className="coach-head">
        <h2>Coach</h2>
        <select value={id} onChange={e => onPlayer(e.target.value)} title="Whose game to coach">
          {players.map(x => <option key={x.id} value={x.id}>{x.name}{x.id === me ? ' (you)' : ''}</option>)}
        </select>
        <span className="muted">{p.roles[0]?.role ?? ''} · CT {side(c.sides.CT)} · T {side(c.sides.T)} win chance a round</span>
      </div>
      <p className="coach-summary">{c.summary}{!done && <span className="muted"> (updates while rounds are graded)</span>}</p>
      <div className="coach-cols">
        <div>
          <h3>Work on</h3>
          {c.improve.length ? c.improve.map(n => <NoteCard key={n.title} n={n} onRound={onRound} />) : <p className="muted">Nothing stands out.</p>}
        </div>
        <div>
          <h3>Keep doing</h3>
          {c.strengths.length ? c.strengths.map(n => <NoteCard key={n.title} n={n} onRound={onRound} />) : <p className="muted">No clear strengths this game.</p>}
        </div>
      </div>
    </section>
  );
}

function NoteCard({ n, onRound }: { n: CoachNote; onRound: (i: number) => void }) {
  return (
    <div className={`coach-note ${n.kind}`}>
      <b>{n.title}</b>
      <p>{n.detail}</p>
      {n.rounds.length > 0 && (
        <div className="coach-rounds">
          <span className="muted">Watch:</span>
          {n.rounds.slice(0, 8).map(i => <button key={i} onClick={() => onRound(i)} title="Open this round in Review">R{i + 1}</button>)}
          {n.rounds.length > 8 && <span className="muted">+{n.rounds.length - 8}</span>}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ p, picked, onPick }: { p: PlayerReport; picked: boolean; onPick: () => void }) {
  const delta = p.gameRating !== null && p.rank !== null ? p.gameRating - p.rank : null;
  return (
    <tr className={`pickable ${picked ? 'pick' : ''}`} onClick={onPick} title="Click to highlight their round grades">
      <td><b className={p.team === 0 ? 'ct' : 't'}>{p.name}</b></td>
      <td>{p.rank !== null ? fmt(p.rank) : <span className="muted">–</span>}</td>
      <td title={p.duelRating !== null ? `Duels ${p.duelsWon}–${p.duelsLost} vs avg ${fmt(p.avgOpponent ?? 0)} → ${fmt(p.duelRating)}; impact ${p.pointsPerRound >= 0 ? '+' : ''}${p.pointsPerRound.toFixed(1)} pts/round` : 'No duels yet'}>
        <b>{p.gameRating !== null ? fmt(p.gameRating) : '–'}</b>
      </td>
      <td style={{ color: delta === null ? undefined : delta >= 0 ? '#22c55e' : '#ef4444' }}>{delta === null ? '' : `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}`}</td>
      <td><LetterChip letter={p.letter} /></td>
      <td style={{ color: p.impactPerRound > 0.5 ? '#22c55e' : p.impactPerRound < -0.5 ? '#ef4444' : undefined }}>{p.impactPerRound >= 0 ? '+' : ''}{p.impactPerRound.toFixed(1)}%</td>
      <td>{p.kills}</td><td>{p.deaths}</td><td>{p.adr.toFixed(0)}</td><td>{p.kast.toFixed(0)}%</td><td>{p.hs.toFixed(0)}%</td>
      <td>{p.openingKills}–{p.openingDeaths}</td><td>{p.clutches || ''}</td><td>{p.multiKills || ''}</td>
      <td>{p.utilDamage || ''}</td><td>{p.flashAssists || ''}</td><td>{p.whiffs || ''}</td><td>{p.upsets || ''}</td>
      <td className="muted">{p.roles.slice(0, 2).map(r => `${r.role} ×${r.rounds}`).join(', ')}</td>
    </tr>
  );
}

function LetterChip({ letter }: { letter: Letter }) {
  return <span className="letter" style={{ background: LETTER_COLOR[letter] }}>{letter}</span>;
}

const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
