import { closeDlMatch } from '../ui/closeMatch';
import { CountUp } from '../ui/CountUp';
import { useEffect, useMemo, useState } from 'react';
import { saveMoments } from '../moments/moments';
import { matchPosition } from './bench';
import { dlMoments } from '../moments/build';
import { MarkFace } from '../ui/MarkFace';
import { ScoreRing } from '../ui/ScoreRing';
import { NOTE_INFO } from '../engine/recap';
import { navigate } from '../shell/router';
import { TrackRows } from '../site/charts';
import { percentile } from '../engine/profileView';
import { Icon, type IconName } from '../ui/Icon';
import { useProfile } from '../ui/profileApi';
import { steamId3 } from './api';
import type { DlMove, DlTag } from './coach';
import { heroArt, heroOf, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import type { DlMatch } from './match';
import { useDl } from './store';
import { useCoach, useMySlot } from './useCoach';
import { abilityUse, reportCard, type GradeKey, type ReportCard } from './grade';
import { benchLevel, benchSource, HAS_HIGH, setBenchLevel, type BenchLevel } from './bench';
import { Economy, Items, Objectives, Positioning, Scoreboard, TeamSouls, WinChance } from './DlRecap';
import { openLatest } from './open';
import './dl.css';
import { engineReview, type EngineMove, type EngineReview } from './engineReview';
import { ultUses, type UltUse, type UltVerdict } from './ultUse';
import { ultOf, type UltInfo } from './ultKinds';
import { abilitiesOf } from './abilityInfo';
import { DL_SEARCH, SEARCH_COLOR, type SearchClass } from './search';
import FIGHT_MODEL from './generated/fightmodel.json';

/** Whether the fight model's ultimates version shipped (tools/dl-fight.ts). */
const ULTS_IN = !!(FIGHT_MODEL as { ults?: unknown }).ults;

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// the same tabs, in the same order, as CS2's recap (Overview · Coach · Scoreboard · Timeline), then this game's own
type Tab = 'overview' | 'coach' | 'scoreboard' | 'objectives' | 'build';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'coach', label: 'Coach', icon: 'chat' }, { id: 'scoreboard', label: 'Scoreboard', icon: 'list' },
  { id: 'objectives', label: 'Timeline', icon: 'grid' }, { id: 'build', label: 'Economy & items', icon: 'coins' },
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
  // the engine's review of the graded player: every move, accuracy, the costliest and the best calls
  const review = useMemo(() => (match && subject !== null ? engineReview(match, demo, subject) : null), [match, demo, subject]);
  // your own match: its moments become puzzles and go in the mistake reel
  useEffect(() => { if (match && review && subject !== null && subject === coach.mine) saveMoments(dlMoments(match, review, subject)); }, [match, review, subject, coach.mine]);
  // their ultimate: what it does, and each time they used it, judged (needs the demo)
  const ults = useMemo(() => (match && subject !== null ? ultUses(match, demo, subject) : null), [match, demo, subject]);
  const subjectUlt = match && subject !== null ? ultOf(match.players.find(p => p.slot === subject)?.hero ?? -1) : null;
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
      {auto !== 'opening' && <a href="/deadlock/review">Pick one</a>}</p></div>
  );
  const me = coach.mine !== null ? match.players.find(p => p.slot === coach.mine)! : null;
  const who = match.players.find(p => p.slot === subject) ?? null;
  const watch = (t: number) => { useDl.getState().setTime(Math.max(0, t - 4)); useDl.getState().setPlaying(false); navigate({ page: 'deadlock', mode: 'review' }); };
  const nameOf = (slot: number) => { const p = match.players.find(x => x.slot === slot)!; return names[p.account]?.name ?? heroOf(p.hero).name; };
  // the graded player's moves (everyone's when nobody is picked)
  const myMoves = subject !== null ? coach.all.filter(m => m.slot === subject) : coach.all;

  return (
    <div className="report dl-report">
      <header className="recap-head" style={who && heroArt(who.hero) ? { '--map-art': `url(${heroArt(who.hero)})`, '--hero-tint': heroOf(who.hero).color } as React.CSSProperties : undefined}>
        <div className="recap-head-main">
          <h1 className="recap-map display">Deadlock <span className="sr-only">{teamKills(match, 0)}–{teamKills(match, 1)}</span></h1>
          <span className="recap-score display">
            <b style={{ color: TEAM_COLOR[0] }}>{teamKills(match, 0)}</b><i>–</i><b style={{ color: TEAM_COLOR[1] }}>{teamKills(match, 1)}</b>
          </span>
          <span className="muted">kills</span>
          {me && <span className={`recap-result ${match.winner === me.team ? 'victory' : 'defeat'}`}>{match.winner === me.team ? 'Victory' : 'Defeat'}</span>}
          <button className="ghost small-btn recap-close" onClick={closeDlMatch}><Icon name="close" size={13} /> Close match</button>
        </div>
        <p className="muted">Match {match.id} · {mins(match.duration)} · {TEAM_NAME[match.winner]} won{me ? ` · you: ${heroOf(me.hero).name}` : ''}</p>
        {who && (
          <div className="dl-subject">
            {heroOf(who.hero).card && <img src={heroOf(who.hero).card!} alt="" width={44} height={44} />}
            <div className="dl-subject-who">
              <b>{nameOf(who.slot)}{who.slot === coach.mine ? ' (you)' : ''}</b>
              <span className="muted small">{heroOf(who.hero).name}{card?.pos ? <span className={`dl-pos p${card.pos}`}>Pos {card.pos}</span> : null}</span>
            </div>
            {card && card.overall !== null && <span className="dl-subject-grade"><ScoreRing score={card.overall} note={card.note} size={56} /><b title="The match grade: 50 is average for the hero and position">{letterOf(card.overall)}</b></span>}
            <div className="dl-subject-stats">
              <span><b className="num">{who.kills}/{who.deaths}/{who.assists}</b><i>K/D/A</i></span>
              <span><b className="num"><CountUp text={`${(who.netWorth / 1000).toFixed(1)}k`} id={`${match.id}:${who.slot}:nw`} /></b><i>souls</i></span>
              <span><b className="num"><CountUp text={String(who.lastHits)} id={`${match.id}:${who.slot}:lh`} /></b><i>last hits</i></span>
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
          {/* the report card is the overview's top (it was its own tab) */}
          {card && who && <Grades card={card} match={match} name={nameOf(who.slot)} hero={heroOf(who.hero).name} moves={coach.all} watch={watch} level={level} pickLevel={pickLevel} />}
          {card && subject !== null && <DlDuo match={match} a={subject} card={card} nameOf={nameOf} moves={coach.all} />}
          <div className="dl-ov-charts">
            <WinChance match={match} team={who?.team ?? 0} watch={watch} />
            <TeamSouls match={match} team={who?.team ?? 0} />
          </div>
          <Moments moves={[...myMoves, ...(review ? engineMoves(review, myMoves) : [])]} watch={watch} />
        </>
      )}
      {tab === 'scoreboard' && <Scoreboard match={match} subject={subject} mine={coach.mine} nameOf={nameOf} pick={slot => setPick(slot)} />}
      {tab === 'build' && who && (
        <>
          <Economy match={match} slot={who.slot} watch={watch} />
          <Items match={match} slot={who.slot} />
          <Abilities match={match} slot={who.slot} card={card} watch={watch} />
        </>
      )}
      {tab === 'coach' && (
        <>
          {review && who && <EngineCard review={review} watch={watch} who={nameOf(who.slot)} ult={subjectUlt} uses={ults?.uses ?? null} />}
          <Coach moves={myMoves} watch={watch} who={who ? nameOf(who.slot) : 'everyone'} />
          {who && <Positioning match={match} slot={who.slot} watch={watch} />}
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

/** The engine's verdicts and best calls as moments for the lists (not where the coach already marked something). */
function engineMoves(r: EngineReview, coach: DlMove[]): DlMove[] {
  const free = (t: number) => !coach.some(c => Math.abs(c.t - t) < 20);
  const t3 = DL_SEARCH.thresholds?.[3] ?? 0.035;
  const as = (x: EngineMove, note: DlMove['note']): DlMove => ({ t: x.t, slot: x.slot, team: x.team, kind: 'engine', note, title: x.title, why: x.why, tags: [] });
  return [
    ...r.worst.filter(x => (x.cls === 'Mistake' || x.cls === 'Blunder') && free(x.t)).map(x => as(x, x.cls === 'Blunder' ? '??' : '?')),
    ...r.best.filter(x => free(x.t)).map(x => as(x, x.margin > t3 ? '!!' : '!')),
  ];
}

/**
 * The engine on the graded player: accuracy (like chess.com's: a typical Phantom-and-up game is 90), how many moves fell
 * in each class, and the costliest moves and the best calls with what the search saw.
 */
const ULT_VERDICT: Record<UltVerdict, { label: string; color: string }> = {
  great: { label: 'Great', color: SEARCH_COLOR.Best }, good: { label: 'Good', color: SEARCH_COLOR.Good }, ok: { label: 'OK', color: SEARCH_COLOR.Inaccuracy }, wasted: { label: 'Wasted', color: SEARCH_COLOR.Mistake },
};
function EngineCard({ review, watch, who, ult, uses }: { review: EngineReview; watch: (t: number) => void; who: string; ult: UltInfo | null; uses: UltUse[] | null }) {
  const demoRead = !!useDl(s => s.demo);
  const [all, setAll] = useState(false);
  const shown = all ? review.worst : review.worst.slice(0, 4);
  const CLASSES: SearchClass[] = ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];
  const row = (x: EngineMove) => (
    <li key={x.t} className="moment-card" style={{ '--cls': SEARCH_COLOR[x.cls] } as React.CSSProperties}>
      <span className="dl-engine-cls" style={{ background: SEARCH_COLOR[x.cls] }}>{x.cls}</span>
      <span className="dl-move-text"><b>{x.title.replace(/^[^:]+: /, '')}</b>{x.why.map((w, i) => <span key={i} className="muted small">{w}</span>)}</span>
      <span className="num muted">{mins(x.t)}</span>
      <button className="chip" onClick={() => watch(x.t)}>Watch</button>
    </li>
  );
  return (
    <section className="recap-card dl-engine">
      <h3>Engine ({who})</h3>
      <div className="dl-engine-head">
        <div className="dl-engine-acc" title={`Accuracy: how close every move came to the coach's best, like chess.com's. A typical Phantom-and-up player's game is 90. ${review.moves.length} moves, one every 20 s alive.`}>
          <b className="num">{Math.round(review.accuracy)}</b><span className="muted small">accuracy</span>
        </div>
        <ul className="dl-engine-counts">
          {CLASSES.map(c => <li key={c}><i style={{ background: SEARCH_COLOR[c] }} /><span>{c}</span><b className="num">{review.counts[c]}</b></li>)}
        </ul>
      </div>
      {review.worst.length > 0 && (
        <>
          <h4>Costliest moves</h4>
          <ul className="dl-engine-moves">{shown.map(row)}</ul>
          {review.worst.length > 4 && <button className="link-btn small" onClick={() => setAll(!all)}>{all ? 'Fewer' : `All ${review.worst.length}`}</button>}
        </>
      )}
      {review.best.length > 0 && (
        <>
          <h4>Best calls</h4>
          <ul className="dl-engine-moves">{review.best.slice(0, 3).map(row)}</ul>
        </>
      )}
      {ult && (
        <>
          <h4>Ultimate: {ult.name}</h4>
          <p className="dl-engine-ult">{ult.does} <span className="muted">Worth using: {ult.use.charAt(0).toLowerCase() + ult.use.slice(1)}</span></p>
          {uses === null ? <p className="muted small">Each time it was used shows once the match's demo is read (Review reads it).</p>
            : !uses.length ? <p className="muted small">Not used this match{ult.effects.includes('revive') ? ' (it goes off on its own)' : ''}.</p> : (
              <ul className="dl-engine-moves">
                {uses.map(u => (
                  <li key={u.t}>
                    <span className="dl-engine-cls" style={{ background: ULT_VERDICT[u.verdict].color }}>{ULT_VERDICT[u.verdict].label}</span>
                    <span className="dl-move-text"><b>{u.text}</b></span>
                    <span className="num muted">{mins(u.t)}</span>
                    <button className="chip" onClick={() => watch(u.t)}>Watch</button>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
      <p className="muted small">The coach looks 20 s ahead: the best options good players take here, what the enemy would likely do, and the win chance after. {ULTS_IN ? (demoRead ? 'Ultimates ready count in its fights.' : 'Ultimates count once the demo is read.') : demoRead ? 'It names the ultimates ready in fights; being ready barely changed who won fights, so they don\'t change its odds.' : 'Read the demo for ultimates.'} It sees enemies you might not have.</p>
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
/** A 0–100 grade as a letter, as CS2's (S+ … F), so both games show "B · 63". */
export const letterOf = (score: number) => (score >= 85 ? 'S+' : score >= 75 ? 'S' : score >= 62 ? 'A' : score >= 50 ? 'B' : score >= 40 ? 'C' : score >= 30 ? 'D' : 'F');

/** The card in one line: "A strong game: …", for the grades and the recap's head. */
function cardVerdict(card: ReportCard): string {
  const scored = card.parts.filter(p => p.score !== null);
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0], worst = [...scored].sort((a, b) => a.score! - b.score!)[0];
  return !best ? 'Not enough data to grade this match.'
    : card.overall! >= 62 ? `A strong game: ${PRAISE[best.key]}.` : card.overall! >= 45 ? `An average game: ${PRAISE[best.key]}, ${worst.label.toLowerCase()} held it back.` : `A rough game: ${worst.label.toLowerCase()} cost the most${best.score! >= 55 ? `, though ${PRAISE[best.key]}` : ''}.`;
}

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
  const verdict = cardVerdict(card);
  const jump = (key: GradeKey) => document.getElementById(`grade-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <>
      <section className="recap-card dl-rc-head">
        <div className="dl-rc-main">
          <ScoreRing score={card.overall} note={card.note} size={104} />
          <div>
            <span className="muted small">{name}'s report card · {hero}{card.pos ? ` · Pos ${card.pos}` : ''}</span>
            <p className="dl-rc-verdict">{verdict}</p>
            <span className="muted small" title={`50 is an average game for ${hero} in this position ${level === 'high' ? 'among Phantom+ players' : ''} (${src.matches.toLocaleString()} ${level === 'high' ? 'high-rank' : 'public'} matches since the patch)`}>{overallRank ? `Overall ${ORD(overallRank.n)} of ${overallRank.of}` : '50 = average'}</span>
            {HAS_HIGH && (
              <span className="dl-level" role="group" aria-label="Compare with">
                <span className="muted small">Compare with</span>
                <button className={`chip ${level === 'all' ? 'on' : ''}`} onClick={() => pickLevel('all')}>Everyone</button>
                <button className={`chip ${level === 'high' ? 'on' : ''}`} onClick={() => pickLevel('high')}>Phantom+</button>
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="dl-rc-tiles">
        {card.parts.map(p => {
          const r = rankOf(p.score, c => c.parts.find(x => x.key === p.key)?.score ?? null);
          return (
            <button key={p.key} className="dl-rc-tile" onClick={() => jump(p.key)} title={p.summary}>
              <span className="dl-rc-tile-top"><ScoreRing score={p.score} note={p.note} size={44} /><b>{p.label}</b></span>
              <span className="dl-rc-bar"><i style={{ width: `${p.score ?? 0}%`, background: p.score === null ? 'transparent' : p.note === 'book' ? 'var(--text-2)' : NOTE_INFO[p.note].color }} /></span>
              <span className="muted small">{p.score === null ? 'not graded' : r ? `${ORD(r.n)} of ${r.of} for ${p.label.toLowerCase()}` : ''}</span>
            </button>
          );
        })}
      </div>

      {/* the same top row as the CS2 recap: the costliest moment, the best play, what to fix next (each one leads somewhere) */}
      {(() => {
        const mine = moves.filter(m => m.slot === card.slot && m.win && m.kind !== 'laning');
        const costly = [...mine].filter(m => m.win!.swing < -0.01).sort((x, y) => x.win!.swing - y.win!.swing)[0];
        const top = [...mine].filter(m => m.win!.swing > 0.01).sort((x, y) => y.win!.swing - x.win!.swing)[0];
        const pts = (m: DlMove) => `${m.win!.swing >= 0 ? '+' : '−'}${Math.abs(Math.round(m.win!.swing * 100))}% win chance`;
        return (
          <section className="top3">
            <div className="top3-card leak"><span className="eyebrow">Costliest moment</span>
              {costly ? <><b>{costly.title.replace(/^[^:]+: /, '')}</b><span className="muted small">{mins(costly.t)} · {pts(costly)}</span><button className="cta small-btn" onClick={() => watch(costly.t)}><Icon name="play" size={12} /> Watch</button></> : <span className="muted">No costly moment. Clean game.</span>}
            </div>
            <div className="top3-card best"><span className="eyebrow">Best play</span>
              {top ? <><b>{top.title.replace(/^[^:]+: /, '')}</b><span className="muted small">{mins(top.t)} · {pts(top)}</span><button className="cta small-btn" onClick={() => watch(top.t)}><Icon name="play" size={12} /> Watch</button></> : <span className="muted">No big swing in your favour this time.</span>}
            </div>
            <div className="top3-card fix"><span className="eyebrow">Fix next</span>
              {worst ? <><b>{worst.label}</b><span className="muted small">{FOCUS[worst.key]}</span><button className="cta small-btn" onClick={() => jump(worst.key)}>See why</button></> : <span className="muted">Nothing stands out.</span>}
            </div>
          </section>
        );
      })()}

      {card.parts.map(p => {
        const facts = p.lines.filter(l => l.t === undefined), moments = p.lines.filter(l => l.t !== undefined);
        const r = rankOf(p.score, c => c.parts.find(x => x.key === p.key)?.score ?? null);
        return (
          <section key={p.key} id={`grade-${p.key}`} className="recap-card dl-grade">
            <div className="dl-grade-head">
              <ScoreRing score={p.score} note={p.note} size={40} />
              <span className="dl-grade-title"><h3>{p.label}</h3><span className="muted small">{p.summary}</span></span>
              {p.note !== 'book' && <MarkFace note={p.note} size={22} className="dl-card-mark" />}
              {r && <span className="dl-grade-rank muted small">{ORD(r.n)} of {r.of} in the match</span>}
            </div>
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
  // what each does, its numbers and upgrade tiers (the books); against them when the graded player is on the other team
  const player = match.players.find(p => p.slot === slot);
  const info = useMemo(() => (player ? abilitiesOf(player.hero) : []), [player]);
  const mine = useMySlot(), enemy = mine !== null && match.players.find(p => p.slot === mine)?.team !== player?.team;
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
              {(() => {
                const a = info.find(x => x.name === r.a.name);
                if (!a) return null;
                return (
                  <details className="dl-abil-info">
                    <summary>What it does</summary>
                    <p>{a.book?.does ?? a.text}{a.book?.unsure ? <span className="muted"> (the game data had no text for this one: written from its numbers, to check)</span> : null}</p>
                    {enemy && a.book && <p><b>Against it:</b> {a.book.against}</p>}
                    {a.numbers.length > 0 && <p className="muted small">{a.cd ? `Cooldown ${a.cd} s · ` : ''}{a.numbers.join(' · ')}</p>}
                    {a.tiers.length > 0 && (
                      <ol className="dl-abil-tiers">
                        {a.tiers.map((t, i) => <li key={i} className={i < r.upgrades.length ? 'got' : ''}><span>Tier {i + 1}{i < r.upgrades.length ? ' (bought)' : ''}</span>{t.join(', ') || '–'}</li>)}
                      </ol>
                    )}
                  </details>
                );
              })()}
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


/** Duo review: the graded player's report card next to a friend's from the same match (the better score lit). */
function DlDuo({ match, a, card, nameOf, moves }: { match: DlMatch; a: number; card: ReportCard; nameOf: (slot: number) => string; moves: DlMove[] }) {
  const demo = useDl(s => s.demo);
  const me = match.players.find(p => p.slot === a)!;
  const [bSlot, setB] = useState<number | null>(null);
  const others = match.players.filter(p => p.slot !== a);
  // by default the enemy in the same position (your lane opposite), else any enemy
  const myPos = matchPosition(match, a);
  const b = others.find(p => p.slot === bSlot) ?? others.find(p => p.team !== me.team && matchPosition(match, p.slot) === myPos) ?? others.find(p => p.team !== me.team)!;
  const other = useMemo(() => reportCard(match, b.slot, demo, moves), [match, b.slot, demo, moves]);
  const cell = (x: number | null, y: number | null, fmt = (v: number) => String(v)) => <td className={x !== null && y !== null && x > y ? 'hi' : ''}>{x === null ? '–' : fmt(x)}</td>;
  const k = (v: number) => `${(v / 1000).toFixed(1)}k`;
  return (
    <section className="recap-card duo">
      <div className="duo-head">
        <h3>Side by side</h3>
        <label className="muted small">with <select value={b.slot} onChange={e => setB(Number(e.target.value))}>{others.map(p => <option key={p.slot} value={p.slot}>{nameOf(p.slot)} · {heroOf(p.hero).name}{p.team === me.team ? ' (teammate)' : ' (enemy)'}</option>)}</select></label>
      </div>
      <table className="duo-table">
        <thead><tr><th /><th>{nameOf(a)} · {heroOf(me.hero).name}</th><th>{nameOf(b.slot)} · {heroOf(b.hero).name}</th></tr></thead>
        <tbody>
          <tr><td>K / D / A</td><td>{me.kills}/{me.deaths}/{me.assists}</td><td>{b.kills}/{b.deaths}/{b.assists}</td></tr>
          <tr><td>Souls</td>{cell(me.netWorth, b.netWorth, k)}{cell(b.netWorth, me.netWorth, k)}</tr>
          <tr><td>Overall (50 is average for the hero and position)</td>{cell(card.overall, other.overall)}{cell(other.overall, card.overall)}</tr>
          {card.parts.map(p => { const q = other.parts.find(x => x.key === p.key)?.score ?? null; return <tr key={p.key}><td>{p.label}</td>{cell(p.score, q)}{cell(q, p.score)}</tr>; })}
        </tbody>
      </table>
    </section>
  );
}
