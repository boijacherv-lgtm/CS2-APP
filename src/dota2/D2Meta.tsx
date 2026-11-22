import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { tally, verdict, type Dir, type PatchChange } from '../engine/patchWords';
import { Loading } from '../ui/Loading';
import { abilityById, D2_HEROES, heroOf, itemById, itemByKey, ITEM_ICONS } from './data';
import { mainPosition, POSITION_INFO, type HeroPairs, type Position } from './draft';
import { TalentTree } from './D2Talents';
import { useHeroData } from './gameData';
import { buildsFrom, heroBuildGames, heroItems, heroMeta, heroStats, patchChanges, patchList, patchNotes, rankOf, RANKS, STAGES, type HeroMeta, type PatchInfo, type RankBand } from './meta';

/**
 * Meta & builds' own tabs for Dota 2, like Deadlock's: the heroes on this patch as a tier list by position, the newest
 * patch notes read into buffs and nerfs, and one hero's items by stage with this patch's changes and talents.
 */
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const POSITIONS: Position[] = [1, 2, 3, 4, 5];

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
/** The rank band, kept in this browser. */
function useRank(): [RankBand, (id: string) => void] {
  const [id, setId] = useState(() => { try { return localStorage.getItem('stratboard.d2.rank') ?? 'all'; } catch { return 'all'; } });
  return [rankOf(id), v => { setId(v); try { localStorage.setItem('stratboard.d2.rank', v); } catch { /* private mode */ } }];
}
/** Who plays where: pros' positions and the game's tags, as the draft uses them. */
function usePairs(): HeroPairs | null {
  const [pairs, setPairs] = useState<HeroPairs | null>(null);
  useEffect(() => {
    void Promise.all([import('./generated/heroPairs.json'), import('./generated/heroPositions.json')])
      .then(([p, positions]) => setPairs({ ...p.default, positions: positions.default.heroes }));
  }, []);
  return pairs;
}
/** The newest patch and what it did to each hero and item. */
function usePatch(): { patch: PatchInfo | null; heroes: Map<number, ReturnType<typeof tallied>>; items: Map<number, ReturnType<typeof tallied>> } {
  const { data } = useLoad(async () => {
    const [newest] = await patchList(1);
    return { newest, changes: newest ? changesOf(await patchNotes(newest.name)) : [] };
  }, []);
  return useMemo(() => ({
    patch: data?.newest ?? null,
    heroes: new Map([...tally(data?.changes ?? [], 'hero')].map(([id, t]) => [id, tallied(t)])),
    items: new Map([...tally(data?.changes ?? [], 'item')].map(([id, t]) => [id, tallied(t)])),
  }), [data]);
}
const tallied = (t: { buffs: number; nerfs: number; lines: PatchChange[] }) => ({ ...t, verdict: verdict(t) });
const changesOf = (notes: Awaited<ReturnType<typeof patchNotes>>) => patchChanges(notes, id => abilityById(id)?.name ?? null, id => itemById.get(id)?.name ?? null);

const HeroIcon = ({ id, size = 28 }: { id: number; size?: number }) => {
  const h = heroOf(id);
  return h.icon ? <img className="dl-meta-hero" src={h.icon} alt="" width={size} height={size} loading="lazy" /> : <span className="dl-hero-dot" style={{ width: size, height: size }} />;
};
const ItemIcon = ({ id, size = 34 }: { id: number; size?: number }) => {
  const it = itemById.get(id);
  return it?.icon ? <img className="dl-meta-item" src={it.icon} alt={it.name} title={`${it.name}${it.cost ? ` (${it.cost.toLocaleString()} gold)` : ''}`} width={Math.round(size * 1.375)} height={size} loading="lazy" /> : null;
};
const PosChip = ({ p }: { p: Position }) => <span className={`dl-pos p${p}`} title={POSITION_INFO[p].job}>Pos {p} <span className="muted">{POSITION_INFO[p].name}</span></span>;
/** "Buffed", "Nerfed", "Mixed": what the newest patch did, its lines on hover. */
function PatchChip({ p }: { p: { verdict: string; lines: PatchChange[] } }) {
  return <span className={`dl-patch ${p.verdict}`} title={p.lines.map(l => `${MARK[l.dir]} ${l.ability ? `${l.ability}: ` : ''}${l.text}`).join('\n')}>{p.verdict}</span>;
}
const MARK: Record<Dir, string> = { 1: '+', 0: '·', [-1]: '−' } as Record<Dir, string>;
const DIR_CLASS: Record<Dir, string> = { 1: 'buff', 0: 'change', [-1]: 'nerf' } as Record<Dir, string>;
function Trend({ now, before }: { now: number; before: number }) {
  const pts = (now - before) * 100, big = Math.abs(pts) >= 1.5;
  return (
    <span className={`dl-trend ${pts > 0 ? 'up' : pts < 0 ? 'down' : ''} ${big ? 'big' : ''}`} title={`${pct(before)} before the patch`}>
      {pts > 0 ? '▲' : pts < 0 ? '▼' : ''} {Math.abs(pts).toFixed(1)}{big ? (pts > 0 ? ' rising' : ' falling') : ''}
    </span>
  );
}

// ---- the heroes on this patch ----------------------------------------------------------------------------------
type SortKey = 'tier' | 'win' | 'pick' | 'ban';
export function MetaHeroes({ onHero }: { onHero: (h: number) => void }) {
  const [band, setBand] = useRank();
  const [sort, setSort] = useState<SortKey>('tier');
  const [pos, setPos] = useState<number>(0);
  const [q, setQ] = useState('');
  const [grouped, setGrouped] = useState(() => { try { return localStorage.getItem('stratboard.d2.metaGroup') !== '0'; } catch { return true; } });
  const toggleGroup = () => { setGrouped(g => { try { localStorage.setItem('stratboard.d2.metaGroup', g ? '0' : '1'); } catch { /* private mode */ } return !g; }); };
  const stats = useLoad(heroStats, []);
  const patch = usePatch(), pairs = usePairs();
  const all = useMemo(() => (stats.data ? heroMeta(stats.data, band, patch.patch?.at ?? null) : null), [stats.data, band, patch.patch]);
  const posOf = (h: number): Position => (pairs ? mainPosition(pairs, h) : 1);
  const rows = useMemo(() => {
    if (!all) return [];
    const order = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    const by: Record<SortKey, (a: HeroMeta, b: HeroMeta) => number> = {
      tier: (a, b) => order[a.tier] - order[b.tier] || b.winRate - a.winRate, win: (a, b) => b.winRate - a.winRate,
      pick: (a, b) => b.pickRate - a.pickRate, ban: (a, b) => (b.banRate ?? 0) - (a.banRate ?? 0),
    };
    const find = q.trim().toLowerCase();
    return all.filter(r => r.games > 0 && (!pos || posOf(r.hero) === pos) && (!find || heroOf(r.hero).name.toLowerCase().includes(find))).sort(by[sort]);
  }, [all, sort, pos, q, pairs]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = grouped ? POSITIONS.map(p => ({ pos: p as Position | null, rows: rows.filter(r => posOf(r.hero) === p) })).filter(g => g.rows.length) : [{ pos: null as Position | null, rows }];
  const matches = all ? Math.round(all.reduce((a, r) => a + r.games, 0) / 10) : 0;
  return (
    <section className="dl-meta">
      <div className="dl-meta-head">
        <h2>Heroes on this patch</h2>
        <select className="dl-rank" value={band.id} onChange={e => setBand(e.target.value)} aria-label="Ranks">
          {RANKS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select className="dl-rank" value={pos} onChange={e => setPos(Number(e.target.value))} aria-label="Position">
          <option value={0}>All positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>Pos {p} · {POSITION_INFO[p].name}</option>)}
        </select>
        <input className="dl-meta-search" type="search" placeholder="Search heroes" value={q} onChange={e => setQ(e.target.value)} aria-label="Search heroes" />
        <button className={`chip ${grouped ? 'on' : ''}`} onClick={toggleGroup} title="Split the list by position">By role</button>
        {all && <span className="muted small">The last 7 days · {matches.toLocaleString()} matches{patch.patch ? ` · patch ${patch.patch.name} since ${day(patch.patch.at)}` : ''}</span>}
      </div>
      {stats.err && <p className="warn-text">{stats.err}</p>}
      {!all && !stats.err && <Loading>Loading the meta…</Loading>}
      {all && !rows.length && <p className="empty-state">No hero matches "{q}".</p>}
      {all && rows.length > 0 && (
        <table className="site-table dl-meta-table">
          <thead><tr>
            <th>Hero</th>
            {([['tier', 'Tier'], ['win', 'Win rate'], ['pick', 'Pick rate'], ['ban', 'Pro bans']] as [SortKey, string][]).map(([k, l]) => (
              <th key={k}><button className={`dl-sort ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{l}</button></th>
            ))}
            <th title="Public matches at all ranks: win rate since the patch against before it">Since the patch</th><th className="num" title="Picks / bans in pro matches this week">Pro</th><th className="num">Games</th><th />
          </tr></thead>
          {groups.map(g => (
            <tbody key={g.pos ?? 'all'}>
              {g.pos && (
                <tr className="dl-meta-group"><td colSpan={9}><span className={`dl-pos p${g.pos}`}>Pos {g.pos}</span> <b>{POSITION_INFO[g.pos].name}</b> <span className="muted small">{POSITION_INFO[g.pos].job} · {g.rows.length} {g.rows.length === 1 ? 'hero' : 'heroes'}</span></td></tr>
              )}
              {g.rows.map(r => {
                const changed = patch.heroes.get(r.hero);
                return (
                  <tr key={r.hero}>
                    <td><span className="dl-meta-name"><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b>{!g.pos && <PosChip p={posOf(r.hero)} />}{changed && <PatchChip p={changed} />}</span></td>
                    <td><span className={`dl-tier t${r.tier}`}>{r.tier}</span></td>
                    <td className={`num ${r.winRate >= 0.51 ? 'up' : r.winRate < 0.49 ? 'down' : ''}`}>
                      <span className="dl-rate">{pct(r.winRate)}<i style={{ '--w': `${Math.max(0, Math.min(1, (r.winRate - 0.44) / 0.14)) * 100}%` } as CSSProperties} /></span>
                    </td>
                    <td className="num"><span className="dl-rate">{pct(r.pickRate)}<i style={{ '--w': `${Math.min(1, r.pickRate / 0.35) * 100}%` } as CSSProperties} /></span></td>
                    <td className="num">{r.banRate === null ? '–' : pct(r.banRate)}</td>
                    <td className="num">{r.since ? <Trend now={r.since.winRate} before={r.since.before} /> : <span className="muted">–</span>}</td>
                    <td className="num muted">{r.proPicks} / {r.proBans}</td>
                    <td className="num muted">{r.games.toLocaleString()}</td>
                    <td><button className="ghost small-btn" onClick={() => onHero(r.hero)}>Builds</button></td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      )}
      <p className="muted small">From OpenDota's last 7 days of matches, so early in a patch the rates still lean on the one before; "Since the patch" counts only the days since it came out. Tier from the win rate, pulled toward 50% for heroes with fewer games: S 52.5%+, A 51%+, B 49%+, C 47.5%+, D below. Pick rate: share of matches with the hero. Bans are counted in pro matches only. Positions: where pros play each hero, by the game's tags for heroes they rarely pick.</p>
    </section>
  );
}

// ---- the patch notes -----------------------------------------------------------------------------------------------
export function PatchView({ onHero }: { onHero: (hero: number) => void }) {
  const list = useLoad(() => patchList(), []);
  const [pick, setPick] = useState(0);
  const name = list.data?.[Math.min(pick, list.data.length - 1)]?.name;
  const notes = useLoad(() => (name ? patchNotes(name).then(changesOf) : Promise.resolve(null)), [name]);
  const stats = useLoad(heroStats, []);
  const movers = useMemo(() => {
    if (!stats.data || !list.data?.length || pick) return [];
    return heroMeta(stats.data, rankOf('all'), list.data[0].at).filter(r => r.since && r.since.games >= 300 && Math.abs(r.since.winRate - r.since.before) >= 0.015)
      .sort((a, b) => (b.since!.winRate - b.since!.before) - (a.since!.winRate - a.since!.before));
  }, [stats.data, list.data, pick]);
  if (list.err) return <p className="warn-text">{list.err}</p>;
  if (!list.data) return <Loading>Reading the patch notes…</Loading>;
  const changes = notes.data ?? [];
  const heroes = [...tally(changes, 'hero')].sort((a, b) => (b[1].buffs - b[1].nerfs) - (a[1].buffs - a[1].nerfs));
  const items = [...tally(changes, 'item')];
  const general = changes.filter(c => c.kind === 'general');
  const line = (c: PatchChange, i: number) => (
    <li key={i} className={`dl-pl ${DIR_CLASS[c.dir]}`}><i aria-label={DIR_CLASS[c.dir]}>{MARK[c.dir]}</i><span>{c.ability && c.kind !== 'general' && <b>{c.ability}: </b>}{c.text}</span></li>
  );
  return (
    <section className="dl-meta dl-patchview">
      <div className="dl-meta-head">
        <h2>Patch notes</h2>
        <select className="dl-rank" value={pick} onChange={e => setPick(Number(e.target.value))} aria-label="Patch">
          {list.data.map((p, i) => <option key={p.name} value={i}>{day(p.at)} · {p.name}</option>)}
        </select>
        {name && <a className="muted small" href={`https://www.dota2.com/patches/${name}`} target="_blank" rel="noreferrer">Official notes</a>}
      </div>
      <p className="muted small">Valve's own notes. Each line is marked buff, nerf or neutral from its numbers and wording (a shorter cooldown is a buff; by level, the levels are added up): a quick read, so look at the lines themselves for anything that matters.</p>
      {notes.err && <p className="warn-text">{notes.err}</p>}
      {!notes.data && !notes.err && <Loading>Reading patch {name}…</Loading>}

      {movers.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h2>Moved most since the patch</h2><span className="muted small">All ranks · win rate since the patch vs before</span></div>
          <div className="dl-movers">
            {movers.slice(0, 6).map(r => <button key={r.hero} className="dl-mover up" onClick={() => onHero(r.hero)}><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b><Trend now={r.since!.winRate} before={r.since!.before} /></button>)}
            {movers.slice(-6).reverse().filter(r => r.since!.winRate < r.since!.before).map(r => <button key={r.hero} className="dl-mover down" onClick={() => onHero(r.hero)}><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b><Trend now={r.since!.winRate} before={r.since!.before} /></button>)}
          </div>
        </div>
      )}
      {general.length > 0 && (
        <details className="site-card d2-patch-general">
          <summary className="card-head"><h2>General</h2><span className="muted small">{general.length} lines: the map, gold, experience, creeps</span></summary>
          <ul className="dl-patch-general">{general.map(line)}</ul>
        </details>
      )}
      {heroes.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h2>Heroes</h2><span className="muted small">{heroes.length} changed · {heroes.filter(([, t]) => verdict(t) === 'buffed').length} buffed · {heroes.filter(([, t]) => verdict(t) === 'nerfed').length} nerfed</span></div>
          <div className="dl-patch-grid">
            {heroes.map(([id, t]) => (
              <div key={id} className="dl-patch-card">
                <button className="dl-patch-who" onClick={() => onHero(id)} title="This hero's builds"><HeroIcon id={id} /><b>{heroOf(id).name}</b><PatchChip p={tallied(t)} /></button>
                <ul>{t.lines.map(line)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <div className="site-card">
          <div className="card-head"><h2>Items</h2><span className="muted small">{items.length} changed</span></div>
          <div className="dl-patch-grid">
            {items.map(([id, t]) => (
              <div key={id} className="dl-patch-card">
                <div className="dl-patch-who"><ItemIcon id={id} size={22} /><b>{t.lines[0]?.name || itemById.get(id)?.name || `Item ${id}`}</b><PatchChip p={tallied(t)} /></div>
                <ul>{t.lines.map(line)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---- one hero's builds -------------------------------------------------------------------------------------------
const itemName = (key: string) => itemByKey.get(key)?.name ?? key.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
const KeyIcon = ({ k, size = 30 }: { k: string; size?: number }) => {
  const it = itemByKey.get(k);
  return <img className="dl-meta-item" src={it?.icon ?? `${ITEM_ICONS}/${k}.png`} alt={itemName(k)} title={`${itemName(k)}${it?.cost ? ` (${it.cost.toLocaleString()} gold)` : ''}`} width={Math.round(size * 1.375)} height={size} loading="lazy" />;
};

/** The two or three ways pros build the hero: pick one to see its buy order and skill order. */
function BuildPicks({ hero }: { hero: number }) {
  const { data, err } = useLoad(() => heroBuildGames(hero), [hero]);
  const builds = useMemo(() => (data ? buildsFrom(data.games, k => itemByKey.get(k)?.cost ?? 0) : null), [data]);
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [hero]);
  if (err) return <p className="warn-text">{err}</p>;
  if (!builds) return <Loading>Reading {heroOf(hero).name}'s builds…</Loading>;
  if (!builds.length) return <p className="empty-state">Not enough pro matches on {heroOf(hero).name} to tell a build yet.</p>;
  const b = builds[Math.min(pick, builds.length - 1)];
  return (
    <div className="site-card">
      <div className="card-head">
        <h3>Builds</h3>
        <span className="muted small">from {data!.games.length} pro matches since {day(data!.since)}{b.base.length ? <> · all start {b.base.map(itemName).join(' → ')}</> : null}</span>
      </div>
      <div className="d2-builds" role="tablist" aria-label="Builds">
        {builds.map((x, i) => (
          <button key={i} role="tab" aria-selected={i === pick} className={`d2-build ${i === pick ? 'on' : ''}`} onClick={() => setPick(i)}>
            <span className="d2-build-items">{x.core.map(k => <KeyIcon key={k} k={k} size={26} />)}</span>
            <b>{x.core.map(itemName).join(' + ')}</b>
            <span className="small"><span className={`num ${x.wins / x.games >= 0.52 ? 'up' : x.wins / x.games < 0.48 ? 'down' : ''}`}>{pct(x.wins / x.games)} won</span> <span className="muted">· {x.games} games</span></span>
          </button>
        ))}
      </div>
      <div className="d2-build-detail">
        <div>
          <h4>Start</h4>
          <div className="d2-build-start">
            {b.start.map(s => <span key={s.key} className="d2-build-start-item"><KeyIcon k={s.key} size={24} />{s.count > 1 && <b className="num">×{s.count}</b>}</span>)}
          </div>
          <h4>Buy order</h4>
          <ol className="d2-build-order">
            {b.order.map(o => (
              <li key={o.key} className={b.core.includes(o.key) ? 'own' : ''}>
                <span className="num muted">{Math.round(o.t / 60)}:00</span>
                <KeyIcon k={o.key} size={26} />
                <b>{itemName(o.key)}</b>
                <span className="muted small num" title="Share of this build's games that get it">{Math.round(o.share * 100)}%</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4>Skill order</h4>
          <SkillOrder skills={b.skills} />
        </div>
      </div>
      <p className="muted small">Builds: pro matches grouped by their first big items; the order is the usual minute of each item most of a build's games get. Pro matches only: OpenDota's explorer has no public ones, so a rarely picked hero has few.</p>
    </div>
  );
}

/** The skill taken at each level, as a row of icons; a talent level shows a T, its words on hover. */
function SkillOrder({ skills }: { skills: number[] }) {
  return (
    <ol className="d2-skill-order">
      {skills.map((id, i) => {
        const a = abilityById(id);
        return (
          <li key={i} title={`Level ${i + 1}: ${a?.name ?? 'unknown'}`}>
            <span className="num muted">{i + 1}</span>
            {!a ? <b className="d2-so-empty" title="A skill or talent from an older patch">?</b> : a.talent ? <b className="d2-so-talent">T</b>
              : <img src={`${ITEM_ICONS.replace(/items$/, 'abilities')}/${a.key}.png`} alt={a.name} width={30} height={30} loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />}
          </li>
        );
      })}
    </ol>
  );
}
export function HeroBuilds({ hero, setHero }: { hero: number; setHero: (h: number) => void }) {
  const items = useLoad(() => heroItems(hero), [hero]);
  const patch = usePatch(), data = useHeroData(hero), changed = patch.heroes.get(hero);
  const heroes = useMemo(() => [...D2_HEROES].sort((a, b) => a.name.localeCompare(b.name)), []);
  return (
    <section className="dl-meta">
      <div className="dl-meta-head">
        <h2><HeroIcon id={hero} size={32} /> {heroOf(hero).name}</h2>
        <select className="dl-rank" value={hero} onChange={e => setHero(Number(e.target.value))} aria-label="Hero">
          {heroes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        {changed && <PatchChip p={changed} />}
        {data && <span className="muted small num" title="Before attributes and items">Base: {data.stats.health} health · {data.stats.armor.toFixed(1)} armor · {data.stats.speed} move speed · {data.stats.range} attack range</span>}
      </div>
      <BuildPicks hero={hero} />
      {items.err && <p className="warn-text">{items.err}</p>}
      {items.data && (
        <details className="site-card d2-patch-general">
          <summary className="card-head"><h3>Every item by stage</h3><span className="muted small">what players buy at each stage, most bought first (OpenDota's recent parsed matches)</span></summary>
          <div className="d2-stages">
            {STAGES.map(s => (
              <div key={s.id} className="d2-stage">
                <h4>{s.label} <span className="muted small">{s.when}</span></h4>
                {!items.data![s.id].length ? <p className="muted small">Not enough games.</p> : (
                  <ul>
                    {items.data![s.id].filter(i => itemById.get(i.item)).slice(0, 8).map(i => (
                      <li key={i.item}>
                        <ItemIcon id={i.item} size={26} />
                        <span><b>{itemById.get(i.item)!.name}</b><i style={{ '--w': `${i.share * 100}%` } as CSSProperties} /></span>
                        <span className="num muted small">{i.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="d2-build-cols">
        <div className="site-card">
          <div className="card-head"><h3>Talents</h3><span className="muted small">this patch's tree</span></div>
          <TalentTree hero={hero} upgrades={[]} />
        </div>
        <div className="site-card">
          <div className="card-head"><h3>Patch {patch.patch?.name ?? ''}</h3><span className="muted small">{changed ? `${changed.lines.length} changes` : 'no changes'}</span></div>
          {changed ? <ul className="dl-patch-general">{changed.lines.map((c, i) => <li key={i} className={`dl-pl ${DIR_CLASS[c.dir]}`}><i>{MARK[c.dir]}</i><span>{c.ability && <b>{c.ability}: </b>}{c.text}</span></li>)}</ul>
            : <p className="muted small">The newest patch left {heroOf(hero).name} as they were.</p>}
        </div>
      </div>
      {data && (
        <div className="site-card">
          <div className="card-head"><h3>Skills</h3><span className="muted small">this patch's numbers, by level</span></div>
          <div className="d2-skill-list">
            {Object.entries(data.skills).filter(([key]) => !/^(special_bonus|generic_hidden)/.test(key)).map(([key, s]) => (
              <div key={key} className="d2-skill-row">
                <img src={`https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities/${key}.png`} alt="" width={36} height={36} loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
                <span><b>{s.name}</b><span className="muted small">{s.desc}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="muted small">Bought later partly means the game went well enough to afford it: treat the late list as what players reach, not a recipe.</p>
    </section>
  );
}
