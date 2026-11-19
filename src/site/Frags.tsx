import { useEffect, useRef, useState } from 'react';
import { LETTER_COLOR, LETTERS } from '../engine/notes';

/**
 * Real pieces of the product at true size, for the home and game pages instead of icon-in-a-box cards: a grade scale,
 * a win-chance bar, a move card with its Brilliant mark and tags, a duel. They use the product's own classes and colours.
 */
export function GradeFrag() {
  const word: Record<string, string> = { 'S+': 'Carried', S: 'Great', A: 'Clean', B: 'Solid', C: 'Meh', D: 'Rough', F: 'We need to talk' };
  return (
    <div className="frag frag-grades" role="img" aria-label="The grades from S+ to F">
      {LETTERS.map(l => <span key={l} className="frag-grade"><b className="letter-chip" style={{ background: LETTER_COLOR[l] }}>{l}</b><i>{word[l]}</i></span>)}
    </div>
  );
}

export function WinFrag({ from = 52, to = 31, side = 'CT' }: { from?: number; to?: number; side?: string }) {
  const d = to - from;
  return (
    <div className="frag frag-win" role="img" aria-label={`Win chance from ${from}% to ${to}%`}>
      <div className="feed-win"><span className="bar"><i style={{ width: `${to}%`, background: d >= 0 ? 'var(--good)' : 'var(--bad)' }} /></span>
        <span className="num"><b className={side === 'CT' ? 'side-ct' : undefined}>{side}</b> {from}% → {to}% <b className={d >= 0 ? 'up' : 'down'}>{d >= 0 ? '+' : '−'}{Math.abs(d)}%</b></span></div>
      <p className="muted small">Every kill, grenade and rotation moves the bar.</p>
    </div>
  );
}

/** A part of the report card as the Deadlock recap shows it: its score out of 100, a bar, and the rank in the match. */
export function ScoreFrag({ score, rank }: { score: number; rank: string }) {
  return (
    <div className="frag frag-score" role="img" aria-label={`Score ${score} out of 100, ${rank} in the match`}>
      <div className="frag-score-top"><b className="num">{score}</b><span className="muted small">{rank} in the match</span></div>
      <span className="dl-rc-bar"><i style={{ width: `${score}%`, background: score >= 62 ? 'var(--good)' : score >= 50 ? 'var(--text-2)' : 'var(--bad)' }} /></span>
    </div>
  );
}

export function CardFrag({ tags = ['TRADE', 'ECO FRAG', 'LONG ODDS'] }: { tags?: string[] }) {
  return (
    <div className="frag frag-card" role="img" aria-label="A move card: Brilliant, a kill that won the round">
      <div className="frag-card-head"><span className="feed-grade" style={{ background: 'var(--letter-splus, #1baca6)' }}>Brilliant</span><span className="muted">Lay2n · 0:57</span></div>
      <b>Killed Sehrvus at Underpass with a Desert Eagle</b>
      <div className="feed-win"><span className="bar"><i style={{ width: '13%', background: 'var(--good)' }} /></span><span className="num">2% → 13% <b className="up">+11%</b></span></div>
      <div className="feed-tags">{tags.map(t => <span key={t} className="feed-tag">{t}</span>)}</div>
    </div>
  );
}

export function DuelFrag() {
  return (
    <div className="frag frag-duel" role="img" aria-label="Duel odds 31% to win, lost">
      <div className="feed-win"><span className="bar"><i style={{ width: '31%', background: 'var(--bad)' }} /></span><span className="num">31% to win · lost</span></div>
      <div className="feed-tags"><span className="feed-tag">ISOLATED</span><span className="feed-tag">NO TRADE</span></div>
    </div>
  );
}

export function UtilFrag() {
  return (
    <div className="frag frag-util" role="img" aria-label="A flash that blinded two enemies and set up a kill">
      <div className="feed-tags"><span className="feed-tag">FLASH ASSIST</span><span className="feed-tag">2 BLINDED</span></div>
      <p className="muted small">Flash at B Doors: two enemies blinded, one killed 1.2 s later. <b className="up">+6%</b></p>
    </div>
  );
}

export function PosFrag() {
  return (
    <div className="frag frag-pos" role="img" aria-label="Where level-10 players hold a spot">
      <div className="feed-tags"><span className="feed-tag">B DOORS</span><span className="feed-tag">ROUND 12 · 0:40</span></div>
      <p className="muted small">Level-10 players hold this spot 55% of the time. Alone here they die 52%.</p>
    </div>
  );
}

/**
 * The page's one dealt moment: the win-chance bar scrubs from 50% to 97% as you scroll the section into view, like a replay
 * running (static at the end with reduced motion).
 */
export function ScrollWin() {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(50);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(97); return; }
    const on = () => {
      const r = ref.current?.getBoundingClientRect(); if (!r) return;
      const p = Math.max(0, Math.min(1, (innerHeight - r.top) / (innerHeight * 0.75)));
      setV(Math.round(50 + p * 47));
    };
    on(); addEventListener('scroll', on, { passive: true, capture: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on, true); removeEventListener('resize', on); };
  }, []);
  return (
    <div className="frag frag-win" ref={ref} role="img" aria-label="The win chance rising from 50% to 97% as a round plays">
      <div className="feed-win"><span className="bar"><i style={{ width: `${v}%`, background: 'var(--good)' }} /></span>
        <span className="num"><b className="side-ct">CT</b> {v}% <b className="up">+{v - 50}%</b></span></div>
      <p className="muted small">Every kill, grenade and rotation moves the bar.</p>
    </div>
  );
}
