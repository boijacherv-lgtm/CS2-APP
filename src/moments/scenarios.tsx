import { useEffect, useState } from 'react';
import type { BatchStats } from '../engine/batch';
import type { Simulation } from '../engine/combat';
import { MAPS, presetsFor, tPlaysFor } from '../map/catalog';
import { navigate } from '../shell/router';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';

/**
 * Scenarios (round 8, B6): a situation on the Tactical board — a CT setup against a T play, both from the board's own
 * library — and you change your side (move players, draw routes, drop grenades). The board's simulation plays it 200
 * times; the stars say how much better your plan does than the setup you started from (win chance for your side).
 */
export interface Scenario {
  id: string; map: string; ct: string; t: string; you: 'CT' | 'T'; title: string;
  /** a small situation: how many of each side are left (CT, T) */ keep?: [number, number];
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

/** Every scenario the library makes: on each map, each T play against the first CT setups, once as each side, then the same
 * as small situations (you outnumbered 2 against 3, or alone 1 against 2). */
export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const m of MAPS) {
    const cts = Object.keys(presetsFor(m.id, 0)).filter(n => n !== 'Empty').slice(0, 2);
    const ts = Object.keys(tPlaysFor(m.id, 0));
    if (!cts.length || !ts.length) continue;
    ts.forEach((t, i) => {
      const ct = cts[i % cts.length];
      out.push({ id: `${m.id}|${ct}|${t}|T`, map: m.id, ct, t, you: 'T', difficulty: 'Medium', title: `Make "${t}" work against ${ct}` });
      out.push({ id: `${m.id}|${ct}|${t}|CT`, map: m.id, ct, t, you: 'CT', difficulty: 'Medium', title: `Stop "${t}" from ${ct}` });
    });
    // small ones: the same plays, with players taken out
    ts.slice(0, 2).forEach((t, i) => {
      const ct = cts[i % cts.length];
      out.push({ id: `${m.id}|${ct}|${t}|CT|2v3`, map: m.id, ct, t, you: 'CT', keep: [2, 3], difficulty: 'Hard', title: `2 against 3: hold against "${t}"` });
      out.push({ id: `${m.id}|${ct}|${t}|CT|1v2`, map: m.id, ct, t, you: 'CT', keep: [1, 2], difficulty: 'Hard', title: `Clutch 1 against 2 against "${t}"` });
      out.push({ id: `${m.id}|${ct}|${t}|T|3v2`, map: m.id, ct, t, you: 'T', keep: [2, 3], difficulty: 'Easy', title: `Take the man advantage: 3 against 2 with "${t}"` });
    });
  }
  return out;
}

/** Your best stars per scenario, in this browser. */
const KEY = 'rageview.scenarios';
const readStars = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const saveStars = (id: string, n: number) => { try { const s = readStars(); if ((s[id] ?? 0) < n) localStorage.setItem(KEY, JSON.stringify({ ...s, [id]: n })); } catch { /* private mode */ } };

/** The scenario being played (set when you start one, cleared when you leave it). */
let active: (Scenario & { baseline: number | null }) | null = null;
const subs = new Set<() => void>();
const changed = () => subs.forEach(f => f());

/** Loads a scenario on the Tactical board. */
export function startScenario(sc: Scenario) {
  const st = useStore.getState();
  if (st.mapId !== sc.map) st.setMap(sc.map);
  setTimeout(() => {
    const s = useStore.getState();
    s.loadPreset(sc.ct);
    s.loadTPlay(sc.t);
    // a small situation: take players out (the last ones listed go first)
    if (sc.keep) for (const [side, n] of [['CT', sc.keep[0]], ['T', sc.keep[1]]] as const) {
      for (const p of useStore.getState().board.players.filter(x => x.side === side).slice(n)) useStore.getState().remove(p.id);
    }
    s.setCombat(true);
    active = { ...sc, baseline: null };
    changed();
    navigate({ page: 'cs2', mode: 'tactical' });
  }, 50);
}

/** The bar over the Tactical board while a scenario is on: the goal, then the stars once the simulation has run. */
export function ScenarioBar({ batch, sim }: { batch: { stats: BatchStats; done: boolean } | null; sim?: Simulation | null }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(x => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const sc = active;
  const win = batch?.done ? (sc?.you === 'CT' ? batch.stats.ctWin : batch.stats.tWin) + batch.stats.draw / 2 : null;
  // the first full run is how the scenario starts: your plan is measured against it
  useEffect(() => { if (sc && sc.baseline === null && win !== null) { sc.baseline = win; changed(); } }, [win, sc]);
  const gain = sc && sc.baseline !== null && win !== null ? win - sc.baseline : null;
  const stars = gain === null ? null : gain >= 0.1 ? 3 : gain >= 0.05 ? 2 : gain >= 0.01 ? 1 : 0;
  useEffect(() => { if (sc && stars) saveStars(sc.id, stars); }, [stars, sc]);
  if (!sc) return null;
  const mySide = batch?.done ? Object.entries(batch.stats.players) : [];
  const ids = useStore.getState().board.players.filter(p => p.side === sc.you).map(p => p.id);
  const survive = mySide.filter(([id]) => ids.includes(id)).map(([, v]) => v.survive);
  const surv = survive.length ? survive.reduce((a, b) => a + b, 0) / survive.length : null;
  // the targets: the win chance each star needs (the start plus 1, 5 and 10 points)
  const goals = sc.baseline !== null ? [0.01, 0.05, 0.1].map(g => Math.min(99, Math.round((sc.baseline! + g) * 100))) : null;
  // the duel that went wrong in the round shown (this seed): your first player to go down, and who got them
  const board = useStore.getState().board.players, label = (id: string) => board.find(p => p.id === id)?.label ?? id;
  const lost = sim?.kills.find(k => board.find(p => p.id === k.victim)?.side === sc.you);
  const check = () => { const st = useStore.getState(); st.reroll(); st.setTime(0); st.setPlaying(true); };
  return (
    <div className="scenario-bar" role="status">
      <b>{sc.title}</b>
      <span className="muted small">You're {sc.you}{sc.keep ? `, ${sc.keep[sc.you === 'CT' ? 0 : 1]} against ${sc.keep[sc.you === 'CT' ? 1 : 0]}` : ''}. Goal: raise your side's win chance. Move players, draw routes, drop grenades; every change replays it 200 times.</span>
      {goals && <span className="scenario-goal small" title="The win chance each star needs">{[0, 1, 2].map(i => <span key={i}><Icon name="star" size={12} className={stars !== null && i < stars ? 'on' : ''} /> {goals[i]}%{i < 2 ? ' · ' : ''}</span>)}</span>}
      <span className="scenario-score">
        {win === null ? 'Simulating…' : <>Win {Math.round(win * 100)}%{sc.baseline !== null && <> (started at {Math.round(sc.baseline * 100)}%)</>}{surv !== null && <> · your players survive {Math.round(surv * 100)}%</>}</>}
        {stars !== null && <span className="scenario-stars" aria-label={`${stars} of 3 stars`}>{[0, 1, 2].map(i => <Icon key={i} name="star" size={14} className={i < stars ? 'on' : ''} />)}</span>}
      </span>
      {sc.you === 'T' && sc.baseline !== null && sc.baseline < 0.3 && <span className="muted small">The simulator is tough on attackers (a stock play starts low). The stars measure how much you improve it.</span>}
      {lost && <span className="muted small">In this run: {label(lost.victim)} goes down{lost.killer ? ` to ${label(lost.killer)}` : ''} at {Math.round(lost.t)} s.</span>}
      <button className="cta small-btn" onClick={check}>Check my plan</button>
      <button className="ghost small-btn" onClick={() => { active = null; changed(); }}>Leave the scenario</button>
    </div>
  );
}

/** The Puzzles page's Scenarios list: by map (with its radar), difficulty, and your best stars. */
export function ScenarioList() {
  const all = scenarios(), stars = readStars();
  if (!all.length) return <p className="muted">No scenarios on these maps yet.</p>;
  return (
    <>
      {MAPS.map(m => {
        const list = all.filter(x => x.map === m.id);
        if (!list.length) return null;
        const got = list.reduce((a, x) => a + (stars[x.id] ?? 0), 0);
        return (
          <section key={m.id} className="site-card scenario-map">
            <div className="card-head">
              <h2 className="scenario-map-name">{m.levels[0].image && <img src={m.levels[0].image} alt="" width={40} height={40} loading="lazy" />}{m.name}</h2>
              <span className="muted small"><Icon name="star" size={12} className="on" /> {got} of {list.length * 3}</span>
            </div>
            <ul className="scenario-list">
              {list.map(sc => (
                <li key={sc.id}>
                  <span><b>{sc.title}</b><span className="muted small">You're {sc.you}{sc.keep ? ` · ${sc.keep[sc.you === 'CT' ? 0 : 1]} against ${sc.keep[sc.you === 'CT' ? 1 : 0]}` : ' · 5 against 5'} · {sc.difficulty}</span></span>
                  <span className="scenario-stars" aria-label={`${stars[sc.id] ?? 0} of 3 stars`}>{[0, 1, 2].map(i => <Icon key={i} name="star" size={13} className={i < (stars[sc.id] ?? 0) ? 'on' : ''} />)}</span>
                  <button className="cta small-btn" onClick={() => startScenario(sc)}>Play</button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
