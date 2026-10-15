import { useStore } from '../store';

/** CS2's round clock is 1:55 after freeze time. The board's time counts up from 0 at the end of freeze time. */
export const ROUND_SECONDS = 115;

const clock = (sec: number) => {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Top-centre scoreboard like the CS2 HUD: CT players alive · round clock counting down · T players alive. */
export function RoundHud({ ctAlive, tAlive }: { ctAlive: number; tAlive: number }) {
  const time = useStore(s => s.time);
  const left = ROUND_SECONDS - time;
  return (
    <div className="hud" title={`${clock(time)} into the round`}>
      <span className="hud-side ct" title="CT players alive">{ctAlive}</span>
      <span className={`hud-clock ${left <= 10 ? 'low' : ''}`}>{clock(left)}</span>
      <span className="hud-side t" title="T players alive">{tAlive}</span>
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
