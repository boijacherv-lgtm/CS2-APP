import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../ui/Icon';
import { Loading } from '../ui/Loading';
import { DL_HEROES, heroOf } from './data';
import ITEMS from './generated/items.json';
import { draftStats, heroBuilds, heroMeta, rankOf, RANKS, readDraft, sharedMeta, suggest, type HeroMeta, type RankBand } from './meta';
import { tally, verdict, type Dir, type Patch, type PatchChange } from './patches';
import { gameplayPatches } from './patchFeed';
import { counterItems, type CounterItem } from './meta';
import { suggestBuild, type Focus, type Item } from './suggest';
import { MY_GRADES } from './DlProfile';
import { POS_JOB, POS_NAME, positionOf, POSITIONS_SOURCE, spreadOf, type Pos } from './positions';

/**
 * Tactical's meta tabs: the heroes on this patch (a tier list), one hero's builds (core items in buy order, the most
 * played in-game builds with their real win rates, off-meta items that win more), and a free draft planner (both teams'
 * chances from patch strength, pairs and matchups, with the best next pick). Data: deadlock-api, at the chosen ranks.
 */
const ITEM = new Map((ITEMS as { id: number; name: string; tier: number; cost: number; slot: string; icon: string | null }[]).map(i => [i.id, i]));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The rank band, kept in this browser. */
export function useRank(): [RankBand, (id: string) => void] {
  const [id, setId] = useState(() => { try { return localStorage.getItem('stratboard.dl.rank') ?? 'all'; } catch { return 'all'; } });
  return [rankOf(id), v => { setId(v); try { localStorage.setItem('stratboard.dl.rank', v); } catch { /* private mode */ } }];
}
function RankPick({ band, set }: { band: RankBand; set: (id: string) => void }) {
  return (
    <select className="dl-rank" value={band.id} onChange={e => set(e.target.value)} aria-label="Ranks">
      {RANKS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );
}
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; err: string | null } {
  const [data, setData] = useState<T | null>(null), [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null); setErr(null);
    load().then(d => { if (live) setData(d); }).catch(e => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err };
}
const HeroIcon = ({ id, size = 28 }: { id: number; size?: number }) => {
  const h = heroOf(id);
  return h.card ? <img className="dl-meta-hero" src={h.card} alt="" width={size} height={size} loading="lazy" /> : <span className="dl-hero-dot" style={{ background: h.color, width: size, height: size }} />;
};
/** A hero's usual position, with how often they really end up in each. */
const PosChip = ({ hero }: { hero: number }) => {
  const p = positionOf(hero), sp = spreadOf(hero);
  const tip = `Pos ${p} ${POS_NAME[p]}: ${POS_JOB[p]}${sp ? `. In real games: ${sp.map((x, i) => `Pos ${i + 1} ${Math.round(x * 100)}%`).join(', ')}` : ''}`;
  return <span className={`dl-pos p${p}`} title={tip}>Pos {p} <span className="muted">{POS_NAME[p]}</span></span>;
};
const ItemIcon = ({ id, size = 26 }: { id: number; size?: number }) => {
  const it = ITEM.get(id);
  return it?.icon ? <img className={`dl-meta-item tier${it.tier}`} src={it.icon} alt={it.name} title={`${it.name} (${it.cost.toLocaleString()})`} width={size} height={size} loading="lazy" /> : null;
};

// ---- the heroes on this patch ----------------------------------------------------------------------------------
type SortKey = 'tier' | 'win' | 'pick' | 'ban';
export function MetaHeroes({ onHero }: { onHero: (h: number) => void }) {
  const [band, setBand] = useRank();
  const [sort, setSort] = useState<SortKey>('tier');
  const [pos, setPos] = useState<number>(0);
  const [q, setQ] = useState('');
  // grouped by role (position, Pos 1 to 6), or one list; kept in this browser
  const [grouped, setGrouped] = useState(() => { try { return localStorage.getItem('stratboard.dl.metaGroup') !== '0'; } catch { return true; } });
  const toggleGroup = () => { setGrouped(g => { try { localStorage.setItem('stratboard.dl.metaGroup', g ? '0' : '1'); } catch { /* private mode */ } return !g; }); };
  const { data, err } = useLoad(() => heroMeta(band), [band.id]);
  const rows = useMemo(() => {
    if (!data) return [];
    const order = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    const by: Record<SortKey, (a: HeroMeta, b: HeroMeta) => number> = {
      tier: (a, b) => order[a.tier] - order[b.tier] || b.winRate - a.winRate, win: (a, b) => b.winRate - a.winRate,
      pick: (a, b) => b.pickRate - a.pickRate, ban: (a, b) => (b.banRate ?? 0) - (a.banRate ?? 0),
    };
    const find = q.trim().toLowerCase();
    return data.rows.filter(r => (!pos || positionOf(r.hero) === pos) && (!find || heroOf(r.hero).name.toLowerCase().includes(find))).sort(by[sort]);
  }, [data, sort, pos, q]);
  const groups = grouped ? ([1, 2, 3, 4, 5, 6] as Pos[]).map(p => ({ pos: p as Pos | null, rows: rows.filter(r => positionOf(r.hero) === p) })).filter(g => g.rows.length)
    : [{ pos: null as Pos | null, rows }];
  return (
    <section className="dl-meta">
      <div className="dl-meta-head">
        <h2>Heroes on this patch</h2>
        <RankPick band={band} set={setBand} />
        <select className="dl-rank" value={pos} onChange={e => setPos(Number(e.target.value))} aria-label="Position">
          <option value={0}>All positions</option>
          {([1, 2, 3, 4, 5, 6] as Pos[]).map(p => <option key={p} value={p}>Pos {p} · {POS_NAME[p]}</option>)}
        </select>
        <input className="dl-meta-search" type="search" placeholder="Search heroes" value={q} onChange={e => setQ(e.target.value)} aria-label="Search heroes" />
        <button className={`chip ${grouped ? 'on' : ''}`} onClick={toggleGroup} title="Split the list by role (position)">By role</button>
        {data && <span className="muted small">Since the patch of {day(data.since)}{data.patch ? ` (${data.patch.title})` : ''} · {Math.round(data.rows.reduce((a, r) => a + r.matches, 0) / 12).toLocaleString()} matches</span>}
      </div>
      {data?.early && <p className="dl-early muted small"><b>Early patch:</b> heroes marked * have under 3,000 games since the patch, so their win rate leans on the previous patch, moved by what the patch notes did to them. It sharpens as games come in.</p>}
      {err && <p className="warn-text">{err}</p>}
      {!data && !err && <Loading>Loading the meta…</Loading>}
      {data && !rows.length && <p className="empty-state">No hero matches "{q}".</p>}
      {data && (
        <table className="site-table dl-meta-table">
          <thead><tr>
            <th>Hero</th>
            {([['tier', 'Tier'], ['win', 'Win rate'], ['pick', 'Pick rate'], ['ban', 'Ban rate']] as [SortKey, string][]).map(([k, l]) => (
              <th key={k}><button className={`dl-sort ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{l}</button></th>
            ))}
            <th title="Win rate now against the previous patch">Since last patch</th><th>K / D / A</th><th className="num">Games</th><th />
          </tr></thead>
          {groups.map(g => (
            <tbody key={g.pos ?? 'all'}>
              {g.pos && (
                <tr className="dl-meta-group"><td colSpan={9}><span className={`dl-pos p${g.pos}`}>Pos {g.pos}</span> <b>{POS_NAME[g.pos]}</b> <span className="muted small">{POS_JOB[g.pos]} · {g.rows.length} {g.rows.length === 1 ? 'hero' : 'heroes'}</span></td></tr>
              )}
            {g.rows.map(r => (
                <tr key={r.hero}>
                  <td><span className="dl-meta-name"><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b>{!g.pos && <PosChip hero={r.hero} />}{r.patch && <PatchChip p={r.patch} />}</span></td>
                  <td><span className={`dl-tier t${r.tier}`}>{r.tier}</span></td>
                  <td className={`num ${r.winRate >= 0.51 ? 'up' : r.winRate < 0.49 ? 'down' : ''}`}>
                    <span className="dl-rate" title={r.early ? `Early: ${pct(r.early.raw)} from its ${r.early.games.toLocaleString()} games on this patch, leaning on the previous patch` : undefined}>{pct(r.winRate)}{r.early ? '*' : ''}<i style={{ '--w': `${Math.max(0, Math.min(1, (r.winRate - 0.44) / 0.14)) * 100}%` } as React.CSSProperties} /></span>
                  </td>
                  <td className="num"><span className="dl-rate">{pct(r.pickRate)}<i style={{ '--w': `${Math.min(1, r.pickRate / 0.6) * 100}%` } as React.CSSProperties} /></span></td>
                  <td className="num">{r.banRate === null ? '–' : pct(r.banRate)}</td>
                  <td className="num">{r.delta === undefined ? <span className="muted">–</span> : <Trend d={r.delta} before={r.before!} />}</td>
                  <td className="num muted">{r.kda.map(x => x.toFixed(1)).join(' / ')}</td>
                  <td className="num muted">{r.matches.toLocaleString()}</td>
                  <td><button className="ghost small-btn" onClick={() => onHero(r.hero)}>Builds</button></td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
      <p className="muted small">Tier from the win rate, pulled toward 50% for heroes with fewer games: S 52.5%+, A 51%+, B 49%+, C 47.5%+, D below. Pick rate: share of matches with the hero.
        Position: by farm priority (the lower the number, the more it farms), from how each hero farmed in {POSITIONS_SOURCE.matches.toLocaleString()} games since {POSITIONS_SOURCE.since.slice(0, 10)}; hover for how often they play each. Data: deadlock-api.</p>
    </section>
  );
}

// ---- one hero's builds -------------------------------------------------------------------------------------------
export function HeroBuilds({ hero, setHero }: { hero: number; setHero: (h: number) => void }) {
  const [band, setBand] = useRank();
  const { data, err } = useLoad(() => heroBuilds(hero, band), [hero, band.id]);
  return (
    <section className="dl-meta">
      <div className="dl-meta-head">
        <h2><HeroIcon id={hero} size={32} /> {heroOf(hero).name}</h2>
        <select className="dl-rank" value={hero} onChange={e => setHero(Number(e.target.value))} aria-label="Hero">
          {[...DL_HEROES].sort((a, b) => a.name.localeCompare(b.name)).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <RankPick band={band} set={setBand} />
        {data && <span className="muted small">Wins {pct(data.base)} of {data.games.toLocaleString()} games since {day(data.since)}</span>}
      </div>
      {err && <p className="warn-text">{err}</p>}
      {!data && !err && <Loading>Loading builds…</Loading>}
      {data && (
        <>
          <SuggestedBuild hero={hero} stats={data} />
          <div className="site-card">
            <div className="card-head"><h3>Core items</h3><span className="muted small">bought in over a third of games, in the order they're usually bought</span></div>
            <div className="dl-core">
              {data.core.map(i => (
                <span key={i.item} className="dl-core-item">
                  <ItemIcon id={i.item} size={40} />
                  <b className="small">{ITEM.get(i.item)?.name}</b>
                  <span className="muted small num">{mins(i.buyAt)} · {Math.round(i.share * 100)}% · {pct(i.winRate)}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="site-card">
            <div className="card-head"><h3>Most played builds</h3><span className="muted small">the game's build browser, with how they really did on this patch</span></div>
            {!data.builds.length && <p className="muted">Not enough games on one build yet.</p>}
            {data.builds.map(b => (
              <div key={b.id} className="dl-build">
                <div className="dl-build-head">
                  <b>{b.name}</b>
                  <span className={`num ${b.winRate >= data.base + 0.01 ? 'up' : b.winRate <= data.base - 0.01 ? 'down' : ''}`}>{pct(b.winRate)}</span>
                  <span className="muted small num">{b.matches.toLocaleString()} games · {b.players.toLocaleString()} players</span>
                  <CopyBuild id={b.id} />
                </div>
                <div className="dl-build-items">{b.items.filter(id => ITEM.has(id)).slice(0, 24).map(id => <ItemIcon key={id} id={id} />)}</div>
              </div>
            ))}
          </div>
          <div className="site-card">
            <div className="card-head"><h3>Off-meta items</h3><span className="muted small">rarely bought (under 12% of games) but winning 3+ points more than {heroOf(hero).name} does</span></div>
            {!data.offMeta.length ? <p className="muted">Nothing off-meta stands out on this hero right now.</p> : (
              <table className="site-table">
                <tbody>{data.offMeta.map(i => (
                  <tr key={i.item}>
                    <td><span className="dl-meta-name"><ItemIcon id={i.item} /><b>{ITEM.get(i.item)?.name}</b></span></td>
                    <td className="num up">{pct(i.winRate)}</td>
                    <td className="num muted">in {pct(i.share)} of games</td>
                    <td className="num muted">bought ~{mins(i.buyAt)}</td>
                    <td className="num muted">{i.matches.toLocaleString()} games</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p className="muted small">An item bought late wins more partly because the game went well enough to afford it: compare the buy times, and treat these as ideas to try, not proof.</p>
          </div>
        </>
      )}
    </section>
  );
}

// ---- the draft planner ---------------------------------------------------------------------------------------------
export function Draft() {
  const [band, setBand] = useRank();
  const [teams, setTeams] = useState<[number[], number[]]>(() => { try { return JSON.parse(localStorage.getItem('stratboard.dl.draft') ?? '[[],[]]'); } catch { return [[], []]; } });
  // every change from the latest teams (quick clicks one after another all count)
  const update = (f: (t: [number[], number[]]) => [number[], number[]]) => setTeams(cur => {
    const next = f(cur);
    try { localStorage.setItem('stratboard.dl.draft', JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const save = (t: [number[], number[]]) => update(() => t);
  const [side, setSide] = useState<0 | 1>(0);
  const [q, setQ] = useState('');
  const { data, err } = useLoad(() => draftStats(band), [band.id]);
  const stats = useMemo(() => data && { ...data, spreadOf, posOf: positionOf, nameOf: (h: number) => heroOf(h).name }, [data]);
  const read = useMemo(() => stats && (teams[0].length || teams[1].length) ? readDraft(teams, stats) : null, [stats, teams]);
  const pool = DL_HEROES.map(h => h.id);
  const ideas = useMemo(() => stats && teams[side].length < 6 ? suggest(teams, side, pool, stats) : [], [stats, teams, side]); // eslint-disable-line react-hooks/exhaustive-deps
  const taken = new Set([...teams[0], ...teams[1]]);
  const add = (h: number, t: 0 | 1 = side) => update(cur => {
    if (cur[0].includes(h) || cur[1].includes(h) || cur[t].length >= 6) return cur;
    const n: [number[], number[]] = [[...cur[0]], [...cur[1]]]; n[t].push(h); return n;
  });
  const drop = (h: number, t: 0 | 1) => update(cur => { const n: [number[], number[]] = [[...cur[0]], [...cur[1]]]; n[t] = n[t].filter(x => x !== h); return n; });
  const NAMES = ['Amber Hand', 'Sapphire Flame'];
  return (
    <section className="dl-meta">
      <div className="dl-meta-head">
        <h2>Draft</h2>
        <RankPick band={band} set={setBand} />
        <button className="ghost small-btn" onClick={() => save([[], []])}>Clear</button>
        <span className="muted small">Up to 6 heroes a side, any order. Click a hero to add it to the side you're picking for.</span>
      </div>
      {err && <p className="warn-text">{err}</p>}
      <div className="dl-draft">
        {([0, 1] as const).map(t => (
          <div key={t} className={`dl-draft-team t${t} ${side === t ? 'on' : ''}`} onClick={() => setSide(t)}>
            <div className="dl-draft-team-head">
              <b>{NAMES[t]}</b>
              {read && <span className="num dl-draft-p">{pct(t === 0 ? read.p : 1 - read.p)}</span>}
            </div>
            <div className="dl-draft-slots">
              {Array.from({ length: 6 }, (_, i) => teams[t][i]).map((h, i) => h === undefined
                ? <span key={i} className="dl-draft-slot empty">{side === t && i === teams[t].length ? 'pick…' : ''}</span>
                : <button key={i} className="dl-draft-slot" onClick={e => { e.stopPropagation(); drop(h, t); }} title={`${heroOf(h).name}: click to remove`}><HeroIcon id={h} size={40} /><span className="small">{heroOf(h).name}</span></button>)}
            </div>
            {read && (
              <div className="muted small">
                {teams[t].map(h => `${heroOf(h).name} Pos ${read.roles[t].pos[h]}`).join(' · ')}
                {read.roles[t].missing.length > 0 && <span className="warn-text"> · no {read.roles[t].missing.map(p => `Pos ${p} ${POS_NAME[p as Pos]}`).join(', ')}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      {read && (
        <div className="site-card">
          <div className="card-head"><h3>Read</h3><span className="muted small">patch strength + pairs + matchups (log-odds), from {band.label.toLowerCase()} games</span></div>
          <table className="site-table"><thead><tr><th /><th className="num">Heroes</th><th className="num">Pairs</th><th className="num">Matchups</th></tr></thead>
            <tbody>{([0, 1] as const).map(t => <tr key={t}><td>{NAMES[t]}</td>{(['meta', 'synergy', 'counters'] as const).map(k => <td key={k} className={`num ${read.parts[t][k] > 0.02 ? 'up' : read.parts[t][k] < -0.02 ? 'down' : ''}`}>{read.parts[t][k] >= 0 ? '+' : ''}{read.parts[t][k].toFixed(2)}</td>)}</tr>)}</tbody>
          </table>
          {read.notes.length > 0 && <ul className="dl-draft-notes">{read.notes.map((n, i) => <li key={i}><b>{NAMES[n.team]}:</b> {n.text}</li>)}</ul>}
          <p className="muted small">A draft decides part of a match, not all of it: this is how such line-ups have done, not a prediction of yours.</p>
        </div>
      )}
      {ideas.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h3>Best next for {NAMES[side]}</h3><span className="muted small">how much each would move the read</span></div>
          <div className="dl-draft-ideas">{ideas.map(x => (
            <button key={x.hero} className="dl-draft-idea" onClick={() => add(x.hero)}><HeroIcon id={x.hero} size={36} /><span className="small">{heroOf(x.hero).name}</span><b className="num up small">+{(x.p * 100).toFixed(1)}</b></button>
          ))}</div>
        </div>
      )}
      <div className="site-card">
        <div className="card-head"><h3>Heroes</h3><input className="dl-draft-search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="dl-draft-pool">
          {[...DL_HEROES].sort((a, b) => a.name.localeCompare(b.name)).filter(h => h.name.toLowerCase().includes(q.toLowerCase())).map(h => (
            <button key={h.id} className="dl-draft-hero" disabled={taken.has(h.id)} onClick={() => add(h.id)} title={`${h.name}: usually Pos ${positionOf(h.id)} ${POS_NAME[positionOf(h.id)]}`}>
              <HeroIcon id={h.id} size={36} /><span className="small">{h.name}</span>
            </button>
          ))}
        </div>
      </div>
      {!data && !err && <Loading>Loading matchups…</Loading>}
    </section>
  );
}

/** Rising / falling: the win rate now against the previous patch (1.5 points or more either way is called out). */
function Trend({ d, before }: { d: number; before: number }) {
  const pts = d * 100, big = Math.abs(pts) >= 1.5;
  return (
    <span className={`dl-trend ${pts > 0 ? 'up' : pts < 0 ? 'down' : ''} ${big ? 'big' : ''}`} title={`${pct(before)} on the previous patch`}>
      {pts > 0 ? '▲' : pts < 0 ? '▼' : ''} {Math.abs(pts).toFixed(1)}{big ? (pts > 0 ? ' rising' : ' falling') : ''}
    </span>
  );
}
/** "Buffed", "Nerfed", "Mixed": what the current patch did to a hero, with its lines on hover. */
function PatchChip({ p }: { p: { buffs: number; nerfs: number; verdict: string; lines: PatchChange[] } }) {
  return (
    <span className={`dl-patch ${p.verdict}`} title={p.lines.map(l => `${l.dir > 0 ? '+' : l.dir < 0 ? '−' : '·'} ${l.ability ? `${l.ability}: ` : ''}${l.text}`).join('\n')}>
      {p.verdict}
    </span>
  );
}
const DIR_MARK: Record<Dir, string> = { 1: 'buff', 0: 'change', [-1]: 'nerf' } as Record<Dir, string>;

/**
 * Tactical → Patch: the newest gameplay update, read: every hero's and item's changes marked buff / nerf (from the
 * numbers and wording), the general changes, and how heroes have moved since (win rate against the previous patch).
 */
export function PatchView({ onHero }: { onHero: (hero: number) => void }) {
  const [band] = useRank();
  const notes = useLoad(() => sharedMeta().then(s => s?.patches ?? gameplayPatches()), []);
  const meta = useLoad(() => heroMeta(band), [band.id]);
  const [pick, setPick] = useState(0);
  if (notes.err) return <p className="warn-text">{notes.err}</p>;
  if (!notes.data) return <Loading>Reading the patch notes…</Loading>;
  if (!notes.data.length) return <p className="empty-state">No gameplay updates in the patch notes feed.</p>;
  const p: Patch = notes.data[Math.min(pick, notes.data.length - 1)];
  const heroes = [...tally(p.changes, 'hero')].sort((a, b) => (b[1].buffs - b[1].nerfs) - (a[1].buffs - a[1].nerfs));
  const items = [...tally(p.changes, 'item')];
  const general = p.changes.filter(c => c.kind === 'general');
  const movers = (meta.data?.rows ?? []).filter(r => r.delta !== undefined && Math.abs(r.delta) >= 0.015).sort((a, b) => b.delta! - a.delta!);
  const line = (c: PatchChange, i: number) => (
    <li key={i} className={`dl-pl ${DIR_MARK[c.dir]}`}><i aria-label={DIR_MARK[c.dir]}>{c.dir > 0 ? '+' : c.dir < 0 ? '−' : '·'}</i><span>{c.ability && <b>{c.ability}: </b>}{c.text}</span></li>
  );
  return (
    <section className="dl-meta dl-patchview">
      <div className="dl-meta-head">
        <h2>Patch notes</h2>
        <select className="dl-rank" value={pick} onChange={e => setPick(Number(e.target.value))} aria-label="Update">
          {notes.data.map((x, i) => <option key={x.at} value={i}>{day(x.at)} · {x.title}</option>)}
        </select>
        <a className="muted small" href={p.link} target="_blank" rel="noreferrer">Official notes</a>
      </div>
      <p className="muted small">Read from Deadlock's own changelog and Steam news (deadlock-api feed). Each line is marked buff, nerf or neutral from its numbers and wording (a shorter cooldown is a buff); the meta uses this patch's date and, early on, these buffs and nerfs.</p>

      {pick === 0 && movers.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h2>Moved most since the previous patch</h2><span className="muted small">{band.label} · win rate now vs before</span></div>
          <div className="dl-movers">
            {movers.slice(0, 6).map(r => <button key={r.hero} className="dl-mover up" onClick={() => onHero(r.hero)}><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b><Trend d={r.delta!} before={r.before!} /></button>)}
            {movers.slice(-6).reverse().filter(r => r.delta! < 0).map(r => <button key={r.hero} className="dl-mover down" onClick={() => onHero(r.hero)}><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b><Trend d={r.delta!} before={r.before!} /></button>)}
          </div>
        </div>
      )}

      <div className="site-card">
        <div className="card-head"><h2>Heroes</h2><span className="muted small">{heroes.length} changed · {heroes.filter(([, t]) => verdict(t) === 'buffed').length} buffed · {heroes.filter(([, t]) => verdict(t) === 'nerfed').length} nerfed</span></div>
        <div className="dl-patch-grid">
          {heroes.map(([id, t]) => (
            <div key={id} className="dl-patch-card">
              <button className="dl-patch-who" onClick={() => onHero(id)} title="This hero's builds"><HeroIcon id={id} /><b>{heroOf(id).name}</b><PatchChip p={{ ...t, verdict: verdict(t) }} /></button>
              <ul>{t.lines.map(line)}</ul>
            </div>
          ))}
        </div>
      </div>
      {items.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h2>Items</h2><span className="muted small">{items.length} changed</span></div>
          <div className="dl-patch-grid">
            {items.map(([id, t]) => {
              const it = ITEM.get(id);
              return (
                <div key={id} className="dl-patch-card">
                  <div className="dl-patch-who">{it?.icon && <img className="dl-meta-item" src={it.icon} alt="" width={26} height={26} />}<b>{it?.name ?? id}</b><PatchChip p={{ ...t, verdict: verdict(t) }} /></div>
                  <ul>{t.lines.map(line)}</ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {general.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h2>General</h2></div>
          <ul className="dl-patch-general">{general.map(line)}</ul>
        </div>
      )}
    </section>
  );
}

/**
 * The coach's build for you (suggest.ts): your position, a weapon / spirit / mixed focus, staying alive, helping the
 * team and the enemy heroes; your report card (Profile → Deadlock) fills in what you're weak at. Twelve items in three
 * phases, each with why.
 */
function SuggestedBuild({ hero, stats }: { hero: number; stats: Awaited<ReturnType<typeof heroBuilds>> }) {
  const [band] = useRank();
  const mine = useMemo(() => { try { return JSON.parse(localStorage.getItem(MY_GRADES) ?? 'null') as { games: number; parts: Record<string, number | null> } | null; } catch { return null; } }, []);
  const weak = mine ? Object.entries(mine.parts).filter(([, v]) => v !== null && v < 45).map(([k]) => k) : [];
  // the hero's own lean: spirit or weapon, from its core items
  const lean: Focus = (() => {
    const c = stats.core.map(i => ITEM.get(i.item)?.slot);
    const sp = c.filter(x => x === 'spirit').length, wp = c.filter(x => x === 'weapon').length;
    return sp > wp + 1 ? 'spirit' : wp > sp + 1 ? 'weapon' : 'mixed';
  })();
  const [pos, setPos] = useState<Pos>(positionOf(hero));
  const [focus, setFocus] = useState<Focus>(lean);
  const [survive, setSurvive] = useState(weak.includes('survival'));
  const [support, setSupport] = useState(positionOf(hero) >= 5);
  const [enemies, setEnemies] = useState<number[]>([]);
  const [counters, setCounters] = useState<CounterItem[]>([]);
  useEffect(() => { setPos(positionOf(hero)); setFocus(lean); setSupport(positionOf(hero) >= 5); }, [hero]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!enemies.length) { setCounters([]); return; }
    counterItems(hero, enemies, band).then(c => live && setCounters(c), () => live && setCounters([]));
    return () => { live = false; };
  }, [hero, enemies, band]);
  const build = useMemo(() => suggestBuild(stats, ITEM as unknown as Map<number, Item>, { focus, survive, support }, counters, h => heroOf(h).name),
    [stats, focus, survive, support, counters]);
  const total = build.phases.reduce((a, p) => a + p.cost, 0);
  return (
    <div className="site-card dl-sugg">
      <div className="card-head"><h3>The coach's build for you</h3><span className="muted small">{total.toLocaleString()} souls · from {stats.games.toLocaleString()} games on this patch</span></div>
      <div className="dl-sugg-opts">
        <label>Position <select className="dl-rank" value={pos} onChange={e => { const p = Number(e.target.value) as Pos; setPos(p); setSupport(p >= 5); }}>
          {([1, 2, 3, 4, 5, 6] as Pos[]).map(p => <option key={p} value={p}>Pos {p} · {POS_NAME[p]}</option>)}
        </select></label>
        <span className="dl-sugg-seg" role="group" aria-label="Focus">
          {(['weapon', 'spirit', 'mixed'] as Focus[]).map(f => <button key={f} className={`chip ${focus === f ? 'on' : ''}`} onClick={() => setFocus(f)}>{f === 'weapon' ? 'Gun' : f === 'spirit' ? 'Spirit' : 'Mixed'}{f === lean ? ' ·' : ''}</button>)}
        </span>
        <button className={`chip ${survive ? 'on' : ''}`} onClick={() => setSurvive(!survive)}>Survive more</button>
        <button className={`chip ${support ? 'on' : ''}`} onClick={() => setSupport(!support)}>Help the team</button>
        <label>Against <select className="dl-rank" value="" onChange={e => { const h = Number(e.target.value); if (h && !enemies.includes(h) && enemies.length < 6) setEnemies([...enemies, h]); }}>
          <option value="">add an enemy…</option>
          {[...DL_HEROES].filter(h => h.id !== hero && !enemies.includes(h.id)).sort((a, b) => a.name.localeCompare(b.name)).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select></label>
        {enemies.map(h => <button key={h} className="dl-sugg-enemy" onClick={() => setEnemies(enemies.filter(x => x !== h))} title="Remove"><HeroIcon id={h} size={22} /><Icon name="close" size={11} /></button>)}
      </div>
      {mine && <p className="muted small dl-sugg-me">From your report card ({mine.games} games): {weak.length ? <>weakest at <b>{weak.join(', ')}</b>{weak.includes('survival') ? ', so it starts with Survive more on' : ''}.</> : 'nothing below average, so it builds for the hero.'}</p>}
      {!mine && <p className="muted small dl-sugg-me">Open Profile → Deadlock once and the coach also builds around what you're weak at.</p>}
      <div className="dl-sugg-phases">
        {build.phases.map(ph => (
          <div key={ph.name} className="dl-sugg-phase">
            <div className="dl-sugg-ph-head"><b>{ph.name}</b><span className="muted small">{ph.cost.toLocaleString()} souls</span></div>
            {ph.picks.map(p => (
              <div key={p.item.id} className={`dl-sugg-item s-${p.item.slot}`}>
                <ItemIcon id={p.item.id} size={34} />
                <span><b>{p.item.name}</b><span className="muted small">{mins(p.buyAt)} · {p.why.join(' · ') || `${p.item.slot}`}</span></span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The build's ID for the game's own build browser: copy it, then in Deadlock search it under Builds and subscribe. */
export function CopyBuild({ id, short }: { id: number; short?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button className="ghost small-btn dl-copy-build" title="In Deadlock: open the hero's Builds, search this build ID, then subscribe to it"
      onClick={async () => { try { await navigator.clipboard.writeText(String(id)); setDone(true); setTimeout(() => setDone(false), 2500); } catch { /* no clipboard: the ID is in the title */ } }}>
      <Icon name={done ? 'check' : 'copy'} size={13} /> {done ? (short ? 'Copied' : 'Copied: search it in Builds') : short ? 'Copy ID' : `Copy build ID ${id}`}
    </button>
  );
}
