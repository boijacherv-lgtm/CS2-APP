/**
 * CS2's game page, the same layout as Deadlock's (/deadlock): what it is, what the coach grades, how it works, where
 * it's at, questions. Reached at /cs2 (the game's Review and Tactical board are /cs2/review and /cs2/tactical).
 */
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const GAME = GAMES.find(g => g.id === 'cs2')!;

export function Cs2Home() {
  return (
    <div className="page dl cs2-home" style={{ '--game': GAME.color } as React.CSSProperties}>
      <section className="dl-hero">
        <div className="dl-hero-text">
          <span className="eyebrow"><GameMark game={GAME} size={14} /> {GAME.name} <span className={`games-status ${GAME.status}`}>{STATUS_LABEL[GAME.status]}</span></span>
          <h1>Every CS2 round, graded.</h1>
          <p className="lead">Drop a demo. Watch it on the radar while the coach marks every move against level-10 players.</p>
          <div className="hero-cta">
            <a className="cta primary" href="/cs2/review">Review a CS2 match <Icon name="arrowRight" size={14} /></a>
            <a className="cta" href="/cs2/tactical">Tactical board</a>
          </div>
        </div>
        <img className="dl-hero-shot" src="/images/shots/cs2-recap.jpg" alt="A CS2 match recap on Mirage: the score, the player's grades against the lobby and level 10, and their key numbers" width={800} height={562} />
      </section>

      <section className="site-section">
        <h2 className="section-title">What it grades</h2>
        <div className="feature-grid">
          {GRADES.map(f => (
            <div key={f.title} className="feature">
              <span className="feature-ico"><Icon name={f.icon} size={18} /></span>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          <li><b>Get a demo</b><span>CS2 → Watch → Your Matches → download. FACEIT and HLTV demos work too.</span></li>
          <li><b>Drop it in</b><span>It's read in your browser; nothing is uploaded.</span></li>
          <li><b>Every play graded</b><span>Brilliant to Blunder per move, S+ to F per round.</span></li>
          <li><b>Fix one thing</b><span>The coach picks it. You track it.</span></li>
        </ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">Questions</h2>
        <div className="faq">
          {FAQ.map(q => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}
        </div>
      </section>

      <footer className="site-footer">
        <nav><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/changelog">What's new</a></nav>
        <span className="muted">Not affiliated with Valve. Counter-Strike 2 and its logo belong to Valve.</span>
      </footer>
    </div>
  );
}

const GRADES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'crosshair', title: 'Aim duels', text: 'Duels you should have won, and the ones you stole.' },
  { icon: 'friends', title: 'Trades', text: 'Who traded, and who died alone.' },
  { icon: 'bomb', title: 'Utility', text: 'Flashes that worked, grenades that didn\'t.' },
  { icon: 'map', title: 'Positioning', text: 'Where you stood vs where level-10 players stand.' },
  { icon: 'coins', title: 'Economy', text: 'What you bought and what it got you.' },
  { icon: 'trophy', title: 'Clutches', text: '1vX: what won it, what lost it.' },
];


const FAQ = [
  { q: 'Where do demos come from?', a: 'CS2 → Watch → Your Matches → Download, or your Steam folder (the site finds them). FACEIT and HLTV demos work too, unzipped.' },
  { q: 'Is my demo uploaded?', a: 'No. It\'s read in your browser. Logged in, only your match\'s numbers are saved to your profile.' },
  { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access.' },
];
