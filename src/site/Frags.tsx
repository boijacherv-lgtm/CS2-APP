import { LETTER_COLOR, LETTERS } from '../engine/recap';

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

export function WinFrag({ from = 52, to = 31 }: { from?: number; to?: number }) {
  return (
    <div className="frag frag-win" role="img" aria-label={`Win chance from ${from}% to ${to}%`}>
      <div className="feed-win"><span className="bar"><i style={{ width: `${to}%`, background: to >= from ? 'var(--good)' : 'var(--bad)' }} /></span>
        <span className="num"><b className="side-ct">CT</b> {from}% → {to}% <b className="down">−{from - to}%</b></span></div>
      <p className="muted small">Every kill, grenade and rotation moves the bar.</p>
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
