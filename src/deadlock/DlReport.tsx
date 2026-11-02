import { useEffect, useMemo, useState } from 'react';
import { NOTE_INFO } from '../engine/recap';
import { navigate } from '../shell/router';
import { Radar } from '../site/charts';
import { Icon, type IconName } from '../ui/Icon';
import { useProfile } from '../ui/profileApi';
import { steamId3 } from './api';
import type { DlMove, DlTag } from './coach';
import { heroOf, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import type { DlMatch } from './match';
import { useDl } from './store';
import { useCoach } from './useCoach';
import { abilityUse, reportCard, type ReportCard } from './grade';
import { BENCH_SOURCE } from './bench';
import { Economy, Items, Objectives, Scoreboard, TeamSouls } from './DlRecap';
import { openLatest } from './open';
import './dl.css';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
type Tab = 'overview' | 'grades' | 'coach' | 'economy' | 'items' | 'abilities' | 'fights' | 'objectives';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'grades', label: 'Report card', icon: 'trophy' }, { id: 'coach', label: 'Coach', icon: 'target' },
  { id: 'economy', label: 'Economy', icon: 'coins' }, { id: 'items', label: 'Items', icon: 'shield' }, { id: 'abilities', label: 'Abilities', icon: 'bolt' },
  { id: 'fights', label: 'Fights', icon: 'swords' }, { id: 'objectives', label: 'Objectives', icon: 'map' },
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
  const match = useDl(s => s.match), names = useDl(s => s.names), demo = useDl(s => s.demo);
  const coach = useCoach();
  const [tab, setTab] = useState<Tab>('overview');
  // whose recap: yours when you played in it, else the player picked here
  const [pick, setPick] = useState<number | null>(null);
  const subject = pick ?? coach.mine ?? match?.players[0]?.slot ?? null;
  const card = useMemo(() => (match && subject !== null ? reportCard(match, subject, demo, coach.all) : null), [match, subject, demo, coach.all]);
  // nothing open: your newest match opens by itself (logged in with Steam)
  const steam = useProfile(s => s.me?.steamId);
  const [auto, setAuto] = useState<'idle' | 'opening' | 'none' | 'failed'>('idle');
  useEffect(() => {
    if (match || !steam || auto !== 'idle') return;
    setAuto('opening');
    openLatest(steamId3(steam)).then(m => setAuto(m ? 'idle' : 'none'), () => setAuto('failed'));
  }, [match, steam, auto]);
  useEffect(() => { setPick(null); }, [match?.id]);
  if (!match) return (
    <div className="page"><p className="muted">{auto === 'opening' ? 'Opening your latest match…' : auto === 'none' ? 'No matches of yours on deadlock-api yet. ' : auto === 'failed' ? 'Couldn\'t open your latest match. ' : 'No match open. '}
      {auto !== 'opening' && <a href="#/deadlock/review">Pick one</a>}</p></div>
  );
  const me = coach.mine !== null ? match.players.find(p => p.slot === coach.mine)! : null;
  const who = match.players.find(p => p.slot === subject) ?? null;
  const watch = (t: number) => { useDl.getState().setTime(Math.max(0, t - 4)); useDl.getState().setPlaying(false); navigate({ page: 'deadlock', mode: 'review' }); };
  const nameOf = (slot: number) => { const p = match.players.find(x => x.slot === slot)!; return names[p.account]?.name ?? heroOf(p.hero).name; };
  // the graded player's moves (everyone's when nobody is picked)
  const myMoves = subject !== null ? coach.all.filter(m => m.slot === subject) : coach.all;

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
        {who && (
          <div className="dl-subject">
            {heroOf(who.hero).card && <img src={heroOf(who.hero).card!} alt="" width={44} height={44} />}
            <div className="dl-subject-who">
              <b>{nameOf(who.slot)}{who.slot === coach.mine ? ' (you)' : ''}</b>
              <span className="muted small">{heroOf(who.hero).name}{card?.pos ? <span className={`dl-pos p${card.pos}`}>Pos {card.pos}</span> : null}</span>
            </div>
            <div className="dl-subject-stats">
              <span><b className="num">{who.kills}/{who.deaths}/{who.assists}</b><i>K/D/A</i></span>
              <span><b className="num">{(who.netWorth / 1000).toFixed(1)}k</b><i>souls</i></span>
              <span><b className="num">{who.lastHits}</b><i>last hits</i></span>
              <span className={`dl-subject-result ${match.winner === who.team ? 'won' : 'lost'}`}>{match.winner === who.team ? 'Won' : 'Lost'}</span>
            </div>
            <label className="dl-subject-pick">
              <span className="muted small">Graded player</span>
              <select value={subject ?? ''} onChange={e => setPick(Number(e.target.value))}>
                {match.players.map(p => <option key={p.slot} value={p.slot}>{nameOf(p.slot)} · {heroOf(p.hero).name}{p.slot === coach.mine ? ' (you)' : ''}</option>)}
              </select>
            </label>
          </div>
        )}
      </header>

      <nav className="recap-tabs" aria-label="Recap">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
      </nav>

      {tab === 'overview' && (
        <>
          <Scoreboard match={match} subject={subject} mine={coach.mine} nameOf={nameOf} pick={slot => setPick(slot)} />
          <TeamSouls match={match} team={who?.team ?? 0} />
          <Moments moves={myMoves} watch={watch} />
        </>
      )}
      {tab === 'grades' && card && who && <Grades card={card} name={nameOf(who.slot)} hero={heroOf(who.hero).name} watch={watch} />}
      {tab === 'economy' && who && <Economy match={match} slot={who.slot} watch={watch} />}
      {tab === 'items' && who && <Items match={match} slot={who.slot} />}
      {tab === 'abilities' && who && <Abilities match={match} slot={who.slot} card={card} watch={watch} />}
      {tab === 'coach' && <Coach moves={myMoves} watch={watch} who={who ? nameOf(who.slot) : 'everyone'} />}
      {tab === 'fights' && (
        <section className="recap-card">
          <h3>{who ? `${nameOf(who.slot)}'s kills and deaths` : 'Every kill and death'}</h3>
          <MoveList moves={myMoves.filter(m => m.kind !== 'laning')} watch={watch} />
        </section>
      )}
      {tab === 'objectives' && <Objectives match={match} team={who?.team ?? 0} watch={watch} />}
    </div>
  );
}

const teamKills = (m: DlMatch, team: DlTeam) => m.players.filter(p => p.team === team).reduce((a, p) => a + p.kills, 0);

/** The graded player's worst and best moments, with what happened. */
function Moments({ moves, watch }: { moves: DlMove[]; watch: (t: number) => void }) {
  const rank = (n: string) => ({ '??': 0, '?': 1, '!!': 0, '!': 1 } as Record<string, number>)[n] ?? 2;
  const bad = moves.filter(m => m.note === '?' || m.note === '??').sort((a, b) => rank(a.note) - rank(b.note) || a.t - b.t);
  const good = moves.filter(m => m.note === '!' || m.note === '!!').sort((a, b) => rank(a.note) - rank(b.note) || a.t - b.t);
  return (
    <div className="dl-moments">
      <section className="recap-card">
        <h3>Worst moments</h3>
        {bad.length ? <MoveList moves={bad.slice(0, 5)} watch={watch} /> : <p className="muted">No real mistakes marked.</p>}
      </section>
      <section className="recap-card">
        <h3>Best moments</h3>
        {good.length ? <MoveList moves={good.slice(0, 5)} watch={watch} /> : <p className="muted">No standout plays marked.</p>}
      </section>
    </div>
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
              <span className="coach-rounds">Watch: {l.hits.slice(0, 6).map((h, i) => <button key={`${h.t}-${h.slot}-${i}`} onClick={() => watch(h.t)}>{mins(h.t)}</button>)}</span>
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

const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`;
const TONE_COLOR = { up: 'var(--good)', down: 'var(--bad)', flat: 'var(--text-3)' } as const;

/** The report card: each part's score against the same hero in the same position, with the moments behind it. */
function Grades({ card, name, hero, watch }: { card: ReportCard; name: string; hero: string; watch: (t: number) => void }) {
  return (
    <>
      <section className="recap-card dl-grade-head">
        <div>
          <h3>{name}'s report card</h3>
          <p className="muted">{hero}{card.pos ? ` · played Pos ${card.pos}` : ''} · graded against players of the same hero in the same position ({BENCH_SOURCE.matches.toLocaleString()} public matches since the patch); 50 is average.</p>
          <div className="dl-grade-overall">
            <ScoreRing score={card.overall} note={card.note} size={84} />
            <div><b>Overall</b><span className="muted small">{NOTE_INFO[card.note].label}</span></div>
          </div>
          <div className="dl-grade-chips">
            {card.parts.map(p => <span key={p.key}><ScoreRing score={p.score} note={p.note} size={40} />{p.label}</span>)}
          </div>
        </div>
        <Radar axes={card.parts.map(p => ({ label: p.label, you: p.z, tip: `${p.label}: ${p.score ?? 'not graded'}` }))} refLabel="Average for the position" />
      </section>
      {card.parts.map(p => (
        <section key={p.key} className="recap-card dl-grade">
          <h3>
            <ScoreRing score={p.score} note={p.note} size={36} />
            {p.label}
            {p.note !== 'book' && <b className="dl-card-mark" style={{ background: NOTE_INFO[p.note].color }}>{NOTE_INFO[p.note].mark}</b>}
          </h3>
          <p className="muted small">{p.summary}</p>
          <ul className="dl-grade-lines">
            {p.lines.map((l, i) => (
              <li key={i}>
                <i style={{ background: TONE_COLOR[l.tone ?? 'flat'] }} />
                <span>{l.text}</span>
                {l.t !== undefined && <button className="chip" onClick={() => watch(l.t!)}>Watch</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Each ability: unlocked and upgraded when, damage to heroes, casts (with the demo); the ultimate's use. */
function Abilities({ match, slot, card, watch }: { match: DlMatch; slot: number; card: ReportCard | null; watch: (t: number) => void }) {
  const demo = useDl(s => s.demo);
  const rows = useMemo(() => abilityUse(match, slot, demo), [match, slot, demo]);
  const part = card?.parts.find(p => p.key === 'abilities');
  const maxDmg = Math.max(1, ...rows.map(r => r.damage));
  return (
    <>
      <section className="recap-card">
        <h3>Abilities</h3>
        <ul className="dl-itemrows">
          {rows.map(r => (
            <li key={r.a.cls}>
              {r.a.img && <img src={r.a.img} alt="" />}
              <b>{r.a.name}{r.a.ult ? ' (ultimate)' : ''}</b>
              <span className="muted small">{r.unlocked !== null ? `unlocked ${mins(r.unlocked)}` : 'never unlocked'}{r.upgrades.length ? ` · upgraded ${r.upgrades.map(mins).join(', ')}` : ''}{r.casts !== null ? ` · cast ${r.casts}×` : ''}</span>
              <span className="dl-abil-bar"><i style={{ width: `${(r.damage / maxDmg) * 100}%` }} /><span className="num">{Math.round(r.damage).toLocaleString()}</span></span>
            </li>
          ))}
        </ul>
        {!demo && <p className="muted small">Casts and how the ultimate was used come from the match's demo; this match has none, so only damage and upgrades are shown.</p>}
      </section>
      {part && (
        <section className="recap-card">
          <h3>How they were used</h3>
          <ul className="dl-grade-lines">
            {part.lines.map((l, i) => <li key={i}><i style={{ background: TONE_COLOR[l.tone ?? 'flat'] }} /><span>{l.text}</span>{l.t !== undefined && <button className="chip" onClick={() => watch(l.t!)}>Watch</button>}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}

/** A score out of 100 as a ring, coloured by its mark (grey for an average one). */
function ScoreRing({ score, note, size }: { score: number | null; note: keyof typeof NOTE_INFO; size: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, col = score === null ? 'var(--text-3)' : note === 'book' ? 'var(--text-2)' : NOTE_INFO[note].color;
  return (
    <span className="dl-ring" style={{ width: size, height: size }} title={score === null ? 'Not graded' : `${score} / 100`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="dl-ring-track" strokeWidth={size > 60 ? 7 : 4} />
        {score !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={size > 60 ? 7 : 4} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <b className="num" style={{ fontSize: size > 60 ? 26 : size > 38 ? 13 : 12 }}>{score ?? '–'}</b>
    </span>
  );
}
