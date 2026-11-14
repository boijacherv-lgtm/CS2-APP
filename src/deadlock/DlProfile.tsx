import { lastN, plural } from '../site/format';
import { SteamLoginButton } from '../ui/SteamLogin';
import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../shell/router';
import { AreaChart, MiniLine, ResultStrip, TrendTile } from '../site/charts';
import { Icon } from '../ui/Icon';
import { Loading } from '../ui/Loading';
import { getItem, setItem } from '../ui/localStore';
import { ScoreRing } from '../ui/ScoreRing';
import { loadMatch, matchHistory, partyMatches, rankName, soloVsParty, type DlHistoryRow } from './api';
import { BOT_ON, botMatches } from './botApi';
import { coachMatch, type DlTag } from './coach';
import { heroOf } from './data';
import { gameplayPatches } from './patchFeed';
import { myBestBuilds, type MyBuild } from './meta';
import { CopyBuild } from './DlMeta';
import type { Patch } from './patches';
import { laneOpponent, noteOf, reportCard, type GradeKey } from './grade';
import { statAt } from './match';
import { openMatch } from './open';
import { engineReview } from './engineReview';
import { saveMoments } from '../moments/moments';
import { dlMoments } from '../moments/build';
import './dl.css';
import { percentile } from '../engine/profileView';

/**
 * Profile → Deadlock: your recent matches (deadlock-api's history plus the bot's), headline numbers with their trend,
 * results, your heroes, and the coach's report card over your last graded matches: each part's average, the overall
 * trend, the mistakes that come back, your best and worst games. Each graded match is kept in this browser.
 */
const RECENT = 20, GRADED = 10;
/** Deadlock's rank tiers by number (badge = tier × 10 + subrank). */
const PARTS: { key: GradeKey; label: string }[] = [
  { key: 'kills', label: 'Kills' }, { key: 'map', label: 'Map activity' }, { key: 'abilities', label: 'Abilities' },
  { key: 'rotations', label: 'Rotations' }, { key: 'survival', label: 'Survival' },
];
const MISTAKE: Partial<Record<DlTag, string>> = {
  ISOLATED: 'Dying alone', OUTNUMBERED: 'Fights you were outnumbered in', OVEREXTENDED: 'Too deep past their Guardians',
  'COST OBJECTIVE': 'Deaths that cost an objective', 'ULT UNUSED': 'Dying with your ultimate ready', 'LANE LOST': 'Behind after laning',
};
/** One graded match, as kept: enough for the profile without reading the match again. */
interface Graded { id: number; at: number; hero: number; won: boolean; overall: number | null; parts: Partial<Record<GradeKey, number | null>>; mistakes: Partial<Record<DlTag, number>>;
  /** the enemy heroes, and when you died (s): for matchups and deaths by phase */ enemies?: number[]; deaths?: number[];
  /** your lane at 10:00 against your lane opponent (souls): won / even / lost */ lane?: 'won' | 'even' | 'lost' | null }
const KEY = (account: string, id: number) => `dlgrade3:${account}:${id}`;
/** Your report card's averages over your last graded matches (Profile → Deadlock keeps them for the suggested build). */
export const MY_GRADES = 'stratboard.dl.myGrades';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const won = (r: DlHistoryRow) => r.match_result === r.player_team;
/** deadlock-api leaves souls at 0 for some matches (no stats recorded): those would read as a 0-soul game. */
const hasSouls = (r: DlHistoryRow) => r.net_worth > 0;
const spm = (r: DlHistoryRow) => r.net_worth / Math.max(1, r.match_duration_s / 60);

/** Grades one match for the player (the same report card as Match recap), or reads the kept grade. */
async function grade(account: string, r: DlHistoryRow): Promise<Graded | null> {
  const kept = await getItem<Graded>(KEY(account, r.match_id));
  if (kept) return kept;
  const m = await loadMatch(r.match_id);
  const me = m.players.find(p => String(p.account) === account);
  if (!me) return null;
  const moves = coachMatch(m);
  const card = reportCard(m, me.slot, null, moves);
  const mistakes: Graded['mistakes'] = {};
  for (const mv of moves.filter(x => x.slot === me.slot && (x.note === '?' || x.note === '??' || x.note === '?!')))
    for (const t of mv.tags) if (MISTAKE[t]) mistakes[t] = (mistakes[t] ?? 0) + 1;
  const g: Graded = { id: m.id, at: m.start, hero: me.hero, won: m.winner === me.team, overall: card.overall,
    parts: Object.fromEntries(card.parts.map(p => [p.key, p.score])), mistakes,
    enemies: m.players.filter(p => p.team !== me.team).map(p => p.hero), deaths: m.deaths.filter(d => d.slot === me.slot).map(d => Math.round(d.t)),
    lane: (() => { const o = laneOpponent(m, me.slot), a = statAt(m, me.slot, 600)?.netWorth, b = o ? statAt(m, o.slot, 600)?.netWorth : null; return a == null || b == null ? null : a - b > 1000 ? 'won' : b - a > 1000 ? 'lost' : 'even'; })() };
  await setItem(KEY(account, r.match_id), g);
  // its moments become puzzles too (the engine is a few hundred ms a match; once per match, as the grade is kept)
  try { saveMoments(dlMoments(m, engineReview(m, null, me.slot), me.slot)); } catch { /* a puzzle less, the grade stands */ }
  return g;
}

export function DlProfile({ account }: { account: string | null }) {
  const [rows, setRows] = useState<DlHistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [graded, setGraded] = useState<Graded[]>([]);
  const [grading, setGrading] = useState<{ done: number; of: number } | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [builds, setBuilds] = useState<MyBuild[]>([]);

  useEffect(() => {
    if (!account) return;
    let live = true;
    setRows(null); setErr(null);
    Promise.all([matchHistory(account), BOT_ON ? botMatches(account).catch(() => null) : Promise.resolve(null)]).then(([api, bot]) => {
      if (!live) return;
      const seen = new Set(api.map(x => x.match_id));
      // normal 6v6 matches only (game mode 1): Street Brawl and others play too differently to compare
      setRows([...(bot?.matches ?? []).filter(m => !seen.has(m.match_id)), ...api].filter(r => (r.game_mode ?? 1) === 1).sort((a, b) => b.start_time - a.start_time));
    }).catch(e => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [account]);

  // the coach grades the last few, one at a time (each match is read once, then kept)
  useEffect(() => {
    if (!account || !rows) return;
    let live = true;
    (async () => {
      const todo = rows.slice(0, GRADED), out: Graded[] = [];
      setGrading({ done: 0, of: todo.length });
      for (const [i, r] of todo.entries()) {
        const g = await grade(account, r).catch(() => null);
        if (!live) return;
        if (g) { out.push(g); setGraded([...out]); }
        setGrading({ done: i + 1, of: todo.length });
      }
      if (live) setGrading(null);
    })();
    return () => { live = false; };
  }, [account, rows]);

  const recent = useMemo(() => (rows ?? []).slice(0, RECENT), [rows]);
  // your most-won in-game build on each hero you've played lately
  const heroIds = useMemo(() => [...new Set(recent.map(r => r.hero_id))].join(','), [recent]);
  useEffect(() => {
    if (!account || !heroIds) return;
    let live = true;
    myBestBuilds(account, heroIds.split(',').map(Number)).then(b => live && setBuilds(b), () => live && setBuilds([]));
    return () => { live = false; };
  }, [account, heroIds]);
  // your report card's averages, for the coach's suggested build (Tactical → Builds)
  useEffect(() => {
    if (!graded.length || grading) return;
    const parts = Object.fromEntries(PARTS.map(p => { const xs = graded.map(g => g.parts[p.key]).filter((v): v is number => typeof v === 'number'); return [p.key, xs.length ? Math.round(xs.reduce((a, v) => a + v, 0) / xs.length) : null]; }));
    try { localStorage.setItem(MY_GRADES, JSON.stringify({ at: Date.now(), games: graded.length, parts })); } catch { /* private mode */ }
  }, [graded, grading]);
  if (!account) return <section className="empty-card"><Icon name="user" size={30} /><h2>Your Deadlock profile</h2><p className="muted">It comes from your matches: log in with Steam to see it.</p><SteamLoginButton /></section>;
  if (err) return <p className="warn-text">{err}</p>;
  if (!rows) return <Loading>Loading your Deadlock matches…</Loading>;
  if (!rows.length) return <p className="empty-state">No normal Deadlock matches yet. Add RageView bot in Review (or pick your Steam folder there) and they come in by themselves.</p>;

  const chrono = [...recent].reverse();
  const half = (xs: DlHistoryRow[], f: (r: DlHistoryRow) => number) => xs.length ? xs.reduce((a, r) => a + f(r), 0) / xs.length : 0;
  const heroes = [...recent.reduce((m, r) => m.set(r.hero_id, [...(m.get(r.hero_id) ?? []), r]), new Map<number, DlHistoryRow[]>())]
    .map(([hero, xs]) => ({ hero, n: xs.length, wr: xs.filter(won).length / xs.length, k: half(xs, r => r.player_kills), d: half(xs, r => r.player_deaths), a: half(xs, r => r.player_assists), spm: half(xs, spm) }))
    .sort((a, b) => b.n - a.n);
  const avg = (key: GradeKey) => { const xs = graded.map(g => g.parts[key]).filter((v): v is number => typeof v === 'number'); return xs.length ? Math.round(xs.reduce((a, v) => a + v, 0) / xs.length) : null; };
  const mistakes = Object.entries(graded.reduce<Record<string, number>>((m, g) => { for (const [t, n] of Object.entries(g.mistakes)) m[t] = (m[t] ?? 0) + (n ?? 0); return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 4);
  const byScore = graded.filter(g => g.overall !== null).sort((a, b) => b.overall! - a.overall!);
  // the leak: the mistake that comes back most; the superpower: your best part, 55+ (50 is average), as a percentile
  const leak = mistakes[0] ?? null;
  const superPart = PARTS.map(p => ({ ...p, v: avg(p.key) })).filter((p): p is typeof p & { v: number } => p.v !== null && p.v >= 55).sort((a, b) => b.v - a.v)
    .map(p => ({ ...p, better: percentile((p.v - 50) / 20) }))[0] ?? null;
  // matchups (2+ games against a hero), deaths by phase, deaths with the ultimate ready
  const vs = new Map<number, { n: number; w: number }>();
  for (const g of graded) for (const e of g.enemies ?? []) { const x = vs.get(e) ?? { n: 0, w: 0 }; x.n++; if (g.won) x.w++; vs.set(e, x); }
  const matchups = [...vs].filter(([, x]) => x.n >= 2).map(([hero, x]) => ({ hero, n: x.n, wr: x.w / x.n })).sort((a, b) => b.wr - a.wr);
  const withDeaths = graded.filter(g => g.deaths);
  const phases = withDeaths.length ? [['Laning (0–10 min)', 0, 600], ['Mid game (10–25)', 600, 1500], ['Late game (25+)', 1500, Infinity]].map(([label, a, b]) => ({
    label: label as string, n: withDeaths.reduce((acc, g) => acc + g.deaths!.filter(t => t >= (a as number) && t < (b as number)).length, 0) / withDeaths.length })) : [];
  const ultDeaths = graded.length ? graded.reduce((a, g) => a + (g.mistakes['ULT UNUSED'] ?? 0), 0) / graded.length : null;
  // the lane at 10:00, and the rank from the ranked matches in the history
  const lanes = graded.filter(g => g.lane).reduce((a, g) => ({ ...a, [g.lane!]: (a[g.lane!] ?? 0) + 1 }), {} as Record<string, number>);
  const ranked = chrono.filter(r => r.ranked_display_badge);
  const heroGrade = (hero: number) => { const xs = graded.filter(g => g.hero === hero && g.overall !== null).map(g => g.overall!); return xs.length ? Math.round(xs.reduce((a, v) => a + v, 0) / xs.length) : null; };
  const open = async (id: number) => {
    setOpening(id);
    try { await openMatch(id); navigate({ page: 'deadlock', mode: 'report' }); } catch { setOpening(null); }
  };
  const ringNote = (s: number | null) => (s === null ? 'book' : noteOf((s - 50) / 20));

  return (
    <>
      {/* the same top as CS2's profile: the stat strip, then the biggest leak and your superpower */}
      <div className="trend-row stat-strip">
        <TrendTile label="KDA" values={chrono.map(r => (r.player_kills + r.player_assists) / Math.max(1, r.player_deaths))} fmt={v => v.toFixed(2)} />
        <TrendTile label="Souls a minute" values={chrono.filter(hasSouls).map(spm)} fmt={v => Math.round(v).toLocaleString('en-US')} />
        <TrendTile label="Last hits a minute" values={chrono.filter(hasSouls).map(r => r.last_hits / Math.max(1, r.match_duration_s / 60))} fmt={v => v.toFixed(1)} />
        <TrendTile label="Deaths" values={chrono.map(r => r.player_deaths)} fmt={v => v.toFixed(1)} higherBetter={false} />
        {ranked.length >= 2 && <TrendTile label={`Rank · ${rankName(ranked.at(-1)!.ranked_display_badge!)}`} values={ranked.map(r => r.ranked_display_badge!)} fmt={v => rankName(Math.round(v))} sub={`your last ${ranked.length} ranked`} />}
      </div>
      <TrendsCard chrono={chrono} />
      {(leak || superPart) && (
        <div className="leak-row">
          {leak && <section className="site-card leak-card"><span className="eyebrow">Biggest leak</span><h2>{MISTAKE[leak[0] as DlTag]}</h2>
            <p className="leak-num"><b>{(leak[1] / graded.length).toFixed(1)} a match</b> over your last {graded.length} graded</p>
            <div className="hero-cta"><a className="cta" href="/puzzles">Practise in Puzzles</a><a className="cta" href="/deadlock/review">Watch your matches</a></div></section>}
          {superPart && <section className="site-card super-card"><span className="eyebrow">Your superpower</span><h2>{superPart.label}</h2>
            <p className="muted">Better than <b>{superPart.better}%</b> of players on your hero and position</p><p className="muted small">Your average {superPart.v} · 50 is average</p></section>}
        </div>
      )}

      <div className="dash-row">
        <section className="site-card dash-narrow">
          <div className="card-head"><h2><Icon name="trophy" size={16} /> Results</h2><span className="muted small">{plural(recent.length, 'match')}</span></div>
          <ResultStrip results={chrono.slice(-20).map(r => ({ win: won(r), title: `${heroOf(r.hero_id).name} · ${day(r.start_time)} · ${won(r) ? 'won' : 'lost'}` }))} />
        </section>
      </div>

      <section className="site-card">
        <div className="card-head"><h2><Icon name="star" size={16} /> The coach on your last {GRADED} matches</h2>
          {grading ? <span className="muted small">grading {grading.done} of {grading.of}…</span> : <span className="muted small">{graded.length} graded · 50 is average for your hero and position</span>}</div>
        {!graded.length && grading ? <Loading>Grading your matches (each is read once, then kept in this browser)…</Loading> : (
          <>
            <div className="dl-pf-parts">
              <div className="dl-pf-overall">
                <ScoreRing score={byScore.length ? Math.round(byScore.reduce((a, g) => a + g.overall!, 0) / byScore.length) : null} note={ringNote(byScore.length ? byScore.reduce((a, g) => a + g.overall!, 0) / byScore.length : null)} size={84} />
                <span className="muted small">overall</span>
                <MiniLine values={[...graded].sort((a, b) => a.at - b.at).map(g => g.overall ?? 50)} good={null} />
              </div>
              {PARTS.map(p => {
                const v = avg(p.key);
                return (
                  <div key={p.key} className="dl-pf-part">
                    <ScoreRing score={v} note={ringNote(v)} size={48} />
                    <b>{p.label}</b>
                    <MiniLine values={[...graded].sort((a, b) => a.at - b.at).map(g => g.parts[p.key] ?? 50)} good={v === null ? null : v >= 50} />
                  </div>
                );
              })}
            </div>
            {mistakes.length > 0 && (
              <>
                <h4>What comes back</h4>
                <ul className="dl-pf-mistakes">
                  {mistakes.map(([t, n]) => <li key={t}><b className="num">{n}×</b> {MISTAKE[t as DlTag]}</li>)}
                </ul>
              </>
            )}
            {byScore.length >= 2 && (
              <div className="dl-pf-bestworst">
                {[['Best game', byScore[0]], ['Worst game', byScore.at(-1)!]].map(([label, g]) => {
                  const x = g as Graded;
                  return (
                    <button key={label as string} className="dl-pf-game" onClick={() => void open(x.id)} disabled={opening !== null}>
                      <span className="muted small">{label as string}</span>
                      <ScoreRing score={x.overall} note={ringNote(x.overall)} size={40} />
                      <span><b>{heroOf(x.hero).name}</b> <span className="muted small">{day(x.at)} · {x.won ? 'won' : 'lost'}</span></span>
                      <Icon name="arrowRight" size={14} />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <PatchEffect rows={rows} />
      <SoloVsParty account={account} rows={rows} />

      <section className="site-card">
        <div className="card-head"><h2><Icon name="user" size={16} /> Your heroes</h2><span className="muted small">{lastN(recent.length, 'match').toLowerCase()}</span></div>
        <div className="dl-sb-scroll"><table className="site-table dl-pf-heroes">
          <thead><tr><th>Hero</th><th>Games</th><th>Win rate</th><th>Grade</th><th>K/D/A</th><th>Souls a minute</th><th>Most-won build</th></tr></thead>
          <tbody>{heroes.map(h => (
            <tr key={h.hero}>
              <td><span className="dl-sb-who">{heroOf(h.hero).card && <img className="dl-hero-img" src={heroOf(h.hero).card!} alt="" width={26} height={26} />}<b>{heroOf(h.hero).name}</b></span></td>
              <td className="num">{h.n}</td>
              <td className="num" style={{ color: h.wr >= 0.5 ? 'var(--good)' : 'var(--bad)' }}>{pct(h.wr)}</td>
              <td className="num">{heroGrade(h.hero) ?? '–'}</td>
              <td className="num">{h.k.toFixed(1)} / {h.d.toFixed(1)} / {h.a.toFixed(1)}</td>
              <td className="num">{Math.round(h.spm).toLocaleString()}</td>
              <td>{(() => { const b = builds.find(x => x.hero === h.hero); return b ? <span className="dl-pf-build"><span title={b.name}>{b.name}</span><span className="muted small">{b.wins} won of {b.matches}</span><CopyBuild id={b.id} short /></span> : <span className="muted">–</span>; })()}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {(matchups.length >= 2 || phases.length > 0 || Object.keys(lanes).length > 0) && (
        <div className="profile-grid">
          {matchups.length >= 2 && <section className="site-card"><div className="card-head"><h2>Matchups</h2><span className="muted small">2+ games against them</span></div>
            <table className="site-table"><tbody>
              {[...matchups.slice(0, 3).map(m => ({ ...m, tone: 'up' })), ...matchups.slice(-3).reverse().filter(m => !matchups.slice(0, 3).includes(m)).map(m => ({ ...m, tone: 'down' }))].map(m => (
                <tr key={`${m.tone}${m.hero}`}><td>{m.tone === 'up' ? 'You beat' : 'You lose to'} <b>{heroOf(m.hero).name}</b></td><td className={`num ${m.wr >= 0.5 ? 'up' : 'down'}`}>{pct(m.wr)} of {m.n}</td></tr>
              ))}
            </tbody></table></section>}
          {Object.keys(lanes).length > 0 && <section className="site-card"><div className="card-head"><h2>Lane record</h2><span className="muted small">souls at 10:00 vs your lane opponent</span></div>
            <table className="site-table"><tbody>{(['won', 'even', 'lost'] as const).map(k => <tr key={k}><td>{k === 'won' ? 'Won (1,000+ ahead)' : k === 'lost' ? 'Lost (1,000+ behind)' : 'Even'}</td><td className={`num ${k === 'won' ? 'up' : k === 'lost' ? 'down' : ''}`}>{lanes[k] ?? 0}</td></tr>)}</tbody></table></section>}
          {phases.length > 0 && <section className="site-card"><div className="card-head"><h2>Deaths by phase</h2><span className="muted small">a match, last {withDeaths.length} graded</span></div>
            <table className="site-table"><tbody>
              {phases.map(p => <tr key={p.label}><td>{p.label}</td><td className="num">{p.n.toFixed(1)}</td></tr>)}
              {ultDeaths !== null && <tr><td>With your ultimate ready</td><td className={`num ${ultDeaths > 0.5 ? 'down' : ''}`}>{ultDeaths.toFixed(1)}</td></tr>}
            </tbody></table></section>}
        </div>
      )}

      <section className="site-card">
        <div className="card-head"><h2>{lastN(Math.min(10, rows.length), 'match')}</h2></div>
        <ul className="dl-rows">
          {rows.slice(0, 10).map(r => {
            const h = heroOf(r.hero_id), g = graded.find(x => x.id === r.match_id);
            return (
              <li key={r.match_id}>
                <button className={`dl-row ${won(r) ? 'win' : 'loss'}`} onClick={() => void open(r.match_id)} disabled={opening !== null}>
                  {h.card ? <img src={h.card} alt="" width={36} height={36} loading="lazy" /> : <span className="dl-hero-dot" style={{ background: h.color }} />}
                  <span className="dl-row-hero"><b>{h.name}</b><span className="muted small">{day(r.start_time)} · {mins(r.match_duration_s)}</span></span>
                  <span className={`dl-row-result ${won(r) ? 'win' : 'loss'}`}>{won(r) ? 'Win' : 'Loss'}</span>
                  <span className="dl-row-kda num">{r.player_kills}/{r.player_deaths}/{r.player_assists}</span>
                  <span className="dl-row-souls num muted">{g?.overall != null ? <>coach <b>{g.overall}</b></> : `${(r.net_worth / 1000).toFixed(1)}k souls`}</span>
                  <span className="dl-row-go">{opening === r.match_id ? 'Opening…' : <Icon name="arrowRight" size={14} />}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}


/** Solo or with a friend: your win rate and KDA in each, over every match here. */
function SoloVsParty({ account, rows }: { account: string; rows: DlHistoryRow[] }) {
  const [party, setParty] = useState<Set<number> | null>(null);
  useEffect(() => { let live = true; partyMatches(account).then(p => live && setParty(p), () => live && setParty(null)); return () => { live = false; }; }, [account]);
  if (!party) return null;
  const s = soloVsParty(rows, party);
  if (!s.solo.n || !s.party.n) return null;
  const wr = (x: { n: number; wins: number }) => x.wins / x.n;
  const better = wr(s.party) > wr(s.solo) ? 'party' : 'solo';
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="user" size={16} /> Solo or with friends</h2><span className="muted small">with friends: a Steam friend on your team · {plural(rows.length, 'match')}</span></div>
      <table className="duo-table">
        <thead><tr><th /><th>Matches</th><th>Won</th><th>KDA</th></tr></thead>
        <tbody>
          {(['solo', 'party'] as const).map(k => (
            <tr key={k}><td>{k === 'solo' ? 'Solo' : 'With friends'}</td><td>{s[k].n}</td><td className={better === k ? 'hi' : ''}>{pct(wr(s[k]))}</td><td>{s[k].kda.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Before and after the newest gameplay patch: your heroes you played on both sides of it, and what the patch did to them. */
function PatchEffect({ rows }: { rows: DlHistoryRow[] }) {
  const [patch, setPatch] = useState<Patch | null>(null);
  useEffect(() => { gameplayPatches().then(ps => setPatch(ps[0] ?? null), () => setPatch(null)); }, []);
  if (!patch) return null;
  const after = rows.filter(r => r.start_time >= patch.at), before = rows.filter(r => r.start_time < patch.at);
  const heroes = [...new Set(after.map(r => r.hero_id))].filter(h => before.some(r => r.hero_id === h));
  const side = (xs: DlHistoryRow[]) => ({ n: xs.length, wr: xs.filter(won).length / Math.max(1, xs.length), spm: xs.filter(hasSouls).reduce((a, r) => a + spm(r), 0) / Math.max(1, xs.filter(hasSouls).length) });
  const dirWord = (h: number) => { const cs = patch.changes.filter(c => c.kind === 'hero' && c.id === h); const d = cs.reduce((a, c) => a + c.dir, 0); return !cs.length ? 'not changed' : d > 0 ? `buffed (${cs.length} changes)` : d < 0 ? `nerfed (${cs.length} changes)` : `changed (${cs.length})`; };
  const all = { b: side(before), a: side(after) };
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="bolt" size={16} /> Since the last patch</h2>
        <a className="muted small" href={patch.link} target="_blank" rel="noreferrer">{patch.title} · {day(patch.at)}</a></div>
      {!after.length ? <p className="muted">No matches since this patch yet.</p> : (
        <table className="duo-table">
          <thead><tr><th /><th>Before</th><th>After</th><th>The patch</th></tr></thead>
          <tbody>
            <tr><td>All heroes ({all.b.n} → {all.a.n} matches)</td><td>{pct(all.b.wr)} won · {Math.round(all.b.spm)} souls/min</td>
              <td className={all.a.wr > all.b.wr ? 'hi' : ''}>{pct(all.a.wr)} won · {Math.round(all.a.spm)} souls/min</td><td /></tr>
            {heroes.map(h => { const b = side(before.filter(r => r.hero_id === h)), a = side(after.filter(r => r.hero_id === h)); return (
              <tr key={h}><td>{heroOf(h).name} ({b.n} → {a.n})</td><td>{pct(b.wr)} · {Math.round(b.spm)}</td><td className={a.wr > b.wr ? 'hi' : ''}>{pct(a.wr)} · {Math.round(a.spm)}</td><td>{dirWord(h)}</td></tr>
            ); })}
          </tbody>
        </table>
      )}
      {after.length > 0 && !heroes.length && <p className="muted small">None of your heroes since the patch were played before it in these matches.</p>}
    </section>
  );
}

/** One Trends card with a switch (KDA, souls a minute, last hits a minute, deaths): the same numbers as the tiles, bigger. */
function TrendsCard({ chrono }: { chrono: DlHistoryRow[] }) {
  const [metric, setMetric] = useState<'kda' | 'souls' | 'hits' | 'deaths'>('kda');
  const M = {
    kda: { label: 'KDA', f: (r: DlHistoryRow) => (r.player_kills + r.player_assists) / Math.max(1, r.player_deaths), fmt: (v: number) => v.toFixed(2), rows: chrono },
    souls: { label: 'Souls a minute', f: spm, fmt: (v: number) => Math.round(v).toLocaleString('en-US'), rows: chrono.filter(hasSouls) },
    hits: { label: 'Last hits a minute', f: (r: DlHistoryRow) => r.last_hits / Math.max(1, r.match_duration_s / 60), fmt: (v: number) => v.toFixed(1), rows: chrono.filter(hasSouls) },
    deaths: { label: 'Deaths', f: (r: DlHistoryRow) => r.player_deaths, fmt: (v: number) => v.toFixed(1), rows: chrono },
  }[metric];
  if (M.rows.length < 3) return null;
  return (
    <section className="site-card trends-card">
      <div className="card-head"><h2>Trends</h2>
        <div className="seg-mini" role="group" aria-label="Metric">{(['kda', 'souls', 'hits', 'deaths'] as const).map(k => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{{ kda: 'KDA', souls: 'Souls/min', hits: 'Last hits/min', deaths: 'Deaths' }[k]}</button>)}</div></div>
      <AreaChart points={M.rows.map((r, i) => ({ label: `#${i + 1} ${heroOf(r.hero_id).name}`, value: M.f(r) }))} fmt={M.fmt} />
    </section>
  );
}
