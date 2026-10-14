import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { runBatch, runUtilityImpact, type BatchStats, type UtilityImpact } from './engine/batch';
import { simulate } from './engine/combat';
import { computeKillMap } from './engine/killmap';
import { timelineEnd } from './engine/timeline';
import { computeControl } from './engine/control';
import { buildReplay, reviewRound } from './engine/recap';
import { getEngine } from './map/catalog';
import { useStore, type Tool } from './store';
import { Board } from './ui/Board';
import { AnalysisPanel, Toolbar } from './ui/Panels';
import { RecapPanel } from './ui/Recap';

const KEYS: Record<string, Tool> = { v: 'select', c: 'ct', t: 't', s: 'smoke', f: 'flash', m: 'molotov', h: 'he', p: 'path', l: 'lineup', e: 'erase' };

export function App() {
  const board = useStore(s => s.board);
  const mapId = useStore(s => s.mapId);
  const level = useStore(s => s.level);
  const engine = useMemo(() => getEngine(mapId, level), [mapId, level]);

  // Demo review: the real round replaces the planning board and the simulation.
  const review = useStore(s => s.review);
  const replay = useMemo(
    () => (review && review.data.map === mapId ? buildReplay(engine, review.data, review.round, board.context) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [review?.data, review?.round, engine],
  );
  useEffect(() => { if (replay) useStore.setState({ board: replay.board }); }, [replay]);
  const recap = useMemo(() => (replay ? reviewRound(engine, replay) : null), [engine, replay]);
  // Analysis runs on a deferred copy so dragging stays smooth.
  const deferred = useDeferredValue(board);
  const analysis = useMemo(() => engine.analyze(deferred), [engine, deferred]);
  const time = useStore(s => s.time);
  const showControl = useStore(s => s.overlays.control);
  const deferredTime = useDeferredValue(time);
  const combat = useStore(s => s.combat);
  const seed = useStore(s => s.seed);
  const simEnd = useMemo(() => Math.max(60, Math.ceil(timelineEnd(engine, deferred.players))), [engine, deferred.players]);
  const simulated = useMemo(
    () => (!review && combat && deferred.players.some(p => p.side === 'T') && deferred.players.some(p => p.side === 'CT') ? simulate(engine, deferred, simEnd, seed) : null),
    [engine, deferred, simEnd, seed, combat, review],
  );
  const sim = replay?.sim ?? simulated;
  const control = useMemo(
    () => (showControl ? computeControl(engine, deferred, deferredTime, sim) : null),
    [engine, deferred, deferredTime, showControl, sim],
  );

  // Kill map: scored for the selected CT's weapon (rifle otherwise).
  const showKillMap = useStore(s => s.overlays.killmap);
  const selectedId = useStore(s => s.selectedId);
  const ctWeapon = deferred.players.find(p => p.id === selectedId && p.side === 'CT')?.weapon ?? 'rifle';
  const killMap = useMemo(
    () => (showKillMap ? computeKillMap(engine, deferred, sim, ctWeapon) : null),
    [engine, deferred, sim, ctWeapon, showKillMap],
  );

  // Many rounds of the same setup, in the background, for per-player kill chances.
  const [batch, setBatch] = useState<{ stats: BatchStats; done: boolean } | null>(null);
  useEffect(() => {
    setBatch(null);
    if (review || !combat || !deferred.players.some(p => p.side === 'T') || !deferred.players.some(p => p.side === 'CT')) return;
    let cancel = () => {};
    const timer = setTimeout(() => {
      cancel = runBatch(engine, deferred, simEnd, 200, (stats, done) => setBatch({ stats, done }));
    }, 250);
    return () => { clearTimeout(timer); cancel(); };
  }, [engine, deferred, simEnd, combat, review]);

  // Once the batch is in, measure what each grenade is worth by replaying without it.
  const [impact, setImpact] = useState<{ v: UtilityImpact; done: boolean } | null>(null);
  const batchDone = !!batch?.done;
  useEffect(() => {
    setImpact(null);
    if (review || !batchDone || !deferred.utility.length) return;
    return runUtilityImpact(engine, deferred, simEnd, 100, (v, done) => setImpact({ v, done }));
  }, [engine, deferred, simEnd, batchDone, review]);

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
      const tool = KEYS[e.key.toLowerCase()];
      if (tool) useStore.getState().setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [end]);

  return (
    <div className="app">
      <Toolbar engine={engine} timelineEnd={end} />
      <Board key={`${mapId}:${level}`} analysis={analysis} engine={engine} control={control} sim={sim} killMap={killMap} batch={batch?.stats ?? null} />
      {recap && replay
        ? <RecapPanel recap={recap} replay={replay} engine={engine} control={control} />
        : <AnalysisPanel analysis={analysis} engine={engine} control={control} sim={sim} killMap={killMap} batch={batch} impact={impact} stale={deferred !== board} />}
    </div>
  );
}
