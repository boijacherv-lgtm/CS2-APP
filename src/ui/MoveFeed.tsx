import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { simStateAt, type Simulation } from '../engine/combat';
import { gunFromName } from '../engine/guns';
import { calloutAt, GRADE_INFO, moveKey, readMs, TAG_INFO, type DemoRound, type Move, type Review } from '../engine/recap';
import { useStore } from '../store';
import { GameIcon, Icon } from './Icon';
import { CS2_ICONS, type Cs2Icon } from './cs2Icons';
import { useShown } from './shown';

/**
 * Evaluated moves in Review (which ones: every move, or only yours; see ./shown):
 *   kills     the KillFeed (top right, like CS2's): every kill, with the killer's and the victim's letter. Click one
 *             to open its card.
 *   playing   each move's card opens by itself, bottom left, one at a time and in order. With slow motion on, the replay goes
 *             into slow motion until it's read (Stop to read stops on it, clicking the card skips to the next); with it off the
 *             replay doesn't wait and the card shows the latest move.
 *   paused    the card for a move you clicked, a moment you stepped to with ◀ ▶, or the one you stopped on.
 * The players a card is about are highlighted on the map (onFocus) and a line runs to the player.
 */

const KILL_SECS = 6; // a killfeed row stays this long (round seconds), like CS2's
const KILL_ROWS = 6;

/** Who a move is about: the player, and whoever they killed, blinded or hurt with it. */
export function involvedIn(m: Move, sim: Simulation, round: DemoRound): string[] {
  const ids = new Set([m.player]);
  if (m.kind === 'kill') {
    const k = sim.kills.find(x => x.killer === m.player && Math.abs(x.t - m.t) < 0.06);
    if (k) ids.add(k.victim);
  }
  if (m.util) for (const e of sim.utilEvents) if (e.src === m.util && e.kind === 'blind') ids.add(e.id);
  if (m.kind === 'utility')
    for (const d of round.nadeDamage ?? []) if (d.attacker === m.player && d.t >= m.t - 0.1 && d.t <= m.t + 8 && d.dmg > 0) ids.add(d.victim);
  return [...ids];
}

export function MoveFeed({ recap, sim, round, time, view, boardRef, names, onFocus }: {
  recap: Review; sim: Simulation; round: DemoRound; time: number; view: { scale: number; x: number; y: number };
  boardRef: React.RefObject<HTMLDivElement>; names: Record<string, string>; onFocus: (ids: string[] | null) => void;
}) {
  const { shown } = useShown();
  const playing = useStore(s => s.playing), readSlow = useStore(s => s.readSlow), held = useStore(s => s.readHold);
  const queueing = readSlow && (playing || held);
  // moves already read in the reading queue; forgotten when you go back in time or change round
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const lastTime = useRef(time);
  useEffect(() => {
    if (time < lastTime.current - 0.05) setRead(new Set());
    lastTime.current = time;
  }, [time]);
  useEffect(() => setRead(new Set()), [recap, shown]);
  const [page, setPage] = useState(0);
  const { pending, backlog } = calloutAt(recap.moves, time, queueing, read, 0, shown);
  const { move: atMove, group } = calloutAt(recap.moves, time, false, read, page, shown);
  const groupKey = group.map(moveKey).join('|');
  useEffect(() => setPage(group.length - 1), [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // a move picked from the killfeed or the move list, or a card you closed: holds until the replay moves on
  const pickedAt = useStore(s => s.feedPick);
  const [closedAt, setClosedAt] = useState<{ key: string; t: number } | null>(null);
  const picked = pickedAt && Math.abs(pickedAt.t - time) < 0.01 ? pickedAt.key : null;
  const closed = closedAt && Math.abs(closedAt.t - time) < 0.01 ? closedAt.key : null;

  // the reading queue: slow down for the move being read, then mark it read so the next one comes up
  const pendingKey = pending ? moveKey(pending) : '';
  const [readFor, setReadFor] = useState(0);
  useEffect(() => {
    if (!pending || held) { useStore.setState({ slowUntil: 0 }); return; }
    const ms = readMs(pending);
    setReadFor(ms);
    useStore.setState({ slowUntil: performance.now() + ms, slowSpeed: backlog ? 0.12 : 0.3 });
    const t = setTimeout(() => setRead(r => new Set(r).add(pendingKey)), ms);
    return () => clearTimeout(t);
    // only when a different move comes up, or you stop / carry on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, held]);
  const stop = () => useStore.setState({ playing: false, readHold: true });
  const resume = () => { setRead(r => new Set(r).add(pendingKey)); useStore.getState().setPlaying(true); };
  const skip = () => { if (pending && !held) setRead(r => new Set(r).add(pendingKey)); };

  // which card: playing, the move being read (or the latest one); paused, only what you asked for
  const stepped = atMove && Math.abs(time - (atMove.t + 0.1)) < 0.06 ? atMove : undefined;
  const cardMove = playing
    ? pending ?? atMove
    : picked ? recap.moves.find(m => moveKey(m) === picked) : held && pending ? pending : stepped;
  const card = cardMove && moveKey(cardMove) !== closed ? cardMove : undefined;
  const cardKey = card ? moveKey(card) : '';
  // pausing keeps the card you were reading open (it becomes the picked move until the replay moves on)
  // (not when you jumped elsewhere: seeking or ◀ ▶ also stop playback)
  const lastPlaying = useRef({ key: '', t: 0 });
  if (playing) lastPlaying.current = { key: cardKey, t: time };
  useEffect(() => {
    const st = useStore.getState(), was = lastPlaying.current;
    if (playing || st.readHold || !was.key || Math.abs(st.time - was.t) > 0.3) return;
    useStore.setState({ feedPick: { key: was.key, t: st.time } });
  }, [playing]);
  const reading = !!card && !!pending && cardKey === pendingKey;

  // highlight who the card is about while you're looking at it (paused or stopped)
  const focusKey = card && !playing ? cardKey : '';
  useEffect(() => {
    onFocus(focusKey && card ? involvedIn(card, sim, round) : null);
    return () => onFocus(null);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the line from the card to the player
  const anchorEl = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchorEl.current, board = boardRef.current;
    if (!el || !board) { setAnchor(null); return; }
    const r = el.getBoundingClientRect(), b = board.getBoundingClientRect();
    setAnchor({ x: r.right - b.left, y: r.top - b.top + 18 });
  }, [cardKey, boardRef]);
  const who = card && simStateAt(sim, card.player, time);
  const px = who ? view.x + who.pos.x * view.scale : 0, py = who ? view.y + who.pos.y * view.scale : 0;

  if (!card) return null;
  const g = GRADE_INFO[card.grade];
  return (
    <>
      {who && anchor && (
        <svg className="feed-link" aria-hidden>
          <line x1={anchor.x} y1={anchor.y} x2={px} y2={py} stroke={g.color} strokeWidth={1.5} strokeDasharray="4 3" />
          <circle cx={px} cy={py} r={15} fill="none" stroke={g.color} strokeWidth={2} />
        </svg>
      )}
      <div className={`feed-card ${reading && !held ? 'reading' : ''}`} key={cardKey} ref={anchorEl} style={{ borderColor: g.color }}
        onClick={skip} title={reading && !held ? 'Click for the next move' : undefined}>
        <div className="feed-card-head">
          <span className="feed-mark" style={{ background: g.color }}>{g.mark}</span>
          <div className="feed-who"><b style={{ color: g.color }}>{g.label}</b><span className={card.side === 'CT' ? 'ct' : 't'}>{names[card.player] ?? ''}</span></div>
          <span className={`feed-gain ${Math.round(card.gain * 100) > 0 ? 'up' : Math.round(card.gain * 100) < 0 ? 'down' : 'flat'}`} title="Change in their team's win chance">
            {signedPct(card.gain)}
          </span>
          {!playing && <button className="ghost feed-x" onClick={e => { e.stopPropagation(); setClosedAt({ key: cardKey, t: time }); }} title="Close" aria-label="Close"><Icon name="close" /></button>}
        </div>
        <div className="feed-title">{brief(card.title)}</div>
        {card.tags.length > 0 && (
          <div className="feed-tags">
            {card.tags.map(t => <span key={t} className="tag" title={TAG_INFO[t].tip} style={{ color: TAG_INFO[t].color, borderColor: TAG_INFO[t].color }}>{t}</span>)}
          </div>
        )}
        {card.why.length > 0 && <ul>{card.why.map((w, i) => <li key={i}>{brief(w)}</li>)}</ul>}
        <div className="feed-card-foot" onClick={e => e.stopPropagation()}>
          {!playing && !picked && !held && group.length > 1 && (
            <span className="feed-pager">
              <button onClick={() => setPage((page + group.length - 1) % group.length)} aria-label="Previous move at this moment">‹</button>
              {Math.min(page, group.length - 1) + 1} of {group.length} at this moment
              <button onClick={() => setPage((page + 1) % group.length)} aria-label="Next move at this moment">›</button>
            </span>
          )}
          {reading && !held && <button className="feed-stop" onClick={stop} title="Stop the replay on this move to read it"><Icon name="pause" size={12} /> Stop to read</button>}
          {reading && !held && <span className="muted">slow motion · click the card to skip</span>}
          {held && <button className="primary" onClick={resume} title="Carry on (Space)"><Icon name="play" size={12} /> Continue</button>}
        </div>
        {reading && !held && readFor > 0 && <i key={`r${cardKey}`} className="feed-read" style={{ animationDuration: `${readFor}ms`, background: g.color }} />}
      </div>
    </>
  );
}

/** Opens a move's card: pauses on the current time and shows that move. */
function openMove(key: string) {
  const st = useStore.getState();
  st.setPlaying(false);
  useStore.setState({ feedPick: { key, t: st.time } });
}

/**
 * The killfeed, top right like in CS2: killer → weapon → victim, newest at the bottom, each row for a few seconds.
 * The killer's letter sits in front and the victim's after their name (for the moves being evaluated: every move,
 * or only yours). Click a row for the full card.
 */
export function KillFeed({ recap, round, time, names }: { recap: Review; round: DemoRound; time: number; names: Record<string, string> }) {
  const picked = useStore(s => s.feedPick);
  const { shown } = useShown();
  const sideOf = (id: string) => round.frames.players[id]?.side;
  const rows = round.kills.filter(k => k.t <= time + 0.01 && time - k.t < KILL_SECS).slice(-KILL_ROWS);
  if (!rows.length) return null;
  const moveOf = (kind: 'kill' | 'death', id: string, t: number) => recap.moves.find(m => m.kind === kind && m.player === id && Math.abs(m.t - t) < 0.06);
  const chip = (m: Move | undefined) => m && shown(m)
    ? <span className="kf-mark" style={{ background: GRADE_INFO[m.grade].color }} title={`${GRADE_INFO[m.grade].label}: ${signedPct(m.gain)} win chance`}>{GRADE_INFO[m.grade].mark}</span>
    : null;
  const who = (id: string) => <b className={sideOf(id) === 'CT' ? 'ct' : 't'}>{names[id] ?? '?'}</b>;
  return (
    <div className="killfeed" role="log" aria-label="Kills">
      {rows.map((k, i) => {
        const kill = k.attacker && k.attacker !== k.victim && sideOf(k.attacker) ? moveOf('kill', k.attacker, k.t) : undefined;
        const death = moveOf('death', k.victim, k.t);
        const open = kill ?? death;
        const gun = weaponLabel(k.weapon), pic = weaponIcon(k.weapon);
        const on = !!open && picked?.key === moveKey(open) && Math.abs(picked.t - time) < 0.01;
        return (
          <div key={`${k.t}-${k.victim}-${i}`} className={`kf-row ${on ? 'on' : ''} ${time - k.t < 0.6 ? 'new' : ''}`}
            onClick={() => open && openMove(moveKey(open))} title={open ? 'Open this kill' : undefined}>
            {chip(kill)}
            {kill ? who(k.attacker) : null}
            <span className="kf-gun" title={gun}>{pic ? <GameIcon src={pic} size={15} title={gun} /> : gun}{k.headshot && <Icon name="crosshair" size={14} title="Headshot" className="kf-hs" />}</span>
            {who(k.victim)}
            {chip(death)}
          </div>
        );
      })}
    </div>
  );
}

/** Weapon name for the killfeed: the gun's short name, or what the grenade / knife / bomb was. */
function weaponLabel(w: string): string {
  const n = w.toLowerCase().replace(/^weapon_/, '');
  if (n.includes('hegrenade')) return 'HE';
  if (/inferno|molotov|incgrenade/.test(n)) return 'Fire';
  if (n.includes('flashbang')) return 'Flash';
  if (n.includes('smokegrenade')) return 'Smoke';
  if (/knife|bayonet/.test(n)) return 'Knife';
  if (/c4|planted/.test(n)) return 'Bomb';
  if (n === 'world' || n === 'trigger_hurt') return 'Fall';
  return gunFromName(w)?.short ?? n.replace(/_/g, ' ');
}

/** CS2's killfeed pictogram for a weapon from the demo (weapon_ak47, m4a1_silencer, hegrenade, inferno, knife_t…). */
function weaponIcon(w: string): Cs2Icon | null {
  let n = w.toLowerCase().replace(/^weapon_/, '');
  if (/^knife|bayonet/.test(n)) n = n === 'bayonet' ? 'bayonet' : n === 'knife_t' ? 'knife_t' : 'knife';
  if (n === 'molotov' || n === 'incgrenade' || n === 'inferno') n = 'inferno';
  if (n === 'usp_silencer_off') n = 'usp_silencer';
  if (n === 'm4a1_silencer_off') n = 'm4a1_silencer';
  if (n === 'planted_c4' || n === 'c4') n = 'planted_c4';
  const key = `equipment/${n}` as Cs2Icon;
  return key in CS2_ICONS ? key : null;
}

/** A win-chance change as shown: +12%, −3%, or 0% (never "−0%"). */
function signedPct(gain: number) {
  const p = Math.round(gain * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}

/** The pop-up's short form: drops every "(...)" aside, e.g. "(from Jungle, 14 m)" or "(headshot)". */
export const brief = (s: string) => s.replace(/\s*\([^()]*\)/g, '').trim();
