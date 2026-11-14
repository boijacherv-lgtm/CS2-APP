/**
 * Match recap's bigger parts: the scoreboard, both teams' souls, economy, items (with what to buy against this enemy
 * team) and objectives.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loading } from '../ui/Loading';
import { matchPosition } from './bench';
import { DL_MAP_IMAGE, heroOf, LANES, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import { useRank } from './DlMeta';
import { LinesChart } from './DlCharts';
import { SplitChart } from '../site/charts';
import { economy, laneOpponent, teamSouls, unspentAtDeaths, worthAt } from './grade';
import { WIN_MODEL, winCurve } from './winChance';
import { statAt, type DlMatch, type DlObjective } from './match';
import { counterItems, heroBuilds, type CounterItem } from './meta';
import { useDl } from './store';
import { feedEvents } from './events';
import { positioning, SPOT_GRID, SPOT_PHASES, SPOT_SOURCE, spotGrid } from './spots';
import ITEMS from './generated/items.json';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** A soul bag worth listing in the recap (smaller ones only show in the replay's feed). */
const BIG_BAG = 300;
type Item = { id: number; name: string; tier: number; cost: number; icon: string | null };
const ITEM = new Map((ITEMS as Item[]).map(i => [i.id, i]));
const HeroImg = ({ hero, size = 22 }: { hero: number; size?: number }) => {
  const h = heroOf(hero);
  return h.card ? <img className="dl-hero-img" src={h.card} alt={h.name} title={h.name} width={size} height={size} /> : <span className="dl-hero-dot" style={{ background: h.color }} />;
};
const ItemImg = ({ id, size = 22, dim = false }: { id: number; size?: number; dim?: boolean }) => {
  const it = ITEM.get(id);
  return it?.icon ? <img className={`dl-item-img tier${it.tier} ${dim ? 'dim' : ''}`} src={it.icon} alt={it.name} title={it.name} width={size} height={size} /> : null;
};

// ---- the scoreboard ----------------------------------------------------------------------------------------------

export function Scoreboard({ match, subject, mine, nameOf, pick }: { match: DlMatch; subject: number | null; mine: number | null; nameOf: (slot: number) => string; pick: (slot: number) => void }) {
  return (
    <section className="recap-card dl-sb">
      {([0, 1] as DlTeam[]).map(team => {
        const ps = match.players.filter(p => p.team === team).sort((a, b) => b.netWorth - a.netWorth);
        const total = ps.reduce((a, p) => a + p.netWorth, 0);
        return (
          <div key={team} className="dl-sb-team">
            <div className="dl-sb-head" style={{ color: TEAM_COLOR[team] }}>
              <b>{TEAM_NAME[team]}</b>{match.winner === team && <span className="dl-sb-won">Won</span>}
              <span className="muted small">{ps.reduce((a, p) => a + p.kills, 0)} kills · {(total / 1000).toFixed(1)}k souls</span>
            </div>
            <div className="dl-sb-scroll">
              <table className="dl-sb-table">
                <thead><tr><th>Player</th><th>K/D/A</th><th>Souls</th><th>LH / DN</th><th>Hero dmg</th><th>Healing</th><th>Items</th></tr></thead>
                <tbody>
                  {ps.map(p => {
                    const end = statAt(match, p.slot, match.duration), pos = matchPosition(match, p.slot);
                    const items = (match.items[p.slot] ?? []).filter(i => ITEM.has(i.id) && i.sold === null).map(i => i.id);
                    return (
                      <tr key={p.slot} className={`${p.slot === subject ? 'on' : ''} ${p.slot === mine ? 'me' : ''}`} onClick={() => pick(p.slot)} title="Grade this player">
                        <td><span className="dl-sb-who"><HeroImg hero={p.hero} size={30} /><span><b>{nameOf(p.slot)}</b><span className="muted small">{heroOf(p.hero).name}{pos && <span className={`dl-pos p${pos}`}>Pos {pos}</span>}</span></span></span></td>
                        <td className="num">{p.kills}/{p.deaths}/{p.assists}</td>
                        <td className="num"><b>{(p.netWorth / 1000).toFixed(1)}k</b></td>
                        <td className="num">{p.lastHits} / {p.denies}</td>
                        <td className="num">{end ? `${(end.playerDamage / 1000).toFixed(1)}k` : '–'}</td>
                        <td className="num muted">{end?.heal ? `${(end.heal / 1000).toFixed(1)}k` : '–'}</td>
                        <td><span className="dl-sb-items">{items.slice(-12).map((id, i) => <ItemImg key={`${id}-${i}`} id={id} size={20} />)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ---- both teams' souls -----------------------------------------------------------------------------------------

export function TeamSouls({ match, team }: { match: DlMatch; team: DlTeam }) {
  const demo = useDl(s => s.demo);
  const pts = useMemo(() => teamSouls(match, demo, 30), [match, demo]);
  const other = (1 - team) as DlTeam;
  const lead = pts.map(p => p.v[team] - p.v[other]);
  const best = Math.max(...lead), worst = Math.min(...lead), endLead = lead.at(-1)!;
  return (
    <section className="recap-card">
      <h3>Souls</h3>
      <div className="dl-kpis">
        <span><b className="num" style={{ color: endLead >= 0 ? 'var(--good)' : 'var(--bad)' }}>{sign(endLead)}</b><i>at the end</i></span>
        <span><b className="num">{best > 0 ? sign(best) : '–'}</b><i>biggest lead</i></span>
        <span><b className="num">{worst < 0 ? sign(worst) : '–'}</b><i>furthest behind</i></span>
      </div>
      {/* the lead around 0: above in your team's colour, below in theirs; the biggest lead labelled once */}
      {(() => {
        const far = lead.reduce((b, v, i) => (Math.abs(v) > Math.abs(lead[b]) ? i : b), 0);
        return <SplitChart xticks={Array.from({ length: Math.floor(match.duration / 300) + 1 }, (_, k) => k * 300)} caption={`${TEAM_NAME[team]}'s soul lead over the match`} base={0} colors={[TEAM_COLOR[team], TEAM_COLOR[other]]}
          points={pts.map((p, i) => ({ t: p.t, v: lead[i] }))} fmt={sign} axis={v => (Math.abs(v) < 1 ? '0' : `${v > 0 ? '+' : '−'}${(Math.abs(v) / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k`)} xfmt={mins}
          label={lead[far] ? { t: pts[far].t, text: `${lead[far] > 0 ? 'Biggest lead' : 'Furthest behind'} ${sign(lead[far])}` } : null}
          dots={match.midBoss.map(b => ({ t: b.t, color: TEAM_COLOR[b.team], title: `${TEAM_NAME[b.team]} took the Mid Boss` }))} />;
      })()}
      {!demo && <p className="muted small">Between the match's snapshots (every 3 min); a match with a demo shows it every 2 s.</p>}
    </section>
  );
}

// ---- economy ---------------------------------------------------------------------------------------------------

export function Economy({ match, slot, watch }: { match: DlMatch; slot: number; watch: (t: number) => void }) {
  const demo = useDl(s => s.demo), names = useDl(s => s.names);
  const me = match.players.find(p => p.slot === slot)!, hero = heroOf(me.hero), pos = matchPosition(match, slot);
  const rows = useMemo(() => economy(match, slot), [match, slot]);
  const opp = useMemo(() => laneOpponent(match, slot), [match, slot]);
  const unspent = useMemo(() => unspentAtDeaths(match, slot, demo, id => ITEM.get(id)?.cost ?? null), [match, slot, demo]);
  if (!rows.length) return <section className="recap-card"><p className="muted">The match is too short to compare.</p></section>;
  const last = rows.at(-1)!, who = last.of === 'hero+pos' ? `Pos ${pos} ${hero.name}` : last.of === 'hero' ? hero.name : `Pos ${pos}`;
  const step = 30, curve: { t: number; v: number }[] = [], oppCurve: { t: number; v: number }[] = [];
  for (let t = 0; t <= match.duration; t += step) { curve.push({ t, v: worthAt(match, demo, slot, t) }); if (opp) oppCurve.push({ t, v: worthAt(match, demo, opp.slot, t) }); }
  const band = [{ t: 0, lo: 0, hi: 0 }, ...rows.filter(r => r.avg !== null).map(r => ({ t: r.minute * 60, lo: Math.max(0, r.avg! - r.sd!), hi: r.avg! + r.sd! }))];
  const avgLine = [{ t: 0, v: 0 }, ...rows.filter(r => r.avg !== null).map(r => ({ t: r.minute * 60, v: r.avg! }))];
  // souls a minute in each phase, against the average
  const at = (mk: number) => rows.find(r => r.minute === mk);
  const phases = ([['Laning', 0, 12], ['Mid game', 12, 25], ['Late game', 25, last.minute]] as const).filter(([, a, b]) => b > a && (a === 0 || at(a)) && at(b)).map(([label, a, b]) => {
    const A = a === 0 ? { nw: 0, avg: 0 } : at(a)!, Bm = at(b)!;
    return { label, a, b, you: (Bm.nw - A.nw) / (b - a), avg: Bm.avg !== null && A.avg !== null ? (Bm.avg - A.avg) / (b - a) : null };
  });
  const LABEL = { lane: 'Lane creeps', camps: 'Camps', kills: 'Hero kills', urn: 'Urn', boss: 'Bosses' } as const;
  const srcMax = Math.max(1, ...last.src.flatMap(x => [x.you, x.avg ?? 0]));
  // what to take away: the source furthest below the average, the weakest phase, souls carried into deaths
  const short = [...last.src].filter(x => x.avg !== null).sort((a, b) => (a.you - a.avg!) - (b.you - b.avg!))[0];
  const weak = [...phases].filter(p => p.avg !== null).sort((a, b) => (a.you - a.avg!) - (b.you - b.avg!))[0];
  const carried = unspent.filter(u => u.unspent >= 1500);
  const lh12 = at(12);
  return (
    <>
      <section className="recap-card">
        <h3>Souls against the average {who}{opp ? ` and ${names[opp.account]?.name ?? heroOf(opp.hero).name}` : ''}</h3>
        <div className="dl-kpis">
          <span><b className="num">{Math.round(last.nw / last.minute).toLocaleString()}</b><i>souls a minute (avg {last.avg !== null ? Math.round(last.avg / last.minute).toLocaleString() : '–'})</i></span>
          {lh12 && <span><b className="num">{lh12.lh}</b><i>last hits at 12:00 (avg {lh12.lhAvg !== null ? Math.round(lh12.lhAvg) : '–'})</i></span>}
          {opp && <span><b className="num" style={{ color: me.netWorth >= opp.netWorth ? 'var(--good)' : 'var(--bad)' }}>{sign(me.netWorth - opp.netWorth)}</b><i>vs {heroOf(opp.hero).name} at the end</i></span>}
          <span><b className="num">{unspent.length ? Math.round(unspent.reduce((a, u) => a + u.unspent, 0) / unspent.length).toLocaleString() : '–'}</b><i>unspent souls a death (about)</i></span>
        </div>
        <LinesChart height={230} band={band}
          series={[{ label: 'You', color: '#f3f4f6', points: curve }, { label: `Average ${who}`, color: 'var(--text-3)', points: avgLine, dashed: true },
            ...(opp ? [{ label: heroOf(opp.hero).name, color: TEAM_COLOR[opp.team], points: oppCurve }] : [])]} />
      </section>

      <section className="recap-card">
        <h3>What to take away</h3>
        <ul className="dl-take">
          {weak && weak.avg !== null && <li className={weak.you >= weak.avg ? 'is-up' : 'is-down'}><b>{weak.label} ({weak.a}–{weak.b} min)</b>{weak.you >= weak.avg ? ' was your best stretch: ' : ' is where you fell behind: '}{Math.round(weak.you).toLocaleString()} souls a minute against {Math.round(weak.avg).toLocaleString()}.</li>}
          {short && short.avg !== null && short.you < short.avg * 0.85 && <li className="is-down"><b>{LABEL[short.k]}</b> brought {Math.round(short.you).toLocaleString()} souls by {last.minute} min; the average {who} gets {Math.round(short.avg).toLocaleString()}.{short.k === 'camps' ? ' Clear a camp on your way when the lane is pushed.' : short.k === 'lane' ? ' Last-hit more and keep up with the waves.' : short.k === 'urn' ? ' Join the urn when it spawns on your side.' : ''}</li>}
          {carried.length > 0 && <li className="is-down"><b>Died holding souls</b> {carried.length}×: {carried.slice(0, 4).map(u => <button key={u.t} className="chip" onClick={() => watch(u.t)}>{mins(u.t)} · {(u.unspent / 1000).toFixed(1)}k</button>)}{carried.length > 4 && <span className="muted"> +{carried.length - 4} more</span>} Spend before a fight or a risky push.</li>}
          {!carried.length && <li className="is-up"><b>Souls spent</b> before your deaths: you never died holding much.</li>}
        </ul>
      </section>

      <section className="recap-card">
        <h3>Souls a minute by phase</h3>
        <div className="dl-phases">
          {phases.map(p => (
            <div key={p.label} className={p.avg === null ? '' : p.you >= p.avg ? 'up' : 'down'}>
              <span className="muted small">{p.label} · {p.a}–{p.b} min</span>
              <b className="num">{Math.round(p.you).toLocaleString()}</b>
              <span className="small">{p.avg !== null ? <>average {Math.round(p.avg).toLocaleString()} · <span className="dl-delta">{sign(p.you - p.avg)}</span></> : 'no average'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="recap-card">
        <h3>Where the souls came from (by {last.minute} min)</h3>
        <ul className="dl-src">
          {last.src.map(x => (
            <li key={x.k}>
              <span>{LABEL[x.k]}</span>
              <span className="dl-src-bars">
                <i className="you" style={{ width: `${(x.you / srcMax) * 100}%` }} />
                {x.avg !== null && <i className="avg" style={{ width: `${(x.avg / srcMax) * 100}%` }} />}
              </span>
              <span className="num"><b>{Math.round(x.you).toLocaleString()}</b>{x.avg !== null && <span className="muted"> / {Math.round(x.avg).toLocaleString()}</span>}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Top bar: you; under it: the average {who}.</p>
      </section>
    </>
  );
}

// ---- items -----------------------------------------------------------------------------------------------------

export function Items({ match, slot }: { match: DlMatch; slot: number }) {
  const p = match.players.find(x => x.slot === slot)!, hero = heroOf(p.hero);
  const enemies = useMemo(() => match.players.filter(x => x.team !== p.team).map(x => x.hero), [match, p.team]);
  const [band] = useRank();
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof heroBuilds>> | null | 'error'>(null);
  const [counters, setCounters] = useState<CounterItem[] | null | 'error'>(null);
  useEffect(() => { let live = true; setMeta(null); heroBuilds(p.hero, band).then(r => live && setMeta(r), () => live && setMeta('error')); return () => { live = false; }; }, [p.hero, band]);
  useEffect(() => { let live = true; setCounters(null); counterItems(p.hero, enemies, band).then(r => live && setCounters(r), () => live && setCounters('error')); return () => { live = false; }; }, [p.hero, enemies, band]);
  const bought = (match.items[slot] ?? []).filter(i => ITEM.has(i.id));
  const first = new Map<number, number>(); for (const i of bought) if (!first.has(i.id)) first.set(i.id, i.t);
  const core = meta && meta !== 'error' ? meta.core.slice(0, 12) : [];
  const coreIds = new Set(core.map(c => c.item)), off = new Set(meta && meta !== 'error' ? meta.offMeta.map(i => i.item) : []);
  const PH = [['Laning', 0, 720], ['Mid game', 720, 1500], ['Late game', 1500, Infinity]] as const;
  return (
    <>
      <section className="recap-card">
        <h3>Buy against this enemy team</h3>
        <p className="muted small">Items that win more than usual on {hero.name} against these heroes this patch ({band.label}), from public matches: the number is how much more often games with it are won against them; the heroes, who it helps most against.</p>
        <div className="dl-enemies">{enemies.map(h => <HeroImg key={h} hero={h} size={30} />)}</div>
        {counters === null ? <Loading>Reading the item stats…</Loading> : counters === 'error' ? <p className="muted">Couldn't read the item stats (deadlock-api). Try again later.</p> : (
          <ul className="dl-counters">
            {counters.filter(c => ITEM.has(c.item)).slice(0, 8).map(c => {
              const it = ITEM.get(c.item)!, t = first.get(c.item);
              return (
                <li key={c.item} className={t !== undefined ? 'got' : ''}>
                  <ItemImg id={c.item} size={36} />
                  <span className="dl-counter-name"><b>{it.name}</b><span className="muted small">{it.cost.toLocaleString()} souls · tier {it.tier}</span></span>
                  <span className="dl-counter-vs">{c.vs.slice(0, 3).map(v => <HeroImg key={v.hero} hero={v.hero} size={20} />)}</span>
                  <span className="num dl-counter-lift">+{(c.lift * 100).toFixed(1)}%</span>
                  <span className={`dl-counter-state ${t !== undefined ? 'up' : ''}`}>{t !== undefined ? `bought ${mins(t)}` : 'not bought'}</span>
                </li>
              );
            })}
            {!counters.length && <li className="empty-state">Nothing stands out against this team: the usual build is fine.</li>}
          </ul>
        )}
      </section>

      <section className="recap-card">
        <h3>Your build</h3>
        <div className="dl-build-phases">
          {PH.map(([label, a, b]) => {
            const xs = bought.filter(i => i.t >= a && i.t < b);
            return (
              <div key={label}>
                <span className="muted small">{label}</span>
                <div className="dl-build-row">
                  {xs.map((i, k) => (
                    <span key={`${i.id}-${k}`} className="dl-build-item" title={`${ITEM.get(i.id)!.name} · ${mins(i.t)}${i.sold ? ` · sold ${mins(i.sold)}` : ''}`}>
                      <ItemImg id={i.id} size={34} dim={i.sold !== null} />
                      <span className="num">{mins(i.t)}</span>
                      {coreIds.has(i.id) ? <em className="core">core</em> : off.has(i.id) ? <em className="off">off-meta</em> : null}
                    </span>
                  ))}
                  {!xs.length && <span className="muted small">nothing</span>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="muted small">Faded: sold later. Core: in most {hero.name} builds this patch. Off-meta: rarely bought but wins more on {hero.name}.</p>
      </section>

      <section className="recap-card">
        <h3>Core items on {hero.name}</h3>
        {meta === null ? <Loading>Reading this patch's items…</Loading> : meta === 'error' ? <p className="muted">Couldn't read the item stats.</p> : (
          <div className="dl-rc-core">
            {core.map(c => {
              const t = first.get(c.item), late = t !== undefined && t - c.buyAt > 240, early = t !== undefined && c.buyAt - t > 240;
              const st = t === undefined ? 'missing' : late ? 'late' : early ? 'early' : 'ok';
              return (
                <div key={c.item} className={`dl-rc-item ${st}`} title={`${ITEM.get(c.item)?.name}: usually ${mins(c.buyAt)}, ${pct(c.share)} buy it, ${pct(c.winRate)} win`}>
                  <ItemImg id={c.item} size={40} dim={t === undefined} />
                  <span className="small">{ITEM.get(c.item)?.name}</span>
                  <span className="num small">{t === undefined ? 'not bought' : `${mins(t)}${late ? ` · ${Math.round((t - c.buyAt) / 60)} min late` : early ? ` · ${Math.round((c.buyAt - t) / 60)} min early` : ' · on time'}`}</span>
                  <span className="muted small">usually {mins(c.buyAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

// ---- objectives ------------------------------------------------------------------------------------------------

export function Objectives({ match, team, watch }: { match: DlMatch; team: DlTeam; watch: (t: number) => void }) {
  const demo = useDl(s => s.demo), names = useDl(s => s.names);
  const other = (1 - team) as DlTeam;
  const find = (tm: DlTeam, f: (o: DlObjective) => boolean) => match.objectives.find(o => o.team === tm && f(o));
  const lost = (tm: DlTeam) => match.objectives.filter(o => o.team === tm && o.destroyed !== null).length;
  // one objective: a diamond in its owner's colour, hollow once it fell (with when; click to watch)
  const Node = ({ o, label }: { o: DlObjective | undefined; label: string }) => {
    const fell = !!o && o.destroyed !== null, owner = o?.team;
    return (
      <button className={`dl-tug-node ${fell ? 'fell' : 'up'}`} disabled={!fell} onClick={() => fell && watch(o!.destroyed! - 20)}
        title={fell ? `${o!.name}: fell at ${mins(o!.destroyed!)} (watch)` : `${label}: standing`}
        style={{ ['--c' as string]: owner !== undefined ? TEAM_COLOR[owner] : 'var(--text-3)' }}>
        <i />
        <span className="num">{fell ? mins(o!.destroyed!) : ''}</span>
      </button>
    );
  };
  const KINDS = ['base guardian', 'walker', 'guardian'] as const;
  const nameOf = (slot: number | null) => { const p = match.players.find(x => x.slot === slot); return p ? names[p.account]?.name ?? heroOf(p.hero).name : null; };
  // everything big that happened, in order, with who did it (soul bags only when they were worth it)
  const feed = useMemo(() => feedEvents(match, demo).filter(e => e.kind !== 'kill' && (e.kind !== 'bag' || e.souls! >= BIG_BAG)), [match, demo]);
  return (
    <>
      <section className="recap-card">
        <div className="dl-kpis">
          <span><b className="num" style={{ color: 'var(--good)' }}>{lost(other)}</b><i>taken by {TEAM_NAME[team]}</i></span>
          <span><b className="num" style={{ color: 'var(--bad)' }}>{lost(team)}</b><i>lost</i></span>
          <span><b className="num">{match.midBoss.filter(b => b.team === team).length} / {match.midBoss.length}</b><i>Mid Bosses</i></span>
          {demo && <span><b className="num">{demo.rifts.filter(r => r.team === team).length} / {demo.rifts.filter(r => r.taken !== null).length}</b><i>Rifts</i></span>}
        </div>
        {/* each lane as a tug of war: your base on the left, theirs on the right */}
        <div className="dl-tug">
          <div className="dl-tug-head"><span style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}</span><span style={{ color: TEAM_COLOR[other] }}>{TEAM_NAME[other]}</span></div>
          {LANES.map(l => (
            <div key={l.id} className="dl-tug-lane">
              <span className="dl-tug-name"><i style={{ background: l.color }} />{l.name}</span>
              <div className="dl-tug-track">
                {KINDS.map(k => <Node key={`a${k}`} o={find(team, o => o.kind === k && o.lane === l.id)} label={k} />)}
                <span className="dl-tug-mid" />
                {[...KINDS].reverse().map(k => <Node key={`b${k}`} o={find(other, o => o.kind === k && o.lane === l.id)} label={k} />)}
              </div>
            </div>
          ))}
          <div className="dl-tug-lane base">
            <span className="dl-tug-name">Base</span>
            <div className="dl-tug-track">
              <Node o={find(team, o => o.kind === 'patron')} label="Patron" />
              <Node o={find(team, o => o.kind === 'shrine' && o.id === 10)} label="Shrine" />
              <Node o={find(team, o => o.kind === 'shrine' && o.id === 11)} label="Shrine" />
              <span className="dl-tug-mid" />
              <Node o={find(other, o => o.kind === 'shrine' && o.id === 11)} label="Shrine" />
              <Node o={find(other, o => o.kind === 'shrine' && o.id === 10)} label="Shrine" />
              <Node o={find(other, o => o.kind === 'patron')} label="Patron" />
            </div>
          </div>
          <p className="muted small dl-tug-key">Guardian, Walker, Base Guardian from the middle out; hollow ones fell (click to watch).</p>
        </div>
      </section>
      <section className="recap-card">
        <h3>Who took what</h3>
        <ul className="dl-obj-list">
          {feed.map((e, i) => {
            const by = nameOf(e.slot), side = e.team !== null ? TEAM_NAME[e.team] : '';
            const text = e.kind === 'objective' ? <>{by ?? side} destroyed <b>{e.what}</b></>
              : e.kind === 'urn' ? (e.what === 'delivered' ? <>{by} delivered the <b>urn</b> <span className="dl-feed-souls">+{e.souls!.toLocaleString()}</span></> : <>{by} picked up the <b>urn</b></>)
              : e.kind === 'urnLost' ? <>{by} lost the <b>urn</b></>
              : e.kind === 'bag' ? <>{by} took <b>{nameOf(e.victim ?? null) ?? 'a'}{e.victim !== undefined ? "'s" : ''} soul bag</b> <span className="dl-feed-souls">+{e.souls!.toLocaleString()}</span></>
              : e.kind === 'sinners' ? <>{by} took <b>Sinner's Sacrifice</b></>
              : e.kind === 'rejuv' ? <>{by} took the <b>Rejuvenator</b></>
              : e.kind === 'boss' ? <>{side} killed the <b>Mid Boss</b></>
              : <>{side} took the <b>Unstable Rift</b></>;
            return (
              <li key={i} className={e.team === team ? 'ours' : 'theirs'}>
                <span className="num muted">{mins(e.t)}</span><i style={{ background: e.team !== null ? TEAM_COLOR[e.team] : 'var(--text-3)' }} />
                <span>{text}</span><button className="chip" onClick={() => watch(e.t - 20)}>Watch</button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

// ---- win chance ------------------------------------------------------------------------------------------------

/** A team's chance to win over the match, from the coach's model, with the moments that moved it most. */
export function WinChance({ match, team, watch }: { match: DlMatch; team: DlTeam; watch: (t: number) => void }) {
  const demo = useDl(s => s.demo);
  const curve = useMemo(() => winCurve(match, demo, 15).map(c => ({ t: c.t, v: (team === 0 ? c.p : 1 - c.p) * 100 })), [match, demo, team]);
  // the biggest moves over a minute
  const moves = useMemo(() => {
    const out: { t: number; d: number }[] = [];
    for (let i = 4; i < curve.length; i++) out.push({ t: curve[i - 4].t, d: curve[i].v - curve[i - 4].v });
    const big = out.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)), kept: typeof out = [];
    for (const m of big) { if (kept.length >= 4) break; if (kept.every(k => Math.abs(k.t - m.t) > 90)) kept.push(m); }
    return kept.sort((a, b) => a.t - b.t);
  }, [curve]);
  const peak = Math.max(...curve.map(c => c.v)), low = Math.min(...curve.map(c => c.v));
  return (
    <section className="recap-card" title={`From the coach's model: ${WIN_MODEL.matches.toLocaleString()} high-rank matches since the patch; right about the winner ${Math.round(WIN_MODEL.test.accuracy * 100)}% of the time on matches it hadn't seen`}>
      <h3>Chance to win</h3>
      <div className="dl-kpis">
        <span><b className="num">{Math.round(peak)}%</b><i>highest</i></span>
        <span><b className="num">{Math.round(low)}%</b><i>lowest</i></span>
        <span><b className="num" style={{ color: match.winner === team ? 'var(--good)' : 'var(--bad)' }}>{match.winner === team ? 'Won' : 'Lost'}</b><i>{match.winner === team ? (low < 35 ? 'a comeback' : 'as expected') : (peak > 65 ? 'thrown from ahead' : 'never really ahead')}</i></span>
      </div>
      <SplitChart xticks={Array.from({ length: Math.floor(match.duration / 300) + 1 }, (_, k) => k * 300)} caption={`${TEAM_NAME[team]}'s chance to win over the match`} base={50} top={100} bottom={0} colors={[TEAM_COLOR[team], TEAM_COLOR[(1 - team) as DlTeam]]}
        points={curve} fmt={v => `${Math.round(v)}%`} xfmt={mins} onPick={watch}
        label={(() => { const big = [...moves].sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]; return big ? { t: big.t, text: `${mins(big.t)} ${big.d >= 0 ? '+' : '−'}${Math.abs(big.d).toFixed(0)}%` } : null; })()}
        dots={match.midBoss.map(b => ({ t: b.t, color: TEAM_COLOR[b.team], title: `${TEAM_NAME[b.team]} took the Mid Boss` }))} />
      {moves.length > 0 && (
        <div className="dl-win-moves">
          {moves.map(m => <button key={m.t} className={`chip ${m.d >= 0 ? 'up' : 'down'}`} onClick={() => watch(m.t)}>{mins(m.t)} · {m.d >= 0 ? '+' : '−'}{Math.abs(m.d).toFixed(0)} pts</button>)}
        </div>
      )}
    </section>
  );
}

/**
 * Where you played next to good players in your position (spots.ts): per stage, the share of your time spent where
 * they usually are; a small map of their usual spots with your path; and the longest stretches you spent where they
 * rarely go, to watch (not marked as mistakes: a flank can be right).
 */
export function Positioning({ match, slot, watch }: { match: DlMatch; slot: number; watch: (t: number) => void }) {
  const demo = useDl(s => s.demo);
  const p = useMemo(() => positioning(match, slot, demo), [match, slot, demo]);
  const team = match.players.find(x => x.slot === slot)?.team ?? 0;
  const firstLive = p ? Math.max(0, p.phases.findIndex(ph => ph.n > 0)) : 0;
  const [phase, setPhase] = useState<number | null>(null);
  if (!p) return null;
  const at = phase ?? firstLive, ph = SPOT_PHASES[at];
  const grid = spotGrid(p.pos, at, team) ?? [];
  const S = 240, cell = S / SPOT_GRID;
  const dots = p.path.filter(d => d.t >= ph.from && d.t < ph.to);
  return (
    <section className="recap-card dl-spots">
      <h3>Where you played</h3>
      <p className="muted small">Next to Pos {p.pos} players at {SPOT_SOURCE.minBadge >= 91 ? 'Phantom and up' : 'high ranks'} ({SPOT_SOURCE.matches} matches): time spent where they usually are.</p>
      <div className="dl-spots-body">
        <svg viewBox={`0 0 ${S} ${S}`} className="dl-spots-map" role="img" aria-label={`Your path from ${ph.label}, over where good Pos ${p.pos} players usually are`}>
          <image href={DL_MAP_IMAGE} width={S} height={S} opacity={0.5} />
          {grid.map((v, i) => v < 0.08 ? null : <rect key={i} x={(i % SPOT_GRID) * cell} y={Math.floor(i / SPOT_GRID) * cell} width={cell} height={cell} rx={cell * 0.2} className="dl-spots-heat" opacity={Math.min(0.55, v * 0.7)} />)}
          {dots.map(d => <circle key={d.t} cx={d.x * S} cy={d.y * S} r={2.2} className={d.usual ? 'dl-spots-dot' : 'dl-spots-dot rare'} />)}
        </svg>
        <div className="dl-spots-side">
          <div className="dl-spots-phases" role="tablist" aria-label="Stage of the match">
            {p.phases.map((x, i) => (
              <button key={x.label} role="tab" aria-selected={i === at} className={i === at ? 'on' : ''} disabled={!x.n} onClick={() => setPhase(i)}>
                <span className="muted small">{x.label}</span><b className="num">{x.n ? pct(x.usual / x.n) : '–'}</b>
              </button>
            ))}
          </div>
          {p.stretches.length > 0 && (
            <ul className="dl-spots-stretches">
              {p.stretches.map(s => (
                <li key={s.t}><span className="num muted">{mins(s.t)}</span><span>{Math.round(s.dur)} s where they rarely are</span><button className="chip" onClick={() => watch(s.t)}>Watch</button></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
