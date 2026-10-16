import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { simStateAt, type Simulation } from '../engine/combat';
import { gunFromName } from '../engine/guns';
import { calloutAt, GRADE_INFO, isMarked, moveKey, readMs, TAG_INFO, type DemoRound, type Move, type Review } from '../engine/recap';
import { useStore } from '../store';

/**
 * Graded moves in Review, without covering the fight:
 *   kills     the KillFeed (top right, like CS2's): every kill with the killer's letter, and the victim's when the
 *             death cost the team. Click one to open its card.
 *   grenades  a ticker in the bottom-left corner, one line per grenade / flash (up to 3). With "slow down to read" on
 *             they come one at a time and the replay waits in slow motion for each (⏸ stops on it).
 *   paused    the full card for the move (every comment, tags, ‹ › for moves at the same moment), docked bottom left.
 *             The players it's about are highlighted on the map (onFocus) and a line runs to the player.
 */

const FEED_SECS = 5; // a ticker line stays this long (round seconds) after its move
const FEED_LINES = 3;
const isNade = (m: Move) => m.kind === 'utility' || m.kind === 'flash';
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
  const playing = useStore(s => s.playing), readSlow = useStore(s => s.readSlow), held = useStore(s => s.readHold);
  const queueing = readSlow && (playing || held);
  // moves already read in the reading queue; forgotten when you go back in time or change round
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const lastTime = useRef(time);
  useEffect(() => {
    if (time < lastTime.current - 0.05) setRead(new Set());
    lastTime.current = time;
  }, [time]);
  useEffect(() => setRead(new Set()), [recap]);
  const [page, setPage] = useState(0);
  // the reading queue is for grenades (kills are in the killfeed); paused, any move at the current moment
  const nades = useMemo(() => recap.moves.filter(isNade), [recap]);
  const { pending, backlog } = calloutAt(nades, time, queueing, read, 0);
  const { move: atMove, group } = calloutAt(recap.moves, time, false, read, page);
  const groupKey = group.map(moveKey).join('|');
  useEffect(() => setPage(group.length - 1), [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // a move picked from the ticker or the killfeed, or a card you closed: holds until the replay moves on
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

  // the ticker: recent moves, never past the one being read
  const pendingAt = pending ? nades.indexOf(pending) : Infinity;
  const lines = nades.filter((m, i) => isMarked(m) && m.t <= time && time - m.t < FEED_SECS && i <= pendingAt).slice(-FEED_LINES);

  // the card: paused, or stopped on a move to read it
  // the card only when you ask for it: a move you clicked, ⏸ on a grenade, or a moment you stepped to with ◀ ▶
  // (which lands just after it); pausing anywhere else leaves the map clear
  const stepped = atMove && Math.abs(time - (atMove.t + 0.1)) < 0.06 ? atMove : undefined;
  const cardMove = !playing
    ? (picked ? recap.moves.find(m => moveKey(m) === picked) : held && pending ? pending : stepped)
    : undefined;
  const card = cardMove && moveKey(cardMove) !== closed ? cardMove : undefined;
  const active = card ?? pending ?? (playing ? lines.at(-1) : undefined);
  const activeKey = active ? moveKey(active) : '';

  // highlight who the open card is about
  useEffect(() => {
    onFocus(card ? involvedIn(card, sim, round) : null);
    return () => onFocus(null);
  }, [card ? moveKey(card) : '']); // eslint-disable-line react-hooks/exhaustive-deps

  // the line from the card / ticker line to the player
  const anchorEl = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchorEl.current, board = boardRef.current;
    if (!el || !board) { setAnchor(null); return; }
    const r = el.getBoundingClientRect(), b = board.getBoundingClientRect();
    setAnchor({ x: r.right - b.left, y: r.top - b.top + Math.min(r.height / 2, 16) });
  }, [activeKey, !!card, lines.length, boardRef]);
  const who = active && simStateAt(sim, active.player, time);
  const px = who ? view.x + who.pos.x * view.scale : 0, py = who ? view.y + who.pos.y * view.scale : 0;

  if (!lines.length && !card) return null;
  const g = active ? GRADE_INFO[active.grade] : null;
  const name = (m: Move) => <span className={m.side === 'CT' ? 'ct' : 't'}>{names[m.player] ?? ''}</span>;
  const gain = (m: Move) => (
    <span className={`feed-gain ${m.gain >= 0 ? 'up' : 'down'}`} title="Change in their team's win chance">
      {m.gain >= 0 ? '+' : '−'}{Math.abs(Math.round(m.gain * 100))}%
    </span>
  );
  return (
    <>
      {who && anchor && g && (
        <svg className="feed-link" aria-hidden>
          <line x1={anchor.x} y1={anchor.y} x2={px} y2={py} stroke={g.color} strokeWidth={1.5} strokeDasharray="4 3" />
          <circle cx={px} cy={py} r={15} fill="none" stroke={g.color} strokeWidth={2} />
        </svg>
      )}
      {card ? (
        <div className="feed-card" ref={anchorEl} style={{ borderColor: GRADE_INFO[card.grade].color }}>
          <div className="feed-card-head">
            <span className="feed-mark" style={{ background: GRADE_INFO[card.grade].color }}>{GRADE_INFO[card.grade].mark}</span>
            <div className="feed-who"><b style={{ color: GRADE_INFO[card.grade].color }}>{GRADE_INFO[card.grade].label}</b>{name(card)}</div>
            {gain(card)}
            <button className="ghost feed-x" onClick={() => setClosedAt({ key: moveKey(card), t: time })} title="Close" aria-label="Close">✕</button>
          </div>
          <div className="feed-title">{card.title}</div>
          {card.tags.length > 0 && (
            <div className="feed-tags">
              {card.tags.map(t => <span key={t} className="tag" title={TAG_INFO[t].tip} style={{ color: TAG_INFO[t].color, borderColor: TAG_INFO[t].color }}>{t}</span>)}
            </div>
          )}
          {card.why.length > 0 && <ul>{card.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="feed-card-foot">
            {!picked && !held && group.length > 1 && (
              <span className="feed-pager">
                <button onClick={() => setPage((page + group.length - 1) % group.length)} aria-label="Previous move at this moment">‹</button>
                {Math.min(page, group.length - 1) + 1} of {group.length} at this moment
                <button onClick={() => setPage((page + 1) % group.length)} aria-label="Next move at this moment">›</button>
              </span>
            )}
            {held && <button className="primary" onClick={resume} title="Carry on (Space)">▶ Continue</button>}
          </div>
        </div>
      ) : (
        <div className="feed" role="log" aria-label="Graded moves">
          {lines.map(m => {
            const k = moveKey(m), gi = GRADE_INFO[m.grade], reading = !!pending && k === pendingKey;
            return (
              <div key={k} ref={k === activeKey ? anchorEl : undefined} className={`feed-line ${reading ? 'reading' : ''}`}
                onClick={() => openMove(k)} title="Open this move">
                <span className="feed-mark" style={{ background: gi.color }}>{gi.mark}</span>
                {name(m)}
                <span className="feed-line-title">{m.title.replace(names[m.player] ?? '\u0000', '').replace(/^[: ]+/, '')}</span>
                {gain(m)}
                {reading && (
                  <button className="feed-stop" onClick={e => { e.stopPropagation(); stop(); }} title="Stop the replay on this move to read it">⏸</button>
                )}
                {reading && readFor > 0 && <i key={k} className="feed-read" style={{ animationDuration: `${readFor}ms`, background: gi.color }} />}
              </div>
            );
          })}
        </div>
      )}
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
 * The killer's letter sits in front (not for a neutral C), the victim's after their name when the death cost the
 * team. Click a row for the full card.
 */
export function KillFeed({ recap, round, time, names }: { recap: Review; round: DemoRound; time: number; names: Record<string, string> }) {
  const picked = useStore(s => s.feedPick);
  const sideOf = (id: string) => round.frames.players[id]?.side;
  const rows = round.kills.filter(k => k.t <= time + 0.01 && time - k.t < KILL_SECS).slice(-KILL_ROWS);
  if (!rows.length) return null;
  const moveOf = (kind: 'kill' | 'death', id: string, t: number) => recap.moves.find(m => m.kind === kind && m.player === id && Math.abs(m.t - t) < 0.06);
  const chip = (m: Move | undefined) => m && isMarked(m)
    ? <span className="kf-mark" style={{ background: GRADE_INFO[m.grade].color }} title={`${GRADE_INFO[m.grade].label}: ${m.gain >= 0 ? '+' : '−'}${Math.abs(Math.round(m.gain * 100))}% win chance`}>{GRADE_INFO[m.grade].mark}</span>
    : null;
  const who = (id: string) => <b className={sideOf(id) === 'CT' ? 'ct' : 't'}>{names[id] ?? '?'}</b>;
  return (
    <div className="killfeed" role="log" aria-label="Kills">
      {rows.map((k, i) => {
        const kill = k.attacker && k.attacker !== k.victim && sideOf(k.attacker) ? moveOf('kill', k.attacker, k.t) : undefined;
        const death = moveOf('death', k.victim, k.t);
        const open = kill ?? death;
        const gun = weaponLabel(k.weapon);
        const on = !!open && picked?.key === moveKey(open) && Math.abs(picked.t - time) < 0.01;
        return (
          <div key={`${k.t}-${k.victim}-${i}`} className={`kf-row ${on ? 'on' : ''} ${time - k.t < 0.6 ? 'new' : ''}`}
            onClick={() => open && openMove(moveKey(open))} title={open ? 'Open this kill' : undefined}>
            {chip(kill)}
            {kill ? who(k.attacker) : null}
            <span className="kf-gun">{gun}{k.headshot && <i className="kf-hs" title="Headshot">⌖</i>}</span>
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
