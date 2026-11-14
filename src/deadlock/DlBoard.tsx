import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Circle, Group, Image as KImage, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva';
import { Icon } from '../ui/Icon';
import { campTier, DL_MAP, heroOf, objectiveKey, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import { MapArt, useGameMap, useTunnels } from './MapArt';
import { matchPosition } from './bench';
import { POS_NAME, type Pos } from './positions';
import { winChance } from './winChance';
import { STEAM_AVAILABLE } from '../env';
import { useProfile } from '../ui/profileApi';
import { sendDispute } from './disputes';
import { DEATH_GRID, DEATH_PHASES, DEATH_SOURCE, heatGrid } from './deathMap';
import { creepsAt, heroAt, troopersAt, readDemo, riftAt, statsAt, ultAt, UNDERGROUND_Z, upAt } from './demo';
import ITEMS from './generated/items.json';
import { RULES, TIMINGS_SOURCE, timersAt } from './timings';
import { feedEvents, type FeedEvent } from './events';
import { DEBUG } from '../env';
import { kdaAt, playerAt, statAt, type DlMatch } from './match';
import { useDl } from './store';
import { useCoach, useMySlot } from './useCoach';
import type { DlMove } from './coach';
import { MarkFace } from '../ui/MarkFace';
import { NOTE_INFO } from '../engine/recap';
import { swingNote } from '../engine/notes';
import PLAY from './generated/playnet.json';
import { ACTION_LABEL, playChances, WINDOW, type Action } from './playNet';
import { searchAt, SEARCH_COLOR } from './search';
import { NoteKeyRows } from '../ui/Playback';
import { engineReview } from './engineReview';
import { useCanvasLabel } from '../ui/canvasLabel';
import { ultOf } from './ultKinds';
import type { Mlp } from '../engine/mlp';

const PLAY_NET = (PLAY as { net: Mlp | null }).net;

/** The shop's items by id (icons for the inventories). */
const ITEM = new Map((ITEMS as { id: number; name: string; tier: number; icon: string | null }[]).map(i => [i.id, i]));
const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A body stays where the hero died, fading out (like CS2's), gone this long after. */
const BODY_GONE = 3;
/** The game's phases, to jump between on a long match. */
const SPEEDS = [1, 2, 4, 8, 16, 32];

function useImages(urls: (string | null)[]) {
  const [imgs, setImgs] = useState<Record<string, HTMLImageElement>>({});
  const key = urls.filter(Boolean).join('|');
  useEffect(() => {
    for (const u of urls) {
      if (!u || imgs[u]) continue;
      const i = new window.Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => setImgs(m => ({ ...m, [u]: i }));
      i.src = u;
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return imgs;
}

/** Deadlock Review's board: the map, every hero, objectives and kills, with playback. */
export function DlBoard() {
  const match = useDl(s => s.match)!;
  const time = useDl(s => s.time), playing = useDl(s => s.playing), speed = useDl(s => s.speed), selected = useDl(s => s.selected);
  const names = useDl(s => s.names);
  // your team (or team 0): an ultimate's tooltip says how to play against it on the other one
  const mySlot = useMySlot(), myTeam = match.players.find(p => p.slot === mySlot)?.team ?? 0;

  // playback
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const s = useDl.getState();
      const t = Math.min(match.duration, s.time + ((now - last) / 1000) * s.speed);
      last = now;
      useDl.setState({ time: t, ...(t >= match.duration ? { playing: false } : {}) });
      if (t < match.duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, match.duration]);
  const coach = useCoach();
  const graded = useMemo(() => coach.shown.filter(m => m.note !== 'book'), [coach.shown]);
  // keys: Space play / pause, ← → the previous / next graded moment, Shift + ← → 10 s
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const s = useDl.getState();
      if (e.key === ' ') { e.preventDefault(); if (!s.playing && s.time >= match.duration) s.setTime(0); s.setPlaying(!s.playing); }
      else if (e.key === 'j' || e.key === 'l') s.setTime(Math.max(0, Math.min(match.duration, s.time + (e.key === 'l' ? 5 : -5))));
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) s.setTime(s.time + (e.key === 'ArrowRight' ? 10 : -10));
        else stepMoment(graded, e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [match.duration, graded]);

  // the board full screen (the map grows with it)
  const board = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => { const on = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on); }, []);
  const demo = useDl(s => s.demo), danger = useDl(s => s.danger);
  // the position each player played this match (by souls on their team at the end)
  const positions = useMemo(() => Object.fromEntries(match.players.map(p => [p.slot, matchPosition(match, p.slot)])) as Record<number, Pos | null>, [match]);
  const teams: DlTeam[] = [0, 1];
  const kills = (team: DlTeam) => match.deaths.filter(d => d.t <= time && d.killer !== null && match.players.find(p => p.slot === d.killer)?.team === team && d.killer !== d.slot).length;
  const souls = (team: DlTeam) => match.players.filter(p => p.team === team).reduce((a, p) => a + (statAt(match, p.slot, time)?.netWorth ?? 0), 0);
  const s0 = souls(0), s1 = souls(1), lead = s0 + s1 ? s0 / (s0 + s1) : 0.5;
  // each team's chance to win right now (the coach's model); the bar follows it
  const p0 = useMemo(() => winChance(match, demo, time, 0), [match, demo, Math.floor(time / 2)]); // eslint-disable-line react-hooks/exhaustive-deps
  const events = useMemo(() => feedEvents(match, demo), [match, demo]);
  const feed = events.filter(e => e.t <= time && time - e.t < 12).slice(-6);
  const nameOf = (slot: number | null) => {
    const p = match.players.find(x => x.slot === slot);
    return p ? names[p.account]?.name ?? heroOf(p.hero).name : 'the creeps';
  };

  return (
    <div className="dl-board" ref={board}>
      <div className="dl-top">
        <div className="dl-score">
          <span className="dl-team-score" style={{ color: TEAM_COLOR[0] }}>{TEAM_NAME[0]} <b>{kills(0)}</b></span>
          <span className="dl-clock num">{mins(time)}</span>
          <span className="dl-team-score" style={{ color: TEAM_COLOR[1] }}><b>{kills(1)}</b> {TEAM_NAME[1]}</span>
          {DEBUG && <DemoChip />}
        </div>
        <div className="dl-souls" title={`Team souls: ${TEAM_NAME[0]} ${s0.toLocaleString()} · ${TEAM_NAME[1]} ${s1.toLocaleString()}`}>
          <i style={{ width: `${p0 * 100}%`, background: TEAM_COLOR[0] }} /><i style={{ width: `${(1 - p0) * 100}%`, background: TEAM_COLOR[1] }} />
          <span className="dl-souls-label num" title={`Win chance from the coach's model; souls: ${Math.round(lead * 100)}% of all souls are ${TEAM_NAME[0]}'s`}>
            {Math.round(p0 * 100)}% · {s0 === s1 ? 'even souls' : `${s0 > s1 ? TEAM_NAME[0] : TEAM_NAME[1]} +${Math.abs(s0 - s1).toLocaleString()} souls`} · {Math.round((1 - p0) * 100)}%
          </span>
        </div>
      </div>

      <div className="dl-main">
        {teams.map(team => (
          <aside key={team} className={`dl-team t${team}`} aria-label={TEAM_NAME[team]}>
            <div className="dl-team-head" style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}{match.winner === team && time >= match.duration ? ' · won' : ''}</div>
            {match.players.filter(p => p.team === team).map(p => {
              const h = heroOf(p.hero), at = playerAt(match, p.slot, time), kda = kdaAt(match, p.slot, time), st = statAt(match, p.slot, time);
              const dead = !at, death = dead ? match.deaths.find(d => d.slot === p.slot && time >= d.t && time < d.t + d.respawn) : null;
              // from the demo, to the second: net worth, last hits / denies, the ultimate; else the match's snapshots
              const live = statsAt(demo, p.slot, time), ultInfo = h.abilities?.find(a => a.ult);
              // no demo: the match data still says when the ultimate was unlocked (not its cooldowns)
              const unlocked = ultInfo?.id ? match.items[p.slot]?.find(i => i.id === ultInfo.id)?.t ?? null : null;
              const ult = ultAt(demo, p.slot, time) ?? (ultInfo?.id ? (unlocked !== null && time >= unlocked ? { state: 'unlocked' as const } : { state: 'locked' as const }) : null);
              const worth = live?.nw ?? st?.netWorth ?? null;
              // what they own now: shop items bought by now and not sold yet
              const owned = (match.items[p.slot] ?? []).filter(i => i.t <= time && (i.sold === null || i.sold > time) && ITEM.has(i.id)).map(i => ITEM.get(i.id)!);
              return (
                <button key={p.slot} className={`dl-player ${dead ? 'dead' : ''} ${selected === p.slot ? 'on' : ''}`} onClick={() => useDl.getState().select(selected === p.slot ? null : p.slot)}>
                  {h.card ? <img src={h.card} alt="" width={32} height={32} /> : <span className="dl-hero-dot" style={{ background: h.color }} />}
                  <span className="dl-player-name"><b>{names[p.account]?.name ?? h.name}</b><span className="muted small">{h.name}{positions[p.slot] && <span className={`dl-pos p${positions[p.slot]}`} title={`Played Pos ${positions[p.slot]} ${POS_NAME[positions[p.slot]!]} this match (by souls on the team at the end)`}>Pos {positions[p.slot]}</span>}</span></span>
                  <span className="dl-player-kda num">{kda.k}/{kda.d}/{kda.a}</span>
                  <span className="dl-player-souls num muted small" title={live ? `Net worth ${live.nw.toLocaleString()} · last hits ${live.lh} · denies ${live.dn} · level ${live.lvl}` : st ? `Net worth ${st.netWorth.toLocaleString()} · last hits ${st.lastHits} · denies ${st.denies} (from the match's snapshots every few minutes; the demo has them to the second)` : 'Net worth'}>
                    {worth !== null ? `${(worth / 1000).toFixed(1)}k` : ''}{live ? <> · <b>{live.lh}</b>/{live.dn}</> : st ? <> · <b>{st.lastHits}</b>/{st.denies}</> : ''}
                  </span>
                  <span className="dl-hp"><i style={{ width: `${at?.hp ?? 0}%`, background: (at?.hp ?? 0) <= 30 ? 'var(--bad)' : TEAM_COLOR[team] }} /></span>
                  {death && <span className="dl-respawn num">{Math.ceil(death.t + death.respawn - time)}</span>}
                  {ult && ultInfo && (
                    <span className={`dl-ult ${ult.state}`} title={`${ultInfo.name}: ${ult.state === 'locked' ? 'not unlocked yet' : ult.state === 'ready' ? 'ready' : ult.state === 'unlocked' ? 'unlocked (when it was used needs the demo)' : `back in ${Math.ceil(ult.left)} s`}${ultTip(p.hero, p.team !== myTeam)}`}>
                      {ultInfo.img && <img src={ultInfo.img} alt="" />}
                      {ult.state === 'cooldown' && <b className="num">{Math.ceil(ult.left)}</b>}
                    </span>
                  )}
                  {selected === p.slot && !dead && <PlayHint match={match} slot={p.slot} time={time} />}
                  {owned.length > 0 && (
                    <span className="dl-items">{owned.map((it, i) => <img key={`${it.id}-${i}`} src={it.icon ?? ''} alt={it.name} title={it.name} className={`tier${it.tier}`} />)}</span>
                  )}
                </button>
              );
            })}
            {team === 1 && DEBUG && <DlTimers match={match} time={time} />}
          </aside>
        ))}
        <DlMap match={match} time={time} selected={selected} />
        <DlCard moves={graded} time={time} canMine={coach.canMine} mineLabel={coach.mine !== null ? 'Mine' : 'This player'} />
        <ol className="dl-feed" aria-label="What happened">
          {feed.map((e, i) => <FeedRow key={`${e.kind}-${e.t}-${e.slot}-${i}`} e={e} match={match} nameOf={nameOf} />)}
        </ol>
      </div>

      <DlPlaybar match={match} time={time} playing={playing} speed={speed} graded={graded}
        full={full} onFull={() => (document.fullscreenElement ? document.exitFullscreen() : board.current?.requestFullscreen())}
        canMine={coach.canMine} mineLabel={coach.mine !== null ? 'Mine' : 'This player'} />
    </div>
  );
}

/** Inside the round map (its circle, with the bases at the top and bottom edge): outside it is where the game parks
 * dead and waiting heroes. */
const onMap = (p: { x: number; y: number }) => Math.hypot(p.x - 0.5, p.y - 0.5) <= 0.5 && p.x > 0.02 && p.x < 0.98 && p.y > 0 && p.y < 1;

function DlMap({ match, time, selected }: { match: DlMatch; time: number; selected: number | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(Math.max(200, Math.min(el.clientWidth, el.clientHeight))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const map = useGameMap(), tunnels = useTunnels();
  // a hero's spot: from the demo (4 a second, smooth; height for underground) where it has one, else the match data;
  // health from the match data
  const demo = useDl(s => s.demo);
  const spotOf = (slot: number) => {
    const base = playerAt(match, slot, time);
    // dead (no health) or parked off the map (a dead or not-yet-spawned hero's spot): not drawn
    if (!base || base.hp <= 0) return null;
    const d = demo ? heroAt(demo, slot, time) : null;
    const at = d ? { x: d.x, y: d.y, hp: base.hp, under: d.z < UNDERGROUND_Z } : { ...base, under: false };
    return onMap(at) ? at : null;
  };
  // the urn from the demo: on the ground where it lay, or with whoever carried it
  const urnNow = useMemo(() => {
    const u = demo ? [...demo.urn].reverse().find(x => x.from <= time) : undefined;
    if (!u) return null;
    if (u.taken === null || time < u.taken) return { x: u.x, y: u.y, label: time < u.landed ? 'landing' : mins(u.from), carried: false, fromLeft: u.fromLeft };
    const at = u.slot !== null && u.until !== null && time < u.until ? spotOf(u.slot) : null;
    const who = match.players.find(p => p.slot === u.slot);
    return at && who ? { x: at.x, y: at.y, label: heroOf(who.hero).name, carried: true, fromLeft: u.fromLeft } : null;
  }, [demo, match, time]); // eslint-disable-line react-hooks/exhaustive-deps
  // your team in lane colours when you played in it (like the game), else the bottom team
  const mine = useMySlot();
  const you = (match.players.find(p => p.slot === mine)?.team ?? 0) as DlTeam;
  // the objectives destroyed by now (as one string, so it changes only when one falls)
  const downList = match.objectives.filter(o => o.destroyed !== null && time >= o.destroyed).map(o => `${o.team}_${objectiveKey(o.id)}`).join(' ');
  const downKeys = useMemo(() => new Set(downList.split(' ')), [downList]);
  const icons = useImages(match.players.map(p => heroOf(p.hero).icon));
  const S = size, k = S / 640;
  // the map like the game draws it, your team's lanes in their colours, objectives destroyed by now hollow: its own
  // layer, kept as it is while only the time moves (the big map image isn't redrawn every frame)
  const baseLayer = useMemo(() => (
    <Layer listening={false}>
      <MapArt S={S} k={k} img={map} tunnels={tunnels} you={you} down={(team, key) => downKeys.has(`${team}_${key}`)} part="base" />
    </Layer>
  ), [S, k, map, tunnels, you, downKeys]);
  const P = (p: { x: number; y: number }) => ({ x: p.x * S, y: p.y * S });
  // the danger layer: where high-rank players die at this stage, from the selected player's side (or yours)
  const danger = useDl(s => s.danger), cell = S / DEATH_GRID;
  const heatTeam = (match.players.find(p => p.slot === selected)?.team ?? you) as DlTeam;
  const phase = DEATH_PHASES.findIndex(p => time >= p.from && time < p.to);
  const heat = useMemo(() => (danger ? heatGrid(time, heatTeam) : null), [danger, heatTeam, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // the selected hero's way over the last 20 s
  const trail = useMemo(() => {
    if (selected === null) return null;
    const pts: number[] = [];
    for (let t = Math.max(0, Math.floor(time) - 20); t <= time; t++) { const a = playerAt(match, selected, t); if (a) pts.push(a.x * S, a.y * S); }
    return pts;
  }, [selected, Math.floor(time), S, match]); // eslint-disable-line react-hooks/exhaustive-deps

  useCanvasLabel(wrap, 'Deadlock map: the match replaying, heroes, objectives and camps');
  return (
    <div className="dl-map" ref={wrap}>
      <Stage width={S} height={S}>
        {baseLayer}
        {heat && (
          <Layer listening={false}>
            {heat.map((v, i) => v < 0.12 ? null : <Rect key={i} x={(i % DEATH_GRID) * cell} y={Math.floor(i / DEATH_GRID) * cell} width={cell} height={cell} fill="#ff4d3a" opacity={Math.min(0.42, (v - 0.1) * 0.6)} cornerRadius={cell * 0.2} />)}
          </Layer>
        )}
        <Layer listening={false}>
          {/* what comes and goes: camps, bridge buffs, the urn, the rift, the mid boss */}
          <MapArt S={S} k={k} img={map} you={you} part="live" at={{ time, midBoss: match.midBoss, demo, urnNow,
            creeps: troopersAt(demo, time) ?? creepsAt(demo, time), creepDeaths: demo?.creepDeaths?.filter(d => time >= d.t && time - d.t < 2), rift: riftAt(demo, time) }} />
          {trail && trail.length >= 4 && <Line points={trail} stroke="#fff" strokeWidth={1.5 * k} opacity={0.6} lineCap="round" lineJoin="round" />}
          {/* bodies: where a hero just died, fading out */}
          {match.deaths.filter(d => time >= d.t && time - d.t < BODY_GONE).map(d => {
            const p = match.players.find(x => x.slot === d.slot)!;
            const fade = Math.min(1, (BODY_GONE - (time - d.t)) / 1.5);
            return (
              <Group key={`d${d.t}-${d.slot}`} {...P(d.at)} opacity={0.85 * fade}>
                <Circle radius={6 * k} fill="#2a2f36" stroke={TEAM_COLOR[p.team]} strokeWidth={1.2 * k} />
                <Line points={[-3 * k, -3 * k, 3 * k, 3 * k]} stroke={TEAM_COLOR[p.team]} strokeWidth={1.6 * k} lineCap="round" />
                <Line points={[-3 * k, 3 * k, 3 * k, -3 * k]} stroke={TEAM_COLOR[p.team]} strokeWidth={1.6 * k} lineCap="round" />
              </Group>
            );
          })}
        </Layer>
        <Layer>
          {match.players.map(p => {
            const at = spotOf(p.slot);
            if (!at) return null;
            const h = heroOf(p.hero), img = h.icon ? icons[h.icon] : undefined, R = 9 * k, on = selected === p.slot;
            return (
              // underground (a tunnel, the mid boss pit): dimmed, with a dashed ring
              <Group key={p.slot} {...P(at)} opacity={at.under ? 0.6 : 1} onClick={() => useDl.getState().select(on ? null : p.slot)} onTap={() => useDl.getState().select(on ? null : p.slot)}>
                {on && <Circle radius={R + 6 * k} stroke="#fff" strokeWidth={1.4 * k} />}
                {at.under && <Circle radius={R + 5.5 * k} stroke="#c8a46a" strokeWidth={1.3 * k} dash={[3 * k, 2.5 * k]} />}
                <Circle radius={R + 3.4 * k} fill="#0b0e12" hitStrokeWidth={14} />
                <Arc innerRadius={R + 1 * k} outerRadius={R + 3 * k} angle={360} fill={TEAM_COLOR[p.team]} opacity={0.22} />
                {at.hp > 0 && <Arc innerRadius={R + 1 * k} outerRadius={R + 3 * k} angle={3.6 * at.hp} rotation={-90} fill={at.hp <= 30 ? '#ef4444' : TEAM_COLOR[p.team]} />}
                <Circle radius={R - 0.5 * k} fill={TEAM_COLOR[p.team]} />
                {img && <KImage image={img} x={-R} y={-R} width={2 * R} height={2 * R} />}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}

/**
 * The playback dock, the same as CS2's: play, speed, the match as a timeline (the win chance as a curve, Amber Hand
 * above and Sapphire Flame below; every kill a tick in the killer's team colour; the graded moments as their face;
 * objectives that fell), the options, and the moment bar (‹ n/N what happened ↺ ›).
 */
function DlPlaybar({ match, time, playing, speed, graded, full, onFull, canMine, mineLabel }: { match: DlMatch; time: number; playing: boolean; speed: number; graded: DlMove[]; full: boolean; onFull: () => void; canMine: boolean; mineLabel: string }) {
  const s = useDl.getState(), danger = useDl(x => x.danger), demo = useDl(x => x.demo), scope = useDl(x => x.scope);
  const dur = Math.max(1, match.duration);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / dur) * 100))}%`;
  const track = useRef<HTMLDivElement>(null);
  const seekAt = (clientX: number) => { const r = track.current!.getBoundingClientRect(); s.setPlaying(false); s.setTime(Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur))); };
  // the win chance every 20 s, as an area from the middle line (Amber Hand up)
  const curve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let t = 0; t <= dur; t += 20) pts.push([t, winChance(match, demo, t, 0)]);
    return `M 0 ${TL_H / 2} ${pts.map(([t, p]) => `L ${(t / dur) * TL_W} ${TL_H / 2 - (p - 0.5) * TL_H * 0.92}`).join(' ')} L ${TL_W} ${TL_H / 2} Z`;
  }, [match, demo, dur]);
  const teamOf = new Map(match.players.map(p => [p.slot, p.team]));
  // moments: several moves at the same second are one stop
  const times = useMemo(() => [...new Set(graded.map(m => m.t))].sort((a, b) => a - b), [graded]);
  const idx = times.reduce((a, t, i) => (t <= time + LEAD + 0.5 ? i : a), -1);
  const here = idx >= 0 ? graded.filter(m => m.t === times[idx]) : [];
  const main = here.find(m => m.note !== 'book') ?? here[0];
  const watch = () => { if (main) { s.setTime(Math.max(0, main.t - LEAD)); s.setPlaying(true); } };
  return (
    <div className="playbar dl-bar">
      <button className={`play-main ${playing ? 'on' : ''}`} onClick={() => { if (!playing && time >= dur) s.setTime(0); s.setPlaying(!playing); }} title="Play / pause (Space)">
        <Icon name={playing ? 'pause' : 'play'} /><span> {playing ? 'Pause' : 'Play'}</span>
      </button>
      <select value={speed} onChange={e => s.setSpeed(Number(e.target.value))} title="Playback speed" aria-label="Playback speed">
        {SPEEDS.map(x => <option key={x} value={x}>{x}×</option>)}
      </select>
      <div className="timeline" ref={track} role="slider" aria-label="Match timeline" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); seekAt(e.clientX); }}
        onPointerMove={e => { if (e.buttons & 1) seekAt(e.clientX); }}>
        <svg className="tl-curve" viewBox={`0 0 ${TL_W} ${TL_H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="dl-tl-eval" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={TL_H}>
              <stop offset="0" stopColor={TEAM_COLOR[0]} stopOpacity=".5" /><stop offset=".5" stopColor={TEAM_COLOR[0]} stopOpacity=".18" />
              <stop offset=".5" stopColor={TEAM_COLOR[1]} stopOpacity=".18" /><stop offset="1" stopColor={TEAM_COLOR[1]} stopOpacity=".5" />
            </linearGradient>
          </defs>
          <line x1="0" x2={TL_W} y1={TL_H / 2} y2={TL_H / 2} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={curve} fill="url(#dl-tl-eval)" />
        </svg>
        {match.deaths.filter(d => d.killer !== null && d.killer !== d.slot).map((d, i) => {
          const team = teamOf.get(d.killer!) ?? 0;
          return <i key={`k${i}`} className={`tl-kill ${team === 0 ? 'ct' : 't'}`} style={{ left: pct(d.t), background: TEAM_COLOR[team] }} />;
        })}
        {match.objectives.filter(o => o.destroyed).map((o, i) => (
          <span key={`o${i}`} className="tl-bomb" style={{ left: pct(o.destroyed!), color: TEAM_COLOR[o.team === 0 ? 1 : 0] }} title={`${o.name} destroyed at ${mins(o.destroyed!)}`}><Icon name="target" size={11} /></span>
        ))}
        {/* a whole match has far more moments than a CS2 round: faces for the big ones (Brilliant, Mistake, Blunder), dots
            in the grade's colour for the rest */}
        {graded.filter(m => m.note !== 'book').map((m, i) => {
          const big = m.note === '!!' || m.note === '?' || m.note === '??';
          return (
            <button key={`m${i}`} tabIndex={-1} className={big ? 'tl-mark' : 'tl-dot'} style={{ left: pct(m.t), background: big ? 'none' : NOTE_INFO[m.note].color }} title={`${NOTE_INFO[m.note].label} · ${m.title}`}
              onPointerDown={e => { e.stopPropagation(); s.setPlaying(false); s.setTime(Math.max(0, m.t - LEAD)); }}>{big && <MarkFace note={m.note} size={15} title={`${NOTE_INFO[m.note].label} · ${m.title}`} />}</button>
          );
        })}
        <i className="tl-head" style={{ left: pct(time) }} />
      </div>
      <span className="num dl-time">{mins(time)} / {mins(dur)}</span>
      {/* the same Options menu as CS2's: whose moves, the danger map, full screen, what the marks mean */}
      <details className="pb-options">
        <summary title="Review settings"><Icon name="gear" /><span className="pb-label">Options</span></summary>
        <div className="pb-options-pop">
          <div className="opt-head">Graded moves</div>
          {canMine && (
            <div className="seg-mini opt-seg" role="group" aria-label="Whose moves">
              <button className={scope === 'all' ? 'on' : ''} onClick={() => useDl.getState().setScope('all')}>Everyone</button>
              <button className={scope === 'mine' ? 'on' : ''} onClick={() => useDl.getState().setScope('mine')}>{mineLabel}</button>
            </div>
          )}
          <button className={`opt-row ${danger ? 'on' : ''}`} onClick={() => useDl.getState().toggleDanger()} aria-pressed={danger}
            title={`Where high-rank players die at this stage of the match (${DEATH_SOURCE.matches.toLocaleString()} Phantom+ matches since the patch)`}>
            <Icon name="skull" /><span>Danger map</span><i className="opt-switch" />
          </button>
          <button className={`opt-row ${full ? 'on' : ''}`} onClick={onFull} aria-pressed={full} title="Full screen (Esc leaves)">
            <Icon name="grid" /><span>Full screen</span><i className="opt-switch" />
          </button>
          <div className="opt-head">What the marks mean</div>
          <NoteKeyRows tips={DL_TIPS} foot="The bar on a card is the team's chance to win the match, just before and 30 s after." />
        </div>
      </details>
      {/* the moment bar, as in CS2: previous, which moment and what happened, watch the lead-up, next */}
      <div className="moment-nav">
        <button onClick={() => stepMoment(graded, -1)} disabled={!times.length} title="Previous moment (←)" aria-label="Previous moment"><Icon name="prev" /></button>
        <div className="moment-label">
          {idx < 0 || !main
            ? <span className="muted">{mins(time)} · {times.length} moments</span>
            : <>
                <span className="muted">{idx + 1}/{times.length}</span>
                <MarkFace note={main.note} size={16} />
                <span>{main.title}{here.length > 1 ? ` +${here.length - 1}` : ''}</span>
                <button className="mini" onClick={watch} title="Watch the lead-up" aria-label="Watch the lead-up"><Icon name="rewind" size={12} /></button>
              </>}
        </div>
        <button onClick={() => stepMoment(graded, 1)} disabled={!times.length} title="Next moment (→)" aria-label="Next moment"><Icon name="next" /></button>
      </div>
    </div>
  );
}
/** What each mark means in Deadlock (coach.ts). */
const DL_TIPS = {
  '!!': '4 kills in 10 s, or a solo kill against 3 or more',
  '!': '3 kills in 10 s, a solo kill against 2, or killing someone 3,000+ souls richer',
  book: 'The expected play: an ordinary kill or a traded death',
  '?!': 'Not the best: a death alone, outnumbered or past their Guardian',
  '?': 'Cost the team: two of those, or a death that lost an objective',
  '??': 'A big swing lost: a costly death that dropped the win chance 15+ points',
} as const;
/** The timeline's drawing box (as CS2's). */
const TL_W = 1000, TL_H = 40;

/**
 * Under the picked player: the engine's verdict on what they did over the next 20 s (the 2-step search, search.ts): the
 * best option, what they did and its class, with what good players usually do and every option on hover.
 */
function PlayHint({ match, slot, time }: { match: DlMatch; slot: number; time: number }) {
  const demo = useDl(s => s.demo);
  const t = Math.floor(time / 2) * 2;
  const chances = useMemo(() => playChances(PLAY_NET, match, slot, t), [match, slot, t]);
  const s = useMemo(() => searchAt(match, demo, slot, t), [match, demo, slot, t]);
  if (!chances) return null;
  const top = (Object.entries(chances) as [Action, number][]).sort((a, b) => b[1] - a[1])[0];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const tip = s ? s.options.map(o => `${ACTION_LABEL[o.action]}: ${pct(o.value)} win chance (${o.reply}${o.fight !== undefined ? `, fight ${Math.round(o.fight * 100)}%` : ''})`).join('\n') : '';
  return (
    <span className="dl-play-hint" title={`The coach, ${WINDOW} s ahead (now ${s ? pct(s.before) : '–'}):\n${tip}\n\nPhantom-and-up players here: ${ACTION_LABEL[top[0]]} ${Math.round(top[1] * 100)}% of the time`}>
      {s ? <>
        <span><span className="muted">Best:</span> {ACTION_LABEL[s.options[0].action]}</span>
        {s.played && s.cls && <span><span className="muted">they:</span> {ACTION_LABEL[s.played.action]} <b style={{ color: SEARCH_COLOR[s.cls] }}>{s.cls}{s.loss > 0.002 ? ` −${(s.loss * 100).toFixed(1)}%` : ''}</b></span>}
      </> : <span><span className="muted">Phantom+ here:</span> {ACTION_LABEL[top[0]]} <b className="num">{Math.round(top[1] * 100)}%</b></span>}
    </span>
  );
}

/** An ultimate's tooltip: what it does (ultBook.ts), and for an enemy, how to play against it. */
function ultTip(hero: number, enemy: boolean) {
  const u = ultOf(hero);
  return u ? `\n${u.does}${enemy ? `\nAgainst it: ${u.against}` : `\nUse it: ${u.use}`}` : '';
}

/** One line of the feed: who did what (hero icon and name in their team's colour), to whom or what. */
function FeedRow({ e, match, nameOf }: { e: FeedEvent; match: DlMatch; nameOf: (slot: number | null) => string }) {
  const who = (slot: number | null, team: DlTeam | null) => {
    const p = match.players.find(x => x.slot === slot);
    if (!p) return <span className="dl-feed-who" style={{ color: team !== null ? TEAM_COLOR[team] : 'var(--text-3)' }}>{team !== null ? TEAM_NAME[team] : 'Creeps'}</span>;
    const h = heroOf(p.hero);
    return <span className="dl-feed-who" style={{ color: TEAM_COLOR[p.team] }}>{h.icon && <img src={h.icon} alt="" />}{nameOf(p.slot)}</span>;
  };
  const verb = (text: string, extra?: React.ReactNode) => <><span className="dl-feed-verb">{text}</span>{extra}</>;
  const body = e.kind === 'kill' ? <>{who(e.slot, e.team)}<Icon name="close" size={10} />{who(e.victim ?? null, null)}</>
    : e.kind === 'objective' ? <>{who(e.slot, e.team)}{verb('destroyed', <b>{e.what}</b>)}</>
    : e.kind === 'urn' ? <>{who(e.slot, e.team)}{e.what === 'delivered' ? verb('delivered the urn', <b className="dl-feed-souls">+{e.souls!.toLocaleString()}</b>) : verb('picked up the urn')}</>
    : e.kind === 'urnLost' ? <>{who(e.slot, e.team)}{verb('lost the urn')}</>
    : e.kind === 'bag' ? <>{who(e.slot, e.team)}{verb(e.victim !== undefined ? 'took the soul bag of' : 'took a soul bag')}{e.victim !== undefined && who(e.victim, null)}<b className="dl-feed-souls">+{e.souls!.toLocaleString()}</b></>
    : e.kind === 'sinners' ? <>{who(e.slot, e.team)}{verb("took Sinner's Sacrifice")}</>
    : e.kind === 'rejuv' ? <>{who(e.slot, e.team)}{verb('took the Rejuvenator')}</>
    : e.kind === 'boss' ? <>{who(null, e.team)}{verb('killed the Mid Boss')}</>
    : <>{who(null, e.team)}{verb('took the Unstable Rift')}</>;
  return <li className={`dl-feed-${e.kind}`}>{body}</li>;
}

/** Jumps to the previous / next graded moment (a few seconds before it, so you see it happen). */
function stepMoment(moves: DlMove[], dir: 1 | -1) {
  const s = useDl.getState();
  const at = s.time + LEAD;
  const next = dir > 0 ? moves.find(m => m.t > at + 0.5) : [...moves].reverse().find(m => m.t < at - 0.5);
  if (next) { s.setPlaying(false); s.setTime(Math.max(0, next.t - LEAD)); }
}
/** A moment is shown from this long before it. */
const LEAD = 4;

/** The coach's card for the latest graded moment (shown from a few seconds before it until a while after). */
function DlCard({ moves, time, canMine, mineLabel = 'Mine' }: { moves: DlMove[]; time: number; canMine: boolean; mineLabel?: string }) {
  const scope = useDl(s => s.scope);
  const m = [...moves].reverse().find(x => time >= x.t - LEAD && time <= x.t + 8);
  return (
    <div className="dl-card-slot">
      {m && <MoveCardDl m={m} />}
    </div>
  );
}

const BETTER_DO: Record<Action, string> = { fight: 'take the fight', objective: 'go for the objective', farm: 'farm camps', lane: 'stay in lane', base: 'go back to base', move: 'rotate' };
const DOING: Record<Action, string> = { fight: 'fighting', objective: 'going for the objective', farm: 'farming', lane: 'staying in lane', base: 'going back to base', move: 'rotating' };
/** The engine's best move a little before a death or kill (the 2-step search, every 20 s alive): the "Better:" line. */
const reviews = new WeakMap<DlMatch, Map<number, ReturnType<typeof engineReview>>>();
function betterBefore(match: DlMatch, demo: ReturnType<typeof useDl.getState>['demo'], m: DlMove): string | null {
  if (m.kind !== 'death' || m.note === 'book' || m.note === '!' || m.note === '!!') return null;
  let per = reviews.get(match);
  if (!per) reviews.set(match, per = new Map());
  let rv = per.get(m.slot);
  if (!rv) { try { rv = engineReview(match, demo, m.slot); } catch { return null; } per.set(m.slot, rv); }
  const before = rv.moves.filter(x => x.t <= m.t - 3 && x.t >= m.t - 30).at(-1);
  if (!before || before.played.action === before.options[0].action) return null;
  return `${BETTER_DO[before.options[0].action]} instead of ${DOING[before.played.action]} (${mins(before.t)})`;
}

/**
 * One graded moment, five lines at most: the grade and who, what happened, the win chance as a bar with its change,
 * the better move (from the engine), and the tags. "Coach wrong?" only on a Mistake or a Blunder.
 */
function SwingNote({ note, swing }: { note: string; swing: number }) {
  const n = swingNote(note, swing);
  return n ? <b className={n.tone}>{n.text}</b> : null;
}

function MoveCardDl({ m }: { m: DlMove }) {
  const match = useDl(s => s.match)!, demo = useDl(s => s.demo), names = useDl(s => s.names);
  const better = useMemo(() => betterBefore(match, demo, m), [match, demo, m]);
  const who = names[match.players.find(p => p.slot === m.slot)?.account ?? -1]?.name ?? heroOf(match.players.find(p => p.slot === m.slot)?.hero ?? 0).name;
  const info = NOTE_INFO[m.note];
  const laning = m.kind === 'laning';
  return (
    <article className={`dl-card ${laning ? 'stat' : ''}`} style={{ borderColor: laning ? 'var(--border-strong)' : info.color }}>
      <header>
        {!laning && <span className="dl-grade-pill" style={{ background: info.color }}>{info.label}</span>}
        {laning && <span className="dl-grade-pill stat">Laning</span>}
        <span className="dl-card-who">{who} · <span className="num">{mins(m.t)}</span></span>
      </header>
      <p className="dl-card-title">{m.title}</p>
      {m.win && (
        <div className="dl-card-win" title="Your team's win chance just before and 30 s after">
          <span className="bar"><i style={{ '--from': `${Math.round(m.win.before * 100)}%`, width: `${Math.round(m.win.after * 100)}%`, background: m.win.swing >= 0 ? 'var(--good)' : 'var(--bad)' } as React.CSSProperties} /></span>
          <span className="num">{TEAM_NAME[m.team]} {Math.round(m.win.before * 100)}% → {Math.round(m.win.after * 100)}% <SwingNote note={m.note} swing={m.win.swing} /></span>
        </div>
      )}
      {m.why.length > 0 && <ul>{m.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {better && <p className="dl-card-better"><b>Better:</b> {better.charAt(0).toUpperCase() + better.slice(1)}</p>}
      {m.tags.length > 0 && <div className="dl-card-tags">{m.tags.map(t => <span key={t}>{t === 'ISOLATED' ? 'ALONE' : t}</span>)}</div>}
      {(m.note === '?' || m.note === '??') && <Dispute m={m} />}
    </article>
  );
}

/** What's up and what's next at this moment of the match (the game's timings, the mid boss from this match). */
function DlTimers({ match, time }: { match: DlMatch; time: number }) {
  const demo = useDl(s => s.demo);
  const rows = timersAt(time, match.midBoss);
  // with the demo: what really happened, in place of the schedule's guess
  if (demo) {
    const set = (what: string, now: string) => { const r = rows.find(x => x.what === what); if (r) r.now = now; };
    const u = [...demo.urn].reverse().find(x => x.from <= time);
    const carrier = u?.slot != null ? heroOf(match.players.find(p => p.slot === u.slot)?.hero ?? 0).name : null;
    set('Soul Urn', !u ? 'not yet' : u.taken === null || time < u.taken ? `on the ground since ${mins(u.from)} (${u.fromLeft ? 'Yellow' : 'Green'})`
      : u.until !== null && time < u.until ? `carried${carrier ? ` by ${carrier}` : ''} since ${mins(u.taken)}` : 'none out');
    const side = (i: number) => { const on = demo.buffs[i]?.find(([a, z]) => time >= a && time < z); return on ? `up since ${mins(on[0])}` : 'taken'; };
    if (time >= RULES.bridgeBuffs.spawn) set('Bridge buffs', `left ${side(0)} · right ${side(1)}`);
    // up now / all, by tier (T1 small, T2 medium, T3 large) and Sinner's Sacrifice
    const byTier = ([1, 2, 3, null] as const).map(tr => { const ix = DL_MAP.camps.map((c, i) => [c, i] as const).filter(([c]) => campTier(c.kind) === tr).map(([, i]) => i);
      return `${tr === null ? "Sinner's" : `T${tr}`} ${ix.filter(i => upAt(demo.camps[i] ?? [], time)).length}/${ix.length}`; });
    set('Camps', byTier.join(' · '));
    const r = riftAt(demo, time), riftSide = r && (r.x < 0.5 ? 'Yellow' : 'Green');
    set('Unstable Rift', !r ? 'none out' : r.phase === 'showing' ? `on the ${riftSide} bridge, opens ${mins(r.opens)}`
      : r.phase === 'contest' ? `${TEAM_NAME[0]} ${Math.round(r.p[0] * 100)}% · ${TEAM_NAME[1]} ${Math.round(r.p[1] * 100)}% (${r.n[0]} v ${r.n[1]})`
        : r.team !== null ? `taken by ${TEAM_NAME[r.team]}` : 'closed');
  }
  return (
    <section className="dl-timers" aria-label="Timers">
      <div className="dl-team-head">Timers</div>
      {rows.map(r => (
        <div key={r.what} className="dl-timer" title={r.note}>
          <b>{r.what}</b>
          <span className="muted small">{r.now}</span>
          {r.next !== null && <span className={`dl-timer-next num ${r.next - time <= 30 ? 'soon' : ''}`}>{mins(Math.max(0, r.next - time))}</span>}
        </div>
      ))}
      <a className="muted small dl-timer-src" href={TIMINGS_SOURCE.url} target="_blank" rel="noreferrer">Game timings from the Deadlock Wiki</a>
    </section>
  );
}

/** How reading the demo is going: deadlock-api reads it in about a minute the first time. */
function DemoChip() {
  const st = useDl(s => s.demoStatus);
  if (!st) return null;
  const text = st.state === 'done' ? 'Demo read' : st.state === 'failed' ? (/^No demo/.test(st.error ?? '') ? 'No demo · basic detail' : 'Demo failed: retry later') : st.local !== undefined ? `Reading your replay · ${Math.round(st.local * 100)}%` : `Reading the demo${st.wait ? ` · ~${st.wait} s` : '…'}`;
  const tip = st.state === 'done' ? 'Read from the match\'s demo: heroes 4 times a second, camps, the urn, bridge buffs, lane creeps, the rift, ultimates and net worth as they really were.'
    : st.state === 'failed' ? st.error ?? 'The demo couldn\'t be read.' : 'deadlock-api is reading this match\'s demo (about a minute the first time, then it\'s kept in this browser).';
  const match = useDl(s => s.match);
  return (
    <>
      <span className={`dl-demo-chip ${st.state}`} title={tip}>{text}</span>
      {st.state !== 'reading' && match && (
        <button className="ghost small-btn dl-demo-reload" onClick={() => void readDemo(match, true)}
          title="Read this match's demo again from deadlock-api (forgets the copy kept in this browser; about a minute)">Reload demo</button>
      )}
    </>
  );
}

/** "Coach wrong?" on a moment: should the mark be better or worse (and why); the owner rules on it (disputes.ts). */
function Dispute({ m }: { m: DlMove }) {
  const me = useProfile(s => s.me), match = useDl(s => s.match);
  const [open, setOpen] = useState(false);
  const [want, setWant] = useState<'better' | 'worse'>(m.note.startsWith('?') ? 'better' : 'worse');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle');
  useEffect(() => { setOpen(false); setState('idle'); setComment(''); setWant(m.note.startsWith('?') ? 'better' : 'worse'); }, [m.t, m.slot, m.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!STEAM_AVAILABLE || !me || !match) return null;
  if (state === 'sent') return <p className="dl-dispute-done muted small">Sent: the owner will check this moment.</p>;
  if (!open) return <button className="link-btn dl-dispute-open small" onClick={() => setOpen(true)}>Coach wrong?</button>;
  const send = async () => {
    setState('sending');
    try { await sendDispute(match.id, m, want, comment.trim()); setState('sent'); } catch (e) { setState(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="dl-dispute">
      <span className="muted small">This mark should be</span>
      <button className={`chip ${want === 'better' ? 'on' : ''}`} onClick={() => setWant('better')}>Better</button>
      <button className={`chip ${want === 'worse' ? 'on' : ''}`} onClick={() => setWant('worse')}>Worse</button>
      <input value={comment} onChange={e => setComment(e.target.value)} maxLength={400} placeholder="Why (optional)" aria-label="Why" />
      <button className="cta primary small-btn" disabled={state === 'sending'} onClick={() => void send()}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
      <button className="ghost small-btn" onClick={() => setOpen(false)}>Cancel</button>
      {state !== 'idle' && state !== 'sending' && <span className="warn-text small">{state}</span>}
    </div>
  );
}
