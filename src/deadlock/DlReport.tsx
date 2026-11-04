import { useEffect, useMemo, useState } from 'react';
import { MarkFace } from '../ui/MarkFace';
import { ScoreRing } from '../ui/ScoreRing';
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
import { abilityUse, reportCard, type GradeKey, type ReportCard } from './grade';
import { benchLevel, benchSource, HAS_HIGH, setBenchLevel, type BenchLevel } from './bench';
import { Economy, Items, Objectives, Scoreboard, TeamSouls, WinChance } from './DlRecap';
import { openLatest } from './open';
import './dl.css';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
type Tab = 'overview' | 'grades' | 'coach' | 'build' | 'objectives';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'grades', label: 'Report card', icon: 'trophy' }, { id: 'coach', label: 'Coach', icon: 'target' },
  { id: 'build', label: 'Souls, items and abilities', icon: 'coins' }, { id: 'objectives', label: 'Objectives', icon: 'map' },
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
  // compared with everyone, or with high-rank players (bench.ts)
  const [level, setLevel] = useState<BenchLevel>(benchLevel);
  const pickLevel = (l: BenchLevel) => { setBenchLevel(l); setLevel(l); };
  const card = useMemo(() => (match && subject !== null ? reportCard(match, subject, demo, coach.all) : null), [match, subject, demo, coach.all, level]); // eslint-disable-line react-hooks/exhaustive-deps
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
          <div className="dl-ov-charts">
            <WinChance match={match} team={who?.team ?? 0} watch={watch} />
            <TeamSouls match={match} team={who?.team ?? 0} />
          </div>
          <Moments moves={myMoves} watch={watch} />
        </>
      )}
      {tab === 'grades' && card && who && <Grades card={card} match={match} name={nameOf(who.slot)} hero={heroOf(who.hero).name} moves={coach.all} watch={watch} level={level} pickLevel={pickLevel} />}
      {tab === 'build' && who && (
        <>
          <Economy match={match} slot={who.slot} watch={watch} />
          <Items match={match} slot={who.slot} />
          <Abilities match={match} slot={who.slot} card={card} watch={watch} />
        </>
      )}
      {tab === 'coach' && (
        <>
          <Coach moves={myMoves} watch={watch} who={who ? nameOf(who.slot) : 'everyone'} />
          <section className="recap-card">
            <h3>Kills</h3>
            <MoveList moves={myMoves.filter(m => m.kind !== 'laning')} watch={watch} compact />
          </section>
        </>
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
        {bad.length ? <MoveList moves={bad.slice(0, 3)} watch={watch} compact /> : <p className="empty-state">No real mistakes marked.</p>}
      </section>
      <section className="recap-card">
        <h3>Best moments</h3>
        {good.length ? <MoveList moves={good.slice(0, 3)} watch={watch} compact /> : <p className="empty-state">No standout plays marked.</p>}
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
      {!lessons.length ? <p className="empty-state">Nothing that comes back: no repeated mistakes in this match.</p> : (
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

/** Graded moments with Watch; compact: the title only (the why shows on hover). */
function MoveList({ moves, watch, compact }: { moves: DlMove[]; watch: (t: number) => void; compact?: boolean }) {
  if (!moves.length) return <p className="empty-state">Nothing here.</p>;
  return (
    <ul className="dl-moves">
      {moves.map(m => (
        <li key={`${m.kind}-${m.t}-${m.slot}`} title={compact ? m.why.join(' ') : undefined}>
          <MarkFace note={m.note} size={24} className="dl-card-mark" />
          <span className="dl-move-text"><b>{m.title}</b>{!compact && m.why.length > 1 && <span className="muted small">{m.why.slice(0, -1).join(' ')}</span>}{compact && m.why[0] && <span className="muted small">{m.why[0]}</span>}</span>
          <button className="chip" onClick={() => watch(m.t)}>Watch</button>
        </li>
      ))}
    </ul>
  );
}

const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`;
const TONE_COLOR = { up: 'var(--good)', down: 'var(--bad)', flat: 'var(--text-3)' } as const;

/** What to do about each part when it's the weakest. */
const FOCUS: Record<GradeKey, string> = {
  kills: 'Pick fights on their richest heroes and turn each kill into something: push a Guardian or take the Mid Boss right after.',
  map: 'Between waves, clear a camp on your way, break crates and statues, and be at objectives when they fall.',
  abilities: 'Use your ultimate whenever it\'s up and a fight starts; holding it for the perfect moment loses more than it wins.',
  rotations: 'When your lane is pushed in, walk to the next lane for a gank, then come back for your next wave.',
  survival: 'Stay where a teammate can reach you, and back off when two or more enemies are missing from the map.',
};
const PRAISE: Record<GradeKey, string> = {
  kills: 'your kills were worth more than usual', map: 'you made good use of the map', abilities: 'your abilities did their job',
  rotations: 'your ganks paid off', survival: 'you stayed alive',
};
const ORD = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * The report card: the overall grade with a verdict and rank in the match, the five parts as tiles, what to focus on
 * next game, then each part's numbers and moments. Every score is against players of the same hero in the same position.
 */
function Grades({ card, match, name, hero, moves, watch, level, pickLevel }: { card: ReportCard; match: DlMatch; name: string; hero: string; moves: DlMove[]; watch: (t: number) => void;
  level: BenchLevel; pickLevel: (l: BenchLevel) => void }) {
  const demo = useDl(s => s.demo);
  // everyone's cards, for the rank in this match
  const all = useMemo(() => match.players.map(p => reportCard(match, p.slot, demo, moves)), [match, demo, moves, level]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = benchSource(level);
  const rankOf = (score: number | null, pick: (c: ReportCard) => number | null) => {
    if (score === null) return null;
    const xs = all.map(pick).filter((x): x is number => x !== null);
    return { n: xs.filter(x => x > score).length + 1, of: xs.length };
  };
  const scored = card.parts.filter(p => p.score !== null);
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0], worst = [...scored].sort((a, b) => a.score! - b.score!)[0];
  const overallRank = rankOf(card.overall, c => c.overall);
  const verdict = !best ? 'Not enough data to grade this match.'
    : card.overall! >= 62 ? `A strong game: ${PRAISE[best.key]}.` : card.overall! >= 45 ? `An average game: ${PRAISE[best.key]}, ${worst.label.toLowerCase()} held it back.` : `A rough game: ${worst.label.toLowerCase()} cost the most${best.score! >= 55 ? `, though ${PRAISE[best.key]}` : ''}.`;
  const jump = (key: GradeKey) => document.getElementById(`grade-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <>
      <section className="recap-card dl-rc-head">
        <div className="dl-rc-main">
          <ScoreRing score={card.overall} note={card.note} size={104} />
          <div>
            <span className="muted small">{name}'s report card · {hero}{card.pos ? ` · Pos ${card.pos}` : ''}</span>
            <h3 className="dl-rc-verdict">{verdict}</h3>
            <span className="muted small">{overallRank ? `${ORD(overallRank.n)} of ${overallRank.of} in this match · ` : ''}50 is an average game for {hero} in this position {level === 'high' ? 'among Phantom+ players' : ''} ({src.matches.toLocaleString()} {level === 'high' ? 'high-rank' : 'public'} matches since the patch)</span>
            {HAS_HIGH && (
              <span className="dl-level" role="group" aria-label="Compare with">
                <span className="muted small">Compare with</span>
                <button className={`chip ${level === 'all' ? 'on' : ''}`} onClick={() => pickLevel('all')}>Everyone</button>
                <button className={`chip ${level === 'high' ? 'on' : ''}`} onClick={() => pickLevel('high')}>Phantom+</button>
              </span>
            )}
          </div>
        </div>
        <Radar axes={card.parts.map(p => ({ label: p.label, you: p.z, tip: `${p.label}: ${p.score ?? 'not graded'}` }))} refLabel="Average for the position" />
      </section>

      <div className="dl-rc-tiles">
        {card.parts.map(p => {
          const r = rankOf(p.score, c => c.parts.find(x => x.key === p.key)?.score ?? null);
          return (
            <button key={p.key} className="dl-rc-tile" onClick={() => jump(p.key)} title={p.summary}>
              <span className="dl-rc-tile-top"><ScoreRing score={p.score} note={p.note} size={44} /><b>{p.label}</b></span>
              <span className="dl-rc-bar"><i style={{ width: `${p.score ?? 0}%`, background: p.score === null ? 'transparent' : p.note === 'book' ? 'var(--text-2)' : NOTE_INFO[p.note].color }} /></span>
              <span className="muted small">{p.score === null ? 'not graded' : r ? `${ORD(r.n)} of ${r.of} in the match` : ''}</span>
            </button>
          );
        })}
      </div>

      {worst && (
        <section className="recap-card dl-rc-focus">
          <div><span className="muted small">Focus next game</span><b>{worst.label}</b><p>{FOCUS[worst.key]}</p></div>
          {best && best.key !== worst.key && <div><span className="muted small">Keep doing</span><b>{best.label}</b><p>{PRAISE[best.key][0].toUpperCase() + PRAISE[best.key].slice(1)}: {best.score} against an average of 50.</p></div>}
        </section>
      )}

      {card.parts.map(p => {
        const facts = p.lines.filter(l => l.t === undefined), moments = p.lines.filter(l => l.t !== undefined);
        const r = rankOf(p.score, c => c.parts.find(x => x.key === p.key)?.score ?? null);
        return (
          <section key={p.key} id={`grade-${p.key}`} className="recap-card dl-grade">
            <h3>
              <ScoreRing score={p.score} note={p.note} size={40} />
              <span className="dl-grade-title">{p.label}<span className="muted small">{p.summary}</span></span>
              {p.note !== 'book' && <MarkFace note={p.note} size={22} className="dl-card-mark" />}
              {r && <span className="dl-grade-rank muted small">{ORD(r.n)} of {r.of}</span>}
            </h3>
            {facts.length > 0 && (
              <ul className="dl-grade-facts">
                {facts.map((l, i) => <li key={i} className={`t-${l.tone ?? 'flat'}`}>{l.text}</li>)}
              </ul>
            )}
            {moments.length > 0 && (
              <>
                <h4>Moments</h4>
                <ul className="dl-grade-lines">
                  {moments.map((l, i) => (
                    <li key={i}>
                      <i style={{ background: TONE_COLOR[l.tone ?? 'flat'] }} />
                      <span>{l.text}</span>
                      <button className="chip" onClick={() => watch(l.t!)}>Watch</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
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

