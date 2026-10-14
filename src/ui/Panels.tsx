import { CTL_COLORS, CTL_LABEL, Ctl, type ControlMap } from '../engine/control';
import type { Analysis, TacticalEngine } from '../engine/predict';
import { popAt } from '../engine/grid';
import { bakeRoute } from '../engine/timeline';
import type { Simulation } from '../engine/combat';
import type { BatchStats, UtilityImpact } from '../engine/batch';
import type { KillMap } from '../engine/killmap';
import { killColor } from './Board';
import type { Econ } from '../engine/types';
import { hasLayer, isAutoLayer, MAPS, presetsFor, roughNote, tPlaysFor } from '../map/catalog';
import { useStore, type Overlay, type Tool } from '../store';
import { BUILTIN_LINEUPS, flightTime, type Lineup, type Technique } from '../map/lineups';
import { DemoLoader } from './Recap';
import { useState } from 'react';
import { threatColor } from './Board';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Move', key: 'V' },
  { id: 'ct', label: 'CT player', key: 'C' },
  { id: 't', label: 'T player', key: 'T' },
  { id: 'smoke', label: 'Smoke', key: 'S' },
  { id: 'flash', label: 'Flash', key: 'F' },
  { id: 'molotov', label: 'Molotov', key: 'M' },
  { id: 'he', label: 'HE grenade', key: 'H' },
  { id: 'path', label: 'Route', key: 'P' },
  { id: 'lineup', label: 'Line-up', key: 'L' },
  { id: 'erase', label: 'Erase', key: 'E' },
];
const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: 'control', label: 'Map control (CT coverage)' },
  { id: 'killmap', label: 'Kill map (CT position value)' },
  { id: 'threat', label: 'Threat on chokepoints' },
  { id: 'los', label: 'Sightline of selected' },
  { id: 'timing', label: 'Spawn timing race' },
  { id: 'callouts', label: 'Callouts' },
  { id: 'lineups', label: 'Line-ups on map' },
  { id: 'walkable', label: 'Walkable floor (debug)' },
];

export function Toolbar({ engine, timelineEnd }: { engine: TacticalEngine; timelineEnd: number }) {
  const s = useStore();
  const entry = MAPS.find(m => m.id === s.mapId)!;
  return (
    <aside className="toolbar">
      <h1>CS2 Tactics<span>{entry.id} · beta</span></h1>
      <section>
        <h3>Map</h3>
        <select value={s.mapId} disabled={!!s.review} onChange={e => s.setMap(e.target.value)}>
          {MAPS.map(m => <option key={m.id} value={m.id}>{m.name}{roughNote(m.id) ? ' (rough)' : ''}</option>)}
        </select>
        {entry.levels.length > 1 && (
          <div className="row seg">
            {entry.levels.map((l, i) => (
              <button key={l.id} className={s.level === i ? 'on' : ''} onClick={() => s.setLevel(i)}>
                {l.id === 'upper' ? 'Upper' : 'Lower'}{s.mapId === 'de_nuke' ? (i === 0 ? ' (A)' : ' (B)') : ''}
              </button>
            ))}
          </div>
        )}
        <p className="muted">
          {!hasLayer(s.mapId, s.level)
            ? 'No tactical layer on this level yet: sightlines, timings and fights still work.'
            : isAutoLayer(s.mapId, s.level)
              ? 'Chokepoints, T plays and CT setups for this map are generated from its geometry.'
              : 'Hand-made tactical layer.'}
          {roughNote(s.mapId) && <><br /><b>Rough:</b> {roughNote(s.mapId)}</>}
        </p>
      </section>
      <section>
        <h3>Tools</h3>
        <div className="tools">
          {TOOLS.map(t => (
            <button key={t.id} className={s.tool === t.id ? 'on' : ''} onClick={() => s.setTool(t.id)} title={`Shortcut: ${t.key}`}>
              <span className={`dot ${t.id}`} />{t.label}<kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <label className="check" title="Route tool: click a player, then one click on the map sends them there by the shortest path">
          <input type="checkbox" checked={s.autoRoute} onChange={e => s.setAutoRoute(e.target.checked)} /> Auto-route (Shift+click = waypoint)
        </label>
        <div className="row">
          <button onClick={s.undo} disabled={!s.past.length}>Undo</button>
          <button onClick={s.redo} disabled={!s.future.length}>Redo</button>
        </div>
      </section>
      <DemoLoader />
      {!s.review && <>
      <section>
        <h3>CT setups</h3>
        <div className="presets">
          {Object.keys(presetsFor(s.mapId, s.level)).map(n => <button key={n} onClick={() => s.loadPreset(n)}>{n === 'Empty' ? 'Clear CTs' : n}</button>)}
        </div>
      </section>
      {Object.keys(tPlaysFor(s.mapId, s.level)).length > 0 && (
        <section>
          <h3>T plays (with routes)</h3>
          <div className="presets">
            {Object.keys(tPlaysFor(s.mapId, s.level)).map(n => <button key={n} onClick={() => s.loadTPlay(n)}>{n}</button>)}
            <button onClick={() => s.loadTPlay(null)}>Clear Ts</button>
          </div>
        </section>
      )}
      <Lineups engine={engine} />
      </>}
      <section>
        <h3>Overlays</h3>
        {OVERLAYS.map(o => (
          <label key={o.id} className="check">
            <input type="checkbox" checked={s.overlays[o.id]} onChange={() => s.toggleOverlay(o.id)} /> {o.label}
          </label>
        ))}
      </section>
      <section>
        <h3>Round time · {fmt(s.time)}</h3>
        <div className="row play">
          <button className={s.playing ? 'on' : ''} onClick={() => {
            if (!s.playing && s.time >= timelineEnd - 0.05) s.setTime(0);
            s.setPlaying(!s.playing);
          }}>{s.playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button onClick={() => { s.setPlaying(false); s.setTime(0); }} title="Back to round start">⟲</button>
          <select value={s.speed} onChange={e => s.setSpeed(+e.target.value)} title="Playback speed">
            <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
          </select>
        </div>
        {!s.review && <div className="row combat">
          <label className="check grow"><input type="checkbox" checked={s.combat} onChange={e => s.setCombat(e.target.checked)} /> Combat (players die)</label>
          <button onClick={s.reroll} disabled={!s.combat} title="Roll the fights again">🎲 Re-roll</button>
        </div>}
        <input type="range" min={0} max={s.review ? Math.ceil(timelineEnd) : Math.max(60, Math.ceil(timelineEnd))} step={0.1} value={s.time}
          onChange={e => { s.setPlaying(false); s.setTime(+e.target.value); }} />
        <p className="muted">Seconds after freeze time. Moves players along their routes and drives map control and utility. Space = play/pause.</p>
      </section>
      <Selection engine={engine} />
    </aside>
  );
}

function Selection({ engine }: { engine: TacticalEngine }) {
  const s = useStore();
  const p = s.board.players.find(x => x.id === s.selectedId);
  const u = s.board.utility.find(x => x.id === s.selectedId);
  if (u)
    return (
      <section>
        <h3>Selected {u.type}</h3>
        <label className="field">Thrown at (s)
          <input type="number" min={0} max={110} step={0.5} value={u.throwAt} onChange={e => s.updateUtility(u.id, { throwAt: +e.target.value })} />
        </label>
        <button onClick={() => s.remove(u.id)}>Delete</button>
      </section>
    );
  if (!p) return null;
  const ready = p.side === 'CT' ? engine.readyAt(p) : null;
  return (
    <section>
      <h3>Selected {p.side} {p.label}</h3>
      <label className="field">Weapon
        <select value={p.weapon} onChange={e => s.updatePlayer(p.id, { weapon: e.target.value as never })}>
          <option value="rifle">Rifle</option><option value="awp">AWP</option><option value="smg">SMG</option><option value="pistol">Pistol</option>
        </select>
      </label>
      {ready !== null && <p className="muted">In position at ~{ready.toFixed(1)}s from CT spawn.</p>}
      <RouteEditor player={p} engine={engine} />
      <div className="field">Facing · {p.facing === undefined ? 'auto (toward enemy approach)' : `${Math.round(((p.facing * 180) / Math.PI + 360) % 360)}°`}
        <input type="range" min={0} max={359} step={5}
          value={Math.round((((p.facing ?? engine.facing(p)) * 180) / Math.PI + 360) % 360)}
          onChange={e => s.updatePlayer(p.id, { facing: (+e.target.value * Math.PI) / 180 })} />
        <div className="row">
          <button onClick={() => s.updatePlayer(p.id, { facing: (p.facing ?? engine.facing(p)) - Math.PI / 12 })} title="Shortcut: [">⟲ 15°</button>
          <button onClick={() => s.updatePlayer(p.id, { facing: (p.facing ?? engine.facing(p)) + Math.PI / 12 })} title="Shortcut: ]">15° ⟳</button>
          <button onClick={() => s.updatePlayer(p.id, { facing: undefined })} disabled={p.facing === undefined}>Auto</button>
        </div>
      </div>
      <button onClick={() => s.remove(p.id)}>Delete</button>
    </section>
  );
}

export function AnalysisPanel({ analysis, engine, control, sim, killMap, batch, impact, stale }: {
  analysis: Analysis; engine: TacticalEngine; control: ControlMap | null; sim: Simulation | null;
  killMap: KillMap | null; batch: { stats: BatchStats; done: boolean } | null;
  impact: { v: UtilityImpact; done: boolean } | null; stale: boolean;
}) {
  const s = useStore();
  const ctx = s.board.context;
  const chokes = [...analysis.chokes].sort((a, b) => b.threat - a.threat);
  const names = new Map(engine.map.chokepoints.map(c => [c.id, c.name]));
  return (
    <aside className={`panel ${stale ? 'stale' : ''}`}>
      <section>
        <h3>Round context</h3>
        <div className="grid2">
          <label className="field">Your side<select disabled value="CT"><option>CT</option></select></label>
          <label className="field">Round phase
            <select value={ctx.phase} onChange={e => s.setContext({ phase: e.target.value as 'early' | 'late' })}>
              <option value="early">Early / default</option><option value="late">Late-round execute</option>
            </select>
          </label>
          <label className="field">Your buy
            <EconSelect value={ctx.economy.user} onChange={v => s.setContext({ economy: { ...ctx.economy, user: v } })} />
          </label>
          <label className="field">Enemy buy
            <EconSelect value={ctx.economy.enemy} onChange={v => s.setContext({ economy: { ...ctx.economy, enemy: v } })} />
          </label>
        </div>
      </section>

      <section className="summary">
        {analysis.summary.map((l, i) => <p key={i}>{l}</p>)}
      </section>

      <KillChances engine={engine} killMap={killMap} batch={batch} />
      <UtilityEval engine={engine} batch={batch} impact={impact} />
      {sim && <KillFeed sim={sim} engine={engine} />}
      {control && <MapControl control={control} time={s.time} />}

      {!engine.map.chokepoints.length && (
        <section className="summary">
          <p><b>No prediction engine for {engine.map.name}{s.level ? ' (lower level)' : ''} yet.</b></p>
          <p className="muted">Sightlines, the timing overlay and hover timings work here. Predictions need this map's chokepoints and T plays, which only Mirage has so far.</p>
        </section>
      )}

      {analysis.predictions.length > 0 && <section>
        <h3>Predicted T plays</h3>
        {analysis.predictions.map((p, i) => (
          <div key={p.id} className={`pred ${i === 0 ? 'top' : ''}`}>
            <div className="pred-head">
              <span className={`site site-${p.target}`}>{p.target}</span>
              <b>{p.label}</b>
              <span className="pct">{Math.round(p.probability * 100)}%</span>
            </div>
            <div className="bar"><div style={{ width: `${p.probability * 100}%` }} /></div>
            <div className="meta">
              Works {Math.round(p.successRate * 100)}% of the time vs this setup
              {p.firstContact && <> · first fight {names.get(p.firstContact.choke)} ~{p.firstContact.t.toFixed(0)}s</>}
              {p.siteHitAt !== null && Number.isFinite(p.siteHitAt) && <> · site hit ~{p.siteHitAt.toFixed(0)}s</>}
            </div>
            {i < 3 && <div className="counter">Counter: {p.counter}</div>}
          </div>
        ))}
      </section>}

      {chokes.length > 0 && <section>
        <h3>Chokepoint vulnerability</h3>
        {chokes.map(c => (
          <div key={c.choke.id} className="choke">
            <div className="choke-head">
              <span className="sw" style={{ background: threatColor(c.threat) }} />
              <b>{c.choke.name}</b>
              <span className="muted">Ts ~{c.tArrival.min.toFixed(1)}s · {c.defenders.length} holding</span>
              <span className="pct" style={{ color: threatColor(c.threat) }}>{Math.round(c.threat * 100)}</span>
            </div>
            {c.reasons.map((r, i) => <div key={i} className="reason">{r}</div>)}
          </div>
        ))}
      </section>}
      <p className="muted foot">
        Floor comes from Valve's official radar (opaque pixels), so walls drawn only as colour lines and height differences are not modelled.
        Timings are rifle speed from the best spawn and are not calibrated against demos yet. Fights use a hand-tuned model.
      </p>
    </aside>
  );
}

const UTIL_NAME = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' } as const;

/** What each grenade does across the simulated rounds, and what the round is worth without it. */
function UtilityEval({ engine, batch, impact }: {
  engine: TacticalEngine; batch: { stats: BatchStats; done: boolean } | null; impact: { v: UtilityImpact; done: boolean } | null;
}) {
  const s = useStore();
  const util = s.board.utility;
  if (!util.length) return null;
  const where = (at: { x: number; y: number }) => {
    let best = '', bd = 120;
    for (const c of engine.map.callouts) { const d = Math.hypot(c.pos.x - at.x, c.pos.y - at.y); if (d < bd) { bd = d; best = c.name; } }
    return best;
  };
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;
  return (
    <section>
      <h3>Utility evaluation {impact && !impact.done ? '· measuring…' : ''}</h3>
      {util.map(u => {
        const st = batch?.stats.utility[u.id];
        const imp = impact?.v[u.id];
        return (
          <div key={u.id} className={`util-row ${s.selectedId === u.id ? 'sel' : ''}`} onClick={() => s.select(u.id)}>
            <div className="util-head">
              <b>{UTIL_NAME[u.type]}</b>
              <span className="muted">{where(u.pos) || 'map'} · {fmt(u.throwAt)}</span>
              <span className="pct" style={{ color: imp ? (imp.ctWinDelta > 0.02 ? '#3ddc84' : imp.ctWinDelta < -0.02 ? '#ff4d4d' : 'var(--muted)') : undefined }}
                title="Change in CT round wins compared to the same rounds without this grenade">
                {imp ? `${sign(imp.ctWinDelta)} CT` : batch?.done ? '…' : ''}
              </span>
            </div>
            {st && u.type !== 'smoke' && (
              <div className="meta">
                {u.type === 'flash'
                  ? `Blinds ${st.blindT.toFixed(1)} T / ${st.blindCT.toFixed(1)} CT per round`
                  : `Deals ${Math.round(st.dmgT)} hp to Ts / ${Math.round(st.dmgCT)} hp to CTs per round`}
                {(u.type === 'flash' ? st.blindCT > st.blindT : st.dmgCT > st.dmgT) && <b className="warn"> · hurts your own side more</b>}
              </div>
            )}
            {u.type === 'smoke' && <div className="meta">Blocks sightlines {fmt(popAt(u))}–{fmt(popAt(u) + 18)}{u.lineup ? ' · line-up' : ''}</div>}
          </div>
        );
      })}
      <p className="muted">"+X% CT" = how many more rounds CTs win with this grenade than without it (same simulated rounds). Edit "Thrown at" on a selected grenade to time it.</p>
    </section>
  );
}

function KillChances({ engine, killMap, batch }: {
  engine: TacticalEngine; killMap: KillMap | null; batch: { stats: BatchStats; done: boolean } | null;
}) {
  const s = useStore();
  const players = s.board.players;
  const cts = players.filter(p => p.side === 'CT'), ts = players.filter(p => p.side === 'T');
  const spot = (pos: { x: number; y: number }) => {
    if (!killMap) return null;
    const v = killMap.pKill[engine.grid.snap(pos)];
    return Number.isNaN(v) ? null : v;
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const row = (p: typeof players[number]) => {
    const st = batch?.stats.players[p.id];
    const sv = p.side === 'CT' ? spot(p.pos) : null;
    return (
      <tr key={p.id} className={s.selectedId === p.id ? 'sel' : ''} onClick={() => s.select(p.id)}>
        <td><b className={p.side.toLowerCase()}>{p.side} {p.label}</b>{p.weapon === 'awp' ? <span className="muted"> AWP</span> : null}</td>
        <td style={{ color: st ? killColor(st.pKill) : undefined }}>{st ? pct(st.pKill) : '–'}</td>
        <td>{st ? st.avgKills.toFixed(2) : '–'}</td>
        <td>{st ? pct(st.survive) : '–'}</td>
        <td className={st && st.flashed > 0.25 ? 'warn' : ''} title={st ? `Average utility damage taken: ${st.utilDamage.toFixed(0)} hp` : ''}>{st ? pct(st.flashed) : '–'}</td>
        {killMap && <td style={{ color: sv !== null ? killColor(sv) : undefined }}>{sv !== null ? pct(sv) : '–'}</td>}
      </tr>
    );
  };
  if (!cts.length) return null;
  return (
    <section>
      <h3>Kill chances {batch ? `· ${batch.stats.rounds}${batch.done ? '' : '/200'} rounds` : ''}</h3>
      {!ts.length && <p className="muted">Place T players (or load a T play) to simulate fights. The kill map works without them using default T paths.</p>}
      {!s.combat && ts.length > 0 && <p className="muted">Turn on Combat to simulate rounds.</p>}
      {batch && (
        <div className="stack result" title="Who has more players left (no bomb modelled)">
          <div style={{ width: pct(batch.stats.ctWin), background: 'var(--ct)' }} />
          <div style={{ width: pct(batch.stats.draw), background: '#555' }} />
          <div style={{ width: pct(batch.stats.tWin), background: 'var(--t)' }} />
        </div>
      )}
      {batch && <div className="stack-labels"><span className="ct">CT win {pct(batch.stats.ctWin)}</span><span>Even {pct(batch.stats.draw)}</span><span className="t">T win {pct(batch.stats.tWin)}</span></div>}
      <table className="kills">
        <thead><tr><th /><th title="Chance to get at least one kill">Kill</th><th title="Average kills per round">Avg K</th><th title="Chance to survive the round">Alive</th><th title="Rounds in which this player gets blinded for 1 s or more">Flashed</th>{killMap && <th title="Kill map value at this spot">Spot</th>}</tr></thead>
        <tbody>{cts.map(row)}{ts.map(row)}</tbody>
      </table>
      {killMap && (
        <>
          <div className="row km">
            <span className="muted grow">Kill map shows</span>
            <select value={s.killMetric} onChange={e => s.setKillMetric(e.target.value as typeof s.killMetric)}>
              <option value="pKill">Kill chance</option><option value="expKills">Expected kills</option><option value="survive">Survival</option>
            </select>
          </div>
          <div className="gradient"><span>bad spot</span><span>good spot</span></div>
          <p className="muted">
            Every spot is scored for a CT holding there (aimed at the first angle a T appears from) against {killMap.source === 'players' ? 'the placed Ts and their routes' : 'Ts on the default paths from spawn'}.
            Grey = no T ever comes into view. Hover the map for exact numbers.
          </p>
        </>
      )}
      {!killMap && <p className="muted">Turn on <b>Kill map</b> under Overlays to see which spots are strong or deadly for a CT.</p>}
    </section>
  );
}

function KillFeed({ sim, engine }: { sim: Simulation; engine: TacticalEngine }) {
  const s = useStore();
  const players = s.board.players;
  const name = (id: string) => { const p = players.find(q => q.id === id); return p ? `${p.side} ${p.label}` : '?'; };
  const side = (id: string) => players.find(q => q.id === id)?.side ?? 'CT';
  const where = (at: { x: number; y: number }) => {
    let best = '', bd = 90;
    for (const c of engine.map.callouts) { const d = Math.hypot(c.pos.x - at.x, c.pos.y - at.y); if (d < bd) { bd = d; best = c.name; } }
    return best;
  };
  const alive = (sd: 'T' | 'CT') => players.filter(p => p.side === sd && (sim.deathT[sim.ids.indexOf(p.id)] ?? Infinity) > s.time).length;
  return (
    <section>
      <h3>Round events · alive at {fmt(s.time)}: <span className="ct">CT {alive('CT')}</span> vs <span className="t">T {alive('T')}</span></h3>
      {sim.kills.length === 0 && <p className="muted">No fights yet. Give players routes (or place them in each other's sight) and press ▶ Play.</p>}
      {[
        ...sim.kills.map(k => ({ t: k.t, kind: 'kill' as const, k })),
        ...sim.utilEvents.filter(e => (e.kind === 'blind' && e.amount >= 1) || (e.kind !== 'blind' && e.amount >= 10)).map(e => ({ t: e.t, kind: 'util' as const, e })),
      ].sort((a, b) => a.t - b.t).map((row, i) => row.kind === 'kill' ? (
        <button key={i} className={`kill ${row.k.t <= s.time ? 'past' : ''}`} onClick={() => { s.setPlaying(false); s.setTime(row.k.t + 0.05); }}>
          <span className="muted">{fmt(row.k.t)}</span>
          {row.k.killer ? <b className={side(row.k.killer).toLowerCase()}>{name(row.k.killer)}</b> : <b>{row.k.cause === 'he' ? '💥 HE' : '🔥 Molotov'}</b>}
          ✕ <b className={side(row.k.victim).toLowerCase()}>{name(row.k.victim)}</b>
          <span className="muted grow-r">{where(row.k.at)}</span>
        </button>
      ) : (
        <button key={i} className={`kill util ${row.e.t <= s.time ? 'past' : ''}`} onClick={() => { s.setPlaying(false); s.setTime(row.e.t + 0.05); }}>
          <span className="muted">{fmt(row.e.t)}</span>
          <b className={side(row.e.id).toLowerCase()}>{name(row.e.id)}</b>
          <span>{row.e.kind === 'blind' ? `flashed ${row.e.amount.toFixed(1)}s` : row.e.kind === 'he' ? `HE −${Math.round(row.e.amount)} hp` : `burned −${Math.round(row.e.amount)} hp`}</span>
        </button>
      ))}
      <p className="muted">Click an event to jump there. 🎲 Re-roll plays the same round with different fight luck.</p>
    </section>
  );
}

function RouteEditor({ player, engine }: { player: import('../engine/types').Player; engine: TacticalEngine }) {
  const s = useStore();
  const r = player.route;
  const baked = r ? bakeRoute(engine, player) : null;
  if (!r)
    return (
      <div className="field">Route
        <button onClick={() => { s.setTool('path'); s.startRoute(player.id); }}>Draw route…</button>
      </div>
    );
  return (
    <div className="field">Route
      <div className="grid2">
        <label className="field">Leaves at (s)
          <input type="number" min={0} max={110} step={0.5} value={r.start} onChange={e => s.updateRoute(player.id, { start: Math.max(0, +e.target.value) })} />
        </label>
        <label className="field">Movement
          <select value={r.mode} onChange={e => s.updateRoute(player.id, { mode: e.target.value as 'run' | 'walk' })}>
            <option value="run">Run</option><option value="walk">Walk (shift)</option>
          </select>
        </label>
      </div>
      {baked && <span className="muted">Arrives {fmt(baked.end)} · {r.pts.length} waypoint{r.pts.length > 1 ? 's' : ''}{baked.unreachable ? ' · ⚠ a waypoint is off the walkable floor' : ''}</span>}
      <div className="row">
        <button onClick={() => { s.setTool('path'); s.startRoute(player.id); }}>Redraw</button>
        <button onClick={() => s.updateRoute(player.id, null)}>Delete route</button>
      </div>
    </div>
  );
}

const LEGEND = [Ctl.CtCross, Ctl.CtSeen, Ctl.CtZone, Ctl.Contested, Ctl.TSeen, Ctl.TZone, Ctl.TSide, Ctl.Denied];
const rgba = (c: Ctl, boost = 1) => {
  const v = CTL_COLORS[c];
  return v ? `rgba(${v[0]},${v[1]},${v[2]},${Math.min(1, (v[3] / 255) * boost)})` : 'transparent';
};

function MapControl({ control, time }: { control: ControlMap; time: number }) {
  const { share } = control;
  const parts = [
    { label: 'CT', v: share.ct, color: rgba(Ctl.CtSeen, 2.2) },
    { label: 'Contested', v: share.contested, color: rgba(Ctl.Contested, 2) },
    { label: 'T', v: share.t, color: rgba(Ctl.TZone, 2) },
    { label: 'Not reached', v: share.neutral, color: '#2a313b' },
  ];
  const order = [Ctl.TSeen, Ctl.TZone, Ctl.Contested, Ctl.TSide, Ctl.None, Ctl.CtZone, Ctl.CtSeen, Ctl.CtCross, Ctl.Denied];
  const callouts = [...control.callouts].sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls));
  return (
    <section>
      <h3>Map control at {fmt(time)}</h3>
      <div className="stack">
        {parts.map(p => p.v > 0.005 && <div key={p.label} style={{ width: `${p.v * 100}%`, background: p.color }} title={`${p.label} ${Math.round(p.v * 100)}%`} />)}
      </div>
      <div className="stack-labels">
        {parts.slice(0, 3).map(p => <span key={p.label}><i style={{ background: p.color }} />{p.label} {Math.round(p.v * 100)}%</span>)}
      </div>
      <div className="legend">
        {LEGEND.map(c => <span key={c}><i style={{ background: rgba(c, 1.8) }} />{CTL_LABEL[c]}</span>)}
      </div>
      {callouts.length > 0 && (
        <div className="callout-list">
          {callouts.map(c => (
            <div key={c.name} className="callout-row">
              <i style={{ background: c.cls === Ctl.None ? '#2a313b' : rgba(c.cls, 2) }} />
              <b>{c.name}</b>
              <span className="muted">
                {c.cls === Ctl.None
                  ? `Ts free from ${fmt(c.tArrive)}`
                  : c.watchers > 0 ? `${CTL_LABEL[c.cls]} (${c.watchers} CT${c.watchers > 1 ? 's' : ''})` : CTL_LABEL[c.cls]}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="muted">Press ▶ Play (or Space) to watch routes play out. Place T players to see their vision and the front line.</p>
    </section>
  );
}

function EconSelect({ value, onChange }: { value: Econ; onChange: (v: Econ) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as Econ)}>
      <option value="full">Full buy</option><option value="half">Half buy</option>
      <option value="force">Force</option><option value="eco">Eco</option>
    </select>
  );
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Line-up library for the current map: filter, preview on the map, use with the selected player. */
function Lineups({ engine }: { engine: TacticalEngine }) {
  const s = useStore();
  const [side, setSide] = useState<'all' | 'T' | 'CT'>('all');
  const [type, setType] = useState<'all' | Lineup['type']>('all');
  const list = [...BUILTIN_LINEUPS, ...s.customLineups].filter(l =>
    l.map === s.mapId && l.level === s.level && (side === 'all' || l.side === side || l.side === 'any') && (type === 'all' || l.type === type));
  const sel = s.board.players.find(p => p.id === s.selectedId);

  const use = (l: Lineup) => {
    const flight = flightTime(l, engine.map.radar.scale);
    // With a player selected: thrown as soon as they can walk to the throw spot.
    let throwAt = s.time;
    if (sel) {
      const path = engine.grid.shortestPath(sel.pos, l.from);
      if (path) {
        let len = 0;
        for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
        throwAt = Math.max(s.time, (sel.route?.start ?? 0) + len * engine.secPerPx(sel.side, sel.weapon) + 0.5);
      }
    }
    s.useLineup(l, Math.round(throwAt * 10) / 10, flight);
  };

  return (
    <section>
      <h3>Line-ups</h3>
      {s.tool === 'lineup' && <NewLineup engine={engine} />}
      <div className="row km">
        <select value={side} onChange={e => setSide(e.target.value as typeof side)}>
          <option value="all">Both sides</option><option value="T">T</option><option value="CT">CT</option>
        </select>
        <select value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="all">All grenades</option><option value="smoke">Smokes</option><option value="flash">Flashes</option>
          <option value="molotov">Molotovs</option><option value="he">HE</option>
        </select>
      </div>
      {list.map(l => (
        <div key={l.id} className="lineup">
          <div className="lineup-head">
            <span className={`dot ${l.type}`} />
            <b>{l.name}</b>
            <span className="muted">{l.side === 'any' ? '' : l.side}</span>
            <button onClick={() => use(l)} title={sel ? `Thrown when ${sel.side} ${sel.label} can reach the spot` : 'Thrown at the current round time'}>Use</button>
            {l.custom && <button onClick={() => s.deleteLineup(l.id)} title="Delete this line-up">✕</button>}
          </div>
          <div className="meta">{l.technique} · {flightTime(l, engine.map.radar.scale).toFixed(1)}s{l.notes ? ` · ${l.notes}` : ''}</div>
        </div>
      ))}
      {!list.length && <p className="muted">No line-ups here yet. Pick the Line-up tool (L) to add your own.</p>}
      <p className="muted">{sel ? `Use = ${sel.side} ${sel.label} walks there and throws it.` : 'Select a player first to have them walk over and throw it.'} Built-in spots are approximate; save your exact in-game version.</p>
    </section>
  );
}

function NewLineup({ engine }: { engine: TacticalEngine }) {
  const s = useStore();
  const d = s.draftLineup;
  const [name, setName] = useState('');
  const [type, setType] = useState<Lineup['type']>('smoke');
  const [lside, setLside] = useState<Lineup['side']>('T');
  const [technique, setTechnique] = useState<Technique>('jump-throw');
  const [notes, setNotes] = useState('');
  if (!d?.from || !d.to) return <p className="hint-box">{!d?.from ? 'Click where you stand to throw.' : 'Now click where it lands.'}</p>;
  const flight = flightTime({ from: d.from, to: d.to, technique, type }, engine.map.radar.scale);
  return (
    <div className="hint-box">
      <label className="field">Name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Window smoke" /></label>
      <div className="grid2">
        <label className="field">Grenade<select value={type} onChange={e => setType(e.target.value as Lineup['type'])}>
          <option value="smoke">Smoke</option><option value="flash">Flash</option><option value="molotov">Molotov</option><option value="he">HE</option>
        </select></label>
        <label className="field">Side<select value={lside} onChange={e => setLside(e.target.value as Lineup['side'])}>
          <option value="T">T</option><option value="CT">CT</option><option value="any">Both</option>
        </select></label>
      </div>
      <label className="field">Technique<select value={technique} onChange={e => setTechnique(e.target.value as Technique)}>
        <option value="throw">Throw</option><option value="jump-throw">Jump-throw</option><option value="run-jump-throw">Run + jump-throw</option>
        <option value="walk-throw">Walk-throw</option><option value="right-click">Right-click (short)</option>
      </select></label>
      <label className="field">How to aim (notes)<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. corner of the antenna" /></label>
      <p className="muted">Flies ~{flight.toFixed(1)}s.</p>
      <div className="row">
        <button onClick={() => s.saveLineup({ name: name || 'My line-up', type, side: lside, from: d.from!, to: d.to!, technique, notes })}>Save</button>
        <button onClick={() => useStore.setState({ draftLineup: null })}>Cancel</button>
      </div>
    </div>
  );
}
