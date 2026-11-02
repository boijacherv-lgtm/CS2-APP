/**
 * Match recap's bigger parts: the scoreboard, both teams' souls, economy, items (with what to buy against this enemy
 * team) and objectives.
 */
import { useEffect, useMemo, useState } from 'react';
import { matchPosition } from './bench';
import { heroOf, LANES, objectiveSpot, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import { useRank } from './DlMeta';
import { LinesChart } from './DlCharts';
import { economy, laneOpponent, teamSouls, unspentAtDeaths, worthAt } from './grade';
import { playerAt, statAt, type DlMatch, type DlObjective } from './match';
import { counterItems, heroBuilds, type CounterItem } from './meta';
import { useDl } from './store';
import ITEMS from './generated/items.json';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
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
      <h3>Souls: {TEAM_NAME[team]} against {TEAM_NAME[other]}</h3>
      <div className="dl-kpis">
        <span><b className="num" style={{ color: endLead >= 0 ? 'var(--good)' : 'var(--bad)' }}>{sign(endLead)}</b><i>at the end</i></span>
        <span><b className="num">{best > 0 ? sign(best) : '–'}</b><i>biggest lead</i></span>
        <span><b className="num">{worst < 0 ? sign(worst) : '–'}</b><i>furthest behind</i></span>
        <span><b className="num">{(pts.at(-1)!.v[team] / 1000).toFixed(1)}k / {(pts.at(-1)!.v[other] / 1000).toFixed(1)}k</b><i>souls</i></span>
      </div>
      <LinesChart gap height={230}
        series={[{ label: TEAM_NAME[team], color: TEAM_COLOR[team], points: pts.map(p => ({ t: p.t, v: p.v[team] })) },
          { label: TEAM_NAME[other], color: TEAM_COLOR[other], points: pts.map(p => ({ t: p.t, v: p.v[other] })) }]}
        marks={match.midBoss.map(b => ({ t: b.t, color: TEAM_COLOR[b.team], label: `${TEAM_NAME[b.team]} took the Mid Boss` }))} />
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
          {carried.length > 0 && <li className="is-down"><b>Died holding souls</b> {carried.length}×: {carried.slice(0, 4).map(u => <button key={u.t} className="chip" onClick={() => watch(u.t)}>{mins(u.t)} · {(u.unspent / 1000).toFixed(1)}k</button>)} Spend before a fight or a risky push.</li>}
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
        {counters === null ? <p className="muted">Reading the item stats…</p> : counters === 'error' ? <p className="muted">Couldn't read the item stats (deadlock-api). Try again later.</p> : (
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
            {!counters.length && <li className="muted">Nothing stands out against this team: the usual build is fine.</li>}
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
        {meta === null ? <p className="muted">Reading this patch's items…</p> : meta === 'error' ? <p className="muted">Couldn't read the item stats.</p> : (
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
  const demo = useDl(s => s.demo);
  const other = (1 - team) as DlTeam;
  const find = (tm: DlTeam, f: (o: DlObjective) => boolean) => match.objectives.find(o => o.team === tm && f(o));
  // who stood by it when it fell (a twelfth of the map)
  const there = (o: DlObjective) => {
    const sp = objectiveSpot(o.team, o.id);
    return sp && o.destroyed !== null ? match.players.filter(p => { const a = playerAt(match, p.slot, o.destroyed! - 1); return !!a && Math.hypot(a.x - sp.x, a.y - sp.y) < 0.085; }) : [];
  };
  const Cell = ({ o }: { o: DlObjective | undefined }) => {
    // the match data lists only objectives that were attacked: one that isn't was never touched
    if (!o) return <span className="dl-obj-cell up" title="Never attacked">standing</span>;
    const fell = o.destroyed !== null;
    return (
      <button className={`dl-obj-cell ${fell ? 'fell' : 'up'}`} disabled={!fell} onClick={() => fell && watch(o.destroyed! - 20)} title={fell ? `Fell at ${mins(o.destroyed!)}: watch` : 'Standing at the end'}>
        {fell ? <b className="num">{mins(o.destroyed!)}</b> : <span>standing</span>}
        {fell && <span className="dl-obj-there">{there(o).filter(p => p.team !== o.team).slice(0, 5).map(p => <HeroImg key={p.slot} hero={p.hero} size={16} />)}</span>}
      </button>
    );
  };
  const KINDS = [['guardian', 'Guardian'], ['walker', 'Walker'], ['base guardian', 'Base Guardian']] as const;
  const lost = (tm: DlTeam) => match.objectives.filter(o => o.team === tm && o.destroyed !== null).length;
  const events = [
    ...match.objectives.filter(o => o.destroyed !== null).map(o => ({ t: o.destroyed!, side: o.team === team ? 'lost' : 'took', label: o.name, color: TEAM_COLOR[(1 - o.team) as DlTeam] })),
    ...match.midBoss.map(b => ({ t: b.t, side: b.team === team ? 'took' : 'lost', label: 'Mid Boss', color: TEAM_COLOR[b.team] })),
    ...(demo?.rifts ?? []).filter(r => r.taken !== null && r.team !== null).map(r => ({ t: r.taken!, side: r.team === team ? 'took' : 'lost', label: 'Unstable Rift', color: TEAM_COLOR[r.team!] })),
  ].sort((a, b) => a.t - b.t);
  return (
    <>
      <section className="recap-card">
        <h3>Objectives</h3>
        <div className="dl-kpis">
          <span><b className="num" style={{ color: 'var(--good)' }}>{lost(other)}</b><i>taken by {TEAM_NAME[team]}</i></span>
          <span><b className="num" style={{ color: 'var(--bad)' }}>{lost(team)}</b><i>lost by {TEAM_NAME[team]}</i></span>
          <span><b className="num">{match.midBoss.filter(b => b.team === team).length} / {match.midBoss.length}</b><i>Mid Bosses</i></span>
          {demo && <span><b className="num">{demo.rifts.filter(r => r.team === team).length} / {demo.rifts.filter(r => r.taken !== null).length}</b><i>Rifts</i></span>}
        </div>
        <div className="dl-obj-strip" aria-label="When they fell">
          {events.map((e, i) => (
            <button key={i} className={`dl-obj-tick ${e.side}`} style={{ left: `${(e.t / match.duration) * 100}%`, background: e.color }} title={`${mins(e.t)} · ${e.side === 'took' ? 'took' : 'lost'} ${e.label}`} onClick={() => watch(e.t - 20)} />
          ))}
          <span className="dl-obj-strip-l small muted">took ↑</span><span className="dl-obj-strip-r small muted">lost ↓</span>
        </div>
        <div className="dl-obj-axis">{Array.from({ length: Math.floor(match.duration / 300) + 1 }, (_, i) => <span key={i} className="small muted num" style={{ left: `${((i * 300) / match.duration) * 100}%` }}>{i * 5}m</span>)}</div>
      </section>
      {([team, other] as DlTeam[]).map(tm => (
        <section key={tm} className="recap-card">
          <h3 style={{ color: TEAM_COLOR[tm] }}>{TEAM_NAME[tm]}'s objectives{tm === team ? '' : ' (theirs)'}</h3>
          <div className="dl-obj-grid">
            <span />{KINDS.map(([, label]) => <span key={label} className="muted small">{label}</span>)}
            {LANES.map(l => (
              <div key={l.id} className="dl-obj-lane">
                <span className="dl-obj-lane-name"><i style={{ background: l.color }} />{l.name}</span>
                {KINDS.map(([kind]) => <Cell key={kind} o={find(tm, o => o.kind === kind && o.lane === l.id)} />)}
              </div>
            ))}
          </div>
          <div className="dl-obj-base">
            {[find(tm, o => o.kind === 'shrine' && o.id === 10), find(tm, o => o.kind === 'shrine' && o.id === 11), find(tm, o => o.kind === 'titan'), find(tm, o => o.kind === 'patron')].map((o, i) => (
              <div key={i}><span className="muted small">{['Shrine 1', 'Shrine 2', 'Patron (weakened)', 'Patron'][i]}</span><Cell o={o} /></div>
            ))}
          </div>
          <p className="muted small">Heroes on a fallen objective: the attackers who were there.</p>
        </section>
      ))}
      <section className="recap-card">
        <h3>Mid Boss{demo?.rifts.length ? ' and Rifts' : ''}</h3>
        <ul className="dl-obj-list">
          {events.filter(e => e.label === 'Mid Boss' || e.label === 'Unstable Rift').map((e, i) => (
            <li key={i}><span className="num muted">{mins(e.t)}</span><i style={{ background: e.color }} /><span>{e.side === 'took' ? `${TEAM_NAME[team]} took` : `${TEAM_NAME[other]} took`} the <b>{e.label}</b></span><button className="chip" onClick={() => watch(e.t - 20)}>Watch</button></li>
          ))}
          {!events.some(e => e.label === 'Mid Boss' || e.label === 'Unstable Rift') && <li className="muted">Nobody took the Mid Boss.</li>}
        </ul>
      </section>
    </>
  );
}

