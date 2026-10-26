import { useMemo, useState } from 'react';
import { NOTE_INFO } from '../engine/recap';
import { navigate } from '../shell/router';
import { AreaChart, BarList } from '../site/charts';
import { Icon, type IconName } from '../ui/Icon';
import type { DlMove, DlTag } from './coach';
import { heroOf, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import { statAt, type DlMatch } from './match';
import { useDl } from './store';
import { useCoach } from './useCoach';
import './dl.css';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
type Tab = 'overview' | 'coach' | 'fights' | 'objectives' | 'scoreboard';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'coach', label: 'Coach', icon: 'target' },
  { id: 'fights', label: 'Fights', icon: 'swords' }, { id: 'objectives', label: 'Objectives', icon: 'map' },
  { id: 'scoreboard', label: 'Scoreboard', icon: 'list' },
];
/** What each kind of mistake means, and what to do instead (the coach's lessons). */
const LESSON: Partial<Record<DlTag, { title: string; fix: string }>> = {
  ISOLATED: { title: 'Dying alone', fix: 'Nobody could help or trade. Move with a teammate, or stay where one can reach you.' },
  OUTNUMBERED: { title: 'Fights you were outnumbered in', fix: 'Count heroes before you commit: back off when two or more are missing from your fight.' },
  OVEREXTENDED: { title: 'Too deep past their Guardians', fix: 'Past a standing Guardian you have no way back. Push there only with your team or when theirs are dead.' },
  'COST OBJECTIVE': { title: 'Deaths that cost an objective', fix: 'Before a wave reaches your Guardian or Walker, play safe: being alive to defend is worth more than a kill.' },
  'LANE LOST': { title: 'Behind after laning', fix: 'Last-hit and deny more, and take the urn and camps when the lane is pushed.' },
};

/** Deadlock's Match recap: the result, the coach's lessons, fights, objectives and every player's numbers. */
export function DlReport() {
  const match = useDl(s => s.match), names = useDl(s => s.names);
  const coach = useCoach();
  const [tab, setTab] = useState<Tab>('overview');
  if (!match) return <div className="page"><p className="muted">No match open. <a href="#/deadlock/review">Pick one</a></p></div>;
  const me = coach.mine !== null ? match.players.find(p => p.slot === coach.mine)! : null;
  const watch = (t: number) => { useDl.getState().setTime(Math.max(0, t - 4)); useDl.getState().setPlaying(false); navigate({ page: 'deadlock', mode: 'review' }); };
  const nameOf = (slot: number) => { const p = match.players.find(x => x.slot === slot)!; return names[p.account]?.name ?? heroOf(p.hero).name; };
  const myMoves = coach.mine !== null ? coach.all.filter(m => m.slot === coach.mine) : coach.all;

  return (
    <div className="report dl-report">
      <header className="recap-head">
        <div className="recap-head-main">
          <span className="recap-map display">Deadlock</span>
          <span className="recap-score display">
            <b style={{ color: TEAM_COLOR[0] }}>{teamKills(match, 0)}</b><i>:</i><b style={{ color: TEAM_COLOR[1] }}>{teamKills(match, 1)}</b>
          </span>
          {me && <span className={`recap-result ${match.winner === me.team ? 'victory' : 'defeat'}`}>{match.winner === me.team ? 'Victory' : 'Defeat'}</span>}
        </div>
        <p className="muted">Match {match.id} · {mins(match.duration)} · {TEAM_NAME[match.winner]} won{me ? ` · you: ${heroOf(me.hero).name}` : ''}</p>
      </header>

      <nav className="recap-tabs" aria-label="Recap">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
      </nav>

      {tab === 'overview' && <Overview match={match} me={me?.slot ?? null} moves={myMoves} watch={watch} />}
      {tab === 'coach' && <Coach moves={myMoves} watch={watch} who={me ? 'you' : 'everyone'} />}
      {tab === 'fights' && (
        <section className="recap-card">
          <h3>{me ? 'Your kills and deaths' : 'Every kill and death'}</h3>
          <MoveList moves={myMoves.filter(m => m.kind !== 'laning')} watch={watch} />
        </section>
      )}
      {tab === 'objectives' && (
        <section className="recap-card">
          <h3>Objectives</h3>
          <ol className="dl-objectives">
            {match.objectives.filter(o => o.destroyed).sort((a, b) => a.destroyed! - b.destroyed!).map(o => (
              <li key={`${o.team}-${o.id}`}>
                <span className="num muted">{mins(o.destroyed!)}</span>
                <span style={{ color: TEAM_COLOR[o.team] }}>{TEAM_NAME[o.team]}</span> lost the <b>{o.name}</b>
                <button className="chip" onClick={() => watch(o.destroyed! - 20)}>Watch</button>
              </li>
            ))}
            {match.midBoss.map((b, i) => <li key={`mb${i}`}><span className="num muted">{mins(b.t)}</span><span style={{ color: TEAM_COLOR[b.team] }}>{TEAM_NAME[b.team]}</span> took the <b>Mid Boss</b><button className="chip" onClick={() => watch(b.t - 20)}>Watch</button></li>)}
          </ol>
        </section>
      )}
      {tab === 'scoreboard' && (
        <section className="recap-card">
          {([0, 1] as DlTeam[]).map(team => (
            <div key={team} className="dl-score-team">
              <h3 style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}{match.winner === team ? ' · won' : ''}</h3>
              <table className="site-table dl-scoreboard">
                <thead><tr><th>Player</th><th>K/D/A</th><th>Souls</th><th>Last hits</th><th>Denies</th><th>Level</th></tr></thead>
                <tbody>
                  {match.players.filter(p => p.team === team).sort((a, b) => b.netWorth - a.netWorth).map(p => (
                    <tr key={p.slot} className={p.slot === coach.mine ? 'me' : ''}>
                      <td><span className="dl-sb-hero">{heroOf(p.hero).card && <img src={heroOf(p.hero).card!} alt="" width={22} height={22} />}<b>{nameOf(p.slot)}</b><span className="muted small">{heroOf(p.hero).name}</span></span></td>
                      <td className="num">{p.kills}/{p.deaths}/{p.assists}</td><td className="num">{p.netWorth.toLocaleString()}</td>
                      <td className="num">{p.lastHits}</td><td className="num">{p.denies}</td><td className="num">{p.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const teamKills = (m: DlMatch, team: DlTeam) => m.players.filter(p => p.team === team).reduce((a, p) => a + p.kills, 0);

function Overview({ match, me, moves, watch }: { match: DlMatch; me: number | null; moves: DlMove[]; watch: (t: number) => void }) {
  // the souls lead over the match, from each player's snapshots (every 3 min and at the end)
  const lead = useMemo(() => {
    const times = [...new Set(Object.values(match.stats).flatMap(ss => ss.map(s => s.t)))].sort((a, b) => a - b);
    const team = (tm: DlTeam, t: number) => match.players.filter(p => p.team === tm).reduce((a, p) => a + (statAt(match, p.slot, t)?.netWorth ?? 0), 0);
    const mine = me !== null ? match.players.find(p => p.slot === me)!.team : 0;
    return times.map(t => ({ label: mins(t), value: team(mine, t) - team((1 - mine) as DlTeam, t) }));
  }, [match, me]);
  const bad = moves.filter(m => m.note === '?' || m.note === '??'), good = moves.filter(m => m.note === '!' || m.note === '!!');
  const myTeam = me !== null ? match.players.find(p => p.slot === me)!.team : 0;
  return (
    <>
      <section className="recap-card overview">
        <h3>Souls lead ({TEAM_NAME[myTeam]}{me !== null ? ', your team' : ''})</h3>
        <AreaChart points={lead} fmt={v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`} height={180} color={TEAM_COLOR[myTeam]} />
      </section>
      <section className="recap-card">
        <h3>The coach's marks{me !== null ? ' on your play' : ''}</h3>
        <BarList rows={(['!!', '!', '?!', '?', '??'] as const).map(n => {
          const c = moves.filter(m => m.note === n).length;
          return { label: `${NOTE_INFO[n].mark} ${NOTE_INFO[n].label}`, value: String(c), share: c / Math.max(1, moves.filter(m => m.note !== 'book').length), tone: n.startsWith('!') ? 'up' as const : n === '?!' ? 'flat' as const : 'down' as const };
        })} />
        {bad.length > 0 && <><h4>Worst moments</h4><MoveList moves={[...bad].sort((a, b) => (a.note === '??' ? -1 : 0) - (b.note === '??' ? -1 : 0)).slice(0, 4)} watch={watch} /></>}
        {good.length > 0 && <><h4>Best moments</h4><MoveList moves={good.slice(0, 3)} watch={watch} /></>}
      </section>
    </>
  );
}

function Coach({ moves, watch, who }: { moves: DlMove[]; watch: (t: number) => void; who: string }) {
  // the lessons: the mistakes that come back most, worst first
  const lessons = (Object.keys(LESSON) as DlTag[]).map(tag => ({ tag, ...LESSON[tag]!, hits: moves.filter(m => m.tags.includes(tag) && (m.note === '?' || m.note === '??' || m.note === '?!')) }))
    .filter(l => l.hits.length).sort((a, b) => b.hits.length - a.hits.length);
  return (
    <section className="recap-card">
      <h3>What to work on ({who})</h3>
      {!lessons.length ? <p className="muted">Nothing that comes back: no repeated mistakes in this match.</p> : (
        <ol className="ov-list">
          {lessons.map(l => (
            <li key={l.tag}>
              <b>{l.title}: {l.hits.length}×</b>
              <p className="muted">{l.fix}</p>
              <span className="coach-rounds">Watch: {l.hits.slice(0, 6).map(h => <button key={h.t} onClick={() => watch(h.t)}>{mins(h.t)}</button>)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MoveList({ moves, watch }: { moves: DlMove[]; watch: (t: number) => void }) {
  if (!moves.length) return <p className="muted">Nothing here.</p>;
  return (
    <ul className="dl-moves">
      {moves.map(m => (
        <li key={`${m.kind}-${m.t}-${m.slot}`}>
          <b className="dl-card-mark" style={{ background: NOTE_INFO[m.note].color }}>{m.note === 'book' ? '·' : NOTE_INFO[m.note].mark}</b>
          <span className="dl-move-text"><b>{m.title}</b>{m.why.length > 1 && <span className="muted small">{m.why.slice(0, -1).join(' ')}</span>}</span>
          <button className="chip" onClick={() => watch(m.t)}>Watch</button>
        </li>
      ))}
    </ul>
  );
}
