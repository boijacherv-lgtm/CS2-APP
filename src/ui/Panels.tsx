import type { ControlMap } from '../engine/control';
import type { Analysis, TacticalEngine } from '../engine/predict';
import { popAt } from '../engine/grid';
import { ENTRY_COLOR, entryClock, entryReports } from '../engine/entries';
import { GUN_GROUPS, GUNS, gunById, gunOf, gunRangeFactor, type Gun } from '../engine/guns';
import { bakeRoute } from '../engine/timeline';
import type { Simulation } from '../engine/combat';
import type { BatchStats, UtilityImpact } from '../engine/batch';
import type { Spot, SpotMap } from '../engine/spots';
import { killColor } from './Board';
import type { Econ } from '../engine/types';
import { hasLayer, isAutoLayer, MAPS, presetsFor, roughNote, tPlaysFor } from '../map/catalog';
import { useStore, type Tool } from '../store';
import { Fold } from './Fold';
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

export function Toolbar({ engine }: { engine: TacticalEngine }) {
  const s = useStore();
  const entry = MAPS.find(m => m.id === s.mapId)!;
  return (
    <aside className="toolbar">
      <h1>{s.mode === 'review' ? 'Match review' : 'Tactical board'}<span>{entry.name}{s.level ? ' · lower level' : ''}</span></h1>
      <section>
        <h3>Map</h3>
        <select value={s.mapId} disabled={s.mode === 'review'} onChange={e => s.setMap(e.target.value)}>
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
      {s.mode !== 'review' && <Fold id="tools" title="Tools">
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
      </Fold>}
      {s.mode === 'review' && <DemoLoader />}
      {s.mode !== 'review' && <>
      <Fold id="ct-setups" title="CT setups">
        <div className="presets">
          {Object.keys(presetsFor(s.mapId, s.level)).map(n => <button key={n} onClick={() => s.loadPreset(n)}>{n === 'Empty' ? 'Clear CTs' : n}</button>)}
        </div>
      </Fold>
      {Object.keys(tPlaysFor(s.mapId, s.level)).length > 0 && (
        <Fold id="t-plays" title="T plays (with routes)">
          <div className="presets">
            {Object.keys(tPlaysFor(s.mapId, s.level)).map(n => <button key={n} onClick={() => s.loadTPlay(n)}>{n}</button>)}
            <button onClick={() => s.loadTPlay(null)}>Clear Ts</button>
          </div>
        </Fold>
      )}
      <Lineups engine={engine} />
      </>}
      {s.mode !== 'review' && <Selection engine={engine} />}
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
      <label className="field">Gun
        <select value={gunOf(p).id} onChange={e => { const gun = gunById(e.target.value)!; s.updatePlayer(p.id, { gun: gun.id, weapon: gun.cls }); }}>
          {GUN_GROUPS.map(gr => (
            <optgroup key={gr.label} label={gr.label}>
              {gr.ids.map(id => gunById(id)!).filter(gn => gn.side === 'both' || gn.side === p.side).map(gn => (
                <option key={gn.id} value={gn.id}>{gn.name} · ${gn.price}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <GunCard gun={gunOf(p)} />
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

export function AnalysisPanel({ analysis, engine, control, sim, spots, batch, impact, stale }: {
  analysis: Analysis; engine: TacticalEngine; control: ControlMap | null; sim: Simulation | null;
  spots: SpotMap | null; batch: { stats: BatchStats; done: boolean } | null;
  impact: { v: UtilityImpact; done: boolean } | null; stale: boolean;
}) {
  const s = useStore();
  const ctx = s.board.context;
  // entries ordered by how much of the T push is expected through them, then by threat
  const entries = entryReports(engine, analysis, s.board).sort((a, b) => b.pressure - a.pressure || b.threat - a.threat);
  const names = new Map(engine.map.chokepoints.map(c => [c.id, c.name]));
  return (
    <aside className={`panel ${stale ? 'stale' : ''}`}>
      <Fold id="context" title="Round context">
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
      </Fold>

      <section className="summary">
        {analysis.summary.map((l, i) => <p key={i}>{l}</p>)}
      </section>

      <SpotFinder spots={spots} />
      <KillChances batch={batch} />
      <UtilityEval engine={engine} batch={batch} impact={impact} />
      {sim && <KillFeed sim={sim} engine={engine} />}
      {control && <MapControl control={control} time={s.time} />}

      {!engine.map.chokepoints.length && (
        <section className="summary">
          <p><b>No prediction engine for {engine.map.name}{s.level ? ' (lower level)' : ''} yet.</b></p>
          <p className="muted">Sightlines, the timing overlay and hover timings work here. Predictions need this map's chokepoints and T plays, which only Mirage has so far.</p>
        </section>
      )}

      {analysis.predictions.length > 0 && <Fold id="preds" title="Predicted T plays">
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
      </Fold>}

      {entries.length > 0 && <Fold id="entries" title="Entries · who holds what" defaultOpen={false}>
        {entries.map(e => (
          <div key={e.id} className="entry">
            <div className="entry-head">
              <span className="pill" style={{ background: ENTRY_COLOR[e.level] }}>{e.level.toUpperCase()}</span>
              <b>{e.name}</b>
              <span className="muted">{entryClock(e, s.time)}</span>
              {e.pressure >= 0.05 && <span className="pct" title="Share of the T team expected through here">{Math.round(e.pressure * 100)}%</span>}
            </div>
            <div className="entry-line" style={{ color: ENTRY_COLOR[e.level] }}>{e.headline}</div>
            {e.details.map((d, i) => <div key={i} className="reason">{d}</div>)}
          </div>
        ))}
      </Fold>}
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
    <Fold id="utility" title="Utility evaluation" aside={impact && !impact.done ? 'measuring…' : undefined}>
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
    </Fold>
  );
}

function KillChances({ batch }: { batch: { stats: BatchStats; done: boolean } | null }) {
  const s = useStore();
  const players = s.board.players;
  const cts = players.filter(p => p.side === 'CT'), ts = players.filter(p => p.side === 'T');
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const row = (p: typeof players[number]) => {
    const st = batch?.stats.players[p.id];
    return (
      <tr key={p.id} className={s.selectedId === p.id ? 'sel' : ''} onClick={() => s.select(p.id)}>
        <td><b className={p.side.toLowerCase()}>{p.side} {p.label}</b> <span className="muted">{gunOf(p).short}</span></td>
        <td style={{ color: st ? killColor(st.pKill) : undefined }}>{st ? pct(st.pKill) : '–'}</td>
        <td>{st ? st.avgKills.toFixed(2) : '–'}</td>
        <td>{st ? pct(st.survive) : '–'}</td>
        <td className={st && st.flashed > 0.25 ? 'warn' : ''} title={st ? `Average utility damage taken: ${st.utilDamage.toFixed(0)} hp` : ''}>{st ? pct(st.flashed) : '–'}</td>
      </tr>
    );
  };
  if (!cts.length) return null;
  return (
    <Fold id="kills" title="Kill chances" aside={batch ? `${batch.stats.rounds}${batch.done ? '' : '/200'} rounds` : undefined}>
      {!ts.length && <p className="muted">Place T players (or load a T play) to simulate fights.</p>}
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
        <thead><tr><th /><th title="Chance to get at least one kill">Kill</th><th title="Average kills per round">Avg K</th><th title="Chance to survive the round">Alive</th><th title="Rounds in which this player gets blinded for 1 s or more">Flashed</th></tr></thead>
        <tbody>{cts.map(row)}{ts.map(row)}</tbody>
      </table>
    </Fold>
  );
}

/** Where should the selected CT stand: the top three spots in plain words, and their current one. */
function SpotFinder({ spots }: { spots: SpotMap | null }) {
  const s = useStore();
  if (!s.overlays.killmap) return null;
  const pl = spots && s.board.players.find(p => p.id === spots.playerId);
  if (!spots || !pl) {
    return (
      <section>
        <h3>Best spots</h3>
        <p className="muted">Select a CT to find where they should stand. It checks the spots they can reach before the Ts arrive.</p>
      </section>
    );
  }
  const gun = gunOf(pl);
  const explain = (sp: Spot) => [
    `${Math.round(sp.firstDuel * 100)}% to win the first duel: ${sp.tAware ? 'the T is already checking this angle' : 'the T walks in looking elsewhere'}.`,
    sp.trade > 0 ? `If you lose it, a teammate trades ${Math.round(sp.trade * 100)}% of the time.` : 'Nobody can trade you here.',
    sp.angles > 1 ? `${sp.angles} Ts appear within 1.5 s: two angles at once.` : 'One angle at a time.',
    `You're set by ${fmt(sp.setBy)}, first T around ${fmt(sp.firstContact)}.`,
  ];
  return (
    <Fold id="spots" title={<>Best spots · {pl.side} {pl.label} ({gun.name})</>}>
      {spots.jobs.length > 0 && <p className="muted">Keeps <b>{spots.jobs.join(' + ')}</b> covered: only spots that still see it are suggested.</p>}
      {spots.best.map((sp, i) => (
        <div key={i} className="spot">
          <div className="spot-head">
            <span className="spot-rank">{i + 1}</span>
            <b>{sp.where || 'Spot'}</b>
            <span className="pct" style={{ color: killColor(sp.score / 100) }}>{sp.score}</span>
            <button onClick={() => s.move(pl.id, sp.pos)}>Move here</button>
          </div>
          {explain(sp).map((l, j) => <div key={j} className="reason">{l}</div>)}
        </div>
      ))}
      {!spots.best.length && <p className="muted">No reachable spot sees a T in time from here. Try another position or place Ts.</p>}
      {spots.current && (
        <div className="spot current">
          <div className="spot-head">
            <span className="spot-rank now">now</span>
            <b>Current spot</b>
            <span className="pct" style={{ color: killColor(spots.current.score / 100) }}>{spots.current.score}</span>
            <span className="muted">{spots.currentRank ? `#${spots.currentRank} of ${spots.candidates}` : ''}</span>
          </div>
          {spots.current.note && <div className="reason warn-text">{spots.current.note}</div>}
          {explain(spots.current).slice(0, 3).map((l, j) => <div key={j} className="reason">{l}</div>)}
        </div>
      )}
      <p className="muted">Scored against {spots.source === 'players' ? 'the Ts you placed and their routes' : 'Ts on the default paths from spawn'}. Score = first duel, tradeability, angles, minus hiding deep.</p>
    </Fold>
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
    <Fold id="feed" defaultOpen={false}
      title="Round events"
      aside={<>alive {fmt(s.time)}: <span className="ct">CT {alive('CT')}</span> vs <span className="t">T {alive('T')}</span></>}>
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
    </Fold>
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

/** Territory summary: who holds how much, the legend, and every named area with a CT-vs-T bar. */
function MapControl({ control, time }: { control: ControlMap; time: number }) {
  const [allZones, setAllZones] = useState(false);
  let ct = 0, tt = 0, mid = 0, n = 0;
  for (let i = 0; i < control.owner.length; i++) {
    const o = control.owner[i];
    if (Number.isNaN(o)) continue;
    n++;
    if (o > 0.15) ct++; else if (o < -0.15) tt++; else mid++;
  }
  const pct = (v: number) => Math.round((v / Math.max(1, n)) * 100);
  const zones = [...control.zones].sort((a, b) => (b.t - b.ct) - (a.t - a.ct));
  const status = (z: ControlMap['zones'][number]) => {
    if (z.ct >= 0.6) return z.watchers ? `CT watching (${z.watchers})` : 'CT hold';
    if (z.t >= 0.6) return 'T hold';
    if (z.ct + z.t < 0.3) return 'Contested';
    if (z.tArrive > time && Number.isFinite(z.tArrive)) return `Ts arrive ${fmt(z.tArrive)}`;
    return z.ct > z.t ? 'CT leaning' : 'T leaning';
  };
  return (
    <Fold id="mapcontrol" title={<>Map control at {fmt(time)}</>}>
      <div className="stack">
        <div style={{ width: `${pct(ct)}%`, background: 'var(--ct)' }} title={`CT ${pct(ct)}%`} />
        <div style={{ width: `${pct(mid)}%`, background: '#ffd640' }} title={`Contested ${pct(mid)}%`} />
        <div style={{ width: `${pct(tt)}%`, background: 'var(--t)' }} title={`T ${pct(tt)}%`} />
      </div>
      <div className="stack-labels">
        <span className="ct"><i style={{ background: 'var(--ct)' }} />CT {pct(ct)}%</span>
        <span><i style={{ background: '#ffd640' }} />Contested {pct(mid)}%</span>
        <span className="t"><i style={{ background: 'var(--t)' }} />T {pct(tt)}%</span>
      </div>
      <p className="muted">Stronger colour = firmer hold · brighter = someone is watching it · <b style={{ color: '#ffd640' }}>yellow line</b> = the front.</p>
      <div className="zones">
        {(allZones ? zones : zones.slice(0, 4)).map(z => (
          <div key={z.name} className="zone-row">
            <b>{z.name}</b>
            <div className="zone-bar" title={`CT ${Math.round(z.ct * 100)}% · contested ${Math.round(z.contested * 100)}% · T ${Math.round(z.t * 100)}%`}>
              <div style={{ width: `${z.ct * 100}%`, background: 'var(--ct)' }} />
              <div style={{ width: `${z.contested * 100}%`, background: '#ffd64088' }} />
              <div style={{ width: `${z.t * 100}%`, background: 'var(--t)' }} />
            </div>
            <span className="muted">{status(z)}</span>
          </div>
        ))}
      </div>
      {zones.length > 4 && (
        <button className="linkish" onClick={() => setAllZones(v => !v)}>{allZones ? 'Show fewer areas' : `Show all ${zones.length} areas`}</button>
      )}
    </Fold>
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
    <Fold id="lineups" title="Line-ups" defaultOpen={false}>
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
    </Fold>
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

/** Stats of a gun as bars, relative to the best gun in each category. */
export function GunCard({ gun }: { gun: Gun }) {
  const max = (f: (x: Gun) => number) => Math.max(...GUNS.map(f));
  const rows: [string, number, number, string][] = [
    ['Kill speed', gun.killRate, max(x => x.killRate), `${gun.killRate.toFixed(1)}/s`],
    ['Damage', Math.min(gun.damage, 120), 120, `${gun.damage}${gun.oneTap ? ` · one-tap ${gun.oneTap}` : ''}`],
    ['Fire rate', gun.rpm, max(x => x.rpm), `${gun.rpm} rpm`],
    ['Armour pen.', gun.armorPen, 100, `${gun.armorPen}%`],
    ['Long range', gunRangeFactor(gun, 2500), 1, `${Math.round(gunRangeFactor(gun, 2500) * 100)}% at 2500u`],
    ['Mobility', gun.speed - 140, 240 - 140, `${gun.speed} u/s`],
  ];
  return (
    <div className="guncard">
      <div className="gun-head"><b>{gun.name}</b><span className="muted">{gun.side === 'both' ? 'Both sides' : gun.side} · ${gun.price}</span></div>
      {rows.map(([label, v, m, txt]) => (
        <div key={label} className="gun-row">
          <span>{label}</span>
          <div className="gun-bar"><div style={{ width: `${Math.max(3, (v / m) * 100)}%` }} /></div>
          <span className="muted">{txt}</span>
        </div>
      ))}
    </div>
  );
}
