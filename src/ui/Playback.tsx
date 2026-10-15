import type { DemoData } from '../engine/recap';
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

/** Bottom-left of the board: play/pause, restart, speed, a scrub bar, and the fight settings. */
export function PlaybackBar({ end }: { end: number }) {
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
      {review && (
        <button className={s.readSlow ? 'on' : ''} onClick={e => { s.setReadSlow(!s.readSlow); e.currentTarget.blur(); /* Space is play/pause, not this */ }}
          title={s.readSlow ? 'Slow motion while you read each graded move: on' : 'Slow motion while you read each graded move: off'}>📖</button>
      )}
      <input className="playbar-range" type="range" min={0} max={max} step={0.1} value={Math.min(s.time, max)}
        title="Seconds after freeze time"
        onChange={e => { s.setPlaying(false); s.setTime(+e.target.value); }} />
      {!review && (
        <>
          <button className={s.combat ? 'on' : ''} onClick={() => s.setCombat(!s.combat)} title="Combat: players fight and die">⚔</button>
          <button onClick={s.reroll} disabled={!s.combat} title="Roll the fights again">🎲</button>
        </>
      )}
    </div>
  );
}
