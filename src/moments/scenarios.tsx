import { useEffect, useState } from 'react';
import type { BatchStats } from '../engine/batch';
import { MAPS, presetsFor, tPlaysFor } from '../map/catalog';
import { navigate } from '../shell/router';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';

/**
 * Scenarios (round 8, B6): a situation on the Tactical board — a CT setup against a T play, both from the board's own
 * library — and you change your side (move players, draw routes, drop grenades). The board's simulation plays it 200
 * times; the stars say how much better your plan does than the setup you started from (win chance for your side).
 */
export interface Scenario { id: string; map: string; ct: string; t: string; you: 'CT' | 'T'; title: string }

/** Every scenario the library makes: on each map, each T play against the first CT setups, once as each side. */
export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const m of MAPS) {
    const cts = Object.keys(presetsFor(m.id, 0)).filter(n => n !== 'Empty').slice(0, 2);
    const ts = Object.keys(tPlaysFor(m.id, 0));
    if (!cts.length || !ts.length) continue;
    ts.forEach((t, i) => {
      const ct = cts[i % cts.length];
      out.push({ id: `${m.id}|${ct}|${t}|T`, map: m.id, ct, t, you: 'T', title: `${m.name}: make "${t}" work against ${ct}` });
      out.push({ id: `${m.id}|${ct}|${t}|CT`, map: m.id, ct, t, you: 'CT', title: `${m.name}: stop "${t}" from ${ct}` });
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
    s.setCombat(true);
    active = { ...sc, baseline: null };
    changed();
    navigate({ page: 'cs2', mode: 'tactical' });
  }, 50);
}

/** The bar over the Tactical board while a scenario is on: the goal, then the stars once the simulation has run. */
export function ScenarioBar({ batch }: { batch: { stats: BatchStats; done: boolean } | null }) {
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
  return (
    <div className="scenario-bar" role="status">
      <b>{sc.title}</b>
      <span className="muted small">You're {sc.you}. Move your players, draw routes, drop grenades: every change replays it 200 times.</span>
      <span className="scenario-score">
        {win === null ? 'Simulating…' : <>Win {Math.round(win * 100)}%{sc.baseline !== null && <> (started at {Math.round(sc.baseline * 100)}%)</>}{surv !== null && <> · your players survive {Math.round(surv * 100)}%</>}</>}
        {stars !== null && <span className="scenario-stars" aria-label={`${stars} of 3 stars`}>{[0, 1, 2].map(i => <Icon key={i} name="star" size={14} className={i < stars ? 'on' : ''} />)}</span>}
      </span>
      <button className="ghost small-btn" onClick={() => { active = null; changed(); }}>Leave the scenario</button>
    </div>
  );
}

/** The Puzzles page's Scenarios list. */
export function ScenarioList() {
  const all = scenarios(), stars = readStars();
  if (!all.length) return <p className="muted">No scenarios on these maps yet.</p>;
  return (
    <section className="site-card">
      <div className="card-head"><h2>Scenarios</h2><span className="muted small">make your way out on the Tactical board; the sim plays it 200 times</span></div>
      <ul className="scenario-list">
        {all.map(sc => (
          <li key={sc.id}>
            <span><b>{sc.title}</b><span className="muted small">You're {sc.you}</span></span>
            <span className="scenario-stars" aria-label={`${stars[sc.id] ?? 0} of 3 stars`}>{[0, 1, 2].map(i => <Icon key={i} name="star" size={13} className={i < (stars[sc.id] ?? 0) ? 'on' : ''} />)}</span>
            <button className="cta small-btn" onClick={() => startScenario(sc)}>Play</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
