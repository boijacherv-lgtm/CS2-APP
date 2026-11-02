import { useEffect, useMemo, useState } from 'react';
import { NOTE_INFO } from '../engine/recap';
import { navigate } from '../shell/router';
import { AreaChart, BarList, Radar } from '../site/charts';
import { Icon, type IconName } from '../ui/Icon';
import type { DlMove, DlTag } from './coach';
import { heroOf, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import { statAt, type DlMatch } from './match';
import { useDl } from './store';
import { useCoach } from './useCoach';
import { abilityUse, economy, reportCard, turningPoints, type ReportCard } from './grade';
import { heroBuilds } from './meta';
import { useRank } from './DlMeta';
import { BENCH_SOURCE } from './bench';
import ITEMS from './generated/items.json';
import './dl.css';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ITEM = new Map((ITEMS as { id: number; name: string; tier: number; cost: number; icon: string | null }[]).map(i => [i.id, i]));
type Tab = 'overview' | 'grades' | 'coach' | 'economy' | 'items' | 'abilities' | 'fights' | 'objectives' | 'scoreboard';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'grades', label: 'Report card', icon: 'trophy' }, { id: 'coach', label: 'Coach', icon: 'target' },
  { id: 'economy', label: 'Economy', icon: 'coins' }, { id: 'items', label: 'Items', icon: 'shield' }, { id: 'abilities', label: 'Abilities', icon: 'bolt' },
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
  const match = useDl(s => s.match), names = useDl(s => s.names), demo = useDl(s => s.demo);
  const coach = useCoach();
  const [tab, setTab] = useState<Tab>('overview');
  // whose recap: yours when you played in it, else the player picked here
  const [pick, setPick] = useState<number | null>(null);
  const subject = pick ?? coach.mine ?? match?.players[0]?.slot ?? null;
  const card = useMemo(() => (match && subject !== null ? reportCard(match, subject, demo, coach.all) : null), [match, subject, demo, coach.all]);
  if (!match) return <div className="page"><p className="muted">No match open. <a href="#/deadlock/review">Pick one</a></p></div>;
  const me = coach.mine !== null ? match.players.find(p => p.slot === coach.mine)! : null;
  const who = match.players.find(p => p.slot === subject) ?? null;
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
        <label className="dl-subject muted small">Graded player{' '}
          <select value={subject ?? ''} onChange={e => setPick(Number(e.target.value))}>
            {match.players.map(p => <option key={p.slot} value={p.slot}>{nameOf(p.slot)} · {heroOf(p.hero).name}{p.slot === coach.mine ? ' (you)' : ''}</option>)}
          </select>
        </label>
      </header>

      <nav className="recap-tabs" aria-label="Recap">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
      </nav>

      {tab === 'overview' && <><WhyResult match={match} team={who?.team ?? 0} watch={watch} /><Overview match={match} me={me?.slot ?? null} moves={myMoves} watch={watch} /></>}
      {tab === 'grades' && card && who && <Grades card={card} name={nameOf(who.slot)} hero={heroOf(who.hero).name} watch={watch} />}
      {tab === 'economy' && who && <Economy match={match} slot={who.slot} />}
      {tab === 'items' && who && <Items match={match} slot={who.slot} />}
      {tab === 'abilities' && who && <Abilities match={match} slot={who.slot} card={card} watch={watch} />}
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

const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`;
const TONE_COLOR = { up: 'var(--good)', down: 'var(--bad)', flat: 'var(--text-3)' } as const;

/** Why the match went the way it did: the biggest swings of the souls lead and what happened in each. */
function WhyResult({ match, team, watch }: { match: DlMatch; team: DlTeam; watch: (t: number) => void }) {
  const tp = useMemo(() => turningPoints(match, team), [match, team]);
  const won = match.winner === team;
  // the swing that decided it: the biggest one in the winner's favour
  const decisive = [...tp.swings].sort((a, b) => (won ? b.delta - a.delta : a.delta - b.delta))[0];
  const say = (s: (typeof tp.swings)[number]) => [
    `${s.kills} kill${s.kills === 1 ? '' : 's'} to ${s.deaths}`,
    ...(s.took.length ? [`took ${s.took.join(', ')}`] : []), ...(s.lost.length ? [`lost ${s.lost.join(', ')}`] : []),
    ...s.boss.map(b => (b === team ? 'took the Mid Boss' : 'they took the Mid Boss')),
  ].join(' · ');
  return (
    <section className="recap-card">
      <h3>Why {TEAM_NAME[team]} {won ? 'won' : 'lost'}</h3>
      {decisive && <p>The decisive stretch: <b>{mins(decisive.from)}–{mins(decisive.to)}</b>, {sign(decisive.delta)} souls for {TEAM_NAME[team]} ({say(decisive)}).</p>}
      <h4>Turning points</h4>
      <ul className="dl-moves">
        {tp.top.map(s => (
          <li key={s.from}>
            <b className="dl-card-mark" style={{ background: s.delta >= 0 ? 'var(--good)' : 'var(--bad)' }}>{s.delta >= 0 ? '+' : '−'}</b>
            <span className="dl-move-text"><b>{mins(s.from)}–{mins(s.to)}: {sign(s.delta)} souls (lead {sign(s.lead)})</b><span className="muted small">{say(s)}</span></span>
            <button className="chip" onClick={() => watch(s.from + 10)}>Watch</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The report card: each part's score against the same hero in the same position, with the moments behind it. */
function Grades({ card, name, hero, watch }: { card: ReportCard; name: string; hero: string; watch: (t: number) => void }) {
  return (
    <>
      <section className="recap-card dl-grade-head">
        <div>
          <h3>{name}'s report card</h3>
          <p className="muted">{hero}{card.pos ? ` · played Pos ${card.pos}` : ''} · graded against players of the same hero in the same position ({BENCH_SOURCE.matches.toLocaleString()} public matches since the patch); 50 is average.</p>
          <div className="dl-grade-overall">
            <b className="dl-card-mark" style={{ background: NOTE_INFO[card.note].color }}>{card.note === 'book' ? '·' : NOTE_INFO[card.note].mark}</b>
            <span className="display">{card.overall ?? '–'}</span><span className="muted">overall</span>
          </div>
        </div>
        <Radar axes={card.parts.map(p => ({ label: p.label, you: p.z, tip: `${p.label}: ${p.score ?? 'not graded'}` }))} refLabel="Average for the position" />
      </section>
      {card.parts.map(p => (
        <section key={p.key} className="recap-card dl-grade">
          <h3>
            <b className="dl-card-mark" style={{ background: NOTE_INFO[p.note].color }}>{p.note === 'book' ? '·' : NOTE_INFO[p.note].mark}</b>
            {p.label} <span className="num">{p.score ?? '–'}</span>
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

/** Net worth and where the souls came from, against the same hero in the same position. */
function Economy({ match, slot }: { match: DlMatch; slot: number }) {
  const rows = useMemo(() => economy(match, slot), [match, slot]);
  if (!rows.length) return <section className="recap-card"><p className="muted">The match is too short to compare.</p></section>;
  const last = rows.at(-1)!;
  const LABEL = { lane: 'Lane creeps', camps: 'Camps', kills: 'Hero kills', urn: 'Urn', boss: 'Bosses' } as const;
  return (
    <>
      <section className="recap-card">
        <h3>Net worth against the average</h3>
        <AreaChart points={rows.map(r => ({ label: `${r.minute}m`, value: r.avg !== null ? r.nw - r.avg : 0, note: `${r.nw.toLocaleString()} vs ${r.avg !== null ? Math.round(r.avg).toLocaleString() : '?'}` }))} fmt={sign} height={170} />
        <table className="site-table dl-econ">
          <thead><tr><th>Minute</th><th>Souls</th><th>Average</th><th>Gap</th><th>Last hits</th><th>Average</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.minute}><td className="num">{r.minute}</td><td className="num">{r.nw.toLocaleString()}</td><td className="num muted">{r.avg !== null ? Math.round(r.avg).toLocaleString() : '–'}</td>
              <td className="num" style={{ color: r.avg === null ? undefined : r.nw >= r.avg ? 'var(--good)' : 'var(--bad)' }}>{r.avg !== null ? sign(r.nw - r.avg) : ''}</td>
              <td className="num">{r.lh}</td><td className="num muted">{r.lhAvg !== null ? Math.round(r.lhAvg) : '–'}</td></tr>
          ))}</tbody>
        </table>
      </section>
      <section className="recap-card">
        <h3>Where the souls came from (by {last.minute} min)</h3>
        <BarList rows={last.src.map(x => ({ label: LABEL[x.k], value: `${Math.round(x.you).toLocaleString()}${x.avg !== null ? ` / ${Math.round(x.avg).toLocaleString()}` : ''}`,
          share: x.avg ? Math.min(1, x.you / (Math.max(x.you, x.avg) || 1)) : 0, tone: x.avg === null ? 'flat' as const : x.you >= x.avg * 1.1 ? 'up' as const : x.you <= x.avg * 0.85 ? 'down' as const : 'flat' as const,
          note: x.avg !== null ? `you / the average ${last.of === 'hero+pos' ? 'for this hero and position' : last.of === 'hero' ? 'for this hero' : 'for the position'}` : undefined }))} />
      </section>
    </>
  );
}

/** What they bought against what wins on the hero this patch: the core items and when, off-meta picks. */
function Items({ match, slot }: { match: DlMatch; slot: number }) {
  const p = match.players.find(x => x.slot === slot)!;
  const [band] = useRank();
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof heroBuilds>> | null | 'error'>(null);
  useEffect(() => { let live = true; setMeta(null); heroBuilds(p.hero, band).then(r => live && setMeta(r), () => live && setMeta('error')); return () => { live = false; }; }, [p.hero, band]);
  const bought = (match.items[slot] ?? []).filter(i => ITEM.has(i.id));
  const first = new Map<number, number>(); for (const i of bought) if (!first.has(i.id)) first.set(i.id, i.t);
  if (meta === null) return <section className="recap-card"><p className="muted">Reading this patch's items for {heroOf(p.hero).name}…</p></section>;
  if (meta === 'error') return <section className="recap-card"><p className="muted">Couldn't read the item stats (deadlock-api). Try again later.</p></section>;
  const core = meta.core.slice(0, 12);
  const offMeta = new Set(meta.offMeta.map(i => i.item));
  const coreIds = new Set(core.map(i => i.item));
  const extra = [...first.keys()].filter(id => !coreIds.has(id));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <section className="recap-card">
        <h3>Core items on {heroOf(p.hero).name} ({band.label})</h3>
        <p className="muted small">Bought in at least 35% of games this patch, in buying order; win rate of games with the item, against {pct(meta.base)} for the hero.</p>
        <ul className="dl-itemrows">
          {core.map(c => {
            const it = ITEM.get(c.item), t = first.get(c.item);
            const late = t !== undefined && t - c.buyAt > 240, early = t !== undefined && c.buyAt - t > 240;
            return (
              <li key={c.item} className={t === undefined ? 'missing' : ''}>
                {it?.icon && <img src={it.icon} alt="" />}
                <b>{it?.name ?? c.item}</b>
                <span className="muted small">usually {mins(c.buyAt)} · {pct(c.share)} buy it · {pct(c.winRate)} win</span>
                <span className="num" style={{ color: t === undefined ? 'var(--bad)' : late ? 'var(--bad)' : early ? 'var(--good)' : undefined }}>
                  {t === undefined ? 'not bought' : `${mins(t)}${late ? ` (${Math.round((t - c.buyAt) / 60)} min late)` : early ? ` (${Math.round((c.buyAt - t) / 60)} min early)` : ''}`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="recap-card">
        <h3>Other items bought</h3>
        <ul className="dl-itemrows">
          {extra.map(id => { const it = ITEM.get(id)!; return (
            <li key={id}>{it.icon && <img src={it.icon} alt="" />}<b>{it.name}</b>
              <span className="muted small">{offMeta.has(id) ? 'off-meta pick that wins on this hero' : `tier ${it.tier}`}</span><span className="num">{mins(first.get(id)!)}</span></li>
          ); })}
          {!extra.length && <li className="muted">Only core items.</li>}
        </ul>
      </section>
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
