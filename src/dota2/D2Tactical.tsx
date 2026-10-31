import { useEffect, useState } from 'react';
import { Arrow, Circle, Group, Image as KImage, Layer, Line, Text } from 'react-konva';
import { Icon, type IconName } from '../ui/Icon';
import { heroMatchups, matchupRate, type HeroMatchup } from './api';
import { buildingOf, cellToMap, D2_HEROES, heroOf, LANE_TOWER, MAP_UNITS, mins, OBS_VISION, roshanOnMap, runeIcon, TEAM_COLOR, TEAM_NAME, type D2Team, type MapStyle, type Pt } from './data';
import { D2Map, useImages } from './D2Map';
import { keyAt, MATCH_LENGTH, useTac, WARD_LIFE, type TacHero } from './tacticalStore';
import '../deadlock/dl.css';
import './d2.css';

type Tab = 'draft' | 'macro' | 'fight';
const TABS: { id: Tab; label: string; icon: IconName; tip: string }[] = [
  { id: 'draft', label: 'Draft', icon: 'grid', tip: 'Both teams\' heroes, who counters whom, and picks against the other side' },
  { id: 'macro', label: 'Macro plan', icon: 'route', tip: 'Who goes where over the match: lanes, rotations, wards' },
  { id: 'fight', label: 'Teamfight', icon: 'swords', tip: 'One fight, frame by frame: positions, engages, who focuses whom' },
];
/** Fixed places on the map, in cells as read from a replay: where runes appear and where Tormentors stand. */
const BOUNTY_SPOTS: [number, number][] = [[120.2, 162.6], [132.6, 91.6]];
const POWER_SPOTS: [number, number][] = [[115.2, 136.7], [137.2, 118.5]];
const TORMENTOR_SPOTS: [number, number][] = [[68, 177.5], [188.5, 79.5]];
const LAIRS: [number, number][] = [[103, 146.7], [150.3, 106.4]];

/** What a plan is built around: runes, Roshan's lairs and Tormentors, labelled. */
function Landmarks({ S, k, style }: { S: number; k: number; style: MapStyle }) {
  const icons = useImages([runeIcon(5), runeIcon(0)]);
  const label = (text: string, y: number) => <Text text={text} x={-40} y={y} width={80} align="center" fontSize={Math.max(8, 8.5 * k)} fontStyle="bold" fill="#fff" stroke="#000" strokeWidth={2 * k} fillAfterStrokeEnabled />;
  const rune = (at: Pt, icon: string | null, name: string, key: string) => (
    <Group key={key} x={at.x * S} y={at.y * S} opacity={0.85}>
      {icon && icons[icon] && <KImage image={icons[icon]} x={-8 * k} y={-8 * k} width={16 * k} height={16 * k} />}
      {label(name, 9 * k)}
    </Group>
  );
  return (
    <Layer listening={false}>
      {BOUNTY_SPOTS.map(([x, y], i) => rune(cellToMap(x, y), runeIcon(5), 'Bounty', `b${i}`))}
      {POWER_SPOTS.map(([x, y], i) => rune(cellToMap(x, y), runeIcon(0), 'Power / Water', `p${i}`))}
      {LAIRS.map(([x, y], i) => { const at = roshanOnMap(style, cellToMap(x, y)); return <Group key={`r${i}`} x={at.x * S} y={at.y * S} opacity={0.85}>{label('Roshan', 11 * k)}</Group>; })}
      {TORMENTOR_SPOTS.map(([x, y], i) => { const at = cellToMap(x, y); return <Group key={`t${i}`} x={at.x * S} y={at.y * S} opacity={0.85}>{label('Tormentor', 14 * k)}</Group>; })}
    </Layer>
  );
}

/** How many picks to suggest for a side. */
const SUGGESTED = 12;

/** Both teams' heroes, who counters whom and what to pick against the other side, from OpenDota's matchups. */
function Draft() {
  const heroes = useTac(s => s.heroes);
  const t = useTac.getState();
  const [tables, setTables] = useState<Record<number, HeroMatchup[]>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const ids = [...new Set(heroes.map(h => h.hero))].join();
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const h of ids ? ids.split(',').map(Number) : []) {
        if (tables[h]) continue;
        try { const rows = await heroMatchups(h); if (live) setTables(x => ({ ...x, [h]: rows })); }
        catch (e) { if (live) setFailed(e instanceof Error ? e.message : String(e)); return; }
      }
    })();
    return () => { live = false; };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const rate = (hero: number, vs: number) => {
    // either side's table will do; both are the same games seen from each end
    const direct = tables[hero]?.find(m => m.hero_id === vs);
    if (direct) return matchupRate(direct);
    const other = tables[vs]?.find(m => m.hero_id === hero);
    return other ? 1 - matchupRate(other) : 0.5;
  };
  const side = (team: D2Team) => heroes.filter(h => h.team === team);
  const picked = new Set(heroes.map(h => h.hero));
  const suggest = (team: D2Team) => {
    const enemies = side((1 - team) as D2Team).filter(e => tables[e.hero]);
    if (!enemies.length) return [];
    return D2_HEROES.filter(h => !picked.has(h.id))
      .map(h => ({ hero: h, edge: enemies.reduce((a, e) => a + (rate(h.id, e.hero) - 0.5), 0) / enemies.length }))
      .sort((a, b) => b.edge - a.edge).slice(0, SUGGESTED);
  };
  const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
  const radiant = side(0), dire = side(1);
  return (
    <div className="d2-draft-tab">
      <aside className="d2-draft-side">
        <Roster />
        <p className="muted small">Heroes here are the same ones you plan with in Macro plan and Teamfight.</p>
      </aside>
      <div className="d2-draft-main">
        {failed && <p className="warn-text small">{failed}</p>}
        <section className="recap-card">
          <h3>Who counters whom</h3>
          {!radiant.length || !dire.length ? <p className="muted">Add heroes to both teams to see their matchups.</p> : (
            <div className="d2-table-wrap">
              <table className="d2-pairs">
                <thead><tr><th />{dire.map(d => <th key={d.id} title={heroOf(d.hero).name}>{heroOf(d.hero).icon && <img src={heroOf(d.hero).icon!} alt={heroOf(d.hero).name} width={26} height={26} />}</th>)}</tr></thead>
                <tbody>
                  {radiant.map(r => (
                    <tr key={r.id}>
                      <th title={heroOf(r.hero).name}>{heroOf(r.hero).icon && <img src={heroOf(r.hero).icon!} alt={heroOf(r.hero).name} width={26} height={26} />}</th>
                      {dire.map(d => { const v = rate(r.hero, d.hero) - 0.5; return <td key={d.id} className={`num ${v >= 0.02 ? 'up' : v <= -0.02 ? 'down' : ''}`} title={`${heroOf(r.hero).name} against ${heroOf(d.hero).name}`}>{pct(v)}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Win rate above even for the {TEAM_NAME[0]} hero. From OpenDota's sample of games, which is small for a single pair: a hint, not a verdict.</p>
        </section>
        {([0, 1] as D2Team[]).map(team => {
          const list = suggest(team);
          return (
            <section key={team} className="recap-card">
              <h3 style={{ color: TEAM_COLOR[team] }}>Picks for {TEAM_NAME[team]}</h3>
              {!list.length ? <p className="muted small">Add a {TEAM_NAME[(1 - team) as D2Team]} hero to see what does well against them.</p> : (
                <div className="d2-picks">
                  {list.map(({ hero, edge }) => (
                    <button key={hero.id} className="d2-pick" disabled={side(team).length >= 5} title={`Add ${hero.name} to ${TEAM_NAME[team]}`}
                      onClick={() => t.addHero(team, hero.id, { x: SPAWN[team].x + (side(team).length - 2) * 0.02, y: SPAWN[team].y })}>
                      {hero.icon && <img src={hero.icon} alt="" width={24} height={24} />}
                      <b>{hero.name}</b>
                      <span className={`num small ${edge >= 0 ? '' : 'muted'}`}>{pct(edge)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
const SPAWN: Record<D2Team, Pt> = { 0: { x: 0.12, y: 0.9 }, 1: { x: 0.88, y: 0.08 } };
/** The usual lanes for five heroes: 1 and 5 bottom for Radiant (top for Dire), 2 mid, 3 and 4 the other side. */
const LANES_OF: Record<D2Team, (1 | 2 | 3)[]> = { 0: [1, 2, 3, 3, 1], 1: [3, 2, 1, 1, 3] };

/** Dota 2 Tactical: two planners in tabs. Everything is kept in this browser. */
export function D2Tactical() {
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('stratboard.d2.tab') as Tab) || 'draft'; } catch { return 'draft'; } });
  const pick = (t: Tab) => { setTab(t); try { localStorage.setItem('stratboard.d2.tab', t); } catch { /* private mode */ } };
  return (
    <div className="dl-tac">
      <nav className="recap-tabs dl-tac-tabs" aria-label="Planner">
        <div className="recap-tabs-list" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)} title={t.tip}><Icon name={t.icon} size={14} /> {t.label}</button>)}
        </div>
        <button className="ghost small-btn" onClick={() => { if (confirm('Clear every plan (heroes, paths, wards, frames)?')) useTac.getState().reset(); }}>Clear all</button>
      </nav>
      {tab === 'draft' ? <Draft /> : tab === 'macro' ? <Macro /> : <Fight />}
    </div>
  );
}

/** Both teams' heroes: change, remove, add (up to five a side). */
function Roster() {
  const heroes = useTac(s => s.heroes), selected = useTac(s => s.selected);
  const t = useTac.getState();
  return (
    <div className="dl-roster">
      {([0, 1] as D2Team[]).map(team => {
        const mine = heroes.filter(h => h.team === team);
        return (
          <div key={team} className="dl-roster-team">
            <b style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}</b>
            {mine.map(h => (
              <div key={h.id} className={`dl-roster-row ${selected === h.id ? 'on' : ''}`} onClick={() => t.select(h.id)}>
                {heroOf(h.hero).icon && <img src={heroOf(h.hero).icon!} alt="" width={24} height={24} />}
                <select className="dl-hero-select" value={h.hero} onChange={e => t.setHero(h.id, Number(e.target.value))} aria-label="Hero">
                  {D2_HEROES.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <button className="verdict-undo" onClick={e => { e.stopPropagation(); t.removeHero(h.id); }} aria-label="Remove hero"><Icon name="close" size={11} /></button>
              </div>
            ))}
            {mine.length < 5 && (
              <button className="ghost small-btn" onClick={() => t.addHero(team, D2_HEROES[(heroes.length * 7 + team * 3) % D2_HEROES.length].id, { x: SPAWN[team].x + (mine.length - 2) * 0.02, y: SPAWN[team].y })}>
                + Add hero
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A hero on the map: icon, team ring; draggable. */
function Token({ h, at, k, S, icon, selected, onDrag, onClick }: {
  h: TacHero; at: Pt; k: number; S: number; icon?: HTMLImageElement; selected: boolean;
  onDrag: (at: Pt) => void; onClick: () => void;
}) {
  const R = 10 * k;
  return (
    <Group x={at.x * S} y={at.y * S} draggable
      onDragEnd={e => onDrag({ x: e.target.x() / S, y: e.target.y() / S })} onClick={e => { e.cancelBubble = true; onClick(); }} onTap={e => { e.cancelBubble = true; onClick(); }}
      onMouseEnter={e => { e.target.getStage()!.container().style.cursor = 'grab'; }} onMouseLeave={e => { e.target.getStage()!.container().style.cursor = ''; }}>
      {selected && <Circle radius={R + 6 * k} stroke="#fff" strokeWidth={1.4 * k} />}
      <Circle radius={R + 3 * k} fill={TEAM_COLOR[h.team]} />
      <Circle radius={R} fill="#0b0e12" />
      {icon && <KImage image={icon} x={-R} y={-R} width={2 * R} height={2 * R} />}
    </Group>
  );
}

function Macro() {
  const heroes = useTac(s => s.heroes), keys = useTac(s => s.keys), notes = useTac(s => s.notes), wards = useTac(s => s.wards), time = useTac(s => s.time), playing = useTac(s => s.playing), selected = useTac(s => s.selected);
  const t = useTac.getState();
  const [note, setNote] = useState('');
  const [wardTool, setWardTool] = useState<'obs' | 'sen' | null>(null);
  const [wardTeam, setWardTeam] = useState<D2Team>(0);
  const icons = useImages(heroes.map(h => heroOf(h.hero).icon));
  // plays at 20x: a 50-minute plan in two and a half minutes
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
    // the usual lanes, at their own first towers, a minute in
    for (const team of [0, 1] as D2Team[]) {
      useTac.getState().heroes.filter(h => h.team === team).forEach((h, i) => {
        const g = buildingOf.get(LANE_TOWER[LANES_OF[team][i] ?? 2][team])!;
        t.setKey(h.id, 60, { x: g.x + (i % 2 ? 0.02 : -0.02), y: g.y + (team === 0 ? -0.03 : 0.03) });
      });
    }
  };
  const near = notes.filter(n => Math.abs(n.t - time) <= 30);
  const sel = heroes.find(h => h.id === selected);
  const up = wards.filter(w => time >= w.t && time < w.t + WARD_LIFE[w.kind]);
  return (
    <div className="dl-tac-body">
      <aside className="dl-tac-side">
        <Roster />
        <button className="ghost small-btn" onClick={lanePreset} disabled={!heroes.length} title="Safe lane, mid and off lane, at their first towers at 1:00">Lane setup (2-1-2)</button>
        <p className="muted small">Drag a hero at any moment of the match to set where they should be then: in between they move in a straight line. Play to watch the plan.</p>
        <div className="d2-ward-tools" role="group" aria-label="Place wards">
          <button className={`chip ${wardTool === 'obs' ? 'on' : ''}`} onClick={() => setWardTool(wardTool === 'obs' ? null : 'obs')}>Observer</button>
          <button className={`chip ${wardTool === 'sen' ? 'on' : ''}`} onClick={() => setWardTool(wardTool === 'sen' ? null : 'sen')}>Sentry</button>
          {([0, 1] as D2Team[]).map(team => <button key={team} className={`chip ${wardTeam === team ? 'on' : ''}`} onClick={() => setWardTeam(team)} style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}</button>)}
        </div>
        <p className="muted small">{wardTool ? `Click the map to place a ward at ${mins(time)}. Click a ward to remove it.` : 'Pick a ward, then click the map. It stays up as long as it does in the game.'}</p>
      </aside>
      <div className="dl-tac-map">
        <D2Map onBackground={at => { if (wardTool) t.addWard({ t: Math.round(time), at, kind: wardTool, team: wardTeam }); else t.select(null); }}>
          {(S, k, style) => (
            <>
            <Landmarks S={S} k={k} style={style} />
            <Layer>
              {up.map((w, i) => (
                <Group key={`${w.t}-${i}`} x={w.at.x * S} y={w.at.y * S} onClick={e => { e.cancelBubble = true; t.removeWard(w); }} onTap={e => { e.cancelBubble = true; t.removeWard(w); }}>
                  {w.kind === 'obs' && <Circle radius={OBS_VISION * S} fill={TEAM_COLOR[w.team]} opacity={0.1} listening={false} />}
                  <Circle radius={5 * k} fill={w.kind === 'obs' ? '#f2c94c' : '#56b4f2'} stroke={TEAM_COLOR[w.team]} strokeWidth={1.4 * k} hitStrokeWidth={10} />
                </Group>
              ))}
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
            </>
          )}
        </D2Map>
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
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={`Note at ${mins(time)} (e.g. "smoke for Roshan")`} maxLength={120} />
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

function Fight() {
  const heroes = useTac(s => s.heroes), frames = useTac(s => s.frames), frame = useTac(s => s.frame), ranges = useTac(s => s.ranges), selected = useTac(s => s.selected);
  const t = useTac.getState();
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
            <label className="dl-range">Range ring <input type="range" min={0} max={2500} step={50} value={ranges[sel.id] ?? 0} onChange={e => t.setRange(sel.id, Number(e.target.value))} />
              <span className="num muted small">{ranges[sel.id] ? `${ranges[sel.id]} u` : 'off'}</span></label>
            <p className="muted small">Click an enemy to have {heroOf(sel.hero).name} focus them (click again to undo).</p>
          </div>
        ) : <p className="muted small">Drag heroes to place them in this frame. Select one for its range ring and who it focuses. Arrows show how each hero moved since the last frame.</p>}
      </aside>
      <div className="dl-tac-map">
        <D2Map onBackground={() => t.select(null)}>
          {(S, k, style) => (
            <>
            <Landmarks S={S} k={k} style={style} />
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
            </>
          )}
        </D2Map>
      </div>
    </div>
  );
}
