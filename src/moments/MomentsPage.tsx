import { useEffect, useMemo, useRef, useState } from 'react';
import { calloutsOf, MAPS, radarOf } from '../map/catalog';
import { useStore } from '../store';
import { DL_MAP_IMAGE } from '../deadlock/data';
import { SEARCH_COLOR } from '../deadlock/search';
import { applyGame } from '../ui/tokens';
import { Icon } from '../ui/Icon';
import { cleanMoment, focusOf, fromShareCode, isMistake, loadMoments, mistakeGroups, shareCode, type Moment, type MomentGame } from './moments';
import { dailyFor, dailyOf, dayNumber, puzzleRating, readScore, record, recordDaily, recordRush, weakSpots, type Score } from './score';
import { loadBoard, loadFriendsBoard, sendAnswer, syncRecord, type BoardRow } from './puzzleApi';
import { useProfile } from '../ui/profileApi';
import { EmptyArt } from '../ui/Art';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const GAME_NAME: Record<MomentGame, string> = { cs2: 'CS2', deadlock: 'Deadlock' };
const imageOf = (m: Moment) => (m.game === 'deadlock' ? DL_MAP_IMAGE : MAPS.find(x => x.id === m.map)?.levels[0].image ?? null);

/** The moment on its map: your team's dots, theirs, you ringed. */
export function MomentMap({ m, size = 260 }: { m: Moment; size?: number }) {
  const img = imageOf(m);
  return (
    <svg className="moment-map" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${m.match}, ${m.when}: ${m.dots.length} players on the map`}>
      <rect width="100" height="100" rx="4" fill="var(--bg-1)" />
      {img && <image href={img} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" opacity={0.85} />}
      {m.dots.filter(d => !d.me).map((d, i) => <circle key={i} cx={d.x * 100} cy={d.y * 100} r={1.9} fill={d.team ? 'var(--good)' : 'var(--bad)'} stroke="#000" strokeWidth={0.5} />)}
      {m.dots.filter(d => d.me).map((d, i) => (
        <g key={`me${i}`}>
          <circle cx={d.x * 100} cy={d.y * 100} r={4.4} fill="none" stroke="var(--theme)" strokeWidth={1.1} />
          <circle cx={d.x * 100} cy={d.y * 100} r={2.3} fill="var(--theme)" stroke="#000" strokeWidth={0.5} />
        </g>
      ))}
    </svg>
  );
}

/**
 * The moment's map with its clip: the 10 s before it (play, or drag through it), and once answered the 5 s after too
 * and arrows to where the best move (green) and the real one (red) go. `big` doubles the map.
 */
export function ClipMap({ m, revealed, hover = null }: { m: Moment; revealed: boolean; hover?: number | null }) {
  const img = imageOf(m), clip = m.clip;
  const frames = clip ? clip.dots[0].xy.length / 2 : 0;
  const zero = clip ? -clip.from : 0; // the frame of the moment itself
  const last = revealed ? frames - 1 : zero;
  const [f, setF] = useState(zero); // fractional frame
  const [playing, setPlaying] = useState(false);
  const [big, setBig] = useState(false);
  // callout names (CS2), on by default; remembered
  const [names, setNames] = useState(() => { try { return localStorage.getItem('rageview.calloutNames') !== '0'; } catch { return true; } });
  const toggleNames = () => setNames(v => { try { localStorage.setItem('rageview.calloutNames', v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  const R = m.game === 'cs2' ? radarOf(m.map) : null;
  const labels = R ? calloutsOf(m.map).map(c => ({ name: c.name, x: (c.x / R.sizePx) * 100, y: (c.y / R.sizePx) * 100 })) : [];
  useEffect(() => { setF(zero); setPlaying(false); }, [m.id, zero]);
  useEffect(() => {
    if (!playing) return;
    // a timer, not animation frames (those stop in a hidden or embedded view): real time, 1 s a second
    let prev = Date.now();
    const id = setInterval(() => {
      const now = Date.now(), dt = (now - prev) / 1000; prev = now;
      setF(x => Math.min(last, x + dt));
    }, 40);
    return () => clearInterval(id);
  }, [playing, last]);
  useEffect(() => { if (playing && f >= last) setPlaying(false); }, [playing, f, last]);
  const [watched, setWatched] = useState(false);
  useEffect(() => setWatched(false), [m.id]);
  const play = () => { if (f >= last - 0.01) setF(0); setPlaying(p => !p); setWatched(true); };
  // a dot at frame f: between the two seconds around it; hidden where either is missing
  const at = (xy: number[]) => {
    const i = Math.min(frames - 1, Math.floor(f)), j = Math.min(frames - 1, i + 1), k = f - i;
    const a = [xy[2 * i], xy[2 * i + 1]], b = [xy[2 * j], xy[2 * j + 1]];
    if (a[0] < 0) return null;
    return b[0] < 0 ? { x: a[0], y: a[1] } : { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k };
  };
  const dots = clip ? clip.dots.map(d => ({ ...d, p: at(d.xy) })).filter(d => d.p) as { team: 0 | 1; me?: boolean; p: { x: number; y: number } }[]
    : m.dots.map(d => ({ team: d.team, me: d.me, p: { x: d.x, y: d.y } }));
  const meAt = m.dots.find(d => d.me);
  const arrow = (o: Moment['options'][number] | undefined, color: string, dash?: string) => o?.to && meAt
    ? <line x1={meAt.x * 100} y1={meAt.y * 100} x2={o.to.x * 100} y2={o.to.y * 100} stroke={color} strokeWidth={0.9} strokeDasharray={dash} markerEnd={`url(#ah-${color === 'var(--good)' ? 'g' : color === 'var(--bad)' ? 'r' : 'w'})`} /> : null;
  const sec = Math.round(f - zero);
  const size = big ? 560 : 300;
  return (
    <div className={`clip-map ${big ? 'big' : ''}`} style={{ width: size }}>
      <svg className="moment-map" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${m.match}, ${m.when}: the map${clip ? `, ${sec >= 0 ? '+' : ''}${sec} s` : ''}`}>
        <defs>
          <marker id="ah-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--good)" /></marker>
          <marker id="ah-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--bad)" /></marker>
          <marker id="ah-w" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--text-1)" /></marker>
        </defs>
        {/* Deadlock's map image is dark buildings over clear streets: a light floor under it makes the streets readable */}
        <rect width="100" height="100" rx="4" fill={m.game === 'deadlock' ? '#6b7686' : 'var(--bg-1)'} />
        {img && <image href={img} x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" opacity={m.game === 'deadlock' ? 1 : 0.85} />}
        {/* small labels, and none under the player you are (it would hide both) */}
        {names && labels.filter(c => !meAt || Math.hypot(c.x - meAt.x * 100, c.y - meAt.y * 100) > 5).map(c => <text key={c.name} x={c.x} y={c.y} className="map-callout" textAnchor="middle" fontSize={big ? 1.7 : 2.1}>{c.name}</text>)}
        {!revealed && hover !== null && Math.abs(f - zero) < 0.5 && arrow(m.options[hover], 'var(--text-1)', '1.5 1')}
        {revealed && Math.abs(f - zero) < 0.5 && <>{m.played !== 0 && arrow(m.options[m.played], 'var(--bad)', '2 1.5')}{arrow(m.options[0], 'var(--good)')}</>}
        {dots.filter(d => !d.me).map((d, i) => <circle key={i} cx={d.p.x * 100} cy={d.p.y * 100} r={big ? 1.4 : 1.9} fill={d.team ? 'var(--good)' : 'var(--bad)'} stroke="#000" strokeWidth={0.4} />)}
        {dots.filter(d => d.me).map((d, i) => (
          <g key={`me${i}`}>
            <circle cx={d.p.x * 100} cy={d.p.y * 100} r={big ? 3.4 : 4.4} fill="none" stroke="var(--theme)" strokeWidth={1} />
            <circle cx={d.p.x * 100} cy={d.p.y * 100} r={big ? 1.8 : 2.3} fill="var(--theme)" stroke="#000" strokeWidth={0.4} />
          </g>
        ))}
      </svg>
      <div className="clip-bar">
        {clip && <button className="chip" onClick={play} aria-label={playing ? 'Pause' : 'Play the clip'}><Icon name={playing ? 'pause' : 'play'} size={12} /> {playing ? 'Pause' : revealed && f >= zero - 0.01 && f < last - 0.01 ? 'What happened next' : watched ? 'Replay' : 'Watch 10 s'}</button>}
        {clip && <input type="range" min={0} max={last} step={0.05} value={Math.min(f, last)} onChange={e => { setPlaying(false); setF(Number(e.target.value)); }} aria-label="Time in the clip" />}
        {clip && <span className="num muted small clip-time">{sec === 0 ? 'now' : `${sec > 0 ? '+' : ''}${sec} s`}</span>}
        {labels.length > 0 && <button className="chip" onClick={toggleNames} aria-pressed={names} title="Callout names on the map">{names ? 'Hide names' : 'Names'}</button>}
        <button className="chip" onClick={() => setBig(b => !b)} aria-label={big ? 'Smaller map' : 'Bigger map'} title={big ? 'Smaller map' : 'Bigger map'}><Icon name={big ? 'close' : 'map'} size={12} /> {big ? 'Smaller' : 'Bigger'}</button>
      </div>
    </div>
  );
}

/** A stable shuffle per moment, so the best move isn't always first. */
const order = (m: Moment) => {
  let h = 0; for (const c of m.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return m.options.map((_, i) => i).sort((a, b) => ((a * 7919 + h) % 13) - ((b * 7919 + h) % 13));
};

/** Sound on a right or wrong answer (two short tones, made here: no sound files); off with the speaker button. */
const soundOn = () => { try { return localStorage.getItem('rageview.sound') !== '0'; } catch { return true; } };
function chime(right: boolean) {
  if (!soundOn()) return;
  try {
    const ctx = new AudioContext(), t = ctx.currentTime;
    (right ? [660, 990] : [300, 220]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = right ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.11); g.gain.exponentialRampToValueAtTime(right ? 0.12 : 0.05, t + i * 0.11 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.18);
      o.connect(g).connect(ctx.destination); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* no audio here */ }
}
/** Rage mode's line on a wrong answer (it swears at the move, not at you). */
const RAGE = ['"{x}"? Really?', '"{x}". That\'s how rounds die.', 'Who taught you "{x}"?', '"{x}". Bold. Wrong, but bold.', 'Uninstall "{x}" from your brain.'];

/** One puzzle: the situation, the moves in a shuffled order; pick one and the engine's answer and why show. */
export function Puzzle({ m, onAnswer, shared }: { m: Moment; onAnswer?: (right: boolean) => number | void; shared?: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [crowd, setCrowd] = useState<{ tried: number; right: number } | null>(null);
  const rage = useStore(s => s.rage);
  useEffect(() => { setPicked(null); setDelta(null); setHover(null); setCrowd(null); }, [m.id]);
  const right = picked === 0;
  const pick = (i: number) => {
    if (picked !== null) return;
    setPicked(i); chime(i === 0);
    const d = onAnswer?.(i === 0); if (typeof d === 'number') setDelta(d);
    // everyone's answers to this premade puzzle (yours counted once: only when it counts for your score)
    if (onAnswer) sendAnswer(m.id, i === 0).then(setCrowd);
  };
  const theirs = shared || !!m.who;
  return (
    <div className={`puzzle ${picked === null ? '' : right ? 'won' : 'lost'}`}>
      <ClipMap m={m} revealed={picked !== null} hover={hover} />
      <div className="puzzle-body">
        <span className="muted small">{GAME_NAME[m.game]} · {m.match} · {m.when}{m.who ? ` · ${m.who}` : ''}</span>
        {(m.tag || m.info?.length) && <div className="puzzle-info">{m.tag && <span className="puzzle-tag">{m.tag}</span>}{m.info?.map(x => <span key={x}>{x}</span>)}</div>}
        <p className="puzzle-setup">{m.setup}</p>
        <b>{theirs ? 'What is the best move here?' : 'What should you do here?'}</b>
        <div className="puzzle-options">
          {order(m).map(i => {
            const o = m.options[i];
            const state = picked === null ? '' : i === 0 ? 'best' : i === picked ? 'wrong' : '';
            return (
              <button key={i} className={`puzzle-option ${state}`} onClick={() => pick(i)} disabled={picked !== null && state === ''}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <span>{o.label}</span>
                {picked !== null && <span className="num muted">{Math.round(o.value * 100)}% to win{i === m.played ? (theirs ? ' · what was played' : ' · what you did') : ''}</span>}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <>
            <p className={`puzzle-verdict ${right ? 'up' : 'down'}`}>
              {right ? <b className="puzzle-win">Right.</b> : rage ? <b>{RAGE[m.id.length % RAGE.length].replace('{x}', m.options[picked].label)}</b> : null}{' '}
              {right ? 'That is the engine\'s best move.' : `The engine's best: ${m.options[0].label}.`}{' '}
              {m.played !== 0 && picked === m.played ? <>You picked what was really played: <span style={{ color: SEARCH_COLOR[m.cls] }}>{m.cls === 'Best' ? 'the best move' : `${/^[AEIOU]/.test(m.cls) ? 'an' : 'a'} ${m.cls}`}</span>, {pct(Math.max(0, m.options[0].value - m.options[m.played].value))} win chance given up ({Math.round(m.options[0].value * 100)}% → {Math.round(m.options[m.played].value * 100)}%).</> : m.played !== 0 ? <>The real move, “{m.options[m.played].label}”, was <span style={{ color: SEARCH_COLOR[m.cls] }}>{m.cls === 'Best' ? 'the best' : `${/^[AEIOU]/.test(m.cls) ? 'an' : 'a'} ${m.cls}`}</span> and gave up {pct(Math.max(0, m.options[0].value - m.options[m.played].value))} win chance ({Math.round(m.options[0].value * 100)}% → {Math.round(m.options[m.played].value * 100)}%).</> : <>It's what was really played.</>}
              {delta !== null && <span className={`puzzle-delta ${delta >= 0 ? 'up' : 'down'}`}> Rating {delta >= 0 ? '+' : '−'}{Math.abs(delta)}</span>}
              {crowd && crowd.tried >= 5 && <span className="puzzle-crowd muted"> {Math.round((crowd.right / crowd.tried) * 100)}% of {crowd.tried} players got this.</span>}
            </p>
            {m.why?.length ? <div className="puzzle-why"><b>Why</b><ul>{m.why.map((w, i) => <li key={i}>{w}</li>)}</ul></div> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Copies a link that holds the whole moment (no login, nothing stored on a server). */
export function ShareMoment({ m }: { m: Moment }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const url = `${location.origin}/m?c=${shareCode(m)}`;
    try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1800); } catch { prompt('Copy this link', url); }
  };
  return <button className="chip" onClick={copy} title="Copy a link to this moment: anyone can open it, no login"><Icon name={done ? 'check' : 'share'} size={13} /> {done ? 'Link copied' : 'Share'}</button>;
}

/** The game you were last in (the site's colour), for the daily when no game is picked. */
const lastGame = (): MomentGame => (document.documentElement.dataset.game === 'deadlock' ? 'deadlock' : (() => { try { return localStorage.getItem('stratboard.game') === 'deadlock' ? 'deadlock' : 'cs2'; } catch { return 'cs2'; } })());

type Mode = 'practice' | 'daily' | 'rush' | 'weak' | 'board';
const RUSH_SECONDS = 180, RUSH_LIVES = 3;

/** Puzzles: practice (yours or top players', at your rating), the daily puzzle, a 3-minute rush, your weak spots; and
 * from your own matches, the next match's focus and the mistake reel. */
export function MomentsPage() {
  const mine = useMemo(loadMoments, []);
  const [mode, setMode] = useState<Mode>('practice');
  // whose puzzles: yours, or premade ones from top players' matches (tools/puzzles.ts; loaded when needed)
  const [source, setSource] = useState<'mine' | 'top'>(() => (mine.length ? 'mine' : 'top'));
  const [top, setTop] = useState<Moment[] | null>(null);
  useEffect(() => {
    if (top) return;
    import('./generated/puzzles.json').then(j => { const d = j.default as { cs2: unknown[]; deadlock: unknown[] }; setTop([...d.cs2, ...d.deadlock].map(cleanMoment).filter((m): m is Moment => !!m)); }, () => setTop([]));
  }, [top]);
  const [game, setGame] = useState<MomentGame | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  // kept the same between renders: a new list would deal a new puzzle (answering re-renders)
  const all = useMemo(() => (source === 'top' ? top ?? [] : mine), [source, top, mine]);
  const ms = useMemo(() => all.filter(m => (game === 'all' || m.game === game) && (!tag || m.tag === tag)), [all, game, tag]);
  const [score, setScore] = useState<Score>(readScore);
  const [sound, setSound] = useState(soundOn);
  const toggleSound = () => setSound(v => { try { localStorage.setItem('rageview.sound', v ? '0' : '1'); } catch { /* private mode */ } return !v; });

  // practice: one you haven't seen, the closest to your rating
  const [cur, setCur] = useState<Moment | null>(null);
  const next = () => {
    const s = readScore(), seen = new Set(s.seen);
    const fresh = ms.filter(m => !seen.has(m.id) && m.id !== cur?.id);
    const from = fresh.length ? fresh : ms.filter(m => m.id !== cur?.id);
    setCur([...from].sort((a, b) => Math.abs(puzzleRating(a) - s.rating) - Math.abs(puzzleRating(b) - s.rating))[0] ?? null);
  };
  useEffect(next, [ms]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (m: Moment) => (right: boolean) => { const r = record(m, right); setScore(r.score); syncRecord(r.score); return r.delta; };

  const groups = mistakeGroups(mine.filter(m => game === 'all' || m.game === game));
  const focus = source === 'top' ? [] : (['cs2', 'deadlock'] as MomentGame[]).filter(g => game === 'all' || g === game).map(g => ({ g, f: focusOf(mine, g) })).filter(x => x.f);
  const header = (
    <header className="moments-head">
      <h1>Puzzles</h1>
      <div className="seg-mini" role="tablist" aria-label="Mode">
        {([['practice', 'Practice'], ['daily', 'Daily'], ['rush', 'Rush'], ['weak', 'Weak spots'], ['board', 'Leaderboard']] as [Mode, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      <span className="puzzle-rating" title="Your puzzle rating: it goes up more for harder puzzles">Rating <b className="num">{score.rating}</b></span>
      <button className="chip" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Sound off' : 'Sound on'}>{sound ? 'Sound on' : 'Sound off'}</button>
    </header>
  );

  const gamePick = (
    <div className="moments-filters"><div className="seg-mini" role="group" aria-label="Game">
      {(['cs2', 'deadlock'] as const).map(g => <button key={g} className={(game === 'all' ? lastGame() : game) === g ? 'on' : ''} onClick={() => setGame(g)}>{GAME_NAME[g]}</button>)}
    </div></div>
  );
  if (mode === 'daily') return <div className="page moments">{header}{gamePick}<DailyPuzzle pool={top?.filter(m => game === 'all' ? m.game === lastGame() : m.game === game) ?? null} game={game === 'all' ? lastGame() : game} onScore={setScore} /></div>;
  if (mode === 'rush') return <div className="page moments">{header}<Rush pool={top} onScore={setScore} /></div>;
  if (mode === 'board') return <div className="page moments">{header}<Leaderboard rating={score.rating} tried={score.tried} /></div>;
  if (mode === 'weak') {
    const spots = weakSpots(score);
    return (
      <div className="page moments">{header}
        <section className="site-card">
          <div className="card-head"><h2><Icon name="warning" size={16} /> Your weak spots</h2><span className="muted small">kinds of situation you've tried 3 or more times</span></div>
          {!spots.length ? <div className="empty-art-row"><EmptyArt size={72} /><p className="muted">Solve a few more puzzles: once you've tried a kind of situation 3 times, it shows here.</p></div> : (
            <ul className="weak-list">
              {spots.map(w => (
                <li key={w.tag}><b>{w.tag}</b><span className={w.rate < 0.5 ? 'down' : 'up'}>You get {Math.round((1 - w.rate) * 100)}% wrong</span><span className="muted small">{w.tried} tried</span>
                  <button className="chip" onClick={() => { setTag(w.tag); setSource('top'); setMode('practice'); }}>Practise these</button></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const switcher = (
    <div className="seg-mini" role="group" aria-label="Whose puzzles">
      <button className={source === 'mine' ? 'on' : ''} onClick={() => setSource('mine')}>Yours</button>
      <button className={source === 'top' ? 'on' : ''} onClick={() => setSource('top')}>Top players</button>
    </div>
  );
  const filters = (
    <div className="moments-filters">
      {switcher}
      <div className="seg-mini" role="group" aria-label="Game">
        {(['all', 'cs2', 'deadlock'] as const).map(g => <button key={g} className={game === g ? 'on' : ''} onClick={() => setGame(g)}>{g === 'all' ? 'All' : GAME_NAME[g]}</button>)}
      </div>
      {tag && <button className="chip on" onClick={() => setTag(null)}>{tag} <Icon name="close" size={11} /></button>}
    </div>
  );
  if (source === 'mine' && !mine.length) return (
    <div className="page moments">{header}{filters}
      <section className="site-card empty-state">
        <Icon name="target" size={28} />
        <h2>Your puzzles come from your matches</h2>
        <p className="muted">Review a CS2 match you played (and pick yourself), or open a Deadlock match of yours: the moments the engine flags become puzzles here. Here's one from a top player's match meanwhile:</p>
        <p><a className="cta primary" href="/cs2/review">Review a CS2 match</a> <a className="cta" href="/deadlock/review">Open a Deadlock match</a></p>
      </section>
      {top?.[0] && <section className="site-card"><Puzzle m={top[0]} onAnswer={answer(top[0])} /></section>}
    </div>
  );
  return (
    <div className="page moments">
      {header}{filters}
      {focus.map(({ g, f }) => (
        <section key={g} className="site-card focus-card">
          <div className="card-head"><h2><Icon name="goal" size={16} /> Next {GAME_NAME[g]} match: one thing</h2>
            <span className={`focus-streak ${f!.streak ? 'up' : ''}`}>{f!.streak ? `Fixing it: ${f!.streak} match${f!.streak === 1 ? '' : 'es'} in a row with fewer` : (f!.matches === 1 ? 'From your last match' : `Over your last ${f!.matches} matches`)}</span></div>
          <p className="focus-kind">{f!.kind}</p>
          <p className="muted">Your most frequent mistake lately. Here are the costliest times:</p>
          <div className="focus-clips">{f!.moments.map(m => <button key={m.id} className="focus-clip" onClick={() => setCur(m)} title="Try it as a puzzle"><MomentMap m={m} size={120} /><span className="small">{m.match} · {m.when}</span></button>)}</div>
        </section>
      ))}

      <section className="site-card">
        <div className="card-head"><h2><Icon name="target" size={16} /> Puzzle{cur ? <span className="muted small"> · difficulty {puzzleRating(cur)}</span> : null}</h2>
          <span className="muted small">{score.solved}/{score.tried} right · streak {score.streak} · best {score.best}</span></div>
        {cur ? <><Puzzle m={cur} onAnswer={answer(cur)} /><div className="puzzle-next"><ShareMoment m={cur} /><button className="primary" onClick={next}>Next puzzle <Icon name="arrowRight" size={13} /></button></div></>
          : <p className="muted">{source === 'top' && !top ? 'Loading puzzles…' : 'No puzzles here yet.'}</p>}
      </section>

      {source === 'mine' && <section className="site-card">
        <div className="card-head"><h2><Icon name="warning" size={16} /> Mistake reel</h2><span className="muted small">{groups.reduce((a, g) => a + g.moments.length, 0)} mistakes from your matches, by type</span></div>
        {groups.map(gr => (
          <details key={gr.kind} className="reel-group">
            <summary><b>{gr.kind}</b><span className="num muted">{gr.moments.length}× · {pct(gr.cost)} win chance in all</span></summary>
            <ul className="reel-list">
              {gr.moments.slice(0, 12).map(m => (
                <li key={m.id} className="moment-card" style={{ '--cls': SEARCH_COLOR[m.cls] } as React.CSSProperties}>
                  <MomentMap m={m} size={84} />
                  <span><b>{m.match} · {m.when}</b><span className="muted small">{m.options[m.played].label} · best: {m.options[0].label} · −{pct(m.cost)}</span></span>
                  <span className="reel-actions"><button className="chip" onClick={() => { setCur(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Puzzle</button><ShareMoment m={m} /></span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>}
    </div>
  );
}

/** Today's puzzle: the same one for everyone; one try; a day streak; a share line. */
function DailyPuzzle({ pool, game, onScore }: { pool: Moment[] | null; game: MomentGame; onScore: (s: Score) => void }) {
  const day = dayNumber(), m = useMemo(() => (pool ? dailyOf(pool, day) : null), [pool, day]);
  const [s, setS] = useState(readScore);
  const d = dailyFor(s, game), done = d.day === day;
  const [copied, setCopied] = useState(false);
  if (!m) return <p className="muted">Loading today's puzzle…</p>;
  const line = `RageView ${GAME_NAME[game]} daily #${day}: ${d.right ? 'solved' : 'missed'}${d.streak > 1 ? `, ${d.streak} days in a row` : ''}. tsakhstvo.xyz/puzzles`;
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="star" size={16} /> {GAME_NAME[game]} daily #{day}</h2><span className="muted small">the same for everyone today · streak {d.streak}</span></div>
      {done && <p className="muted">You've played today's: come back tomorrow for #{day + 1}.</p>}
      <Puzzle key={done ? 'done' : 'play'} m={m} onAnswer={done ? undefined : right => { recordDaily(right, day, game); const r = record(m, right); setS(r.score); onScore(r.score); syncRecord(r.score); return r.delta; }} />
      {done && (
        <div className="puzzle-next"><button className="chip" onClick={async () => { try { await navigator.clipboard.writeText(line); setCopied(true); } catch { prompt('Copy', line); } }}><Icon name={copied ? 'check' : 'share'} size={13} /> {copied ? 'Copied' : 'Share result'}</button></div>
      )}
    </section>
  );
}

/** Puzzle rush: as many as you can in 3 minutes; 3 wrong and it's over. */
function Rush({ pool, onScore }: { pool: Moment[] | null; onScore: (s: Score) => void }) {
  const [state, setState] = useState<'idle' | 'on' | 'over'>('idle');
  const [left, setLeft] = useState(RUSH_SECONDS);
  const [right, setRight] = useState(0), [lives, setLives] = useState(RUSH_LIVES);
  const [cur, setCur] = useState<Moment | null>(null);
  const [answered, setAnswered] = useState(false);
  const order = useRef<Moment[]>([]);
  // easiest first, then harder: the run gets harder as it goes
  const deal = (i: number) => setCur(order.current[i % order.current.length] ?? null);
  const start = () => {
    if (!pool?.length) return;
    order.current = [...pool].sort(() => Math.random() - 0.5).slice(0, 80).sort((a, b) => puzzleRating(a) - puzzleRating(b));
    setRight(0); setLives(RUSH_LIVES); setLeft(RUSH_SECONDS); setAnswered(false); deal(0); setState('on');
  };
  const n = useRef(0);
  useEffect(() => {
    if (state !== 'on') return;
    const id = setInterval(() => setLeft(l => { if (l <= 1) { setState('over'); return 0; } return l - 1; }), 1000);
    return () => clearInterval(id);
  }, [state]);
  useEffect(() => { if (state === 'over') { const s = recordRush(right); onScore(s); syncRecord(s); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const onAnswer = (ok: boolean) => {
    setAnswered(true);
    if (ok) setRight(r => r + 1); else setLives(l => { if (l <= 1) setTimeout(() => setState('over'), 900); return l - 1; });
    setTimeout(() => { n.current++; setAnswered(false); deal(n.current); }, ok ? 700 : 1400);
  };
  const best = readScore().rushBest;
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="bolt" size={16} /> Puzzle rush</h2><span className="muted small">3 minutes, 3 lives · your best {best}</span></div>
      {state === 'idle' && <div className="rush-start"><p className="muted">Solve as many as you can in 3 minutes. They get harder as you go. Three wrong and it's over.</p><button className="primary" onClick={start} disabled={!pool?.length}>{pool ? 'Start' : 'Loading…'}</button></div>}
      {state === 'on' && cur && (
        <>
          <div className="rush-bar"><b className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b><span key={right}>{right} right</span><span>{'Lives: ' + lives}</span></div>
          <Puzzle key={cur.id + n.current} m={cur} onAnswer={answered ? undefined : onAnswer} />
        </>
      )}
      {state === 'over' && <div className="rush-start"><p className="focus-kind">{right} right</p><p className="muted">{right > best ? 'A new best.' : `Your best: ${Math.max(best, right)}.`}</p><button className="primary" onClick={start}>Again</button></div>}
    </section>
  );
}

/** The top puzzle ratings (players with a public profile and 10+ puzzles), and where you'd stand. */
function Leaderboard({ rating, tried }: { rating: number; tried: number }) {
  const me = useProfile(s => s.me), isPublic = useProfile(s => s.data.prefs.public);
  const [rows, setRows] = useState<BoardRow[] | null>(null), [err, setErr] = useState<string | null>(null);
  // everyone, or you and your Steam friends (needs a login)
  const [who, setWho] = useState<'all' | 'friends'>('all'), [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setRows(null); setErr(null); setNote(null);
    const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e));
    if (who === 'friends') loadFriendsBoard().then(r => { setRows(r.rows); setNote(r.note); }, fail);
    else loadBoard().then(setRows, fail);
  }, [who]);
  const place = rows ? rows.filter(r => r.rating > rating).length + 1 : null;
  return (
    <section className="site-card">
      <div className="card-head"><h2><Icon name="trophy" size={16} /> Leaderboard</h2>
        {me ? (
          <span className="seg-mini" role="group" aria-label="Whose ratings">
            <button className={who === 'all' ? 'on' : ''} aria-pressed={who === 'all'} onClick={() => setWho('all')}>Everyone</button>
            <button className={who === 'friends' ? 'on' : ''} aria-pressed={who === 'friends'} onClick={() => setWho('friends')}>Friends</button>
          </span>
        ) : <span className="muted small">puzzle rating · public profiles · 10+ puzzles</span>}
      </div>
      {who === 'friends' && note && <p className="muted small">{note}</p>}
      {who === 'all' && <p className="muted small">{!me ? 'Log in with Steam and make your profile public (Settings) to be on it.' : !isPublic ? 'Your profile is private: make it public in Settings to show up here.' : tried < 10 ? `Solve ${10 - tried} more to show up.` : place ? `Your rating ${rating} would be #${place}.` : ''}</p>}
      {err ? <p className="warn-text">{err}</p> : !rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">{who === 'friends' ? 'No ratings among your friends yet.' : 'Nobody yet. Be first.'}</p> : (
        <ol className="leaderboard">
          {rows.map((r, i) => (
            <li key={r.steamId} className={me?.steamId === r.steamId ? 'mine' : ''}>
              <span className="num board-n">{i + 1}</span>
              {r.avatar ? <img src={r.avatar} alt="" width={28} height={28} /> : <Icon name="user" size={20} />}
              <b>{r.name ?? 'A player'}</b>
              <span className="num board-r">{r.rating}</span>
              <span className="muted small">{r.solved}/{r.tried} · best streak {r.best}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** A shared moment (/m?c=<code>): the puzzle for whoever opened the link. */
export function SharedMoment({ code }: { code: string }) {
  const m = useMemo(() => fromShareCode(code), [code]);
  useEffect(() => { if (m) applyGame(m.game); }, [m]);
  return (
    <div className="page moments">
      <h1>A moment from {m ? `a ${GAME_NAME[m.game]} match` : 'a match'}</h1>
      {m ? <section className="site-card"><Puzzle m={m} shared /></section>
        : <section className="site-card"><p className="muted">This link is broken or incomplete. Ask for it again.</p></section>}
      <p className="muted">Graded by RageView's engine. <a href="/">Review your own match</a>: it's free and runs in your browser.</p>
    </div>
  );
}
