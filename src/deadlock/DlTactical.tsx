import { useEffect, useMemo, useState } from 'react';
import { Arrow, Circle, Group, Image as KImage, Layer, Line, Text } from 'react-konva';
import { AreaChart } from '../site/charts';
import { Icon, type IconName } from '../ui/Icon';
import { loadBenchmarks, type Benchmarks } from './coach';
import { DL_HEROES, DL_MAP, heroOf, MAP_UNITS, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import ITEMS from './generated/items.json';
import { LAYER_LABEL, MapBase, useImages, type MapLayer } from './MapBase';
import { keyAt, MATCH_LENGTH, useTac, type Pt, type TacHero } from './tacticalStore';
import './dl.css';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
interface DlItem { id: number; name: string; cost: number; tier: number; slot: string; icon: string | null }
const ITEM_LIST = ITEMS as DlItem[];
const itemOf = new Map(ITEM_LIST.map(i => [i.id, i]));
type Tab = 'macro' | 'fight' | 'builds';
const TABS: { id: Tab; label: string; icon: IconName; tip: string }[] = [
  { id: 'macro', label: 'Macro plan', icon: 'route', tip: 'Who goes where over the match: lanes, rotations, objectives' },
  { id: 'fight', label: 'Teamfight', icon: 'swords', tip: 'One fight, frame by frame: positions, engages, who focuses whom' },
  { id: 'builds', label: 'Builds & spikes', icon: 'trendUp', tip: 'Both teams\' builds and when each side is stronger' },
];
/** Where a team's heroes start: just outside their base (map coordinates). */
const SPAWN: Record<DlTeam, Pt> = { 0: { x: 0.45, y: 0.86 }, 1: { x: 0.56, y: 0.14 } };

/** Deadlock Tactical: three planners in tabs. Everything is kept in this browser. */
export function DlTactical() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('stratboard.dl.tab') as Tab) || 'macro'; } catch { return 'macro'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('stratboard.dl.tab', t); } catch { /* private mode */ } };
  return (
    <div className="dl-tac">
      <nav className="recap-tabs dl-tac-tabs" aria-label="Planner">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)} title={t.tip}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
        <button className="ghost small-btn" onClick={() => { if (confirm('Clear every plan (heroes, paths, frames, builds)?')) useTac.getState().reset(); }}>Clear all</button>
      </nav>
      {tab === 'macro' && <Macro />}
      {tab === 'fight' && <Fight />}
      {tab === 'builds' && <Builds />}
    </div>
  );
}

// ---- shared ------------------------------------------------------------------------------------------------------

function HeroSelect({ value, onChange, label }: { value: number | null; onChange: (h: number) => void; label: string }) {
  return (
    <select className="dl-hero-select" value={value ?? ''} onChange={e => onChange(Number(e.target.value))} aria-label={label}>
      {value === null && <option value="">Pick a hero…</option>}
      {DL_HEROES.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
    </select>
  );
}

/** Both teams' heroes: change, remove, add (up to six a side). */
function Roster() {
  const heroes = useTac(s => s.heroes), selected = useTac(s => s.selected);
  const t = useTac.getState();
  return (
    <div className="dl-roster">
      {([0, 1] as DlTeam[]).map(team => {
        const mine = heroes.filter(h => h.team === team);
        return (
          <div key={team} className="dl-roster-team">
            <b style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}</b>
            {mine.map(h => (
              <div key={h.id} className={`dl-roster-row ${selected === h.id ? 'on' : ''}`} onClick={() => t.select(h.id)}>
                {heroOf(h.hero).card && <img src={heroOf(h.hero).card!} alt="" width={24} height={24} />}
                <HeroSelect value={h.hero} onChange={v => t.setHero(h.id, v)} label="Hero" />
                <button className="verdict-undo" onClick={e => { e.stopPropagation(); t.removeHero(h.id); }} aria-label="Remove hero"><Icon name="close" size={11} /></button>
              </div>
            ))}
            {mine.length < 6 && (
              <button className="ghost small-btn" onClick={() => t.addHero(team, DL_HEROES[(heroes.length * 7 + team * 3) % DL_HEROES.length].id, { x: SPAWN[team].x + (mine.length - 2.5) * 0.02, y: SPAWN[team].y })}>
                + Add hero
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LayerToggles({ layers, setLayers }: { layers: Set<MapLayer>; setLayers: (l: Set<MapLayer>) => void }) {
  return (
    <div className="dl-layers" role="group" aria-label="Map layers">
      {(Object.keys(LAYER_LABEL) as MapLayer[]).map(l => (
        <label key={l} className="dl-layer"><input type="checkbox" checked={layers.has(l)} onChange={e => { const n = new Set(layers); if (e.target.checked) n.add(l); else n.delete(l); setLayers(n); }} /> {LAYER_LABEL[l]}</label>
      ))}
    </div>
  );
}
function useLayers(initial: MapLayer[]) {
  const [layers, setLayers] = useState(() => new Set(initial));
  return [layers, setLayers] as const;
}

/** A hero on the map: icon, team ring; draggable. */
function Token({ h, at, k, S, icon, selected, onDrag, onClick, dim }: {
  h: TacHero; at: Pt; k: number; S: number; icon?: HTMLImageElement; selected: boolean; dim?: boolean;
  onDrag: (at: Pt) => void; onClick: () => void;
}) {
  const R = 10 * k;
  return (
    <Group x={at.x * S} y={at.y * S} draggable opacity={dim ? 0.45 : 1}
      onDragEnd={e => onDrag({ x: e.target.x() / S, y: e.target.y() / S })} onClick={e => { e.cancelBubble = true; onClick(); }} onTap={e => { e.cancelBubble = true; onClick(); }}
      onMouseEnter={e => { e.target.getStage()!.container().style.cursor = 'grab'; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = ''; }}>
      {selected && <Circle radius={R + 6 * k} stroke="#fff" strokeWidth={1.4 * k} />}
      <Circle radius={R + 3 * k} fill={TEAM_COLOR[h.team]} />
      <Circle radius={R} fill="#0b0e12" />
      {icon && <KImage image={icon} x={-R} y={-R} width={2 * R} height={2 * R} />}
    </Group>
  );
}

// ---- 1. macro plan -------------------------------------------------------------------------------------------------

function Macro() {
  const heroes = useTac(s => s.heroes), keys = useTac(s => s.keys), notes = useTac(s => s.notes), time = useTac(s => s.time), playing = useTac(s => s.playing), selected = useTac(s => s.selected);
  const t = useTac.getState();
  const [layers, setLayers] = useLayers(['lanes', 'objectives', 'urn', 'camps', 'tunnels']);
  const [note, setNote] = useState('');
  const icons = useImages(heroes.map(h => heroOf(h.hero).icon));
  // plays at 20x: a 40-minute plan in 2 minutes
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const s = useTac.getState(), nt = s.time + ((now - last) / 1000) * 20;
      last = now;
      useTac.setState({ time: Math.min(MATCH_LENGTH, nt), ...(nt >= MATCH_LENGTH ? { playing: false } : {}) });
      if (nt < MATCH_LENGTH) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const lanePreset = () => {
    // two heroes a lane, at their own Guardians, a minute in
    for (const team of [0, 1] as DlTeam[]) {
      const mine = useTac.getState().heroes.filter(h => h.team === team);
      const guards = DL_MAP.objectives.filter(o => o.team === team && o.kind === 'tier1').sort((a, b) => a.x - b.x);
      mine.forEach((h, i) => { const g = guards[Math.floor(i / 2) % guards.length]; if (g) t.setKey(h.id, 60, { x: g.x + (i % 2 ? 0.015 : -0.015), y: g.y }); });
    }
  };
  const near = notes.filter(n => Math.abs(n.t - time) <= 15);
  const sel = heroes.find(h => h.id === selected);
  return (
    <div className="dl-tac-body">
      <aside className="dl-tac-side">
        <Roster />
        <button className="ghost small-btn" onClick={lanePreset} disabled={!heroes.length} title="Two heroes a lane, at their own Guardians at 1:00">Lane setup (2-2-2)</button>
        <p className="muted small">Drag a hero at any moment of the match to set where they should be then: in between they move in a straight line. Play to watch the plan.</p>
        <LayerToggles layers={layers} setLayers={setLayers} />
      </aside>
      <div className="dl-tac-map">
        <MapBase layers={layers}>
          {(S, k) => (
            <Layer>
              {sel && (keys[sel.id]?.length ?? 0) > 1 && (
                <>
                  <Line points={keys[sel.id].flatMap(q => [q.at.x * S, q.at.y * S])} stroke="#fff" strokeWidth={1.4 * k} dash={[5 * k, 4 * k]} opacity={0.8} listening={false} />
                  {keys[sel.id].map(q => (
                    <Group key={q.t} x={q.at.x * S} y={q.at.y * S} listening={false}>
                      <Circle radius={3 * k} fill="#fff" />
                      <Text text={mins(q.t)} fontSize={9 * k} fill="#fff" x={5 * k} y={-12 * k} />
                    </Group>
                  ))}
                </>
              )}
              {heroes.map(h => {
                const at = keyAt(keys[h.id], time);
                if (!at) return null;
                const icon = heroOf(h.hero).icon;
                return <Token key={h.id} h={h} at={at} k={k} S={S} icon={icon ? icons[icon] : undefined} selected={selected === h.id}
                  onDrag={p => { t.setKey(h.id, time, p); t.select(h.id); }} onClick={() => t.select(selected === h.id ? null : h.id)} />;
              })}
            </Layer>
          )}
        </MapBase>
        {near.length > 0 && <div className="dl-tac-notes">{near.map(n => <span key={n.t + n.text}><b className="num">{mins(n.t)}</b> {n.text}</span>)}</div>}
      </div>
      <div className="dl-playbar dl-tac-bar">
        <button className="play-main" onClick={() => { if (!playing && time >= MATCH_LENGTH) t.setTime(0); t.setPlaying(!playing); }}><Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause' : 'Play'}</button>
        <div className="dl-timeline">
          <input type="range" min={0} max={MATCH_LENGTH} step={5} value={time} onChange={e => t.setTime(Number(e.target.value))} aria-label="Plan time" />
          <div className="dl-marks" aria-hidden>
            {sel && (keys[sel.id] ?? []).map(q => <i key={q.t} className="graded" style={{ left: `${(q.t / MATCH_LENGTH) * 100}%`, background: '#fff' }} />)}
            {notes.map(n => <i key={n.t + n.text} className="objective" style={{ left: `${(n.t / MATCH_LENGTH) * 100}%`, background: 'var(--highlight)' }} />)}
          </div>
        </div>
        <span className="num dl-time">{mins(time)}</span>
        <form className="dl-note-form" onSubmit={e => { e.preventDefault(); if (note.trim()) { t.addNote({ t: Math.round(time), text: note.trim().slice(0, 120) }); setNote(''); } }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={`Note at ${mins(time)} (e.g. "group mid for the Walker")`} maxLength={120} />
          <button className="chip" disabled={!note.trim()}>Add</button>
        </form>
        {sel && <button className="ghost small-btn" onClick={() => t.clearKeys(sel.id)} title="Forget this hero's path (keeps where they start)">Clear {heroOf(sel.hero).name}'s path</button>}
      </div>
      {notes.length > 0 && (
        <ol className="dl-note-list">
          {notes.map((n, i) => <li key={n.t + n.text}><button className="chip" onClick={() => t.setTime(n.t)}>{mins(n.t)}</button> {n.text} <button className="verdict-undo" onClick={() => t.removeNote(i)} aria-label="Remove note"><Icon name="close" size={10} /></button></li>)}
        </ol>
      )}
    </div>
  );
}

// ---- 2. teamfight ---------------------------------------------------------------------------------------------------

function Fight() {
  const heroes = useTac(s => s.heroes), frames = useTac(s => s.frames), frame = useTac(s => s.frame), ranges = useTac(s => s.ranges), selected = useTac(s => s.selected);
  const t = useTac.getState();
  const [layers, setLayers] = useLayers(['objectives']);
  const [anim, setAnim] = useState<number | null>(null);
  const icons = useImages(heroes.map(h => heroOf(h.hero).icon));
  const cur = frames[frame] ?? frames[0], prev = frame > 0 ? frames[frame - 1] : null;
  // play: every frame in turn, 1.2 s each, sliding between them
  useEffect(() => {
    if (anim === null) return;
    let raf = 0; const start = performance.now();
    const tick = (now: number) => {
      const p = (now - start) / 1200;
      if (p >= frames.length - 1) { setAnim(null); t.setFrame(frames.length - 1); return; }
      setAnim(p); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const posOf = (id: string): Pt | null => {
    if (anim !== null) {
      const i = Math.floor(anim), f = anim - i, a = frames[i]?.pos[id], b = frames[i + 1]?.pos[id] ?? a;
      return a && b ? { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f } : a ?? null;
    }
    return cur.pos[id] ?? null;
  };
  const sel = heroes.find(h => h.id === selected);
  return (
    <div className="dl-tac-body">
      <aside className="dl-tac-side">
        <Roster />
        <div className="dl-frames" role="group" aria-label="Frames">
          {frames.map((_, i) => <button key={i} className={`chip ${frame === i ? 'on' : ''}`} onClick={() => t.setFrame(i)}>Frame {i + 1}</button>)}
          <button className="chip" onClick={() => t.addFrame()} title="A new frame starting from this one">+ Frame</button>
        </div>
        <div className="dl-frame-actions">
          <button className="ghost small-btn" onClick={() => { t.setFrame(0); setAnim(0); }} disabled={frames.length < 2}><Icon name="play" size={12} /> Play frames</button>
          {frames.length > 1 && <button className="ghost small-btn" onClick={() => t.removeFrame(frame)}>Delete frame {frame + 1}</button>}
        </div>
        {sel ? (
          <div className="dl-sel">
            <b>{heroOf(sel.hero).name}</b>
            <label className="dl-range">Range ring <input type="range" min={0} max={3000} step={100} value={ranges[sel.id] ?? 0} onChange={e => t.setRange(sel.id, Number(e.target.value))} />
              <span className="num muted small">{ranges[sel.id] ? `${ranges[sel.id]} u` : 'off'}</span></label>
            <p className="muted small">Click an enemy to have {heroOf(sel.hero).name} focus them (click again to undo).</p>
          </div>
        ) : <p className="muted small">Drag heroes to place them in this frame. Select one for its range ring and who it focuses. Arrows show how each hero moved since the last frame.</p>}
        <LayerToggles layers={layers} setLayers={setLayers} />
      </aside>
      <div className="dl-tac-map">
        <MapBase layers={layers} onBackground={() => t.select(null)}>
          {(S, k) => (
            <Layer>
              {heroes.map(h => {
                const at = posOf(h.id), r = ranges[h.id];
                return at && r ? <Circle key={`r${h.id}`} x={at.x * S} y={at.y * S} radius={(r / MAP_UNITS) * S} stroke={TEAM_COLOR[h.team]} strokeWidth={1.2 * k} dash={[4 * k, 3 * k]} fill={TEAM_COLOR[h.team]} opacity={0.12} listening={false} /> : null;
              })}
              {anim === null && prev && heroes.map(h => {
                const a = prev.pos[h.id], b = cur.pos[h.id];
                if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < 0.004) return null;
                return <Arrow key={`m${h.id}`} points={[a.x * S, a.y * S, b.x * S, b.y * S]} stroke={TEAM_COLOR[h.team]} fill={TEAM_COLOR[h.team]} strokeWidth={1.6 * k} dash={[5 * k, 4 * k]} pointerLength={6 * k} pointerWidth={6 * k} opacity={0.75} listening={false} />;
              })}
              {anim === null && cur.focus.map(f => {
                const a = cur.pos[f.from], b = cur.pos[f.to];
                return a && b ? <Arrow key={`f${f.from}-${f.to}`} points={[a.x * S, a.y * S, b.x * S, b.y * S]} stroke="#ef4444" fill="#ef4444" strokeWidth={2 * k} pointerLength={7 * k} pointerWidth={7 * k} listening={false} /> : null;
              })}
              {heroes.map(h => {
                const at = posOf(h.id);
                if (!at) return null;
                const icon = heroOf(h.hero).icon;
                return <Token key={h.id} h={h} at={at} k={k} S={S} icon={icon ? icons[icon] : undefined} selected={selected === h.id}
                  onDrag={p => { t.setFramePos(h.id, p); t.select(h.id); }}
                  onClick={() => { if (sel && sel.team !== h.team) t.toggleFocus(sel.id, h.id); else t.select(selected === h.id ? null : h.id); }} />;
              })}
            </Layer>
          )}
        </MapBase>
      </div>
    </div>
  );
}

// ---- 3. builds and power spikes ------------------------------------------------------------------------------------

function Builds() {
  const builds = useTac(s => s.builds);
  const t = useTac.getState();
  const [bench, setBench] = useState<Benchmarks>({});
  const heroIds = [...builds[0], ...builds[1]].map(r => r.hero);
  const key = heroIds.join(',');
  useEffect(() => { if (heroIds.length) loadBenchmarks(heroIds).then(b => setBench(old => ({ ...old, ...b }))); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // a hero's expected souls at time t: the average player's curve, from 0 at the start
  const soulsAt = (hero: number, at: number) => {
    const c = bench[hero];
    if (!c?.length) return null;
    const pts = [{ t: 0, avg: 0 }, ...c];
    for (let i = 1; i < pts.length; i++) if (at <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return a.avg + ((b.avg - a.avg) * (at - a.t)) / (b.t - a.t || 1); }
    return pts[pts.length - 1].avg;
  };
  const whenSouls = (hero: number, need: number) => {
    for (let s = 0; s <= MATCH_LENGTH; s += 15) { const v = soulsAt(hero, s); if (v === null) return null; if (v >= need) return s; }
    return null;
  };
  const teamAt = (team: DlTeam, s: number) => builds[team].reduce((a, r) => a + (soulsAt(r.hero, s) ?? 0), 0);
  const ready = heroIds.length > 0 && heroIds.every(h => bench[h]?.length);
  const curve = useMemo(() => ready ? Array.from({ length: 21 }, (_, i) => i * 120).map(s => ({ label: mins(s), value: teamAt(0, s) - teamAt(1, s) })) : [], [ready, key, bench]); // eslint-disable-line react-hooks/exhaustive-deps
  // each item's spike: when the hero has the souls for the build up to it
  const spikes = useMemo(() => ([0, 1] as DlTeam[]).flatMap(team => builds[team].flatMap(r => {
    let sum = 0;
    return r.items.map(id => { const it = itemOf.get(id)!; sum += it?.cost ?? 0; return { team, hero: r.hero, item: it, t: whenSouls(r.hero, sum) }; });
  })).filter(x => x.item && x.t !== null && x.item.tier >= 3).sort((a, b) => a.t! - b.t!), [builds, bench]); // eslint-disable-line react-hooks/exhaustive-deps
  const windows = useMemo(() => {
    const out: { from: number; to: number; team: DlTeam }[] = [];
    for (let s = 0; s <= MATCH_LENGTH; s += 30) {
      const a = teamAt(0, s), b = teamAt(1, s), lead = (a - b) / Math.max(1, (a + b) / 2);
      const team: DlTeam | null = lead > 0.06 ? 0 : lead < -0.06 ? 1 : null;
      const last = out[out.length - 1];
      if (team === null) continue;
      if (last && last.team === team && s - last.to <= 30) last.to = s; else out.push({ from: s, to: s, team });
    }
    return out.filter(w => w.to - w.from >= 60);
  }, [ready, key, bench]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dl-builds">
      {([0, 1] as DlTeam[]).map(team => (
        <section key={team} className="recap-card dl-build-team">
          <h3 style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}</h3>
          {builds[team].map((r, i) => (
            <BuildRowEdit key={i} row={r} onChange={nr => t.setBuild(team, builds[team].map((x, j) => (j === i ? nr : x)))} onRemove={() => t.setBuild(team, builds[team].filter((_, j) => j !== i))} />
          ))}
          {builds[team].length < 6 && <button className="ghost small-btn" onClick={() => t.setBuild(team, [...builds[team], { hero: DL_HEROES[(builds[0].length + builds[1].length) * 5 % DL_HEROES.length].id, items: [] }])}>+ Add hero</button>}
        </section>
      ))}
      <section className="recap-card dl-build-out">
        <h3>Who's stronger when</h3>
        {!heroIds.length ? <p className="muted">Add heroes to both teams (and their items) to see the soul curves and power spikes.</p> : !ready ? <p className="muted">Loading the average soul curves…</p> : (
          <>
            <p className="muted small">Expected souls from the average player on each hero (deadlock-api, last 30 days). Above zero: {TEAM_NAME[0]} ahead.</p>
            <AreaChart points={curve} fmt={v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v)).toLocaleString()}`} height={170} color={TEAM_COLOR[0]} />
            {windows.length > 0 && (
              <>
                <h4>Windows to fight or take objectives</h4>
                <ul className="dl-windows">{windows.map(w => <li key={w.from}><b style={{ color: TEAM_COLOR[w.team] }}>{TEAM_NAME[w.team]}</b> ahead {mins(w.from)}–{mins(w.to)}</li>)}</ul>
              </>
            )}
            {spikes.length > 0 && (
              <>
                <h4>Item spikes (tier 3+)</h4>
                <ol className="dl-spikes">
                  {spikes.map((x, i) => (
                    <li key={i}><span className="num muted">~{mins(x.t!)}</span>{x.item.icon && <img src={x.item.icon} alt="" width={20} height={20} />}<b style={{ color: TEAM_COLOR[x.team] }}>{heroOf(x.hero).name}</b> {x.item.name} <span className="muted small">T{x.item.tier}</span></li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function BuildRowEdit({ row, onChange, onRemove }: { row: { hero: number; items: number[] }; onChange: (r: { hero: number; items: number[] }) => void; onRemove: () => void }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const total = row.items.reduce((a, id) => a + (itemOf.get(id)?.cost ?? 0), 0);
  const found = ITEM_LIST.filter(i => !row.items.includes(i.id) && (!q || i.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 40);
  return (
    <div className="dl-build-row">
      <div className="dl-build-head">
        {heroOf(row.hero).card && <img src={heroOf(row.hero).card!} alt="" width={26} height={26} />}
        <HeroSelect value={row.hero} onChange={h => onChange({ ...row, hero: h })} label="Hero" />
        <span className="num muted small">{total.toLocaleString()} souls</span>
        <button className="verdict-undo" onClick={onRemove} aria-label="Remove hero"><Icon name="close" size={11} /></button>
      </div>
      <div className="dl-build-items">
        {row.items.map(id => { const it = itemOf.get(id); return it ? (
          <button key={id} className={`dl-item t${it.tier} ${it.slot}`} onClick={() => onChange({ ...row, items: row.items.filter(x => x !== id) })} title={`${it.name} · ${it.cost} souls · tier ${it.tier} (click to remove)`}>
            {it.icon && <img src={it.icon} alt="" width={18} height={18} />}{it.name}
          </button>
        ) : null; })}
        <button className="chip" onClick={() => setAdding(!adding)}>{adding ? 'Done' : '+ Item'}</button>
      </div>
      {adding && (
        <div className="dl-item-pick">
          <input autoFocus placeholder="Search items" value={q} onChange={e => setQ(e.target.value)} />
          <div className="dl-item-list">
            {found.map(i => <button key={i.id} className={`dl-item t${i.tier} ${i.slot}`} onClick={() => onChange({ ...row, items: [...row.items, i.id] })}>{i.icon && <img src={i.icon} alt="" width={18} height={18} />}{i.name}<span className="muted small">{i.cost}</span></button>)}
          </div>
        </div>
      )}
    </div>
  );
}
