import { useEffect, useMemo, useState } from 'react';
import { NOTE_INFO } from '../engine/recap';
import { navigate } from '../shell/router';
import { AreaChart, BarList } from '../site/charts';
import { Icon, type IconName } from '../ui/Icon';
import { itemTimings, TIMING_MARGIN, typicalTiming } from './api';
import type { D2Move, D2Tag } from './coach';
import { abilityById, buildingOf, heroOf, itemById, itemByKey, mins, skillLook, TEAM_COLOR, TEAM_NAME, type D2Team } from './data';
import { clashes, laneResults, type D2Match } from './match';
import { useD2 } from './store';
import { useCoach } from './useCoach';
import '../deadlock/dl.css';
import './d2.css';

type Tab = 'overview' | 'coach' | 'draft' | 'fights' | 'objectives' | 'items' | 'skills' | 'scoreboard';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'star' }, { id: 'coach', label: 'Coach', icon: 'target' },
  { id: 'draft', label: 'Draft & lanes', icon: 'grid' }, { id: 'fights', label: 'Fights', icon: 'swords' },
  { id: 'objectives', label: 'Objectives', icon: 'map' }, { id: 'items', label: 'Items', icon: 'trendUp' },
  { id: 'skills', label: 'Skills', icon: 'bolt' }, { id: 'scoreboard', label: 'Scoreboard', icon: 'list' },
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

/** Dota 2's Match recap: the result, the coach's lessons, fights, objectives, item timings and every player's numbers. */
export function D2Report() {
  const match = useD2(s => s.match);
  const coach = useCoach();
  const [tab, setTab] = useState<Tab>('overview');
  if (!match) return <div className="page"><p className="muted">No match open. <a href="#/dota2/review">Pick one</a></p></div>;
  const me = coach.mine !== null ? match.players[coach.mine] : null;
  const watch = (t: number) => { useD2.getState().setTime(t - 8); useD2.getState().setPlaying(false); navigate({ page: 'dota2', mode: 'review' }); };
  const myMoves = coach.mine !== null ? coach.all.filter(m => m.slot === coach.mine) : coach.all;
  const kills = (team: D2Team) => match.players.filter(p => p.team === team).reduce((a, p) => a + p.kills, 0);

  return (
    <div className="report d2-report">
      <header className="recap-head">
        <div className="recap-head-main">
          <span className="recap-map display">Dota 2</span>
          <span className="recap-score display">
            <b style={{ color: TEAM_COLOR[0] }}>{kills(0)}</b><i>:</i><b style={{ color: TEAM_COLOR[1] }}>{kills(1)}</b>
          </span>
          {me && <span className={`recap-result ${match.winner === me.team ? 'victory' : 'defeat'}`}>{match.winner === me.team ? 'Victory' : 'Defeat'}</span>}
        </div>
        <p className="muted">Match {match.id} · {mins(match.duration)} · {match.names[match.winner]} won{me ? ` · you: ${heroOf(me.hero).name}` : ''}</p>
      </header>

      <nav className="recap-tabs" aria-label="Recap">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
      </nav>

      {!match.parsed && tab !== 'scoreboard' && <p className="muted">This match hasn't been parsed: only the scoreboard is available. You can ask OpenDota to parse it in Review.</p>}
      {match.parsed && tab === 'overview' && <Overview match={match} me={me?.slot ?? null} moves={myMoves} watch={watch} />}
      {match.parsed && tab === 'coach' && <Coach moves={myMoves} watch={watch} who={me ? 'you' : 'everyone'} />}
      {match.parsed && tab === 'draft' && <DraftAndLanes match={match} />}
      {tab === 'skills' && <Skills match={match} mine={coach.mine} />}
      {match.parsed && tab === 'fights' && <Fights match={match} team={me?.team ?? 0} watch={watch} />}
      {match.parsed && tab === 'objectives' && <Objectives match={match} watch={watch} />}
      {match.parsed && tab === 'items' && <Items match={match} mine={coach.mine} />}
      {tab === 'scoreboard' && <Scoreboard match={match} mine={coach.mine} />}
    </div>
  );
}

function Overview({ match, me, moves, watch }: { match: D2Match; me: number | null; moves: D2Move[]; watch: (t: number) => void }) {
  const team = me !== null ? match.players[me].team : 0;
  const lead = useMemo(() => match.goldAdv.map((v, i) => ({ label: `${i}:00`, value: team === 0 ? v : -v })), [match, team]);
  const bad = moves.filter(m => m.note === '?' || m.note === '??'), good = moves.filter(m => m.note === '!' || m.note === '!!');
  const bench = me !== null ? match.players[me].bench : null;
  return (
    <>
      {lead.length > 1 && (
        <section className="recap-card overview">
          <h3>Gold lead ({match.names[team]}{me !== null ? ', your team' : ''})</h3>
          <AreaChart points={lead} fmt={v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`} height={180} color={TEAM_COLOR[team]} />
        </section>
      )}
      <section className="recap-card">
        <h3>The coach's marks{me !== null ? ' on your play' : ''}</h3>
        <BarList rows={(['!!', '!', '?!', '?', '??'] as const).map(n => {
          const c = moves.filter(m => m.note === n).length;
          return { label: `${NOTE_INFO[n].mark} ${NOTE_INFO[n].label}`, value: String(c), share: c / Math.max(1, moves.filter(m => m.note !== 'book').length), tone: n.startsWith('!') ? 'up' as const : n === '?!' ? 'flat' as const : 'down' as const };
        })} />
        {bad.length > 0 && <><h4>Worst moments</h4><MoveList moves={[...bad].sort((a, b) => (a.note === '??' ? -1 : 0) - (b.note === '??' ? -1 : 0)).slice(0, 4)} watch={watch} /></>}
        {good.length > 0 && <><h4>Best moments</h4><MoveList moves={good.slice(0, 3)} watch={watch} /></>}
      </section>
      {bench && Object.keys(bench).length > 0 && (
        <section className="recap-card">
          <h3>You against others on {heroOf(match.players[me!].hero).name}</h3>
          <p className="muted small">The share of players on this hero you beat (OpenDota's benchmarks).</p>
          <BarList rows={BENCH.filter(([k]) => bench[k] !== undefined).map(([k, label]) => ({ label, value: `${Math.round(bench[k] * 100)}%`, share: bench[k], tone: bench[k] >= 0.6 ? 'up' as const : bench[k] >= 0.4 ? 'flat' as const : 'down' as const }))} />
        </section>
      )}
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
  return (
    <>
      <section className="recap-card">
        <h3>Draft</h3>
        {!match.draft.length ? <p className="muted">This game mode had no draft to show.</p> : (
          <ol className="d2-draft">
            {match.draft.map((d, i) => (
              <li key={i} className={d.pick ? 'pick' : 'ban'} style={{ borderColor: TEAM_COLOR[d.team] }} title={`${match.names[d.team]} ${d.pick ? 'picked' : 'banned'} ${hero(d.hero).name}`}>
                {hero(d.hero).icon && <img src={hero(d.hero).icon!} alt={hero(d.hero).name} width={30} height={30} />}
                <span className="num muted small">{i + 1}</span>
              </li>
            ))}
          </ol>
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
            {talents.length > 0 && <span className="muted small d2-order-talents">{talents.map(t => t!.name).join(' · ')}</span>}
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
