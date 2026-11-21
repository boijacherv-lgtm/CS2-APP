import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Collapse } from '../ui/Collapse';
import { CountUp } from '../ui/CountUp';
import { MarkFace } from '../ui/MarkFace';
import { ScoreRing } from '../ui/ScoreRing';
import { LETTER_COLOR, LETTERS, NOTE_INFO, type Letter } from '../engine/recap';
import { navigate } from '../shell/router';
import { AreaChart, BarList } from '../site/charts';
import { Icon, type IconName } from '../ui/Icon';
import { itemTimings, TIMING_MARGIN, typicalTiming } from './api';
import type { D2Move, D2Tag } from './coach';
import { abilityById, buildingOf, heroOf, itemById, itemByKey, mins, skillLook, TEAM_COLOR, TEAM_NAME, type D2Team } from './data';
import { TalentTree } from './D2Talents';
import { useLiveGameData, useMapLayout } from './gameData';
import { GRADE_LEGEND, gradeMatch, type ChapterKind, type MatchGrades } from './grades';
import { NORM_SAMPLE, supportNumbers, supportsOf, teamPlayLetter, visionLetter } from './support';
import { clashes, keyFacts, laneResults, SWING_MINUTES, type D2Match } from './match';
import { reportCard, type D2Card, type PartKey } from './reportCard';
import { useD2 } from './store';
import { useCoach } from './useCoach';
import '../deadlock/dl.css';
import './d2.css';

// the same tabs, in the same order, as CS2's and Deadlock's recaps (Overview · Coach · Scoreboard · Timeline · Economy), then this game's own
type Tab = 'overview' | 'coach' | 'scoreboard' | 'timeline' | 'economy' | 'draft' | 'chat';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'coach', label: 'Coach', icon: 'chat' }, { id: 'scoreboard', label: 'Scoreboard', icon: 'list' },
  { id: 'timeline', label: 'Timeline', icon: 'grid' }, { id: 'economy', label: 'Economy', icon: 'coins' },
  { id: 'draft', label: 'Draft & lanes', icon: 'friends' }, { id: 'chat', label: 'Chat', icon: 'chat' },
];
/** What each kind of mistake means, and what to do instead (the coach's lessons). */
const LESSON: Partial<Record<D2Tag, { title: string; fix: string }>> = {
  'PICKED OFF': { title: 'Caught alone', fix: 'Check the map before you farm alone: with enemies missing, move with a teammate or stay near your towers and vision.' },
  OUTNUMBERED: { title: 'Fights you were outnumbered in', fix: 'Count heroes before you commit: back off when two or more of yours aren\'t there yet.' },
  'SAVE UNUSED': { title: 'Died with a saving item ready', fix: 'Use it early: Black King Bar or Blink helps before the stun lands, not after. Put it where your hand finds it.' },
  EXPENSIVE: { title: 'Deaths that cost a lot of gold', fix: 'The more you carry, the more a death hands over. Spend your gold before risky moves, and keep buyback in mind.' },
  'COST OBJECTIVE': { title: 'Deaths that cost a building or Roshan', fix: 'Before a push or a Roshan timing, stay alive: being there to defend is worth more than one kill.' },
  'LANE LOST': { title: 'Behind after laning', fix: 'Fix the lane first: last hits, denies, and pulling or calling for a rotation when it\'s pushed against you.' },
};
/** OpenDota's benchmarks: the share of players on this hero you beat. */
const BENCH: [string, string][] = [['gold_per_min', 'Gold per minute'], ['xp_per_min', 'XP per minute'], ['last_hits_per_min', 'Last hits per minute'], ['hero_damage_per_min', 'Hero damage per minute'], ['tower_damage', 'Tower damage'], ['hero_healing_per_min', 'Healing per minute']];

/** A hero's landscape art, for the recap's header. */
const heroArt = (key: string) => (key ? `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${key.replace('npc_dota_hero_', '')}.png` : null);

/** Dota 2's Match recap, as Deadlock's: the result and the graded player, their report card, the coach, the scoreboard, the timeline. */
export function D2Report() {
  useLiveGameData();
  const match = useD2(s => s.match);
  const coach = useCoach();
  const [tab, setTab] = useState<Tab>('overview');
  const tracks = useD2(s => (s.replay.status === 'ready' ? s.replay.tracks : null));
  useMapLayout(match ?? null, tracks);
  const grades = useMemo(() => (match?.parsed ? gradeMatch(match, coach.all, tracks) : null), [match, coach.all, tracks]);
  // whose recap: yours when you played in it, else the player picked here, else the match's best
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { setPick(null); }, [match?.id]);
  const subject = pick ?? coach.mine ?? grades?.best ?? 0;
  const card = useMemo(() => (match && grades ? reportCard(match, grades, coach.all, subject) : null), [match, grades, coach.all, subject]);
  if (!match) return <div className="page"><p className="muted">No match open. <a href="/dota2/review">Pick one</a></p></div>;
  const who = match.players[subject], h = heroOf(who.hero);
  const watch = (t: number) => { useD2.getState().setTime(t - 8); useD2.getState().setPlaying(false); navigate({ page: 'dota2', mode: 'review' }); };
  const nameOf = (slot: number) => match.players[slot].name ?? heroOf(match.players[slot].hero).name;
  const moves = coach.all.filter(m => m.slot === subject);
  const kills = (team: D2Team) => match.players.filter(p => p.team === team).reduce((a, p) => a + p.kills, 0);
  const art = heroArt(h.key);

  return (
    <div className="report d2-report">
      <header className="recap-head" style={art ? { '--map-art': `url(${art})` } as CSSProperties : undefined}>
        <div className="recap-head-main">
          <h1 className="recap-map display">Dota 2 <span className="sr-only">{kills(0)}–{kills(1)}</span></h1>
          <span className="recap-score display">
            <b style={{ color: TEAM_COLOR[0] }}><CountUp text={String(kills(0))} id={`${match.id}:k0`} /></b><i>–</i><b style={{ color: TEAM_COLOR[1] }}><CountUp text={String(kills(1))} id={`${match.id}:k1`} /></b>
          </span>
          <span className="muted">kills</span>
          {coach.mine !== null && <span className={`recap-result ${match.winner === match.players[coach.mine].team ? 'victory' : 'defeat'}`}>{match.winner === match.players[coach.mine].team ? 'Victory' : 'Defeat'}</span>}
          <button className="ghost small-btn recap-close" onClick={() => { useD2.getState().close(); navigate({ page: 'dota2', mode: 'review' }); }}><Icon name="close" size={13} /> Close match</button>
        </div>
        <p className="muted">Match {match.id} · {mins(match.duration)} · <span style={{ color: TEAM_COLOR[0] }}>{match.names[0]}</span> vs <span style={{ color: TEAM_COLOR[1] }}>{match.names[1]}</span> · {match.names[match.winner]} won</p>
        <div className="dl-subject">
          {h.icon && <img src={h.icon} alt="" width={44} height={44} />}
          <div className="dl-subject-who">
            <b>{nameOf(subject)}{subject === coach.mine ? ' (you)' : ''}</b>
            <span className="muted small">{h.name}{subject === grades?.best ? <span className="d2-mvp">MVP</span> : null}</span>
          </div>
          <div className="dl-subject-stats">
            <span><b className="num">{who.kills}/{who.deaths}/{who.assists}</b><i>K/D/A</i></span>
            <span><b className="num"><CountUp text={`${(who.netWorth / 1000).toFixed(1)}k`} id={`${match.id}:${subject}:nw`} /></b><i>net worth</i></span>
            <span><b className="num"><CountUp text={String(who.lastHits)} id={`${match.id}:${subject}:lh`} /></b><i>last hits</i></span>
            <span><b className="num"><CountUp text={String(who.gpm)} id={`${match.id}:${subject}:gpm`} /></b><i>gold / min</i></span>
            <span className={`dl-subject-result ${match.winner === who.team ? 'won' : 'lost'}`}>{match.winner === who.team ? 'Won' : 'Lost'}</span>
          </div>
          <label className="dl-subject-pick">
            <span className="muted small">Graded player</span>
            <select value={subject} onChange={e => setPick(Number(e.target.value))}>
              {match.players.map(p => <option key={p.slot} value={p.slot}>{nameOf(p.slot)} · {heroOf(p.hero).name}{p.slot === coach.mine ? ' (you)' : ''}</option>)}
            </select>
          </label>
        </div>
      </header>

      <nav className="recap-tabs" aria-label="Recap">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
      </nav>

      {!match.parsed && tab !== 'scoreboard' && <p className="muted">This match hasn't been parsed: only the scoreboard is available. You can ask OpenDota to parse it in Review.</p>}
      {match.parsed && tab === 'overview' && (
        <>
          {card && <ReportCardView card={card} match={match} name={nameOf(subject)} moves={moves} all={grades} watch={watch} />}
          <Facts match={match} grades={grades} subject={subject} watch={watch} />
          {grades && <Collapse title="Everyone's grades" hint="the letters, support play, every moment"><Grades match={match} grades={grades} mine={subject} watch={watch} /></Collapse>}
          <Collapse title="Gold" hint="the lead over the match"><GoldLead match={match} team={who.team} /></Collapse>
          <Collapse title="Key moments" hint="the worst and the best"><KeyMoments moves={moves} watch={watch} /></Collapse>
          {who.bench && Object.keys(who.bench).length > 0 && (
            <Collapse title={`Against others on ${h.name}`} hint="OpenDota's benchmarks">
              <section className="recap-card">
                <p className="muted small">The share of players on this hero {nameOf(subject)} did better than.</p>
                <BarList rows={BENCH.filter(([k]) => who.bench![k] !== undefined).map(([k, label]) => ({ label, value: `${Math.round(who.bench![k] * 100)}%`, share: who.bench![k], tone: who.bench![k] >= 0.6 ? 'up' as const : who.bench![k] >= 0.4 ? 'flat' as const : 'down' as const }))} />
              </section>
            </Collapse>
          )}
        </>
      )}
      {match.parsed && tab === 'coach' && (
        <>
          <Coach moves={moves} watch={watch} who={nameOf(subject)} />
          <details className="recap-card kill-log"><summary><h3 aria-level={2}>Every moment</h3> <span className="muted">{moves.length} graded</span></summary>
            <MoveList moves={moves} watch={watch} />
          </details>
        </>
      )}
      {tab === 'scoreboard' && <Scoreboard match={match} mine={subject} />}
      {match.parsed && tab === 'timeline' && (
        <>
          <Objectives match={match} watch={watch} />
          <Collapse title="Fights" hint="three deaths or more close together" open><Fights match={match} team={who.team} watch={watch} /></Collapse>
        </>
      )}
      {match.parsed && tab === 'economy' && (
        <>
          <Items match={match} mine={subject} />
          <Collapse title="Skills and talents" hint="the order they were taken"><Skills match={match} mine={subject} /></Collapse>
        </>
      )}
      {match.parsed && tab === 'draft' && <DraftAndLanes match={match} />}
      {tab === 'chat' && <Chat match={match} watch={watch} />}
    </div>
  );
}

const ORD = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const TONE_COLOR = { up: 'var(--good)', down: 'var(--bad)', flat: 'var(--text-3)' } as const;
/** What to do about each part when it's the weakest. */
const FOCUS: Record<PartKey, string> = {
  fights: 'Fight with your team: come in after the first stun, and back off from a fight your side is already losing.',
  lane: 'Fix the lane first: last hits and denies, and call for a rotation or pull when it\'s pushed against you.',
  vision: 'Ward where pros do (Meta → Patch has the spots), keep wards alive with sentries nearby, and clear theirs.',
  team: 'Use your stuns and saves on your cores, stack camps between waves, and rotate to the lane that needs you.',
  survival: 'Before you farm alone, count the enemies on the map, and use your saving item before the stun, not after.',
};
const PRAISE: Record<PartKey, string> = {
  fights: 'won the fights', lane: 'won the lane', vision: 'gave the team vision', team: 'played for the team', survival: 'stayed alive',
};
function verdictOf(card: D2Card): string {
  const scored = card.parts.filter(p => p.score !== null);
  const best = [...scored].sort((a, b) => b.score! - a.score!)[0], worst = [...scored].sort((a, b) => a.score! - b.score!)[0];
  if (!best || card.overall === null) return 'Not enough of the match to grade.';
  return card.overall >= 62 ? `A strong game: ${PRAISE[best.key]}.` : card.overall >= 45 ? `An average game: ${PRAISE[best.key]}, ${worst.label.toLowerCase()} held it back.`
    : `A rough game: ${worst.label.toLowerCase()} cost the most${best.score! >= 55 ? `, though ${PRAISE[best.key]}` : ''}.`;
}

/**
 * The report card, as Deadlock's: the overall score with a verdict and rank in the match, the five parts as tiles (one
 * opens below them with its moments), and the costliest moment, best play and what to fix next.
 */
function ReportCardView({ card, match, name, moves, all, watch }: { card: D2Card; match: D2Match; name: string; moves: D2Move[]; all: MatchGrades | null; watch: (t: number) => void }) {
  const coach = useCoach();
  const everyone = useMemo(() => (all ? match.players.map(p => reportCard(match, all, coach.all, p.slot)) : []), [match, all, coach.all]);
  const rankOf = (score: number | null, pick: (c: D2Card) => number | null) => {
    if (score === null) return null;
    const xs = everyone.map(pick).filter((x): x is number => x !== null);
    return { n: xs.filter(x => x > score).length + 1, of: xs.length };
  };
  const scored = card.parts.filter(p => p.score !== null);
  const worst = [...scored].sort((a, b) => a.score! - b.score!)[0];
  const overallRank = rankOf(card.overall, c => c.overall);
  const [openKey, setOpenKey] = useState<PartKey | null>(null);
  useEffect(() => { setOpenKey(null); }, [card.slot]);
  const jump = (key: PartKey) => { setOpenKey(key); setTimeout(() => document.getElementById(`grade-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30); };
  const p = match.players[card.slot];
  const rank = (m: D2Move) => ({ '??': 0, '?': 1, '!!': 0, '!': 1 } as Record<string, number>)[m.note] ?? 2;
  const costly = moves.filter(m => m.note === '??' || m.note === '?').sort((a, b) => rank(a) - rank(b) || a.t - b.t)[0];
  const top = moves.filter(m => m.note === '!!' || m.note === '!').sort((a, b) => rank(a) - rank(b) || a.t - b.t)[0];
  return (
    <>
      <section className="recap-card dl-rc-head">
        <div className="dl-rc-main">
          <ScoreRing score={card.overall} note={card.note} size={104} />
          <div>
            <span className="muted small">{name}'s report card · {heroOf(p.hero).name}</span>
            <p className="dl-rc-verdict">{verdictOf(card)}</p>
            <span className="muted small" title="50 is a typical game: a B. From the grades of every moment, the KDA and the result; supports also by their vision and team play.">
              {overallRank ? `Overall ${ORD(overallRank.n)} of ${overallRank.of}` : '50 = a typical game'}
            </span>
          </div>
        </div>
      </section>

      <div className="dl-rc-tiles">
        {card.parts.map(part => {
          const r = rankOf(part.score, c => c.parts.find(x => x.key === part.key)?.score ?? null);
          return (
            <button key={part.key} className={`dl-rc-tile ${openKey === part.key ? 'on' : ''}`} onClick={() => (openKey === part.key ? setOpenKey(null) : jump(part.key))} aria-expanded={openKey === part.key} title={part.summary}>
              <span className="dl-rc-tile-top"><ScoreRing score={part.score} note={part.note} size={44} /><b>{part.label}</b></span>
              <span className="dl-rc-bar"><i style={{ width: `${part.score ?? 0}%`, background: part.score === null ? 'transparent' : part.note === 'book' ? 'var(--text-2)' : NOTE_INFO[part.note].color }} /></span>
              <span className="muted small">{part.score === null ? 'not graded' : r ? `${ORD(r.n)} of ${r.of}` : ''}</span>
            </button>
          );
        })}
      </div>

      {card.parts.filter(part => part.key === openKey).map(part => {
        const facts = part.lines.filter(l => l.t === undefined), moments = part.lines.filter(l => l.t !== undefined);
        const r = rankOf(part.score, c => c.parts.find(x => x.key === part.key)?.score ?? null);
        return (
          <section key={part.key} id={`grade-${part.key}`} className="recap-card dl-grade">
            <div className="dl-grade-head">
              <ScoreRing score={part.score} note={part.note} size={40} />
              <span className="dl-grade-title"><h3 aria-level={2}>{part.label}</h3></span>
              {part.note !== 'book' && <MarkFace note={part.note} size={22} className="dl-card-mark" />}
              {r && <span className="dl-grade-rank muted small">{ORD(r.n)} of {r.of} in the match</span>}
              <button className="ghost small-btn" onClick={() => setOpenKey(null)} aria-label={`Close ${part.label}`}><Icon name="close" size={14} /></button>
            </div>
            <p className="muted small dl-grade-sum">{part.summary}</p>
            {facts.length > 0 && <ul className="dl-grade-facts">{facts.map((l, i) => <li key={i} className={`t-${l.tone ?? 'flat'}`}>{l.text}</li>)}</ul>}
            {moments.length > 0 && (
              <>
                <h4 aria-level={3}>Moments</h4>
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
            {!part.lines.length && <p className="empty-state">{part.score === null ? 'Not graded for this player: it\'s a support\'s job, or the match didn\'t show it.' : 'Nothing more to show.'}</p>}
          </section>
        );
      })}

      <section className="top3">
        <div className="top3-card leak"><span className="eyebrow">Costliest moment</span>
          {costly ? <><b>{costly.title}</b><span className="muted small">{mins(costly.t)}{costly.why[0] ? ` · ${costly.why[0]}` : ''}</span><button className="cta small-btn" onClick={() => watch(costly.t)}><Icon name="play" size={12} /> Watch</button></> : <span className="muted">No costly moment. Clean game.</span>}
        </div>
        <div className="top3-card best"><span className="eyebrow">Best play</span>
          {top ? <><b>{top.title}</b><span className="muted small">{mins(top.t)}{top.why[0] ? ` · ${top.why[0]}` : ''}</span><button className="cta small-btn" onClick={() => watch(top.t)}><Icon name="play" size={12} /> Watch</button></> : <span className="muted">No standout play this time.</span>}
        </div>
        <div className="top3-card fix"><span className="eyebrow">Fix next</span>
          {worst ? <><b>{worst.label}</b><span className="muted small">{FOCUS[worst.key]}</span><button className="cta small-btn" onClick={() => jump(worst.key)}>See why</button></> : <span className="muted">Nothing stands out.</span>}
        </div>
      </section>
    </>
  );
}

/** The match at a glance: the MVP, the turning point, the richest, the most kills, Roshan. */
function Facts({ match, grades, subject, watch }: { match: D2Match; grades: MatchGrades | null; subject: number; watch: (t: number) => void }) {
  const f = useMemo(() => keyFacts(match), [match]);
  const heroName = (slot: number) => { const p = match.players[slot]; return p.name ?? heroOf(p.hero).name; };
  return (
    <section className="d2-facts" aria-label="The match at a glance">
      {grades && grades.best !== null && (() => {
        const best = grades.players[grades.best], top = LETTERS.slice(0, 3).reduce((a, l) => a + best.counts[l], 0);
        return (
          <div className="d2-fact d2-fact-grade">
            <span className="d2-fact-label">MVP{grades.best === subject ? ' · this player' : ''}</span>
            <b className="d2-fact-grade-row"><span className="d2-match-letter display" style={{ background: LETTER_COLOR[best.letter] }}>{best.letter}</span>{heroOf(match.players[best.slot].hero).name}</b>
            <span className="small muted">{top} of {best.graded} moments at A or better</span>
          </div>
        );
      })()}
      {f.swing && (
        <button className="d2-fact" onClick={() => watch(f.swing!.t)} title="Watch this moment">
          <span className="d2-fact-label">Turning point</span>
          <b className="num">{mins(f.swing.t)}</b>
          <span className="small" style={{ color: TEAM_COLOR[f.swing.team] }}>{match.names[f.swing.team]} +{f.swing.gold.toLocaleString()} gold in {SWING_MINUTES} min</span>
        </button>
      )}
      {f.richest !== null && (
        <div className="d2-fact">
          <span className="d2-fact-label">Richest</span>
          <b>{heroOf(match.players[f.richest].hero).name}</b>
          <span className="small muted">{heroName(f.richest)} · {match.players[f.richest].netWorth.toLocaleString()} gold</span>
        </div>
      )}
      {f.killer !== null && (
        <div className="d2-fact">
          <span className="d2-fact-label">Most kills</span>
          <b>{heroOf(match.players[f.killer].hero).name}</b>
          <span className="small muted">{heroName(f.killer)} · {match.players[f.killer].kills} kills</span>
        </div>
      )}
      <div className="d2-fact">
        <span className="d2-fact-label">Roshan</span>
        <b className="num">{f.roshan[0]} : {f.roshan[1]}</b>
        <span className="small muted">{match.names[0]} : {match.names[1]}</span>
      </div>
    </section>
  );
}

/** The gold lead over the match, from the graded player's side. */
function GoldLead({ match, team }: { match: D2Match; team: D2Team }) {
  const lead = useMemo(() => match.goldAdv.map((v, i) => ({ label: `${i}:00`, value: team === 0 ? v : -v })), [match, team]);
  if (lead.length < 2) return <section className="recap-card"><p className="muted">No gold lead recorded for this match.</p></section>;
  const end = lead[lead.length - 1].value, best = Math.max(...lead.map(x => x.value)), worst = Math.min(...lead.map(x => x.value));
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`;
  return (
    <section className="recap-card">
      <div className="dl-kpis">
        <span><b className="num" style={{ color: end >= 0 ? 'var(--good)' : 'var(--bad)' }}>{sign(end)}</b><i>at the end</i></span>
        <span><b className="num">{best > 0 ? sign(best) : '–'}</b><i>biggest lead</i></span>
        <span><b className="num">{worst < 0 ? sign(worst) : '–'}</b><i>furthest behind</i></span>
      </div>
      <AreaChart points={lead} fmt={sign} height={220} color={TEAM_COLOR[team]} />
    </section>
  );
}

/** The graded player's worst and best moments. */
function KeyMoments({ moves, watch }: { moves: D2Move[]; watch: (t: number) => void }) {
  const rank = (n: string) => ({ '??': 0, '?': 1, '!!': 0, '!': 1 } as Record<string, number>)[n] ?? 2;
  const bad = moves.filter(m => m.note === '?' || m.note === '??').sort((a, b) => rank(a.note) - rank(b.note) || a.t - b.t);
  const good = moves.filter(m => m.note === '!' || m.note === '!!').sort((a, b) => rank(a.note) - rank(b.note) || a.t - b.t);
  return (
    <div className="dl-moments">
      <section className="recap-card"><h3 aria-level={2}>Worst moments</h3>{bad.length ? <MoveList moves={bad.slice(0, 3)} watch={watch} /> : <p className="empty-state">No real mistakes marked.</p>}</section>
      <section className="recap-card"><h3 aria-level={2}>Best moments</h3>{good.length ? <MoveList moves={good.slice(0, 3)} watch={watch} /> : <p className="empty-state">No standout plays marked.</p>}</section>
    </div>
  );
}

const CHAPTER_MARK: Record<ChapterKind, string> = { vision: 'V', team: 'T', lane: 'L', fight: 'F', pick: 'P' };

function LetterChip({ letter, why }: { letter: Letter; why?: string }) {
  return <span className="letter" style={{ background: LETTER_COLOR[letter] }} title={why}>{letter}</span>;
}

/** Everyone's grades: how many of each letter and the match grade, then every moment of the match, as CS2's round grid. */
function Grades({ match, grades, mine, watch }: { match: D2Match; grades: MatchGrades; mine: number | null; watch: (t: number) => void }) {
  const [focus, setFocus] = useState<number | null>(mine ?? grades.best);
  const byTeam = (team: D2Team) => grades.players.filter(g => match.players[g.slot].team === team).sort((a, b) => b.score - a.score);
  const name = (slot: number) => { const p = match.players[slot]; return p.name ?? heroOf(p.hero).name; };
  const ordered = [...byTeam(0), ...byTeam(1)];
  return (
    <>
      <section className="recap-card">
        <h3>Match grades</h3>
        <div className="d2-table-wrap">
          <table className="site-table d2-tier-table">
            <thead>
              <tr>
                <th>Player</th><th>Grade</th>
                {LETTERS.map(l => <th key={l}><LetterChip letter={l} /></th>)}
                <th>Moments</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((g, i) => {
                const p = match.players[g.slot], h = heroOf(p.hero);
                return (
                  <tr key={g.slot} className={`${g.slot === focus ? 'me' : ''} ${i === byTeam(0).length ? 'd2-team-start' : ''}`} onClick={() => setFocus(g.slot)}>
                    <td><span className="dl-sb-hero">{h.icon && <img src={h.icon} alt="" width={22} height={22} />}<b style={{ color: TEAM_COLOR[p.team] }}>{name(g.slot)}</b><span className="muted small">{h.name}</span>{g.slot === grades.best && <span className="d2-mvp">MVP</span>}</span></td>
                    <td><span className="d2-match-letter display" style={{ background: LETTER_COLOR[g.letter] }}>{g.letter}</span></td>
                    {LETTERS.map(l => <td key={l} className={`num ${g.counts[l] ? '' : 'muted'}`}>{g.counts[l] || '·'}</td>)}
                    <td className="num muted">{g.graded}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">The match grade is the average of a player's moments, plus their KDA and a little for winning. Supports also get grades for vision and team play{NORM_SAMPLE.matches ? `, measured against supports in ${NORM_SAMPLE.matches} pro matches, where a typical pro is a B` : ''}; those count for half their match grade, which then compares them with other supports, so an S is as hard to get on a support as on a carry.</p>
      </section>
      <section className="recap-card">
        <h3>Support play</h3>
        <div className="d2-support-cards">
          {([0, 1] as D2Team[]).flatMap(team => supportsOf(match, team)).map(slot => {
            const p = match.players[slot], h = heroOf(p.hero), n = supportNumbers(match, slot), pct = (v: number) => `${Math.round(v * 100)}%`;
            return (
              <article key={slot} className="d2-support-card">
                <header>{h.icon && <img src={h.icon} alt="" width={22} height={22} />}<b style={{ color: TEAM_COLOR[p.team] }}>{name(slot)}</b><span className="muted small">{h.name}</span></header>
                <p><LetterChip letter={visionLetter(n)} /> <b>Vision</b> <span className="muted small">{p.obs} observers, {p.sen} sentries · stood {pct(n.wardLife)} of their life · {pct(n.onSpot)} on pro spots · {p.dewards} enemy wards killed</span></p>
                <p><LetterChip letter={teamPlayLetter(n)} /> <b>Team play</b> <span className="muted small">in {pct(n.killShare)} of kills · {Math.round(p.stuns)} s of stuns · {p.allyCasts} skills on teammates · {p.helpItems} helping items · {p.stacks} stacks</span></p>
              </article>
            );
          })}
        </div>
        <p className="muted small">OpenDota records who a skill was cast on but not who an item was used on, so items count as used, not as saves. Ganks show as an A among the moments once the replay is read: only it says who was where.</p>
      </section>
      <section className="recap-card">
        <h3>Every moment</h3>
        <p className="muted small">Click a name to focus that player · click a grade to watch that moment in Review. <b>V</b> and <b>T</b> are a support's vision and team play, <b>L</b> the lane, <b>F</b> a teamfight, <b>P</b> a pick-off outside one.</p>
        <p className="rg-legend muted">{GRADE_LEGEND.map(([l, t]) => <span key={l}><LetterChip letter={l} /> {t}</span>)}</p>
        <div className="sb-wrap">
          <table className="rg d2-rg">
            <thead>
              <tr>
                <th />
                {grades.chapters.map((c, i) => (
                  <th key={i} style={c.winner !== null ? { borderBottomColor: TEAM_COLOR[c.winner] } : undefined} title={c.title}>
                    <span>{CHAPTER_MARK[c.kind]}</span><i className="num">{c.kind === 'fight' || c.kind === 'pick' ? Math.max(0, Math.floor(c.t / 60)) : ''}</i>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map(g => {
                const p = match.players[g.slot];
                return (
                  <tr key={g.slot} className={g.slot === focus ? 'focus' : ''}>
                    <td className="name" onClick={() => setFocus(g.slot)}><span style={{ color: TEAM_COLOR[p.team] }}>{name(g.slot)}</span></td>
                    {grades.chapters.map((c, i) => {
                      const x = c.grades[g.slot];
                      return (
                        <td key={i} className="cell" onClick={() => { if (c.kind !== 'vision' && c.kind !== 'team') watch(c.kind === 'lane' ? 600 : c.t); }} title={x ? `${c.title}. ${x.why}` : `${c.title}. Not part of it.`}>
                          {x ? <LetterChip letter={x.letter} /> : <span className="muted">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Coach({ moves, watch, who }: { moves: D2Move[]; watch: (t: number) => void; who: string }) {
  const lessons = (Object.keys(LESSON) as D2Tag[]).map(tag => ({ tag, ...LESSON[tag]!, hits: moves.filter(m => m.tags.includes(tag) && (m.note === '?' || m.note === '??' || m.note === '?!')) }))
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
              <span className="coach-rounds">Watch: {l.hits.slice(0, 6).map(h => <button key={`${h.t}-${h.slot}`} onClick={() => watch(h.t)}>{mins(h.t)}</button>)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Fights({ match, team, watch }: { match: D2Match; team: D2Team; watch: (t: number) => void }) {
  const fights = clashes(match);
  if (!fights.length) return <section className="recap-card"><p className="muted">No fights in this match: never three deaths close together.</p></section>;
  const enemy = (1 - team) as D2Team;
  return (
    <section className="recap-card">
      <h3>Fights ({fights.length})</h3>
      <p className="muted small">Three deaths or more close together, seen from {match.names[team]}.</p>
      <ul className="dl-moves">
        {fights.map(f => {
          const swing = f.gold[team] - f.gold[enemy];
          return (
            <li key={f.start}>
              <b className="dl-card-mark" style={{ background: swing >= 0 ? 'var(--good)' : 'var(--bad)' }}>{swing >= 0 ? '+' : '−'}</b>
              <span className="dl-move-text">
                <b>{mins(f.start)}: lost {f.lost[team]}, killed {f.lost[enemy]}</b>
                <span className="muted small">{swing >= 0 ? '+' : '−'}{Math.abs(swing).toLocaleString()} gold swing</span>
              </span>
              <button className="chip" onClick={() => watch(f.start)}>Watch</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Objectives({ match, watch }: { match: D2Match; watch: (t: number) => void }) {
  const rows = [
    ...match.downs.map(d => { const b = buildingOf.get(d.uid)!; return { t: d.t, team: b.team, text: <>lost the <b>{b.name}</b></> }; }),
    ...match.roshan.map(r => ({ t: r.t, team: r.team, text: <>took <b>Roshan</b></> })),
  ].sort((a, b) => a.t - b.t);
  return (
    <section className="recap-card">
      <h3>Objectives</h3>
      <ol className="dl-objectives">
        {rows.map((r, i) => (
          <li key={i}>
            <span className="num muted">{mins(r.t)}</span>
            <span style={{ color: TEAM_COLOR[r.team] }}>{match.names[r.team]}</span> {r.text}
            <button className="chip" onClick={() => watch(r.t)}>Watch</button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DraftAndLanes({ match }: { match: D2Match }) {
  const lanes = laneResults(match);
  const hero = (id: number) => heroOf(id);
  const drafted = match.draft.map((d, i) => ({ ...d, order: i + 1 }));
  // Public games list every ban under one side, though nobody on that side chose them: those belong to neither team.
  const bans = drafted.filter(d => !d.pick), sidedBans = new Set(bans.map(d => d.team)).size > 1;
  const row = (list: typeof drafted, pick: boolean) => (
    <ol className={`d2-draft ${pick ? 'picks' : 'bans'}`} aria-label={pick ? 'Picks' : 'Bans'}>
      {list.map(d => (
        <li key={d.order} className={pick ? 'pick' : 'ban'} title={`${pick ? 'Picked' : 'Banned'} ${hero(d.hero).name}${sidedBans || pick ? `, turn ${d.order}` : ''}`}>
          {hero(d.hero).icon && <img src={hero(d.hero).icon!} alt={hero(d.hero).name} width={pick ? 36 : 24} height={pick ? 36 : 24} />}
          {(sidedBans || pick) && <span className="num muted small">{d.order}</span>}
        </li>
      ))}
    </ol>
  );
  return (
    <>
      <section className="recap-card">
        <h3>Draft</h3>
        {!match.draft.length ? <p className="muted">This game mode had no draft to show.</p> : (
          <>
            <div className="d2-draft-teams">
              {([0, 1] as D2Team[]).map(team => (
                <div key={team} className="d2-draft-team">
                  <b style={{ color: TEAM_COLOR[team] }}>{match.names[team]}</b>
                  {row(drafted.filter(d => d.pick && d.team === team), true)}
                  {sidedBans && row(bans.filter(d => d.team === team), false)}
                </div>
              ))}
            </div>
            {!sidedBans && bans.length > 0 && (
              <div className="d2-draft-pool"><span className="muted small">Banned</span>{row(bans, false)}</div>
            )}
          </>
        )}
      </section>
      <section className="recap-card">
        <h3>Lanes at 10:00</h3>
        <p className="muted small">Net worth of the heroes in each lane; more than 8% ahead counts as won.</p>
        {!lanes.length ? <p className="muted">The match ended too soon, or who played where isn't known.</p> : (
          <ul className="d2-lanes">
            {lanes.map(l => (
              <li key={l.lane}>
                <b>{l.name}</b>
                <span className="d2-lane-heroes">{match.players.filter(p => p.team === 0 && p.lane === l.lane).map(p => heroOf(p.hero).icon && <img key={p.slot} src={heroOf(p.hero).icon!} alt={heroOf(p.hero).name} title={heroOf(p.hero).name} width={24} height={24} />)}</span>
                <span className="num">{Math.round(l.radiant).toLocaleString()}</span>
                <span className="num muted small">vs</span>
                <span className="num">{Math.round(l.dire).toLocaleString()}</span>
                <span className="d2-lane-heroes">{match.players.filter(p => p.team === 1 && p.lane === l.lane).map(p => heroOf(p.hero).icon && <img key={p.slot} src={heroOf(p.hero).icon!} alt={heroOf(p.hero).name} title={heroOf(p.hero).name} width={24} height={24} />)}</span>
                <span style={{ color: l.winner === null ? 'var(--text-2)' : TEAM_COLOR[l.winner] }}><b>{l.winner === null ? 'Even' : `${match.names[l.winner]} won`}</b> <span className="num muted small">{Math.abs(Math.round(l.lead * 100))}%</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** What was said during the match, each line a way back to its moment. */
function Chat({ match, watch }: { match: D2Match; watch: (t: number) => void }) {
  return (
    <section className="recap-card">
      <h3>Chat</h3>
      {!match.chat.length ? <p className="muted">{match.parsed ? 'Nothing in this match\'s chat as OpenDota read it from the replay.' : 'The chat comes with the parsed match.'}</p> : (
        <ol className="d2-chat">
          {match.chat.map((c, i) => {
            const p = c.slot !== null ? match.players[c.slot] : null, h = p ? heroOf(p.hero) : null;
            return (
              <li key={i} className={c.wheel ? 'wheel' : ''}>
                <button className="chip num" onClick={() => watch(c.t)} title="Watch this moment">{mins(c.t)}</button>
                {h?.icon ? <img src={h.icon} alt="" width={22} height={22} /> : <span />}
                <b style={{ color: p ? TEAM_COLOR[p.team] : 'var(--text-3)' }}>{p ? p.name ?? h!.name : c.who ?? 'Someone'}</b>
                <span>{c.text}</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="muted small">As far as OpenDota read it from the replay{match.chat.some(c => c.wheel) ? '. Chat wheel phrases are in italics' : ''}.</p>
    </section>
  );
}

/** Every player's skill order, level by level, and the talents they took. */
function Skills({ match, mine }: { match: D2Match; mine: number | null }) {
  const anyone = match.players.some(p => p.upgrades.length);
  return (
    <section className="recap-card">
      <h3>Skill order</h3>
      {!anyone && <p className="muted">OpenDota has no skill order for this match yet.</p>}
      {anyone && match.players.map(p => {
        const h = heroOf(p.hero), picks = p.upgrades.map(id => abilityById(id));
        const talents = picks.filter(a => a?.talent);
        return (
          <div key={p.slot} className={`d2-order ${p.slot === mine ? 'me' : ''}`}>
            <span className="dl-sb-hero">{h.icon && <img src={h.icon} alt="" width={22} height={22} />}<b style={{ color: TEAM_COLOR[p.team] }}>{h.name}</b></span>
            <span className="d2-order-skills">
              {picks.map((a, i) => a?.talent
                ? <span key={i} className="d2-order-cell talent" title={`Level ${i + 1}: ${a.name}`}>T</span>
                : <span key={i} className="d2-order-cell" title={`Level ${i + 1}: ${a?.name ?? 'unknown'}`}>{a && <img src={skillLook(a.key, h.key).icon} alt={a.name} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />}</span>)}
            </span>
            {talents.length > 0 && <TalentTree hero={p.hero} upgrades={p.upgrades} />}
          </div>
        );
      })}
    </section>
  );
}

/** Items that cost this much are the ones worth timing. */
const BIG_ITEM = 1000;
/** Only the items that shape a game are compared with what's usual: each one is a request to OpenDota. */
const COMPARED_ITEM = 2000;

/** One player's big items against when players on that hero usually have them. */
function ItemsVsUsual({ match, slot }: { match: D2Match; slot: number }) {
  const p = match.players[slot], h = heroOf(p.hero);
  const buys = useMemo(() => {
    const seen = new Set<string>();
    return match.buys.filter(b => b.slot === slot && (itemByKey.get(b.item)?.cost ?? 0) >= COMPARED_ITEM && !seen.has(b.item) && seen.add(b.item)).slice(0, 10);
  }, [match, slot]);
  const [usual, setUsual] = useState<Record<string, number | null>>({});
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUsual({}); setFailed(null);
    void (async () => {
      for (const b of buys) {
        try {
          const rows = await itemTimings(p.hero, b.item);
          if (live) setUsual(u => ({ ...u, [b.item]: typicalTiming(rows) }));
        } catch (e) { if (live) setFailed(e instanceof Error ? e.message : String(e)); return; }
      }
    })();
    return () => { live = false; };
  }, [buys, p.hero]);
  return (
    <div className="d2-vs">
      <h4>{p.name ?? h.name} on {h.name}, against what's usual</h4>
      {!buys.length && <p className="muted small">No big items in this match.</p>}
      {failed && <p className="warn-text small">{failed}</p>}
      <ul>
        {buys.map(b => {
          const it = itemByKey.get(b.item)!, typical = usual[b.item], gap = typical == null ? null : b.t - typical;
          const verdict = gap === null ? null : gap > TIMING_MARGIN ? 'late' : gap < -TIMING_MARGIN * 2 ? 'early' : 'on time';
          return (
            <li key={b.item}>
              {it.icon && <img src={it.icon} alt="" width={30} height={22} />}
              <b>{it.name}</b>
              <span className="num">{mins(b.t)}</span>
              <span className="muted small">{typical === undefined ? 'looking…' : typical === null ? 'too few games to tell' : `usually about ${mins(typical)}`}</span>
              {verdict && <span className={`d2-verdict ${verdict.replace(' ', '-')}`}>{verdict}</span>}
            </li>
          );
        })}
      </ul>
      <p className="muted small">From OpenDota's sample of games on this hero, in steps of several minutes, so treat it as a rough guide.</p>
    </div>
  );
}

function Items({ match, mine }: { match: D2Match; mine: number | null }) {
  const [picked, setPicked] = useState<number | null>(mine);
  return (
    <section className="recap-card">
      <h3>Item timings</h3>
      <p className="muted small">Click a hero to compare their items with when players on that hero usually have them.</p>
      {picked !== null && <ItemsVsUsual match={match} slot={picked} />}
      {match.players.map(p => {
        const buys = match.buys.filter(b => b.slot === p.slot).map(b => ({ t: b.t, item: itemByKey.get(b.item) })).filter(b => b.item && b.item.cost >= BIG_ITEM);
        return (
          <div key={p.slot} className={`d2-timing ${p.slot === mine ? 'me' : ''}`}>
            <button className={`ghost d2-timing-who ${picked === p.slot ? 'on' : ''}`} onClick={() => setPicked(picked === p.slot ? null : p.slot)} aria-pressed={picked === p.slot}>
              <span className="dl-sb-hero">{heroOf(p.hero).icon && <img src={heroOf(p.hero).icon!} alt="" width={22} height={22} />}<b style={{ color: TEAM_COLOR[p.team] }}>{heroOf(p.hero).name}</b></span>
            </button>
            <span className="d2-timing-items">
              {buys.length ? buys.map((b, i) => <span key={i} className="d2-buy" title={`${b.item!.name} · ${b.item!.cost.toLocaleString()} gold`}>{b.item!.icon && <img src={b.item!.icon} alt="" width={24} height={18} />}<span className="num muted small">{mins(b.t)}</span></span>) : <span className="muted small">None logged</span>}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function Scoreboard({ match, mine }: { match: D2Match; mine: number | null }) {
  return (
    <section className="recap-card">
      {([0, 1] as D2Team[]).map(team => (
        <div key={team} className="dl-score-team">
          <h3 style={{ color: TEAM_COLOR[team] }}>{match.names[team]}{match.names[team] !== TEAM_NAME[team] ? ` (${TEAM_NAME[team]})` : ''}{match.winner === team ? ' · won' : ''}</h3>
          <div className="d2-table-wrap">
            <table className="site-table dl-scoreboard">
              <thead><tr><th>Player</th><th>K/D/A</th><th>Net worth</th><th>LH/DN</th><th>GPM/XPM</th><th>Damage</th><th>Wards</th><th>Lvl</th><th>Items</th></tr></thead>
              <tbody>
                {match.players.filter(p => p.team === team).sort((a, b) => b.netWorth - a.netWorth).map(p => (
                  <tr key={p.slot} className={p.slot === mine ? 'me' : ''}>
                    <td><span className="dl-sb-hero">{heroOf(p.hero).icon && <img src={heroOf(p.hero).icon!} alt="" width={22} height={22} />}<b>{p.name ?? heroOf(p.hero).name}</b><span className="muted small">{heroOf(p.hero).name}</span></span></td>
                    <td className="num">{p.kills}/{p.deaths}/{p.assists}</td><td className="num">{p.netWorth.toLocaleString()}</td>
                    <td className="num">{p.lastHits}/{p.denies}</td><td className="num">{p.gpm}/{p.xpm}</td><td className="num">{p.heroDamage.toLocaleString()}</td>
                    <td className="num">{p.obs}/{p.sen}</td><td className="num">{p.level}</td>
                    <td><span className="d2-items">{p.items.map((id, i) => { const it = itemById.get(id); return it?.icon ? <img key={i} src={it.icon} alt={it.name} title={it.name} width={28} height={21} /> : null; })}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

function MoveList({ moves, watch }: { moves: D2Move[]; watch: (t: number) => void }) {
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
