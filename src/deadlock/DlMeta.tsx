import { useEffect, useMemo, useState } from 'react';
import { DL_HEROES, heroOf } from './data';
import ITEMS from './generated/items.json';
import { draftStats, heroBuilds, heroMeta, rankOf, RANKS, readDraft, suggest, type HeroMeta, type RankBand } from './meta';

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
const ItemIcon = ({ id, size = 26 }: { id: number; size?: number }) => {
  const it = ITEM.get(id);
  return it?.icon ? <img className={`dl-meta-item tier${it.tier}`} src={it.icon} alt={it.name} title={`${it.name} (${it.cost.toLocaleString()})`} width={size} height={size} loading="lazy" /> : null;
};

// ---- the heroes on this patch ----------------------------------------------------------------------------------
type SortKey = 'tier' | 'win' | 'pick' | 'ban';
export function MetaHeroes({ onHero }: { onHero: (h: number) => void }) {
  const [band, setBand] = useRank();
  const [sort, setSort] = useState<SortKey>('tier');
  const { data, err } = useLoad(() => heroMeta(band), [band.id]);
  const rows = useMemo(() => {
    if (!data) return [];
    const order = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    const by: Record<SortKey, (a: HeroMeta, b: HeroMeta) => number> = {
      tier: (a, b) => order[a.tier] - order[b.tier] || b.winRate - a.winRate, win: (a, b) => b.winRate - a.winRate,
      pick: (a, b) => b.pickRate - a.pickRate, ban: (a, b) => (b.banRate ?? 0) - (a.banRate ?? 0),
    };
    return [...data.rows].sort(by[sort]);
  }, [data, sort]);
  return (
    <section className="dl-meta">
      <div className="dl-meta-head">
        <h2>Heroes on this patch</h2>
        <RankPick band={band} set={setBand} />
        {data && <span className="muted small">Since the patch of {day(data.since)} · {Math.round(data.rows.reduce((a, r) => a + r.matches, 0) / 12).toLocaleString()} matches</span>}
      </div>
      {err && <p className="warn-text">{err}</p>}
      {!data && !err && <p className="muted">Loading the meta…</p>}
      {data && (
        <table className="site-table dl-meta-table">
          <thead><tr>
            <th>Hero</th>
            {([['tier', 'Tier'], ['win', 'Win rate'], ['pick', 'Pick rate'], ['ban', 'Ban rate']] as [SortKey, string][]).map(([k, l]) => (
              <th key={k}><button className={`dl-sort ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{l}</button></th>
            ))}
            <th>K / D / A</th><th className="num">Games</th><th />
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.hero}>
                <td><span className="dl-meta-name"><HeroIcon id={r.hero} /><b>{heroOf(r.hero).name}</b><span className="muted small">{heroOf(r.hero).role ?? ''}</span></span></td>
                <td><span className={`dl-tier t${r.tier}`}>{r.tier}</span></td>
                <td className={`num ${r.winRate >= 0.51 ? 'up' : r.winRate < 0.49 ? 'down' : ''}`}>{pct(r.winRate)}</td>
                <td className="num">{pct(r.pickRate)}</td>
                <td className="num">{r.banRate === null ? '–' : pct(r.banRate)}</td>
                <td className="num muted">{r.kda.map(x => x.toFixed(1)).join(' / ')}</td>
                <td className="num muted">{r.matches.toLocaleString()}</td>
                <td><button className="ghost small-btn" onClick={() => onHero(r.hero)}>Builds</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Tier from the win rate, pulled toward 50% for heroes with fewer games: S 52.5%+, A 51%+, B 49%+, C 47.5%+, D below. Pick rate: share of matches with the hero. Data: deadlock-api.</p>
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
      {!data && !err && <p className="muted">Loading builds…</p>}
      {data && (
        <>
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
  const stats = useMemo(() => data && { ...data, roleOf: (h: number) => heroOf(h).role ?? null, nameOf: (h: number) => heroOf(h).name }, [data]);
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
                {Object.entries(read.roles[t].count).map(([r, n]) => `${n} ${r}`).join(' · ')}
                {read.roles[t].missing.length > 0 && <span className="warn-text"> · no {read.roles[t].missing.join(', ')}</span>}
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
            <button key={h.id} className="dl-draft-hero" disabled={taken.has(h.id)} onClick={() => add(h.id)} title={`${h.name}${h.role ? ` (${h.role})` : ''}`}>
              <HeroIcon id={h.id} size={36} /><span className="small">{h.name}</span>
            </button>
          ))}
        </div>
      </div>
      {!data && !err && <p className="muted">Loading matchups…</p>}
    </section>
  );
}
