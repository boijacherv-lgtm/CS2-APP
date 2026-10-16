import { useRef } from 'react';
import { GRADE_INFO, type DemoData, type DemoRound, type Review } from '../engine/recap';
import { SIDE_COLOR, T } from './tokens';
import { useShown } from './shown';
import { useStore } from '../store';

/** CS2's round clock is 1:55 after freeze time. The board's time counts up from 0 at the end of freeze time. */
export const ROUND_SECONDS = 115;

const clock = (sec: number) => {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const BOMB_SECONDS = 40;

/**
 * Score before round `idx`, as [this round's CT team, this round's T team]. Teams swap sides at half
 * time, so each earlier round is credited to whichever team the current CT players were on then.
 */
export function scoreBefore(data: DemoData, idx: number): [number, number] {
  const now = data.rounds[idx];
  if (!now) return [0, 0];
  const ctIds = Object.keys(now.frames.players).filter(id => now.frames.players[id].side === 'CT');
  let ct = 0, t = 0;
  for (const r of data.rounds.slice(0, idx)) {
    if (!r.winner) continue;
    const ref = ctIds.find(id => r.frames.players[id]);
    if (!ref) continue;
    if (r.frames.players[ref].side === r.winner) ct++; else t++;
  }
  return [ct, t];
}

export interface HudPlayer { id: string; side: 'CT' | 'T'; label: string; name: string; alive: boolean; hp: number }

/**
 * Top-centre HUD like CS2's: each team's players as small tiles (health bar under each, dimmed and
 * crossed out when dead), the alive count, and the round clock in the middle. In a review it also shows
 * the score so far, and after the plant the clock turns into the bomb timer.
 */
export function RoundHud({ players, score, plantedAt }: { players: HudPlayer[]; score?: [number, number] | null; plantedAt?: number | null }) {
  const time = useStore(s => s.time);
  const planted = plantedAt != null && time >= plantedAt;
  const left = planted ? BOMB_SECONDS - (time - plantedAt!) : ROUND_SECONDS - time;
  const team = (side: 'CT' | 'T') => players.filter(p => p.side === side).slice(0, 5);
  const alive = (side: 'CT' | 'T') => team(side).filter(p => p.alive).length;
  const tiles = (side: 'CT' | 'T') => {
    const list = team(side);
    // CT tiles read right-to-left towards the clock, like the game
    return (side === 'CT' ? [...list].reverse() : list).map(p => (
      <span key={p.id} className={`hud-tile ${side.toLowerCase()} ${p.alive ? '' : 'dead'}`} title={`${p.name}${p.alive ? ` · ${Math.round(p.hp)} hp` : ' · dead'}`}>
        <b>{p.label}</b>
        <i style={{ '--hp': `${p.alive ? Math.max(0, Math.min(100, p.hp)) : 0}%` } as React.CSSProperties} className={p.hp <= 30 ? 'low' : ''} />
      </span>
    ));
  };
  return (
    <div className="hud" title={`${clock(time)} into the round`}>
      <div className="hud-team ct">{tiles('CT')}</div>
      <div className="hud-alive ct" title="CT players alive">{alive('CT')}</div>
      <div className={`hud-mid ${planted ? 'bomb' : ''} ${left <= 10 ? 'low' : ''}`}>
        {score && <span className="hud-score ct" title="Rounds won by this round's CT team">{score[0]}</span>}
        <span className="hud-clock">{planted && <span className="hud-bomb" aria-label="Bomb planted">💣</span>}{clock(left)}</span>
        {score && <span className="hud-score t" title="Rounds won by this round's T team">{score[1]}</span>}
      </div>
      <div className="hud-alive t" title="T players alive">{alive('T')}</div>
      <div className="hud-team t">{tiles('T')}</div>
    </div>
  );
}

/** The playback dock: play/pause, restart, speed, the scrub bar (the round's timeline in Review), and the fight settings. */
export function PlaybackBar({ end, recap, round }: { end: number; recap?: Review | null; round?: DemoRound | null }) {
  const s = useStore();
  const review = s.mode === 'review';
  const max = review ? Math.ceil(end) : Math.max(60, Math.ceil(end));
  return (
    <div className="playbar">
      <button className={`play-main ${s.playing ? 'on' : ''}`} title="Play / pause (Space)" onClick={() => {
        if (!s.playing && s.time >= end - 0.05) s.setTime(0);
        s.setPlaying(!s.playing);
      }}>{s.playing ? '❚❚' : '▶'}<span> {s.playing ? 'Pause' : 'Play'}</span></button>
      <button onClick={() => { s.setPlaying(false); s.setTime(0); }} title="Back to round start">⟲</button>
      <select value={s.speed} onChange={e => s.setSpeed(+e.target.value)} title="Playback speed">
        <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
      </select>
      {review && <EvalToggle />}
      {review && (
        <button className={s.popups ? 'on' : ''} onClick={e => { s.setPopups(!s.popups); e.currentTarget.blur(); }}
          title={s.popups ? 'Move windows: on (a window with the grade and comments for each graded move)' : 'Move windows: off'}>💬</button>
      )}
      {review && s.popups && (
        <button className={s.readSlow ? 'on' : ''} onClick={e => { s.setReadSlow(!s.readSlow); e.currentTarget.blur(); /* Space is play/pause, not this */ }}
          title={s.readSlow ? 'Slow motion while you read each graded move: on' : 'Slow motion while you read each graded move: off'}>📖</button>
      )}
      {review && recap && round
        ? <Timeline end={end} recap={recap} round={round} time={s.time} spoilers={s.reviewSpoilers} onSeek={t => { s.setPlaying(false); s.setTime(t); }} />
        : <input className="playbar-range" type="range" min={0} max={max} step={0.1} value={Math.min(s.time, max)}
            title="Seconds after freeze time"
            onChange={e => { s.setPlaying(false); s.setTime(+e.target.value); }} />}
      {!review && (
        <>
          <button className={s.combat ? 'on' : ''} onClick={() => s.setCombat(!s.combat)} title="Combat: players fight and die">⚔</button>
          <button onClick={s.reroll} disabled={!s.combat} title="Roll the fights again">🎲</button>
        </>
      )}
    </div>
  );
}

const W = 1000, H = 40;

/**
 * The round as a timeline: the win chance as a filled curve behind the track (CT blue above the middle, T yellow
 * below), every kill as a tick in the killer's colour (CT from the top, T from the bottom), the big graded moves as
 * their letter (the same chip as on the map, for every move that's evaluated), and the bomb plant with the post-plant stretch tinted red. Like the
 * rest of the review it only shows what has happened so far, unless Reveal all is on. Click anywhere (or a mark) to
 * jump there; dragging scrubs too.
 */
function Timeline({ end, recap, round, time, spoilers, onSeek }: {
  end: number; recap: Review; round: DemoRound; time: number; spoilers: boolean; onSeek: (t: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const until = spoilers ? Infinity : time;
  const dur = Math.max(1, end);
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / dur) * 100))}%`;
  const seekAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur)));
  };
  // win-chance curve, as an area from the middle line
  const pts = recap.curve.filter(p => p.t <= until);
  const area = pts.length > 1
    ? `M ${(pts[0].t / dur) * W} ${H / 2} ${pts.map(p => `L ${(p.t / dur) * W} ${H / 2 - (p.ct - 0.5) * H * 0.92}`).join(' ')} L ${(pts[pts.length - 1].t / dur) * W} ${H / 2} Z`
    : '';
  const sideOf = (id: string) => round.frames.players[id]?.side;
  const kills = round.kills.filter(k => k.t <= until && sideOf(k.attacker));
  const { shown } = useShown();
  const moves = recap.moves.filter(m => shown(m) && m.t <= until);
  const plant = round.plant !== null && round.plant <= until ? round.plant : null;
  return (
    <div className="timeline" ref={track} role="slider" aria-label="Round timeline" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)}
      onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); seekAt(e.clientX); }}
      onPointerMove={e => { if (e.buttons & 1) seekAt(e.clientX); }}>
      <svg className="tl-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="tl-eval" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset="0" stopColor={T.ct} stopOpacity=".5" /><stop offset=".5" stopColor={T.ct} stopOpacity=".18" />
            <stop offset=".5" stopColor={T.t} stopOpacity=".18" /><stop offset="1" stopColor={T.t} stopOpacity=".5" />
          </linearGradient>
        </defs>
        {plant !== null && <rect x={(plant / dur) * W} y="0" width={((Math.min(until, dur) - plant) / dur) * W} height={H} fill={T.bomb} opacity=".12" />}
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke={T.border} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {area && <path d={area} fill="url(#tl-eval)" />}
      </svg>
      {kills.map((k, i) => (
        <i key={`k${i}`} className={`tl-kill ${sideOf(k.attacker) === 'CT' ? 'ct' : 't'}`} style={{ left: pct(k.t), background: SIDE_COLOR[sideOf(k.attacker)!] }} />
      ))}
      {plant !== null && <span className="tl-bomb" style={{ left: pct(plant) }} title={`Bomb planted at ${clock(plant)} into the round`}>💣</span>}
      {moves.map((m, i) => {
        const g = GRADE_INFO[m.grade];
        // the same letter chip as on the map, for every move that's evaluated
        return (
          <button key={`m${i}`} className="tl-mark" style={{ left: pct(m.t), background: g.color }} title={`${g.mark} · ${m.title}`}
            onPointerDown={e => { e.stopPropagation(); onSeek(m.t + 0.1); }}>{g.mark}</button>
        );
      })}
      <i className="tl-head" style={{ left: pct(time) }} />
    </div>
  );
}

/** Evaluate every move, or only the signed-in player's ("Mine" needs Steam login and being in this match). */
function EvalToggle() {
  const scope = useStore(s => s.evalScope), setScope = useStore(s => s.setEvalScope);
  const { mine, canMine } = useShown();
  return (
    <div className="seg-mini eval-toggle" role="group" aria-label="Whose moves are evaluated">
      <button className={!mine ? 'on' : ''} onClick={() => setScope('all')} title="Evaluate every move: every kill, death, grenade and flash">All</button>
      <button className={mine ? 'on' : ''} disabled={!canMine} onClick={() => setScope('mine')}
        title={canMine ? 'Evaluate only your moves' : 'Log in with Steam (and be in this match) to see only your moves'}>
        Mine{scope === 'mine' && !canMine ? ' ⚠' : ''}
      </button>
    </div>
  );
}
