import { useEffect, useMemo, useState } from 'react';
import { Arc, Circle, Group, Image as KImage, Layer, Line, Shape, Text } from 'react-konva';
import { NOTE_INFO } from '../engine/recap';
import { Icon } from '../ui/Icon';
import { loadMatch, requestParse } from './api';
import type { D2Move } from './coach';
import { buildingOf, heroOf, itemById, mins, OBS_VISION, roshanOnMap, RUNE_ICONS, runeIcon, RUNE_NAME, TEAM_COLOR, type D2Team } from './data';
import { D2Map, useImages } from './D2Map';
import { buildingUp, deadAt, kdAt, lastKnown, netWorthAt, teamKillsAt, type D2Event, type D2Match } from './match';
import { useD2 } from './store';
import { heroAt, heroTrail, unitsAt } from './tracks';
import { useCoach } from './useCoach';

const PHASES = [{ label: 'Laning', t: 0 }, { label: 'Mid game', t: 600 }, { label: 'Late game', t: 1800 }];
const SPEEDS = [1, 2, 4, 8, 16, 32];
/** A moment is shown from this long before it. */
const LEAD = 8;

type Show = { creeps: boolean; neutrals: boolean; couriers: boolean };
const SHOW_LABEL: Record<keyof Show, string> = { creeps: 'Creeps', neutrals: 'Neutrals', couriers: 'Couriers' };

/** Dota 2 Review's board: the map (heroes, creeps, Roshan, runes, wards, buildings, fights), both teams, and playback. */
export function D2Board() {
  const match = useD2(s => s.match)!;
  const [show, setShow] = useState<Show>({ creeps: true, neutrals: true, couriers: true });
  const time = useD2(s => s.time), playing = useD2(s => s.playing), speed = useD2(s => s.speed), selected = useD2(s => s.selected);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const s = useD2.getState();
      const t = Math.min(match.duration, s.time + ((now - last) / 1000) * s.speed);
      last = now;
      useD2.setState({ time: t, ...(t >= match.duration ? { playing: false } : {}) });
      if (t < match.duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, match.duration]);
  const coach = useCoach();
  const graded = useMemo(() => coach.shown.filter(m => m.note !== 'book'), [coach.shown]);
  // keys: Space play / pause, ← → the previous / next graded moment, Shift + ← → 30 s
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const s = useD2.getState();
      if (e.key === ' ') { e.preventDefault(); if (!s.playing && s.time >= match.duration) s.setTime(match.start); s.setPlaying(!s.playing); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) s.setTime(s.time + (e.key === 'ArrowRight' ? 30 : -30));
        else stepMoment(graded, e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [match, graded]);

  const worth = (team: D2Team) => match.players.filter(p => p.team === team).reduce((a, p) => a + netWorthAt(match, p.slot, time), 0);
  const g0 = worth(0), g1 = worth(1), lead = g0 + g1 ? g0 / (g0 + g1) : 0.5;
  const feed = match.deaths.filter(d => d.t <= time && time - d.t < 40).slice(-5).reverse();
  const news = match.events.filter(e => e.t <= time && time - e.t < 40).slice(-4).reverse();
  const newsText = (e: D2Event) => {
    if (e.kind === 'rune') return `${nameOf(e.slot)} took ${RUNE_NAME[e.rune] ?? 'a rune'}`;
    if (e.kind === 'building') { const b = buildingOf.get(e.uid)!; return `${match.names[b.team]} lost ${b.name}`; }
    return `${match.names[e.team]} ${e.kind === 'roshan' ? 'killed Roshan' : e.kind === 'tormentor' ? 'killed a Tormentor' : 'took the Aegis'}`;
  };
  const nameOf = (slot: number | null) => {
    if (slot === null) return 'creeps';
    const p = match.players[slot];
    return p.name ?? heroOf(p.hero).name;
  };

  return (
    <div className="dl-board d2-board">
      <div className="dl-top">
        <div className="dl-score">
          <span className="dl-team-score" style={{ color: TEAM_COLOR[0] }}>{match.names[0]} <b>{teamKillsAt(match, 0, time)}</b></span>
          <span className="dl-clock num">{mins(time)}</span>
          <span className="dl-team-score" style={{ color: TEAM_COLOR[1] }}><b>{teamKillsAt(match, 1, time)}</b> {match.names[1]}</span>
        </div>
        <div className="dl-souls" title={`Team net worth: ${match.names[0]} ${Math.round(g0).toLocaleString()} · ${match.names[1]} ${Math.round(g1).toLocaleString()}`}>
          <i style={{ width: `${lead * 100}%`, background: TEAM_COLOR[0] }} /><i style={{ width: `${(1 - lead) * 100}%`, background: TEAM_COLOR[1] }} />
          <span className="dl-souls-label num">{Math.abs(g0 - g1) < 1 ? 'Even gold' : `${g0 > g1 ? match.names[0] : match.names[1]} +${Math.abs(Math.round(g0 - g1)).toLocaleString()} gold`}</span>
        </div>
      </div>
      {!match.parsed && <NotParsed match={match} />}

      <div className="dl-main">
        {([0, 1] as D2Team[]).map(team => (
          <aside key={team} className={`dl-team t${team}`} aria-label={match.names[team]}>
            <div className="dl-team-head" style={{ color: TEAM_COLOR[team] }}>{match.names[team]}{match.winner === team && time >= match.duration ? ' · won' : ''}</div>
            {match.players.filter(p => p.team === team).map(p => {
              const h = heroOf(p.hero), kd = kdAt(match, p.slot, time), dead = deadAt(match, p.slot, time);
              return (
                <button key={p.slot} className={`dl-player ${dead ? 'dead' : ''} ${selected === p.slot ? 'on' : ''}`} onClick={() => useD2.getState().select(selected === p.slot ? null : p.slot)} title="Show this hero's wards and where they laned">
                  {h.icon ? <img src={h.icon} alt="" width={32} height={32} /> : <span className="dl-hero-dot" style={{ background: TEAM_COLOR[team] }} />}
                  <span className="dl-player-name"><b>{p.name ?? h.name}</b><span className="muted small">{h.name}</span></span>
                  <span className="dl-player-kda num">{match.parsed ? `${kd.k}/${kd.d}` : `${p.kills}/${p.deaths}/${p.assists}`}</span>
                  <span className="dl-player-souls num muted small">{match.parsed ? `${(netWorthAt(match, p.slot, time) / 1000).toFixed(1)}k` : `${p.gpm} GPM`}</span>
                  {dead && <span className="dl-respawn num">{Math.ceil(dead.t + dead.respawn - time)}</span>}
                </button>
              );
            })}
          </aside>
        ))}
        <BoardMap match={match} time={time} selected={selected} show={show} />
        <D2Card moves={graded} time={time} canMine={coach.canMine} />
        <ol className="dl-feed" aria-label="Kills and events">
          {news.map((e, i) => <li key={`e${e.t}-${i}`} className="d2-feed-event">{e.kind === 'rune' && runeIcon(e.rune) && <img src={runeIcon(e.rune)!} alt="" width={16} height={16} />}{newsText(e)}</li>)}
          {feed.map((d, i) => (
            <li key={`${d.t}-${d.slot}-${i}`}>
              <span style={{ color: d.killer !== null ? TEAM_COLOR[match.players[d.killer].team] : 'var(--text-3)' }}>{nameOf(d.killer)}</span>
              <Icon name="close" size={10} />
              <span style={{ color: TEAM_COLOR[match.players[d.slot].team] }}>{nameOf(d.slot)}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="muted small d2-map-note">
        <ReplayNote /> <b style={{ color: WARD_RING.obs }}>O</b> Observer, <b style={{ color: WARD_RING.sen }}>S</b> Sentry.
        <span className="d2-layers" role="group" aria-label="Show on the map">
          {(Object.keys(SHOW_LABEL) as (keyof Show)[]).map(key => (
            <label key={key} className="dl-layer"><input type="checkbox" checked={show[key]} onChange={e => setShow({ ...show, [key]: e.target.checked })} /> {SHOW_LABEL[key]}</label>
          ))}
        </span>
      </p>

      <Playbar match={match} time={time} playing={playing} speed={speed} graded={graded} />
    </div>
  );
}

const STEP_LABEL = { download: 'Downloading the replay', unpack: 'Unpacking the replay', read: 'Reading the replay' };

/** What the heroes on the map are: real movement once the replay is read, last known places until then. */
function ReplayNote() {
  const replay = useD2(s => s.replay);
  if (replay.status === 'ready') return <span>Heroes move as they did in the match, from its replay. The ring is their health.</span>;
  if (replay.status === 'failed') return <span>Couldn't read the replay ({replay.error}), so heroes are at the last place the logs put them, not live.</span>;
  const step = replay.status === 'loading' && replay.step;
  return <span><b>{step ? `${STEP_LABEL[step]}… ${Math.round((replay.share ?? 0) * 100)}%` : 'Getting the replay…'}</b> Heroes start moving when it's done; until then they're at the last place the logs put them.</span>;
}

function NotParsed({ match }: { match: D2Match }) {
  const [state, setState] = useState<'idle' | 'asked' | 'waiting'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const ask = async () => { setErr(null); try { await requestParse(match.id); setState('asked'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const again = async () => {
    setErr(null); setState('waiting');
    try {
      const m = await loadMatch(match.id, true);
      if (m.parsed) useD2.getState().open(m);
      else { setState('asked'); setErr('Not ready yet: it usually takes a few minutes.'); }
    } catch (e) { setState('asked'); setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="d2-parse">
      <span><b>This match hasn't been parsed yet.</b> <span className="muted">Without it there's only the final scoreboard: no wards, deaths or coach.</span></span>
      {state === 'idle' ? <button className="cta primary" onClick={ask}>Ask OpenDota to parse it</button> : <button className="cta" onClick={again} disabled={state === 'waiting'}>{state === 'waiting' ? 'Checking…' : 'Check again'}</button>}
      {err && <span className="warn-text small">{err}</span>}
    </div>
  );
}

function BoardMap({ match, time, selected, show }: { match: D2Match; time: number; selected: number | null; show: Show }) {
  const replay = useD2(s => s.replay);
  const tracks = replay.status === 'ready' ? replay.tracks : null;
  const wards = match.wards.filter(w => time >= w.t && time < w.until);
  const fight = match.fights.find(f => f.at && time >= f.start && time <= f.end + 5);
  const icons = useImages(match.players.map(p => heroOf(p.hero).icon));
  const runeImages = useImages(RUNE_ICONS);
  // with the replay: where each hero really is. Without: the last place the logs put them, fanned out at the same spot
  const real = tracks && match.players.map(p => heroAt(tracks, p.hero, time));
  const known = real && real.every(Boolean) ? [] : match.players.map(p => ({ p, ...lastKnown(match, p.slot, time) }));
  const spots = real && real.every(Boolean) ? match.players.map((p, i) => ({ p, at: real[i]!.at, hp: real[i]!.hp as number | null, dead: real[i]!.hp === 0, stale: false })) : known.map(s => {
    const same = known.filter(o => Math.hypot(o.at.x - s.at.x, o.at.y - s.at.y) < 0.035);
    const a = (same.indexOf(s) / same.length) * Math.PI * 2;
    const at = same.length < 2 ? s.at : { x: s.at.x + Math.cos(a) * 0.04, y: s.at.y + Math.sin(a) * 0.04 };
    return { p: s.p, at, hp: null, dead: s.dead, stale: s.age > STALE && !s.dead };
  });
  const trail = tracks && selected !== null ? heroTrail(tracks, match.players[selected].hero, time, TRAIL) : [];
  const units = tracks ? unitsAt(tracks, time) : [];
  const small = units.filter(u => (u.kind === 'creep' || u.kind === 'siege') ? show.creeps : u.kind === 'neutral' ? show.neutrals : u.kind === 'courier' && show.couriers);
  const big = units.filter(u => u.kind === 'roshan' || u.kind === 'tormentor' || u.kind === 'rune');
  return (
    <D2Map up={uid => buildingUp(match, uid, time)}>
      {(S, k, style) => (
        <Layer listening={false}>
          {/* hundreds of them every frame: one shape draws them all */}
          {small.length > 0 && <Shape sceneFunc={ctx => {
            for (const u of small) {
              const x = u.at.x * S, y = u.at.y * S, team = u.team === 2 ? TEAM_COLOR[0] : u.team === 3 ? TEAM_COLOR[1] : NEUTRAL_COLOR;
              ctx.beginPath();
              if (u.kind === 'siege') ctx.rect(x - 3.6 * k, y - 3.6 * k, 7.2 * k, 7.2 * k);
              else ctx.arc(x, y, (u.kind === 'courier' ? 4 : u.kind === 'neutral' ? 2.2 : 3) * k, 0, Math.PI * 2);
              ctx.fillStyle = u.kind === 'courier' ? '#fff' : team;
              ctx.fill();
              ctx.lineWidth = (u.kind === 'courier' ? 1.6 : 0.8) * k;
              ctx.strokeStyle = u.kind === 'courier' ? team : '#0b0e12';
              ctx.stroke();
            }
          }} />}
          {big.map((u, i) => {
            const at = u.kind === 'roshan' ? roshanOnMap(style, u.at) : u.at;
            return (
            <Group key={`${u.kind}${i}`} x={at.x * S} y={at.y * S}>
              {u.kind === 'rune' ? (
                <>
                  <Circle radius={11 * k} fill="#0b0e12" opacity={0.6} stroke={RUNE_COLOR[u.rune ?? -1] ?? '#fff'} strokeWidth={1.2 * k} />
                  {runeImages[runeIcon(u.rune) ?? ''] && <KImage image={runeImages[runeIcon(u.rune)!]} x={-10 * k} y={-10 * k} width={20 * k} height={20 * k} />}
                  <Label text={RUNE_NAME[u.rune ?? -1] ?? 'Rune'} k={k} fill={RUNE_COLOR[u.rune ?? -1] ?? '#fff'} y={12.5 * k} />
                </>
              ) : (
                <>
                  <Circle radius={12 * k} fill="#0b0e12" />
                  <Arc innerRadius={9.6 * k} outerRadius={12 * k} angle={3.6 * (u.hp ?? 100)} rotation={-90} fill="#e8a33d" />
                  <Text text={u.kind === 'roshan' ? 'R' : 'T'} width={20 * k} x={-10 * k} y={-6 * k} align="center" fontSize={12 * k} fontStyle="bold" fill="#e8a33d" />
                  <Label text={u.kind === 'roshan' ? 'Roshan' : 'Tormentor'} k={k} fill="#e8a33d" y={13.5 * k} />
                </>
              )}
            </Group>
            );
          })}
          {wards.map((w, i) => {
            const dim = selected !== null && w.slot !== selected;
            return (
              <Group key={`${w.kind}${w.slot}${w.t}${i}`} x={w.at.x * S} y={w.at.y * S} opacity={dim ? 0.3 : 1}>
                {w.kind === 'obs' && <Circle radius={OBS_VISION * S} fill={TEAM_COLOR[w.team]} opacity={0.09} />}
                <Circle radius={6 * k} fill={WARD_RING[w.kind]} stroke={TEAM_COLOR[w.team]} strokeWidth={1.4 * k} />
                <Text text={w.kind === 'obs' ? 'O' : 'S'} width={12 * k} x={-6 * k} y={-3.8 * k} align="center" fontSize={8 * k} fontStyle="bold" fill="#0b0e12" />
              </Group>
            );
          })}
          {trail.length > 1 && <Line points={trail.flatMap(p => [p.x * S, p.y * S])} stroke="#fff" strokeWidth={1.6 * k} opacity={0.65} lineCap="round" lineJoin="round" />}
          {/* the dead underneath, so they never cover someone alive */}
          {[...spots].sort((a, b) => Number(b.dead) - Number(a.dead)).map(s => {
            const h = heroOf(s.p.hero);
            return (
              <Group key={s.p.slot} x={s.at.x * S} y={s.at.y * S} opacity={s.stale ? 0.75 : s.dead && tracks ? 0.7 : 1}>
                <HeroMark k={k} icon={h.icon ? icons[h.icon] : undefined} name={s.p.name ?? h.name} team={s.p.team} selected={selected === s.p.slot} hp={s.hp} dead={s.dead} />
              </Group>
            );
          })}
          {fight && (
            <Group x={fight.at!.x * S} y={fight.at!.y * S}>
              <Circle radius={34 * k} stroke="#fff" strokeWidth={1.2 * k} dash={[5 * k, 4 * k]} opacity={0.7} />
              <Label text={`Fight · ${fight.present[0].length}v${fight.present[1].length}`} k={k} fill="#fff" y={-47 * k} />
            </Group>
          )}
        </Layer>
      )}
    </D2Map>
  );
}

const WARD_RING = { obs: '#f2c94c', sen: '#56b4f2' };
const NEUTRAL_COLOR = '#c9b98f';
const RUNE_COLOR: Record<number, string> = { 0: '#5aa7ff', 1: '#ff5a4d', 2: '#f4c430', 3: '#b48cff', 4: '#59d36a', 5: '#ffcf3f', 6: '#ff7be0', 7: '#4fd8ff', 8: '#a8e05f', 9: '#ffb35a' };
const LABEL_W = 92;
/** How much of a selected hero's way is drawn (s). */
const TRAIL = 20;
/** A place the logs gave longer ago than this (s) is drawn faded: the hero has probably moved on. */
const STALE = 45;

/** A hero on the map: their icon in a ring of team colour showing their health, their name under it; crossed out while dead. */
function HeroMark({ k, icon, name, team, selected, hp, dead }: { k: number; icon?: HTMLImageElement; name: string; team: D2Team; selected: boolean; hp: number | null; dead?: boolean }) {
  const R = 11 * k, X = R * 0.72, size = Math.max(9, 10.5 * k), c = TEAM_COLOR[team];
  return (
    <>
      {selected && <Circle radius={R + 5.5 * k} stroke="#fff" strokeWidth={1.4 * k} />}
      {hp === null || dead ? <Circle radius={R + 2.4 * k} fill={c} /> : (
        <>
          <Circle radius={R + 2.4 * k} fill="#0b0e12" />
          <Arc innerRadius={R} outerRadius={R + 2.4 * k} angle={360} fill={c} opacity={0.25} />
          <Arc innerRadius={R} outerRadius={R + 2.4 * k} angle={3.6 * hp} rotation={-90} fill={hp <= 30 ? '#ef4444' : c} />
        </>
      )}
      <Circle radius={R} fill="#0b0e12" />
      {icon && <KImage image={icon} x={-R} y={-R} width={2 * R} height={2 * R} opacity={dead ? 0.55 : 1} />}
      {dead && <Line points={[-X, -X, X, X]} stroke="#ef4444" strokeWidth={2.6 * k} lineCap="round" />}
      {dead && <Line points={[-X, X, X, -X]} stroke="#ef4444" strokeWidth={2.6 * k} lineCap="round" />}
      <Text text={name} x={-LABEL_W / 2} y={R + 3.5 * k} width={LABEL_W} align="center" wrap="none" ellipsis fontSize={size} fontStyle="bold"
        fill={c} stroke="#000" strokeWidth={2.4 * k} fillAfterStrokeEnabled />
    </>
  );
}

/** A small name under something on the map. */
function Label({ text, k, fill, y }: { text: string; k: number; fill: string; y: number }) {
  return <Text text={text} x={-LABEL_W / 2} y={y} width={LABEL_W} align="center" wrap="none" fontSize={Math.max(8.5, 9.5 * k)} fontStyle="bold" fill={fill} stroke="#000" strokeWidth={2.2 * k} fillAfterStrokeEnabled />;
}
function Playbar({ match, time, playing, speed, graded }: { match: D2Match; time: number; playing: boolean; speed: number; graded: D2Move[] }) {
  const s = useD2.getState();
  const span = match.duration - match.start || 1;
  const left = (t: number) => `${((t - match.start) / span) * 100}%`;
  const marks = useMemo(() => [
    ...match.deaths.map(d => ({ t: d.t, color: TEAM_COLOR[match.players[d.slot].team === 0 ? 1 : 0], kind: 'kill' })),
    ...match.roshan.map(r => ({ t: r.t, color: '#d9c07a', kind: 'objective' })),
    ...graded.map(m => ({ t: m.t, color: NOTE_INFO[m.note].color, kind: 'graded' })),
  ], [match, graded]);
  return (
    <div className="dl-playbar">
      <button className="play-main" onClick={() => { if (!playing && time >= match.duration) s.setTime(match.start); s.setPlaying(!playing); }} title="Play / pause (Space)">
        <Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause' : 'Play'}
      </button>
      <select value={speed} onChange={e => s.setSpeed(Number(e.target.value))} aria-label="Speed">
        {SPEEDS.map(x => <option key={x} value={x}>{x}×</option>)}
      </select>
      <div className="dl-step" role="group" aria-label="Graded moments">
        <button onClick={() => stepMoment(graded, -1)} disabled={!graded.length} title="Previous graded moment (←)" aria-label="Previous graded moment"><Icon name="prev" size={14} /></button>
        <span className="num muted small">{graded.filter(m => m.t <= time).length}/{graded.length}</span>
        <button onClick={() => stepMoment(graded, 1)} disabled={!graded.length} title="Next graded moment (→)" aria-label="Next graded moment"><Icon name="prev" size={14} className="flip-x" /></button>
      </div>
      <div className="dl-phases" role="group" aria-label="Jump to">
        {PHASES.filter(p => p.t < match.duration).map(p => <button key={p.label} className="chip" onClick={() => s.setTime(p.t)}>{p.label}</button>)}
      </div>
      <div className="dl-timeline">
        <input type="range" min={match.start} max={match.duration} step={1} value={Math.floor(time)} onChange={e => s.setTime(Number(e.target.value))} aria-label="Match time" />
        <div className="dl-marks" aria-hidden>
          {marks.map((m, i) => <i key={i} className={m.kind} style={{ left: left(m.t), background: m.color }} />)}
        </div>
      </div>
      <span className="num dl-time">{mins(time)} / {mins(match.duration)}</span>
    </div>
  );
}

function stepMoment(moves: D2Move[], dir: 1 | -1) {
  const s = useD2.getState();
  const at = s.time + LEAD;
  const next = dir > 0 ? moves.find(m => m.t > at + 0.5) : [...moves].reverse().find(m => m.t < at - 0.5);
  if (next) { s.setPlaying(false); s.setTime(next.t - LEAD); }
}

/** The coach's card for the latest graded moment, and the item just bought by the hero you're looking at. */
function D2Card({ moves, time, canMine }: { moves: D2Move[]; time: number; canMine: boolean }) {
  const scope = useD2(s => s.scope), match = useD2(s => s.match)!, selected = useD2(s => s.selected);
  const m = [...moves].reverse().find(x => time >= x.t - LEAD && time <= x.t + 24);
  const kit = selected !== null ? match.players[selected].items.map(i => itemById.get(i)).filter(Boolean) : [];
  return (
    <div className="dl-card-slot">
      {canMine && (
        <div className="seg-mini dl-scope" role="group" aria-label="Whose moves">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => useD2.getState().setScope('all')}>All</button>
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => useD2.getState().setScope('mine')}>Mine</button>
        </div>
      )}
      {m && (
        <article className="dl-card" style={{ borderColor: NOTE_INFO[m.note].color }}>
          <header>
            <b className="dl-card-mark" style={{ background: NOTE_INFO[m.note].color }}>{NOTE_INFO[m.note].mark}</b>
            <span>{NOTE_INFO[m.note].label}</span>
            <span className="muted small num">{mins(m.t)}</span>
          </header>
          <p className="dl-card-title">{m.title}</p>
          <ul>{m.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </article>
      )}
      {kit.length > 0 && (
        <div className="d2-kit" title="Items at the end of the match">
          {kit.map(i => i!.icon && <img key={i!.id} src={i!.icon} alt={i!.name} title={i!.name} width={34} height={25} />)}
        </div>
      )}
    </div>
  );
}
