import { useEffect, useMemo, useState } from 'react';
import { MAPS } from '../map/catalog';
import { DL_MAP_IMAGE } from '../deadlock/data';
import { SEARCH_COLOR } from '../deadlock/search';
import { applyGame } from '../ui/tokens';
import { Icon } from '../ui/Icon';
import { cleanMoment, focusOf, fromShareCode, isMistake, loadMoments, mistakeGroups, shareCode, type Moment, type MomentGame } from './moments';

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

/** A stable shuffle per moment, so the best move isn't always first. */
const order = (m: Moment) => {
  let h = 0; for (const c of m.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return m.options.map((_, i) => i).sort((a, b) => ((a * 7919 + h) % 13) - ((b * 7919 + h) % 13));
};

const SCORE_KEY = 'rageview.puzzles';
type Score = { solved: number; tried: number; streak: number; best: number; seen: string[] };
const readScore = (): Score => { try { return { solved: 0, tried: 0, streak: 0, best: 0, seen: [], ...JSON.parse(localStorage.getItem(SCORE_KEY) ?? '{}') }; } catch { return { solved: 0, tried: 0, streak: 0, best: 0, seen: [] }; } };
const writeScore = (s: Score) => { try { localStorage.setItem(SCORE_KEY, JSON.stringify({ ...s, seen: s.seen.slice(-500) })); } catch { /* private mode */ } };

/** One puzzle: the situation, the moves in a shuffled order; pick one and the engine's answer shows. */
export function Puzzle({ m, onAnswer, shared }: { m: Moment; onAnswer?: (right: boolean) => void; shared?: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => setPicked(null), [m.id]);
  const right = picked === 0;
  const pick = (i: number) => { if (picked !== null) return; setPicked(i); onAnswer?.(i === 0); };
  return (
    <div className="puzzle">
      <MomentMap m={m} />
      <div className="puzzle-body">
        <span className="muted small">{GAME_NAME[m.game]} · {m.match} · {m.when}{m.who ? ` · ${m.who}` : ''}</span>
        <p className="puzzle-setup">{m.setup}</p>
        <b>{shared || m.who ? 'What is the best move here?' : 'What should you do here?'}</b>
        <div className="puzzle-options">
          {order(m).map(i => {
            const o = m.options[i];
            const state = picked === null ? '' : i === 0 ? 'best' : i === picked ? 'wrong' : '';
            return (
              <button key={i} className={`puzzle-option ${state}`} onClick={() => pick(i)} disabled={picked !== null && state === ''}>
                <span>{o.label}</span>
                {picked !== null && <span className="num muted">{Math.round(o.value * 100)}% to win{i === m.played ? (shared || m.who ? ' · what was played' : ' · what you did') : ''}</span>}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <p className={`puzzle-verdict ${right ? 'up' : 'down'}`}>
            {right ? 'Right: that is the engine\'s best move.' : `The engine's best: ${m.options[0].label}.`}{' '}
            {m.played !== 0 ? <>The real move, “{m.options[m.played].label}”, was <span style={{ color: SEARCH_COLOR[m.cls] }}>{m.cls === 'Best' ? 'the best' : `${/^[AEIOU]/.test(m.cls) ? 'an' : 'a'} ${m.cls}`}</span> and gave up {pct(m.cost)} win chance.</> : <>It's what was really played.</>}
          </p>
        )}
        {picked !== null && m.why && <ul className="puzzle-why">{m.why.map((w, i) => <li key={i} className="muted">{w}</li>)}</ul>}
      </div>
    </div>
  );
}

/** Copies a link that holds the whole moment (no login, nothing stored on a server). */
export function ShareMoment({ m }: { m: Moment }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const url = `${location.origin}/#/m/${shareCode(m)}`;
    try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1800); } catch { prompt('Copy this link', url); }
  };
  return <button className="chip" onClick={copy} title="Copy a link to this moment: anyone can open it, no login"><Icon name={done ? 'check' : 'share'} size={13} /> {done ? 'Link copied' : 'Share'}</button>;
}

/** Puzzles from your own matches, the next match's focus, and your mistakes grouped by type. */
export function MomentsPage() {
  const mine = useMemo(loadMoments, []);
  // whose puzzles: yours, or premade ones from top players' matches (tools/puzzles.ts; loaded when picked)
  const [source, setSource] = useState<'mine' | 'top'>(() => (mine.length ? 'mine' : 'top'));
  const [top, setTop] = useState<Moment[] | null>(null);
  useEffect(() => {
    if (source !== 'top' || top) return;
    import('./generated/puzzles.json').then(j => { const d = j.default as { cs2: unknown[]; deadlock: unknown[] }; setTop([...d.cs2, ...d.deadlock].map(cleanMoment).filter((m): m is Moment => !!m)); }, () => setTop([]));
  }, [source, top]);
  const [game, setGame] = useState<MomentGame | 'all'>('all');
  // kept the same between renders: a new list would deal a new puzzle (answering re-renders)
  const all = useMemo(() => (source === 'top' ? top ?? [] : mine), [source, top, mine]);
  const ms = useMemo(() => (game === 'all' ? all : all.filter(m => m.game === game)), [all, game]);
  const [score, setScore] = useState(readScore);
  // the next puzzle: one you haven't seen, costliest first; once all are seen, round again
  const pool = useMemo(() => [...ms].sort((a, b) => b.cost - a.cost), [ms]);
  const [cur, setCur] = useState<Moment | null>(null);
  const next = () => { const seen = new Set(readScore().seen); setCur(pool.find(m => !seen.has(m.id) && m.id !== cur?.id) ?? pool[Math.floor(Math.random() * pool.length)] ?? null); };
  useEffect(next, [pool]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = (right: boolean) => {
    const s = readScore(), streak = right ? s.streak + 1 : 0;
    const n = { solved: s.solved + (right ? 1 : 0), tried: s.tried + 1, streak, best: Math.max(s.best, streak), seen: cur ? [...s.seen, cur.id] : s.seen };
    writeScore(n); setScore(n);
  };
  const groups = mistakeGroups(ms);
  const focus = source === 'top' ? [] : (['cs2', 'deadlock'] as MomentGame[]).filter(g => game === 'all' || g === game).map(g => ({ g, f: focusOf(all, g) })).filter(x => x.f);

  const switcher = (
    <div className="seg-mini" role="group" aria-label="Whose puzzles">
      <button className={source === 'mine' ? 'on' : ''} onClick={() => setSource('mine')}>Yours</button>
      <button className={source === 'top' ? 'on' : ''} onClick={() => setSource('top')}>Top players</button>
    </div>
  );
  if (source === 'mine' && !all.length) return (
    <div className="page moments">
      <header className="moments-head"><h1>Puzzles</h1>{switcher}</header>
      <section className="site-card empty-state">
        <Icon name="target" size={28} />
        <h2>Your puzzles come from your matches</h2>
        <p className="muted">Review a CS2 match you played (and pick yourself), or open a Deadlock match of yours: the moments the engine flags become puzzles here, with your mistakes grouped by type.</p>
        <p><a className="cta primary" href="#/cs2/review">Review a CS2 match</a> <a className="cta" href="#/deadlock/review">Open a Deadlock match</a> <button className="cta" onClick={() => setSource('top')}>Solve top players' puzzles</button></p>
      </section>
    </div>
  );
  return (
    <div className="page moments">
      <header className="moments-head">
        <h1>Puzzles</h1>
        {switcher}
        <div className="seg-mini" role="group" aria-label="Game">
          {(['all', 'cs2', 'deadlock'] as const).map(g => <button key={g} className={game === g ? 'on' : ''} onClick={() => setGame(g)}>{g === 'all' ? 'All' : GAME_NAME[g]}</button>)}
        </div>
      </header>

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
        <div className="card-head"><h2><Icon name="target" size={16} /> Puzzle</h2>
          <span className="muted small">{score.solved}/{score.tried} right · streak {score.streak} · best {score.best}</span></div>
        {cur ? <><Puzzle m={cur} onAnswer={answer} /><div className="puzzle-next"><ShareMoment m={cur} /><button className="primary" onClick={next}>Next puzzle <Icon name="arrowRight" size={13} /></button></div></>
          : <p className="muted">{source === 'top' && !top ? 'Loading puzzles…' : 'No moments for this game yet.'}</p>}
      </section>

      {source === 'mine' && <section className="site-card">
        <div className="card-head"><h2><Icon name="warning" size={16} /> Mistake reel</h2><span className="muted small">{ms.filter(isMistake).length} mistakes from your matches, by type</span></div>
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

/** A shared moment (#/m/<code>): the puzzle for whoever opened the link. */
export function SharedMoment({ code }: { code: string }) {
  const m = useMemo(() => fromShareCode(code), [code]);
  useEffect(() => { if (m) applyGame(m.game); }, [m]);
  return (
    <div className="page moments">
      <h1>A moment from {m ? `a ${GAME_NAME[m.game]} match` : 'a match'}</h1>
      {m ? <section className="site-card"><Puzzle m={m} shared /></section>
        : <section className="site-card"><p className="muted">This link is broken or incomplete. Ask for it again.</p></section>}
      <p className="muted">Graded by RageView's engine. <a href="#/">Review your own match</a>: it's free and runs in your browser.</p>
    </div>
  );
}
