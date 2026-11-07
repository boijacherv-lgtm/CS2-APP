/**
 * CS2's game page, the same layout as Deadlock's (/deadlock): what it is, what the coach grades, how it works, where
 * it's at, questions. Reached at /cs2 (the game's Review and Tactical board are /cs2/review and /cs2/tactical).
 */
import { COACH_MODEL, PRO_MODEL } from '../engine/coachModels';
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const GAME = GAMES.find(g => g.id === 'cs2')!;
const MATCHES = COACH_MODEL.source?.demos ?? COACH_MODEL.trainedOn;

export function Cs2Home() {
  return (
    <div className="page dl cs2-home" style={{ '--game': GAME.color } as React.CSSProperties}>
      <section className="dl-hero">
        <div className="dl-hero-text">
          <span className="eyebrow"><GameMark game={GAME} size={14} /> {GAME.name} <span className={`games-status ${GAME.status}`}>{STATUS_LABEL[GAME.status]}</span></span>
          <h1>Every round, graded.</h1>
          <p className="lead">Drop a demo and replay it on the radar, with every kill, grenade and death graded against FACEIT level-10 players, and the play the engine would have made.</p>
          <div className="hero-cta">
            <a className="cta primary" href="/cs2/review">Review a match <Icon name="arrowRight" size={14} /></a>
            <a className="cta" href="/cs2/tactical">Tactical board</a>
          </div>
        </div>
        <img className="dl-hero-shot" src="/images/shots/coach.jpg" alt="A recap's engine card: accuracy, costliest moves and best calls" width={800} height={600} />
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
        <h2 className="section-title">Where it's at</h2>
        <ol className="dl-road">
          {ROAD.map(r => (
            <li key={r.title}>
              <span className="dl-road-dot" aria-hidden />
              <div><b>{r.title}</b><span>{r.text}</span></div>
              <span className="games-status live">Live</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">Questions</h2>
        <div className="faq">
          {FAQ.map(q => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}
        </div>
      </section>

      <footer className="site-footer">
        <span className="muted">Not affiliated with Valve. Counter-Strike 2 and its logo belong to Valve.</span>
      </footer>
    </div>
  );
}

const GRADES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'crosshair', title: 'Aim duels', text: 'Every duel against what level-10 players win from the same spot, distance and gun.' },
  { icon: 'friends', title: 'Trades', text: 'Deaths your team traded, and the ones nobody could: who was alone.' },
  { icon: 'bomb', title: 'Utility', text: 'Flashes that blinded enemies or your own team, grenade damage, utility you died with.' },
  { icon: 'map', title: 'Positioning', text: 'Where you held and moved each round, next to what level-10 players do there.' },
  { icon: 'coins', title: 'Economy', text: 'What you bought each round and what it was worth in the fights that followed.' },
  { icon: 'trophy', title: 'Clutches', text: 'One against more: the kills that won it, and the rounds you could have.' },
];

const ROAD = [
  { title: 'Graded replay', text: 'Every round on the radar with a live win-chance bar and every move graded.' },
  { title: 'The engine', text: 'Every 2 s, the best option from where you stood, and what yours gave up.' },
  { title: 'The coach', text: `Trained on ${MATCHES} FACEIT level-10 matches${PRO_MODEL ? ` and ${PRO_MODEL.source?.demos ?? 0} pro ones` : ''}.` },
  { title: 'Puzzles', text: 'Your own mistakes as puzzles, and top players\' too.' },
  { title: 'Tactical board', text: 'Plan rounds: players, grenades, routes, and fights simulated.' },
];

const FAQ = [
  { q: 'Where do demos come from?', a: 'CS2 → Watch → Your Matches → Download, or your Steam folder (the site finds them). FACEIT and HLTV demos work too, unzipped.' },
  { q: 'Is my demo uploaded?', a: 'No. It\'s read in your browser. Logged in, only your match\'s numbers are saved to your profile.' },
  { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access.' },
];
