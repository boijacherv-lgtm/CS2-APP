import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { runBatch, runUtilityImpact, type BatchStats, type UtilityImpact } from './engine/batch';
import { simulate } from './engine/combat';
import { computeSpots } from './engine/spots';
import { timelineEnd } from './engine/timeline';
import { computeControl } from './engine/control';
import { buildReplay, reviewRound } from './engine/recap';
import { getEngine } from './map/catalog';
import { useStore, type Tool } from './store';
import { Board } from './ui/Board';
import { AnalysisPanel, Toolbar } from './ui/Panels';
import { RecapPanel, ReviewStart, stepMoment } from './ui/Recap';

const KEYS: Record<string, Tool> = { v: 'select', c: 'ct', t: 't', s: 'smoke', f: 'flash', m: 'molotov', h: 'he', p: 'path', l: 'lineup', e: 'erase' };

export function App() {
  const board = useStore(s => s.board);
  const mapId = useStore(s => s.mapId);
  const level = useStore(s => s.level);
  const engine = useMemo(() => getEngine(mapId, level), [mapId, level]);

  // Demo review: the real round replaces the planning board and the simulation.
  const mode = useStore(s => s.mode);
  const inReview = mode === 'review';
  const loaded = useStore(s => s.review);
  const review = inReview ? loaded : null; // a match on screen
  const replay = useMemo(
    () => (review && review.data.map === mapId ? buildReplay(engine, review.data, review.round, board.context) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [review?.data, review?.round, engine],
  );
  // Only while the store is really in Review: coming back from the report/home page this component mounts
  // (and React dev re-runs effects) while the switch to Tactical is already under way.
  useEffect(() => {
    if (replay && useStore.getState().mode === 'review') useStore.setState({ board: replay.board, boardFromReplay: true });
  }, [replay]);
  const recap = useMemo(() => (replay ? reviewRound(engine, replay) : null), [engine, replay]);
  // Analysis runs on a deferred copy so dragging stays smooth.
  const deferred = useDeferredValue(board);
  const analysis = useMemo(() => engine.analyze(deferred), [engine, deferred]);
  const time = useStore(s => s.time);
  const showControl = useStore(s => s.overlays.control);
  const deferredTime = useDeferredValue(time);
  // While playing, a deferred value never settles (time changes every frame), so map control
  // would freeze until Stop. Step it 4× a second instead; when paused, follow the slider exactly.
  const playingNow = useStore(s => s.playing);
  const controlTime = playingNow ? Math.floor(time * 4) / 4 : deferredTime;
  const combat = useStore(s => s.combat);
  const seed = useStore(s => s.seed);
  const simEnd = useMemo(() => Math.max(60, Math.ceil(timelineEnd(engine, deferred.players))), [engine, deferred.players]);
  const simulated = useMemo(
    () => (!inReview && combat && deferred.players.some(p => p.side === 'T') && deferred.players.some(p => p.side === 'CT') ? simulate(engine, deferred, simEnd, seed) : null),
    [engine, deferred, simEnd, seed, combat, inReview],
  );
  const sim = replay?.sim ?? simulated;
  const control = useMemo(
    () => (showControl ? computeControl(engine, deferred, controlTime, sim) : null),
    [engine, deferred, controlTime, showControl, sim],
  );

  // Kill map: scored for the selected CT's weapon (rifle otherwise).
  // Spot finder for the selected CT: where should they stand, keeping the entry they hold covered.
  const showSpots = useStore(s => s.overlays.killmap);
  const selectedId = useStore(s => s.selectedId);
  const spots = useMemo(() => {
    const pl = deferred.players.find(p => p.id === selectedId && p.side === 'CT');
    if (!showSpots || inReview || !pl) return null;
    // the entries this player covers from where they stand (sightline, whatever way they face)
    const sees = (portal: [{ x: number; y: number }, { x: number; y: number }]) => [0.1, 0.3, 0.5, 0.7, 0.9]
      .map(f => ({ x: portal[0].x + (portal[1].x - portal[0].x) * f, y: portal[0].y + (portal[1].y - portal[0].y) * f }))
      .filter(q => Math.hypot(q.x - pl.pos.x, q.y - pl.pos.y) < 1000 && engine.grid.lineOfSight(pl.pos, q)).length >= 2;
    const jobs = engine.map.chokepoints.filter(c => sees(c.portal)).map(c => ({ name: c.name, portal: c.portal }));
    return computeSpots(engine, deferred, simulated, pl, jobs);
  }, [engine, deferred, simulated, selectedId, showSpots, inReview]);


  // Many rounds of the same setup, in the background, for per-player kill chances.
  const [batch, setBatch] = useState<{ stats: BatchStats; done: boolean } | null>(null);
  useEffect(() => {
    setBatch(null);
    if (inReview || !combat || !deferred.players.some(p => p.side === 'T') || !deferred.players.some(p => p.side === 'CT')) return;
    let cancel = () => {};
    const timer = setTimeout(() => {
      cancel = runBatch(engine, deferred, simEnd, 200, (stats, done) => setBatch({ stats, done }), () => useStore.getState().playing);
    }, 250);
    return () => { clearTimeout(timer); cancel(); };
  }, [engine, deferred, simEnd, combat, inReview]);

  // Once the batch is in, measure what each grenade is worth by replaying without it.
  const [impact, setImpact] = useState<{ v: UtilityImpact; done: boolean } | null>(null);
  const batchDone = !!batch?.done;
  useEffect(() => {
    setImpact(null);
    if (inReview || !batchDone || !deferred.utility.length) return;
    return runUtilityImpact(engine, deferred, simEnd, 100, (v, done) => setImpact({ v, done }), () => useStore.getState().playing);
  }, [engine, deferred, simEnd, batchDone, inReview]);

  // Playback: advance round time along the routes.
  const playing = useStore(s => s.playing);
  const end = useMemo(() => (replay ? replay.round.duration : timelineEnd(engine, board.players)), [engine, board.players, replay]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const st = useStore.getState();
      const t = Math.min(end, st.time + ((now - last) / 1000) * st.speed);
      last = now;
      useStore.setState({ time: t, ...(t >= end ? { playing: false } : {}) });
      if (t < end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        const st = useStore.getState();
        if (!st.playing && st.time >= end - 0.05) st.setTime(0);
        st.setPlaying(!st.playing);
        return;
      }
      if (e.key.toLowerCase() === 'r' && useStore.getState().mode === 'review' && useStore.getState().review) {
        const st = useStore.getState();
        st.setReviewSpoilers(!st.reviewSpoilers);
        return;
      }
      // ← → step through the round's key moments, like moves in a chess review
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && recap) {
        e.preventDefault();
        stepMoment(recap, e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      const view = ({ '1': 'clean', '2': 'standard', '3': 'full' } as const)[e.key as '1' | '2' | '3'];
      if (view) { useStore.getState().setView(view); return; }
      const tool = KEYS[e.key.toLowerCase()];
      if (tool) useStore.getState().setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [end, recap]);

  // Review mode without a match: just the place to load one
  if (inReview && !loaded) return <div className="app single"><ReviewStart /></div>;

  return (
    <div className="app">
      <Toolbar engine={engine} />
      <Board key={`${mapId}:${level}`} timelineEnd={end} analysis={analysis} engine={engine} control={control} sim={sim} spots={spots} batch={batch?.stats ?? null} recap={recap} />
      {recap && replay
        ? <RecapPanel recap={recap} replay={replay} engine={engine} control={control} />
        : <AnalysisPanel analysis={analysis} engine={engine} control={control} sim={sim} spots={spots} batch={batch} impact={impact} stale={deferred !== board} />}
    </div>
  );
}
