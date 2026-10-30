import { useEffect, useMemo, useRef, useState } from 'react';
import { Arc, Circle, Group, Image as KImage, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva';
import { Icon } from '../ui/Icon';
import { heroOf, objectiveKey, TEAM_COLOR, TEAM_NAME, type DlTeam } from './data';
import { MapArt, useGameMap } from './MapArt';
import { RULES, TIMINGS_SOURCE, timersAt } from './timings';
import { upAt } from './demo';
import { kdaAt, playerAt, statAt, type DlMatch } from './match';
import { useDl } from './store';
import { useCoach, useMySlot } from './useCoach';
import type { DlMove } from './coach';
import { NOTE_INFO } from '../engine/recap';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** A body stays where the hero died, fading out (like CS2's), gone this long after. */
const BODY_GONE = 3;
/** The game's phases, to jump between on a long match. */
const PHASES = [{ label: 'Laning', t: 0 }, { label: 'Mid game', t: 600 }, { label: 'Late game', t: 1500 }];
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
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) s.setTime(s.time + (e.key === 'ArrowRight' ? 10 : -10));
        else stepMoment(graded, e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [match.duration, graded]);

  const teams: DlTeam[] = [0, 1];
  const kills = (team: DlTeam) => match.deaths.filter(d => d.t <= time && d.killer !== null && match.players.find(p => p.slot === d.killer)?.team === team && d.killer !== d.slot).length;
  const souls = (team: DlTeam) => match.players.filter(p => p.team === team).reduce((a, p) => a + (statAt(match, p.slot, time)?.netWorth ?? 0), 0);
  const s0 = souls(0), s1 = souls(1), lead = s0 + s1 ? s0 / (s0 + s1) : 0.5;
  const feed = match.deaths.filter(d => d.t <= time && time - d.t < 12).slice(-6).reverse();
  const nameOf = (slot: number | null) => {
    const p = match.players.find(x => x.slot === slot);
    return p ? names[p.account]?.name ?? heroOf(p.hero).name : 'the creeps';
  };

  return (
    <div className="dl-board">
      <div className="dl-top">
        <div className="dl-score">
          <span className="dl-team-score" style={{ color: TEAM_COLOR[0] }}>{TEAM_NAME[0]} <b>{kills(0)}</b></span>
          <span className="dl-clock num">{mins(time)}</span>
          <span className="dl-team-score" style={{ color: TEAM_COLOR[1] }}><b>{kills(1)}</b> {TEAM_NAME[1]}</span>
          <DemoChip />
        </div>
        <div className="dl-souls" title={`Team souls: ${TEAM_NAME[0]} ${s0.toLocaleString()} · ${TEAM_NAME[1]} ${s1.toLocaleString()}`}>
          <i style={{ width: `${lead * 100}%`, background: TEAM_COLOR[0] }} /><i style={{ width: `${(1 - lead) * 100}%`, background: TEAM_COLOR[1] }} />
          <span className="dl-souls-label num">{s0 === s1 ? 'Even souls' : `${s0 > s1 ? TEAM_NAME[0] : TEAM_NAME[1]} +${Math.abs(s0 - s1).toLocaleString()} souls`}</span>
        </div>
      </div>

      <div className="dl-main">
        {teams.map(team => (
          <aside key={team} className={`dl-team t${team}`} aria-label={TEAM_NAME[team]}>
            <div className="dl-team-head" style={{ color: TEAM_COLOR[team] }}>{TEAM_NAME[team]}{match.winner === team && time >= match.duration ? ' · won' : ''}</div>
            {match.players.filter(p => p.team === team).map(p => {
              const h = heroOf(p.hero), at = playerAt(match, p.slot, time), kda = kdaAt(match, p.slot, time), st = statAt(match, p.slot, time);
              const dead = !at, death = dead ? match.deaths.find(d => d.slot === p.slot && time >= d.t && time < d.t + d.respawn) : null;
              return (
                <button key={p.slot} className={`dl-player ${dead ? 'dead' : ''} ${selected === p.slot ? 'on' : ''}`} onClick={() => useDl.getState().select(selected === p.slot ? null : p.slot)}>
                  {h.card ? <img src={h.card} alt="" width={32} height={32} /> : <span className="dl-hero-dot" style={{ background: h.color }} />}
                  <span className="dl-player-name"><b>{names[p.account]?.name ?? h.name}</b><span className="muted small">{h.name}</span></span>
                  <span className="dl-player-kda num">{kda.k}/{kda.d}/{kda.a}</span>
                  <span className="dl-player-souls num muted small">{st ? `${(st.netWorth / 1000).toFixed(1)}k` : ''}</span>
                  <span className="dl-hp"><i style={{ width: `${at?.hp ?? 0}%`, background: (at?.hp ?? 0) <= 30 ? 'var(--bad)' : TEAM_COLOR[team] }} /></span>
                  {death && <span className="dl-respawn num">{Math.ceil(death.t + death.respawn - time)}</span>}
                </button>
              );
            })}
            {team === 1 && <DlTimers match={match} time={time} />}
          </aside>
        ))}
        <DlMap match={match} time={time} selected={selected} />
        <DlCard moves={graded} time={time} canMine={coach.canMine} />
        <ol className="dl-feed" aria-label="Kills">
          {feed.map((d, i) => {
            const killer = match.players.find(p => p.slot === d.killer), victim = match.players.find(p => p.slot === d.slot)!;
            return (
              <li key={`${d.t}-${d.slot}-${i}`}>
                <span style={{ color: killer ? TEAM_COLOR[killer.team] : 'var(--text-3)' }}>{nameOf(d.killer)}</span>
                <Icon name="close" size={10} />
                <span style={{ color: TEAM_COLOR[victim.team] }}>{nameOf(d.slot)}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <DlPlaybar match={match} time={time} playing={playing} speed={speed} graded={graded} />
    </div>
  );
}

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
  const map = useGameMap();
  // the urn from the demo: on the ground where it lay, or with whoever carried it
  const demo = useDl(s => s.demo);
  const urnNow = useMemo(() => {
    const u = demo ? [...demo.urn].reverse().find(x => x.from <= time) : undefined;
    if (!u) return null;
    if (u.taken === null || time < u.taken) return { x: u.x, y: u.y, label: time < u.landed ? 'landing' : mins(u.from), carried: false, fromLeft: u.fromLeft };
    const at = u.slot !== null && u.until !== null && time < u.until ? playerAt(match, u.slot, time) : null;
    const who = match.players.find(p => p.slot === u.slot);
    return at && who ? { x: at.x, y: at.y, label: heroOf(who.hero).name, carried: true, fromLeft: u.fromLeft } : null;
  }, [demo, match, Math.floor(time)]); // eslint-disable-line react-hooks/exhaustive-deps
  // your team in lane colours when you played in it (like the game), else the bottom team
  const mine = useMySlot();
  const you = (match.players.find(p => p.slot === mine)?.team ?? 0) as DlTeam;
  const downKeys = useMemo(() => new Set(match.objectives.filter(o => o.destroyed !== null && time >= o.destroyed).map(o => `${o.team}_${objectiveKey(o.id)}`)), [match, Math.floor(time)]); // eslint-disable-line react-hooks/exhaustive-deps
  const icons = useImages(match.players.map(p => heroOf(p.hero).icon));
  const S = size, k = S / 640;
  const P = (p: { x: number; y: number }) => ({ x: p.x * S, y: p.y * S });

  // the selected hero's way over the last 20 s
  const trail = useMemo(() => {
    if (selected === null) return null;
    const pts: number[] = [];
    for (let t = Math.max(0, Math.floor(time) - 20); t <= time; t++) { const a = playerAt(match, selected, t); if (a) pts.push(a.x * S, a.y * S); }
    return pts;
  }, [selected, Math.floor(time), S, match]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="dl-map" ref={wrap}>
      <Stage width={S} height={S}>
        <Layer listening={false}>
          {/* the map like the game draws it, your team's lanes in their colours; objectives destroyed by now hollow */}
          <MapArt S={S} k={k} img={map} you={you} down={(team, key) => downKeys.has(`${team}_${key}`)} at={{ time, midBoss: match.midBoss, demo, urnNow }} />
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
            const at = playerAt(match, p.slot, time);
            if (!at) return null;
            const h = heroOf(p.hero), img = h.icon ? icons[h.icon] : undefined, R = 9 * k, on = selected === p.slot;
            return (
              <Group key={p.slot} {...P(at)} onClick={() => useDl.getState().select(on ? null : p.slot)} onTap={() => useDl.getState().select(on ? null : p.slot)}>
                {on && <Circle radius={R + 6 * k} stroke="#fff" strokeWidth={1.4 * k} />}
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

function DlPlaybar({ match, time, playing, speed, graded }: { match: DlMatch; time: number; playing: boolean; speed: number; graded: DlMove[] }) {
  const s = useDl.getState();
  const marks = useMemo(() => [
    ...match.deaths.map(d => ({ t: d.t, color: TEAM_COLOR[match.players.find(p => p.slot === d.slot)?.team === 0 ? 1 : 0], kind: 'kill' as const })),
    ...match.objectives.filter(o => o.destroyed).map(o => ({ t: o.destroyed!, color: TEAM_COLOR[o.team === 0 ? 1 : 0], kind: 'objective' as const })),
    ...graded.map(m => ({ t: m.t, color: NOTE_INFO[m.note].color, kind: 'graded' as const })),
  ], [match, graded]);
  return (
    <div className="dl-playbar">
      <button className="play-main" onClick={() => { if (!playing && time >= match.duration) s.setTime(0); s.setPlaying(!playing); }} title="Play / pause (Space)">
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
        <input type="range" min={0} max={match.duration} step={1} value={Math.floor(time)} onChange={e => s.setTime(Number(e.target.value))} aria-label="Match time" />
        <div className="dl-marks" aria-hidden>
          {marks.map((m, i) => <i key={i} className={m.kind} style={{ left: `${(m.t / match.duration) * 100}%`, background: m.color }} />)}
        </div>
      </div>
      <span className="num dl-time">{mins(time)} / {mins(match.duration)}</span>
    </div>
  );
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
function DlCard({ moves, time, canMine }: { moves: DlMove[]; time: number; canMine: boolean }) {
  const scope = useDl(s => s.scope);
  const m = [...moves].reverse().find(x => time >= x.t - LEAD && time <= x.t + 8);
  return (
    <div className="dl-card-slot">
      {canMine && (
        <div className="seg-mini dl-scope" role="group" aria-label="Whose moves">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => useDl.getState().setScope('all')}>All</button>
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => useDl.getState().setScope('mine')}>Mine</button>
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
    </div>
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
    set('Camps', `${demo.camps.filter(xs => upAt(xs, time)).length} of ${demo.camps.length} up`);
  }
  return (
    <section className="dl-timers" aria-label="Timers">
      <div className="dl-team-head">Timers</div>
      {rows.map(r => (
        <div key={r.what} className="dl-timer" title={r.note}>
          <b>{r.what}</b>
          <span className="muted small">{r.now}</span>
          {r.next !== null && <span className="dl-timer-next num">{mins(Math.max(0, r.next - time))}</span>}
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
  const text = st.state === 'done' ? 'Demo read' : st.state === 'failed' ? 'No demo' : `Reading the demo${st.wait ? ` · ~${st.wait} s` : '…'}`;
  const tip = st.state === 'done' ? 'Camps, the urn and the bridge buffs are shown as they really were; ability casts and ultimates are in the coach.'
    : st.state === 'failed' ? st.error ?? 'The demo couldn\'t be read.' : 'deadlock-api is reading this match\'s demo (about a minute the first time, then it\'s kept in this browser).';
  return <span className={`dl-demo-chip ${st.state}`} title={tip}>{text}</span>;
}
