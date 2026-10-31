import { APP_NAME } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import '../deadlock/dl.css';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const GAME = GAMES.find(g => g.id === 'dota2')!;

/** Dota 2's page while it's in beta: what works today, where the data comes from, and what's missing. */
export function Dota2() {
  return (
    <div className="page dl" style={{ '--game': GAME.color } as React.CSSProperties}>
      <section className="dl-hero">
        <div className="dl-hero-text">
          <span className="eyebrow"><GameMark game={GAME} size={14} /> {GAME.name} <span className={`games-status ${GAME.status}`}>{STATUS_LABEL[GAME.status]}</span></span>
          <h1>The same coach, for Dota 2.</h1>
          <p className="lead">Open any match by its ID: wards, buildings, deaths and fights over time, with the coach grading every death, kill and lane, then plan your next one in Tactical. Beta on {APP_NAME}.</p>
          <div className="hero-cta">
            <a className="cta primary" href="#/dota2/review">Review a match <Icon name="arrowRight" size={14} /></a>
            <a className="cta" href="#/dota2/tactical">Plan a match</a>
          </div>
        </div>
        <div className="dl-hero-mark" aria-hidden>
          <GameMark game={GAME} size={168} />
        </div>
      </section>

      <section className="site-section">
        <h2 className="section-title">What it does</h2>
        <div className="feature-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="feature">
              <span className="feature-ico"><Icon name={f.icon} size={18} /></span>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section">
        <h2 className="section-title">Where it's at</h2>
        <p className="muted dl-why">Match data comes from opendota.com, so any public match works without a file. Where heroes walked comes from the match's replay, read right in your browser. Valve keeps replays for about two weeks; a replay you've opened once stays in this browser.</p>
        <ol className="dl-road">
          {ROAD.map(r => (
            <li key={r.title} className={r.state === 'next' ? 'next' : ''}>
              <span className="dl-road-dot" aria-hidden />
              <div><b>{r.title}</b><span>{r.text}</span></div>
              <span className={`games-status ${r.state === 'done' ? 'live' : r.state}`}>{r.state === 'done' ? 'Live' : 'Next'}</span>
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
        <span className="muted">Not affiliated with Valve. Dota 2 and its logo belong to Valve.</span>
      </footer>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'play', title: 'Match replay', text: 'Heroes and creeps moving on the map, Roshan, runes, wards with their vision, towers falling.' },
  { icon: 'target', title: 'The coach', text: 'Every death and kill graded, with the reasons. Lanes compared at 10:00.' },
  { icon: 'star', title: 'Match recap', text: 'Gold lead, lessons that come back, fights, objectives, item timings, scoreboard.' },
  { icon: 'grid', title: 'Draft', text: 'Who counters whom, and picks against the other team.' },
  { icon: 'route', title: 'Macro plan', text: 'Heroes and wards over the match, with notes for your team.' },
  { icon: 'swords', title: 'Teamfight planner', text: 'A fight frame by frame: positions, range rings, who focuses whom.' },
  { icon: 'trendUp', title: 'You on your hero', text: 'How your numbers compare with other players on the same hero.' },
];

const ROAD: { title: string; text: string; state: 'done' | 'next' }[] = [
  { title: 'Match replay and the coach', text: 'Any parsed match by its ID, graded, with its recap.', state: 'done' },
  { title: 'Tactical', text: 'Draft with counters, a macro planner with wards, a teamfight planner, and planning from any moment of a match.', state: 'done' },
  { title: 'Heroes on the map', text: 'Every hero moving as they did in the match, with their health.', state: 'done' },
  { title: 'Your replay files', text: 'Open a replay you saved, even after Valve has deleted it.', state: 'next' },
];

const FAQ = [
  { q: 'Where do matches come from?', a: 'opendota.com, a free community service with Dota 2 match data.' },
  { q: 'What does "not parsed" mean?', a: 'OpenDota has only the final scoreboard until it has read the replay. Ask for it on the match: it takes a few minutes, while Valve still keeps the replay (about two weeks).' },
  { q: 'Why can\'t I see my matches?', a: 'Log in with Steam, and turn on Expose Public Match Data in Dota 2\'s settings. A match ID works either way.' },
];
