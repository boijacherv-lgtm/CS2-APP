import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { simStateAt, type Simulation } from '../engine/combat';
import { moveLook, NoteMark } from './NoteMark';
import { gunFromName } from '../engine/guns';
import { calloutAt, NOTE_INFO, moveKey, readMs, TAG_INFO, type DemoRound, type Move, type Review } from '../engine/recap';
import { useStore, whoAmI } from '../store';
import { rageLine } from '../engine/rage';
import { GameIcon, Icon } from './Icon';
import { IMPACT_ICON, isImpactWeapon, KillIcon, killMods } from './KillIcons';
import { VerdictBar } from './Verdict';
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
  // the map labels the places this card names, even the detailed callouts it doesn't show at this zoom
  useEffect(() => {
    useStore.setState({ cardText: card ? [card.title, ...(card.why ?? [])].join(' ') : null });
    return () => useStore.setState({ cardText: null });
  }, [cardKey]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // the reasons, on demand: open for this card only (a new card starts closed again)
  const [openKey, setOpenKey] = useState('');
  const open = !!card && openKey === cardKey;
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpenKey(''); return; }
    setOpenKey(cardKey);
    if (playing) stop(); // reading the reasons: hold the replay here until Continue
  };

  // with the arrows on (a debugging view): a line from the card to the player it's about
  const arrows = useStore(st => st.engineLines), rage = useStore(st => st.rage);
  const anchorEl = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchorEl.current, board = boardRef.current;
    if (!arrows || !el || !board) { setAnchor(null); return; }
    const r = el.getBoundingClientRect(), b = board.getBoundingClientRect();
    setAnchor({ x: r.right - b.left, y: r.top - b.top + 18 });
  }, [cardKey, boardRef, arrows]);
  // the card's player is always ringed in the grade's colour; the arrows add the line to it
  const who = card ? simStateAt(sim, card.player, time) : null;
  const px = who ? view.x + who.pos.x * view.scale : 0, py = who ? view.y + who.pos.y * view.scale : 0;
  // the token's size on screen (as Board draws it), so the ring hugs it at any zoom
  const ringR = Math.max(7.5, Math.min(11, 1024 * view.scale * 0.016)) * (14.6 / 11) + 6;

  if (!card) return null;
  const g = moveLook(card);
  return (
    <>
      {who && (
        <svg className="feed-link" aria-hidden>
          {arrows && anchor && <line x1={anchor.x} y1={anchor.y} x2={px} y2={py} stroke={g.color} strokeWidth={1.5} strokeDasharray="4 3" />}
          {/* one glowing ring in the grade's colour just outside the token's health bezel, and a pulse in the same colour */}
          <circle key={cardKey} className="feed-ring" cx={px} cy={py} r={ringR} fill="none" stroke={g.color} strokeWidth={2}
            style={{ filter: `drop-shadow(0 0 4px ${g.color}) drop-shadow(0 0 1px #000)` }} />
          <circle className="feed-ring-pulse" cx={px} cy={py} r={ringR} fill="none" stroke={g.color} strokeWidth={1.5} />
        </svg>
      )}
      <div className={`feed-card ${reading && !held ? 'reading' : ''} ${open ? 'open' : ''}`} key={cardKey} ref={anchorEl} style={{ borderColor: g.color }}
        onClick={skip} title={reading && !held ? 'Click for the next move' : undefined}>
        <div className="feed-card-head">
          <button className="feed-mark-btn" onClick={toggle} aria-expanded={open} disabled={!card.why.length}
            title={card.why.length ? (open ? 'Hide the reasons' : 'Why? Show the reasons (pauses the replay)') : undefined}>
            <NoteMark m={card} className="feed-mark" size={14} />
            {card.why.length > 0 && <Icon name="chevronDown" size={10} className="feed-mark-caret" />}
          </button>
          <div className="feed-who"><b style={{ color: g.color }}>{g.label}</b><span className={card.side === 'CT' ? 'ct' : 't'}>{names[card.player] ?? ''}</span></div>
          <span className={`feed-gain ${Math.round(card.gain * 100) > 0 ? 'up' : Math.round(card.gain * 100) < 0 ? 'down' : 'flat'}`} title="Change in their team's win chance">
            {signedPct(card.gain)}
          </span>
          {!playing && <button className="ghost feed-x" onClick={e => { e.stopPropagation(); setClosedAt({ key: cardKey, t: time }); }} title="Close" aria-label="Close"><Icon name="close" /></button>}
        </div>
        <div className="feed-title">{brief(card.title)}</div>
        {rage && rageLine(card) && <div className="feed-rage">{rageLine(card)}</div>}
        {card.tags.length > 0 && (
          <div className="feed-tags">
            {card.tags.map(t => <span key={t} className="tag" title={TAG_INFO[t].tip} style={{ color: TAG_INFO[t].color, borderColor: TAG_INFO[t].color }}>{t}</span>)}
          </div>
        )}
        {open && <ul className="feed-why">{card.why.map((w, i) => <li key={i}>{brief(w)}</li>)}</ul>}
        {open && <div onClick={e => e.stopPropagation()}><VerdictBar m={card} /></div>}
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
  const me = useStore(whoAmI);
  const { shown } = useShown();
  const sideOf = (id: string) => round.frames.players[id]?.side;
  const rows = round.kills.filter(k => k.t <= time + 0.01 && time - k.t < KILL_SECS).slice(-KILL_ROWS);
  if (!rows.length) return null;
  const moveOf = (kind: 'kill' | 'death', id: string, t: number) => recap.moves.find(m => m.kind === kind && m.player === id && Math.abs(m.t - t) < 0.06);
  // like a chess score sheet: only annotated moves carry a mark (book kills and deaths stay plain)
  const chip = (m: Move | undefined) => m && shown(m) && m.note !== 'book'
    ? <NoteMark m={m} className="kf-mark" title={`${NOTE_INFO[m.note].label}: ${signedPct(m.gain)} win chance`} />
    : null;
  const who = (id: string) => <b className={sideOf(id) === 'CT' ? 'ct' : 't'} title={names[id]}>{names[id] ?? '?'}</b>;
  return (
    <div className="killfeed" role="log" aria-label="Kills">
      {rows.map((k, i) => {
        const kill = k.attacker && k.attacker !== k.victim && sideOf(k.attacker) ? moveOf('kill', k.attacker, k.t) : undefined;
        const death = moveOf('death', k.victim, k.t);
        const open = kill ?? death;
        // a smoke, flash or decoy that hit them directly: CS2's impact pictogram
        const impact = isImpactWeapon(k.weapon);
        const gun = impact ? `${weaponLabel(k.weapon)} (direct hit)` : weaponLabel(k.weapon), pic = impact ? IMPACT_ICON : weaponIcon(k.weapon);
        const on = !!open && picked?.key === moveKey(open) && Math.abs(picked.t - time) < 0.01;
        const mods = killMods(k);
        const assist = k.assist && k.assist !== k.attacker && names[k.assist] ? k.assist : null;
        // like CS2: your own kills get a red frame, your deaths a red frame on a darker row
        const mine = me && (k.attacker === me ? 'me-kill' : k.victim === me ? 'me-death' : '');
        return (
          <div key={`${k.t}-${k.victim}-${i}`} className={`kf-row ${mine || ''} ${on ? 'on' : ''} ${time - k.t < 0.6 ? 'new' : ''}`}
            onClick={() => open && openMove(moveKey(open))} title={open ? 'Open this kill' : undefined}>
            {chip(kill)}
            {mods.includes('blind') && <span className="kf-mod"><KillIcon mod="blind" /></span>}
            {kill ? who(k.attacker) : null}
            {assist && <span className="kf-assist">+{k.flashAssist && <GameIcon src="equipment/flashbang" size={12} title="Flash assist" />}{who(assist)}</span>}
            <span className="kf-gun" title={gun}>{pic ? <GameIcon src={pic} size={16} title={gun} /> : gun}</span>
            {mods.some(m => m !== 'blind') && <span className="kf-mod">{mods.filter(m => m !== 'blind').map(m => <KillIcon key={m} mod={m} />)}</span>}
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
