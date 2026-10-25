import { useMemo, useRef } from 'react';
import { bombAt, bombTryAt, DEFUSE_KIT_SECONDS, DEFUSE_SECONDS, NOTE_INFO, PLANT_SECONDS, type Annotation, type DemoData, type DemoRound, type Review } from '../engine/recap';
import { moveLook, NoteMark } from './NoteMark';
import { SIDE_COLOR, T } from './tokens';
import { useShown } from './shown';
import { Icon } from './Icon';
import { useStore } from '../store';

/** CS2's round clock is 1:55 after freeze time. The board's time counts up from 0 at the end of freeze time. */
export const ROUND_SECONDS = 115;

const clock = (sec: number) => {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const BOMB_SECONDS = 40;
/** How long the "Sides switched" banner stays at the start of the round (round seconds). */
const SWITCH_BANNER = 5;

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

/**
 * Rounds that start with the teams on the other side from the round before (half time, overtime halves): their
 * indexes. Read from the players' sides, so it works for MR12, MR15 and overtime alike.
 */
export function sideSwitches(data: DemoData): number[] {
  const out: number[] = [];
  for (let i = 1; i < data.rounds.length; i++) {
    const prev = data.rounds[i - 1].frames.players, now = data.rounds[i].frames.players;
    const ids = Object.keys(now).filter(id => prev[id]);
    const swapped = ids.filter(id => prev[id].side !== now[id].side).length;
    if (ids.length && swapped > ids.length / 2) out.push(i);
  }
  return out;
}

export interface HudPlayer { id: string; side: 'CT' | 'T'; label: string; name: string; alive: boolean; hp: number; avatar?: string }

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
  const tiles = (side: 'CT' | 'T') => {
    const list = team(side);
    // CT tiles read right-to-left towards the clock, like the game
    return (side === 'CT' ? [...list].reverse() : list).map(p => (
      <span key={p.id} className={`hud-tile ${side.toLowerCase()} ${p.alive ? '' : 'dead'} ${p.avatar ? 'pic' : ''}`} title={`${p.name}${p.alive ? ` · ${Math.round(p.hp)} hp` : ' · dead'}`}>
        {p.avatar ? <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <b>{p.label}</b>}
        <i style={{ '--hp': `${p.alive ? Math.max(0, Math.min(100, p.hp)) : 0}%` } as React.CSSProperties} className={p.hp <= 30 ? 'low' : ''} />
      </span>
    ));
  };
  return (
    <div className="hud" title={`${clock(time)} into the round`}>
      <div className="hud-team ct">{tiles('CT')}</div>
      <div className={`hud-mid ${planted ? 'bomb' : ''} ${left <= 10 ? 'low' : ''}`}>
        {score && <span className="hud-score ct" title="Rounds won by this round's CT team">{score[0]}</span>}
        <span className="hud-clock">{planted && <span className="hud-bomb" aria-label="Bomb planted"><Icon name="bomb" size={15} /></span>}{clock(left)}</span>
        {score && <span className="hud-score t" title="Rounds won by this round's T team">{score[1]}</span>}
      </div>
      <div className="hud-team t">{tiles('T')}</div>
    </div>
  );
}

/**
 * Review's score bug, top centre like a tournament broadcast: each side's score either side of the round clock, the
 * round number under it, and a strip that becomes the bomb's: planting (filling), the 40 s fuse (draining, red),
 * a defuse (filling blue, green when it beats the fuse, red when it can't), then defused / exploded.
 */
export function ScoreBug({ score, round, roundNo, time, switched }: {
  score: [number, number]; round: DemoRound; roundNo: number; time: number;
  /** The first round after the teams swapped sides: who's on CT now (a player's name), shown for the first seconds. */
  switched?: string | null;
}) {
  const bomb = bombAt(round, time);
  const plantedAt = bomb && bomb.kind !== 'carry' ? bomb.plantedAt : null;
  const act = bombTryAt(round, time);
  const fuse = plantedAt !== null ? Math.max(0, BOMB_SECONDS - (time - plantedAt)) : null;
  const ended = bomb?.kind === 'defuse' || bomb?.kind === 'explode';
  const left = fuse ?? ROUND_SECONDS - time;
  let strip: { cls: string; label: string; share: number; num?: string; icon?: 'bomb' | 'scissors' } | null = null;
  if (bomb?.kind === 'defuse') strip = { cls: 'defused', label: 'Bomb defused', share: 1, icon: 'scissors' };
  else if (bomb?.kind === 'explode') strip = { cls: 'exploded', label: 'Bomb exploded', share: 1, icon: 'bomb' };
  else if (act?.kind === 'defuse') {
    const len = act.end - act.t, made = time - act.t, need = (act.kit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS) - made;
    const inTime = fuse === null || need <= fuse;
    strip = { cls: `defusing ${inTime ? 'ok' : 'late'}`, label: `Defusing${act.kit ? ' with kit' : ''}${inTime ? '' : ': no time'}`, share: Math.min(1, made / (act.done ? len : act.kit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS)), num: Math.max(0, need).toFixed(1), icon: 'scissors' };
  } else if (act?.kind === 'plant') strip = { cls: 'planting', label: 'Planting', share: Math.min(1, (time - act.t) / PLANT_SECONDS), num: Math.max(0, PLANT_SECONDS - (time - act.t)).toFixed(1), icon: 'bomb' };
  else if (fuse !== null) strip = { cls: 'fuse', label: 'Bomb planted', share: fuse / BOMB_SECONDS, num: fuse.toFixed(1), icon: 'bomb' };
  return (
    <div className="scorebug">
      <div className="sb-main">
        <span className="sb-team ct">CT</span>
        <span className="sb-score ct num">{score[0]}</span>
        <span className={`sb-clock num ${fuse !== null && !ended ? 'bomb' : left <= 10 && !ended ? 'low' : ''}`}>
          {fuse !== null && !ended ? <><Icon name="bomb" size={15} className="sb-bomb-icon" />{Math.ceil(fuse)}</> : ended ? clock(ROUND_SECONDS - time) : clock(left)}
        </span>
        <span className="sb-score t num">{score[1]}</span>
        <span className="sb-team t">T</span>
      </div>
      <div className="sb-round">Round {roundNo}</div>
      {switched && time < SWITCH_BANNER && (
        <div className="sb-switch" role="status"><Icon name="swap" size={13} /> Sides switched · {switched}'s team is CT now</div>
      )}
      {strip && (
        <div className={`sb-strip ${strip.cls}`}>
          <i style={{ width: `${Math.round(strip.share * 1000) / 10}%` }} />
          <span>{strip.icon && <Icon name={strip.icon} size={12} />}{strip.label}{strip.num && <b className="num">{strip.num}</b>}</span>
        </div>
      )}
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
        if (!s.playing && s.time >= end - 0.05) s.setTime(s.judging?.from ?? 0);
        s.setPlaying(!s.playing);
      }}><Icon name={s.playing ? 'pause' : 'play'} /><span> {s.playing ? 'Pause' : 'Play'}</span></button>
      <button onClick={() => { s.setPlaying(false); s.setTime(s.judging?.from ?? 0); }} title={s.judging ? 'Back to the clip\'s start' : 'Back to round start'} aria-label={s.judging ? 'Back to the clip\'s start' : 'Back to round start'}><Icon name="toStart" /></button>
      <select value={s.speed} onChange={e => s.setSpeed(+e.target.value)} title="Playback speed">
        <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
      </select>
      {review && <EvalToggle />}
      {review && (
        <button className={s.popups ? 'on' : ''} onClick={e => { s.setPopups(!s.popups); e.currentTarget.blur(); }}
          title={s.popups ? 'Move windows: on (a window with the grade and comments for each graded move)' : 'Move windows: off'} aria-label="Move windows"><Icon name="chat" /><span className="pb-label">Cards</span></button>
      )}
      {review && (
        <button className={s.engineLines ? 'on' : ''} onClick={e => { s.setEngineLines(!s.engineLines); e.currentTarget.blur(); }}
          title={s.engineLines ? 'Arrows: on (the engine\'s best option against what was done, and a line from each card to its player)' : 'Arrows: off (turn on to see the engine\'s lines and which player a card is about)'} aria-label="Arrows"><Icon name="route" /><span className="pb-label">Arrows</span></button>
      )}
      {review && (
        <button className={`pb-rage ${s.rage ? 'on' : ''}`} onClick={e => { s.setRage(!s.rage); e.currentTarget.blur(); }}
          title={s.rage ? 'Rage mode: on (the coach swears at your plays)' : 'Rage mode: off. Turn on to have the coach lose it at your plays (18+, strong language)'} aria-label="Rage mode"><Icon name="bolt" /><span className="pb-label">Rage</span></button>
      )}
      {review && s.popups && (
        <button onClick={e => { s.setReadSlow(!s.readSlow); e.currentTarget.blur(); /* Space is play/pause, not this */ }}
          title={s.readSlow ? 'Slow motion while you read each graded move: on' : 'Slow motion while you read each graded move: off'} aria-label="Slow motion while reading" className={`pb-slow ${s.readSlow ? 'on' : ''}`}><Icon name="slow" /><span className="pb-label">Slow</span></button>
      )}
      {review && <NoteKey />}
      {review && recap && round
        ? <Timeline end={end} recap={recap} round={round} time={s.time} spoilers={s.reviewSpoilers} onSeek={t => { s.setPlaying(false); s.setTime(t); }} />
        : <input className="playbar-range" type="range" min={0} max={max} step={0.1} value={Math.min(s.time, max)}
            title="Seconds after freeze time"
            onChange={e => { s.setPlaying(false); s.setTime(+e.target.value); }} />}
      {!review && (
        <>
          <button className={s.combat ? 'on' : ''} onClick={() => s.setCombat(!s.combat)} title="Combat: players fight and die" aria-label="Combat"><Icon name="swords" /></button>
          <button onClick={s.reroll} disabled={!s.combat} title="Roll the fights again" aria-label="Re-roll the fights"><Icon name="dice" /></button>
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
      {plant !== null && <span className="tl-bomb" style={{ left: pct(plant) }} title={`Bomb planted at ${clock(plant)} into the round`}><Icon name="bomb" size={12} /></span>}
      {moves.map((m, i) => {
        const g = moveLook(m);
        // the same marks as on the map, for every move that's evaluated: book moves as small dots
        return (
          <button key={`m${i}`} className={m.note === 'book' ? 'tl-dot' : 'tl-mark'} style={{ left: pct(m.t), background: g.color }}
            title={`${g.label}${g.mark ? ` (${g.mark})` : ''} · ${m.title}`}
            onPointerDown={e => { e.stopPropagation(); onSeek(m.t + 0.1); }}>{g.mark}</button>
        );
      })}
      <i className="tl-head" style={{ left: pct(time) }} />
    </div>
  );
}

/** What the grade marks mean (on the map, the timeline, the killfeed and the cards). */
function NoteKey() {
  return (
    <details className="note-key">
      <summary title="What the marks mean">Key</summary>
      <div className="note-key-pop">
        {(Object.keys(NOTE_INFO) as Annotation[]).map(a => (
          <div key={a} className="note-key-row">
            <NoteMark m={{ note: a, kind: 'kill' }} />
            <span><b>{NOTE_INFO[a].label}</b> <span className="muted">{NOTE_INFO[a].tip}</span></span>
          </div>
        ))}
        <p className="muted">The % on a card is how much the move changed its team's chance to win the round.</p>
      </div>
    </details>
  );
}

/**
 * Evaluate every move, or only yours. Without knowing who you are (no Steam login, no "This is me" yet) "Mine" is a
 * list of the match's players to pick yourself from, remembered for next time.
 */
function EvalToggle() {
  const scope = useStore(s => s.evalScope), setScope = useStore(s => s.setEvalScope), setClaimed = useStore(s => s.setClaimed);
  const data = useStore(s => s.review?.data);
  const { mine, canMine } = useShown();
  const ids = useMemo(() => (data ? [...new Set(data.rounds.flatMap(r => Object.keys(r.frames.players)))] : []), [data]);
  return (
    <div className="seg-mini eval-toggle" role="group" aria-label="Whose moves are evaluated">
      <button className={!mine ? 'on' : ''} onClick={() => setScope('all')} title="Evaluate every move: every kill, death, grenade and flash">All</button>
      {canMine || !ids.length ? (
        <button className={mine ? 'on' : ''} disabled={!canMine} onClick={() => setScope('mine')} title="Evaluate only your moves">Mine</button>
      ) : (
        <select className="mine-pick" value="" title="Which player are you? Only your moves are evaluated (remembered in this browser)"
          onChange={e => { if (e.target.value) { setClaimed(e.target.value); setScope('mine'); } }}>
          <option value="">Mine…</option>
          {ids.map(id => <option key={id} value={id}>{data!.names[id] ?? id}</option>)}
        </select>
      )}
    </div>
  );
}
