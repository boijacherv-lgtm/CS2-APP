import { MarkFace } from './MarkFace';
import { siteConfig } from './siteConfig';
import { useMemo, useRef } from 'react';
import { bombAt, bombTryAt, DEFUSE_KIT_SECONDS, DEFUSE_SECONDS, gearAt, NOTE_INFO, PLANT_SECONDS, type Annotation, type DemoData, type DemoRound, type Review } from '../engine/recap';
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
  let strip: { cls: string; label: string; share: number; icon?: 'bomb' | 'scissors' } | null = null;
  let defuse: { share: number; ok: boolean } | null = null;
  if (bomb?.kind === 'defuse') strip = { cls: 'defused', label: 'Bomb defused', share: 1, icon: 'scissors' };
  else if (bomb?.kind === 'explode') strip = { cls: 'exploded', label: 'Bomb exploded', share: 1, icon: 'bomb' };
  else if (act?.kind === 'defuse') {
    const full = act.kit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS, made = time - act.t, need = Math.max(0, full - made);
    const ok = fuse === null || need <= fuse;
    defuse = { share: Math.min(1, made / full), ok };
    strip = ok
      ? { cls: 'defusing ok', label: `Defusing${act.kit ? ' with kit' : ''} · ${need.toFixed(1)} s`, share: defuse.share, icon: 'scissors' }
      : { cls: 'defusing late', label: `Too late · ${(need - (fuse ?? 0)).toFixed(1)} s short`, share: defuse.share, icon: 'scissors' };
  } else if (act?.kind === 'plant') strip = { cls: 'planting', label: `Planting · ${Math.max(0, PLANT_SECONDS - (time - act.t)).toFixed(1)} s`, share: Math.min(1, (time - act.t) / PLANT_SECONDS), icon: 'bomb' };
  else if (fuse !== null && !ended && fuse > 0) {
    // after the plant: what the CTs need to stop it
    const { alive, kit } = ctsAt(round, time);
    if (alive > 0) strip = { cls: 'helper', label: `${alive} CT left · need ${kit ? '5 s with kit' : '10 s without kit'} · ${Math.ceil(fuse)} s left`, share: 0 };
  }
  // (the fuse itself counts down in the clock above: one timer, not two)
  return (
    <div className="scorebug">
      <div className="sb-main">
        <span className="sb-team ct">CT</span>
        <span className="sb-score ct num">{score[0]}</span>
        <span className={`sb-clock num ${fuse !== null && !ended ? `bomb ${fuse > 10 ? 'amber' : fuse > 5 ? 'orange' : 'red'}` : left <= 10 && !ended ? 'low' : ''}`}>
          {fuse !== null && !ended ? <><BombDial fuse={fuse} defuse={defuse} />{Math.ceil(fuse)}</> : ended ? clock(ROUND_SECONDS - time) : clock(left)}
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
          <span>{strip.icon && <Icon name={strip.icon} size={12} />}{strip.label}</span>
        </div>
      )}
    </div>
  );
}

/** CTs alive at time t, and whether any of them carries a defuse kit. */
function ctsAt(r: DemoRound, t: number) {
  const ft = r.frames.t;
  let k = 0;
  while (k + 1 < ft.length && ft[k + 1] <= t) k++;
  let alive = 0, kit = false;
  for (const [id, f] of Object.entries(r.frames.players)) {
    if (f.side !== 'CT' || !f.alive[k]) continue;
    alive++;
    if (gearAt(r, id, t)?.kit) kit = true;
  }
  return { alive, kit };
}

/**
 * The bomb dial in the score bug's centre: a ring that drains 40 → 0 (amber, orange from 10 s, red from 5 s), ticks at
 * 10 s and 5 s (the last start for a defuse without and with a kit), and a defuse filling inside it in CT blue (red and
 * striped when it can't finish, a check when it will).
 */
function BombDial({ fuse, defuse }: { fuse: number; defuse: { share: number; ok: boolean } | null }) {
  const tick = (left: number) => {
    const a = (left / BOMB_SECONDS) * 2 * Math.PI - Math.PI / 2;
    return <line x1={17 + Math.cos(a) * 13} y1={17 + Math.sin(a) * 13} x2={17 + Math.cos(a) * 17} y2={17 + Math.sin(a) * 17} className="sb-dial-tick" />;
  };
  return (
    <span className="sb-dial" role="img" aria-label={`Bomb: ${Math.ceil(fuse)} s left`}>
    <svg viewBox="0 0 34 34" width="30" height="30" aria-hidden>
      <defs>
        <pattern id="sb-late" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="3" fill="var(--bad)" /><rect width="1.4" height="3" fill="#0a0c10" />
        </pattern>
      </defs>
      <circle cx="17" cy="17" r="15" className="sb-dial-track" />
      <circle cx="17" cy="17" r="15" className="sb-dial-fuse" pathLength={1} strokeDasharray={`${fuse / BOMB_SECONDS} 1`} transform="rotate(-90 17 17)" />
      {tick(10)}{tick(5)}
      {defuse && <circle cx="17" cy="17" r="10.5" className="sb-dial-defuse" pathLength={1} strokeDasharray={`${defuse.share} 1`} transform="rotate(-90 17 17)"
        stroke={defuse.ok ? 'var(--ct)' : 'url(#sb-late)'} />}
      {defuse?.ok && <path d="M12 17.5l3.2 3.2 6.6-7" className="sb-dial-check" />}
    </svg>
    {!defuse?.ok && <Icon name="bomb" size={13} />}
    </span>
  );
}

/** The rounds along the top: each a chip in the winner's colour with how it ended (an elimination, the bomb, a
 * defuse, the clock), a gap at half-time; rounds ahead stay blank until Reveal all. Click one to go there. */
export function RoundStrip({ data, at, spoilers, onPick }: { data: DemoData; at: number; spoilers: boolean; onPick: (i: number) => void }) {
  const swaps = new Set(sideSwitches(data));
  // how the round ended: from the demo's reason when it has one, else from the plant (bomb down: exploded or defused) and the clock
  const how = (r: { reason: string; winner: string | null; plant: number | null; duration: number }): 'skull' | 'bomb' | 'scissors' | 'timer' => {
    const x = r.reason.toLowerCase().replace(/[^a-z]/g, '');
    if (x) return x.includes('defus') ? 'scissors' : x.includes('exploded') || x.includes('targetbombed') ? 'bomb' : x.includes('saved') || x.includes('time') ? 'timer' : 'skull';
    if (r.plant !== null) return r.winner === 'CT' ? 'scissors' : 'bomb';
    return r.winner === 'CT' && r.duration >= 110 ? 'timer' : 'skull';
  };
  return (
    <ol className="round-strip" aria-label="Rounds">
      {data.rounds.map((r, i) => {
        const shown = spoilers || i < at;
        return (
          <li key={i} className={swaps.has(i) && i > 0 ? 'half' : ''}>
            <button className={`rs-chip ${i === at ? 'on' : ''} ${shown && r.winner ? r.winner.toLowerCase() : ''}`} onClick={() => onPick(i)}
              title={`Round ${r.n}${shown && r.winner ? `: ${r.winner} won${r.reason ? ` (${r.reason.replace(/_/g, ' ')})` : ''}` : ''}`}
              aria-label={`Round ${r.n}${shown && r.winner ? `, ${r.winner} won` : ''}`}>
              {shown && r.winner ? <Icon name={how(r)} size={14} /> : <span className="num">{r.n}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The playback dock: play/pause, restart, speed, the scrub bar (the round's timeline in Review), and the fight settings. */
export function PlaybackBar({ end, recap, round }: { end: number; recap?: Review | null; round?: DemoRound | null }) {
  const s = useStore();
  const review = s.mode === 'review';
  const max = review ? Math.ceil(end) : Math.max(60, Math.ceil(end));
  // the end of the match's last round: the recap is the next step
  const lastRoundOver = review && !!s.review && s.review.round === s.review.data.rounds.length - 1 && s.time >= end - 0.2;
  return (
    <div className="playbar">
      {lastRoundOver && <a className="cta primary small-btn recap-next" href="/cs2/report"><Icon name="star" size={13} /> Recap</a>}
      <button className={`play-main ${s.playing ? 'on' : ''}`} title="Play / pause (Space)" onClick={() => {
        if (!s.playing && s.time >= end - 0.05) s.setTime(s.judging?.from ?? 0);
        s.setPlaying(!s.playing);
      }}><Icon name={s.playing ? 'pause' : 'play'} /><span> {s.playing ? 'Pause' : 'Play'}</span></button>
      <select value={s.speed} onChange={e => s.setSpeed(+e.target.value)} title="Playback speed" aria-label="Playback speed">
        <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
      </select>
      {review && recap && round
        ? <Timeline end={end} recap={recap} round={round} time={s.time} spoilers={s.reviewSpoilers} onSeek={t => { s.setPlaying(false); s.setTime(t); }} />
        : <input className="playbar-range" type="range" min={0} max={max} step={0.1} value={Math.min(s.time, max)}
            title="Seconds after freeze time"
            onChange={e => { s.setPlaying(false); s.setTime(+e.target.value); }} />}
      {review && <ReviewOptions />}
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
  const bombEnd = plant !== null ? (round.bomb ?? []).find(e => (e.kind === 'defuse' || e.kind === 'explode') && e.t <= until) ?? null : null;
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
      {bombEnd && <span className={`tl-bomb end ${bombEnd.kind}`} style={{ left: pct(bombEnd.t) }} title={bombEnd.kind === 'defuse' ? `Defused with ${Math.max(0, Math.round(BOMB_SECONDS - (bombEnd.t - plant!)))} s left` : 'Bomb exploded'}>
        <Icon name={bombEnd.kind === 'defuse' ? 'scissors' : 'burst'} size={12} /></span>}
      {moves.map((m, i) => {
        const g = moveLook(m);
        // the same marks as on the map, for every move that's evaluated: book moves as small dots
        return (
          <button key={`m${i}`} tabIndex={-1} className={`${m.note === 'book' ? 'tl-dot' : 'tl-mark'}${(m.note === '!!' || m.note === '??') && time >= m.t && time - m.t < 0.8 ? ' tl-hit' : ''}`} style={{ left: pct(m.t), background: m.note === 'book' ? g.color : 'none' }}
            title={`${g.label} · ${m.title}`}
            onPointerDown={e => { e.stopPropagation(); onSeek(m.t + 0.1); }}>{m.note !== 'book' && <MarkFace note={m.note} size={15} title={`${g.label} · ${m.title}`} />}</button>
        );
      })}
      <i className="tl-head" style={{ left: pct(time) }} />
    </div>
  );
}

/**
 * Review's settings in one menu over the playbar: whose moves are graded, the coach's cards (and slow motion while
 * reading them), the engine's arrows, rage mode, and what the marks mean.
 */
function ReviewOptions() {
  const s = useStore();
  const toggle = (on: boolean, set: (v: boolean) => void, icon: Parameters<typeof Icon>[0]['name'], label: string, tip: string, cls = '') => (
    <button className={`opt-row ${cls} ${on ? 'on' : ''}`} onClick={() => set(!on)} aria-pressed={on} title={tip}>
      <Icon name={icon} /><span>{label}</span><i className="opt-switch" />
    </button>
  );
  return (
    <details className="pb-options">
      <summary title="Review settings"><Icon name="gear" /><span className="pb-label">Options</span></summary>
      <div className="pb-options-pop">
        <div className="opt-head">Graded moves</div>
        <EvalToggle />
        {toggle(s.popups, s.setPopups, 'chat', 'Coach cards', 'A card with the grade and comments for each graded move')}
        {s.popups && toggle(s.readSlow, s.setReadSlow, 'slow', 'Slow while reading', 'Slow motion while a card is open')}
        {toggle(s.engineLines, s.setEngineLines, 'route', 'Arrows', "The coach's best option against what was done, and a line from each card to its player")}
        {siteConfig().flags.rage && toggle(s.rage !== 'off', on => s.setRage(on ? 'full' : 'off'), 'bolt', 'Rage mode', 'The coach swears at your plays (18+, strong language)', 'rage')}
        <div className="opt-head">Map</div>
        {toggle(s.autoCam, s.setAutoCam, 'target', 'Auto zoom', 'The map zooms in when everyone is on one part of it; off shows the whole map')}
        <div className="opt-head">What the marks mean</div>
        <NoteKeyRows />
      </div>
    </details>
  );
}

/** What the grade marks mean (on the map, the timeline, the killfeed and the cards). */
/** `tips` / `foot`: another game's wording (Deadlock's board). */
export function NoteKeyRows({ tips, foot }: { tips?: Partial<Record<Annotation, string>>; foot?: string } = {}) {
  return (
    <div className="note-key-rows">
        {(Object.keys(NOTE_INFO) as Annotation[]).map(a => (
          <div key={a} className="note-key-row">
            <NoteMark m={{ note: a, kind: 'kill' }} />
            <span><b>{NOTE_INFO[a].label}</b> <span className="muted">{tips?.[a] ?? NOTE_INFO[a].tip}</span></span>
          </div>
        ))}
        <p className="muted">{foot ?? 'The % on a card is how much the move changed its team\'s chance to win the round.'}</p>
    </div>
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
