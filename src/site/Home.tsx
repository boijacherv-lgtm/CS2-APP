import { COACH_MODEL, PRO_MODEL } from '../engine/coachModels';
import { FREE_HISTORY, PRO_EARLY_ACCESS } from '../engine/profile';
import { LETTER_COLOR } from '../engine/recap';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, LIVE_GAMES, SOON_GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const MATCHES = COACH_MODEL.source?.demos ?? COACH_MODEL.trainedOn;
const PRO_MATCHES = PRO_MODEL?.source?.demos ?? 0;

const LIVE = LIVE_GAMES[0];
const toGames = () => document.getElementById('games')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The front page: what it is, which games, how it works, what you get, what it costs. Short on purpose. */
export function Home() {
  const top = GAMES.slice(0, 3), more = GAMES.slice(3);
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow"><Icon name="bolt" size={12} /> Free game coach</span>
          <h1>Prove you were right.</h1>
          <p className="lead">Drop your match. Every play gets a grade and the better option. Live for {LIVE.short}, more games coming.</p>
          <div className="hero-games" aria-label="Games">
            <span className="hero-games-live"><GameMark game={LIVE} size={30} /><b>{LIVE.name}</b><span className="games-status live">Live</span></span>
            <span className="hero-games-soon">
              {SOON_GAMES.map(g => <span key={g.id} title={`${g.name}: ${STATUS_LABEL[g.status].toLowerCase()}`}><GameMark game={g} size={30} muted /></span>)}
            </span>
          </div>
          <div className="hero-cta">
            <a className="cta primary" href="#/cs2/review">Review a {LIVE.short} match <Icon name="arrowRight" size={14} /></a>
            <button className="cta" onClick={toGames}>All games</button>
          </div>
          <ul className="hero-trust">
            <li><Icon name="shield" size={14} /> Nothing uploaded</li>
            <li><Icon name="check" size={14} /> No account needed</li>
          </ul>
        </div>
        <HeroPreview />
      </section>

      <section className="site-section" id="games">
        <h2 className="section-title">Games</h2>
        <div className="game-cards">
          {top.map(g => g.status === 'live' ? (
            <article key={g.id} className="game-card live" style={{ '--game': g.color } as React.CSSProperties}>
              <div className="game-card-head"><GameMark game={g} size={48} /><div><b>{g.name}</b><span className="games-status live">Live now</span></div></div>
              <p>{g.note}</p>
              <ul className="game-card-points"><li>Graded replay</li><li>Engine</li><li>Coach</li><li>Tactical board</li></ul>
              <div className="game-card-cta">
                <a className="cta primary" href="#/cs2/review">Review a match</a>
                <a className="cta" href="#/cs2/tactical">Plan a round</a>
              </div>
            </article>
          ) : (
            <article key={g.id} className={`game-card soon ${g.status}`} style={{ '--game': g.color } as React.CSSProperties}>
              <div className="game-card-head"><GameMark game={g} size={44} muted={g.status !== 'next'} /><div><b>{g.name}</b><span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></div></div>
              <p>{g.note}</p>
              {g.page && <div className="game-card-cta"><a className="cta" href={g.page}>What's coming <Icon name="arrowRight" size={14} /></a></div>}
            </article>
          ))}
        </div>
        <details className="more-games">
          <summary>
            <span className="more-marks">{more.map(g => <GameMark key={g.id} game={g} size={24} muted />)}</span>
            {more.length} more games <Icon name="chevronDown" size={12} />
          </summary>
          <ul>
            {more.map(g => (
              <li key={g.id}><GameMark game={g} size={32} muted /><b>{g.name}</b><span className="muted">{g.note}</span><span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></li>
            ))}
          </ul>
        </details>
      </section>

      <section className="site-section">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          <li><b>Bring a match</b><span>A demo, replay or match ID.</span></li>
          <li><b>Get graded</b><span>Every play, brilliant to blunder.</span></li>
          <li><b>See the better play</b><span>What else you could have done.</span></li>
          <li><b>Fix one thing</b><span>The coach picks it. You track it.</span></li>
        </ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">What you get</h2>
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
        <h2 className="section-title"><GameMark game={LIVE} size={26} /> {LIVE.short} in numbers</h2>
        <div className="stat-strip" aria-label={`${LIVE.name} in numbers`}>
          <div><b>{MATCHES}</b><span>level-10 matches learned</span></div>
          {PRO_MATCHES > 0 && <div><b>{PRO_MATCHES}</b><span>pro matches</span></div>}
          <div><b>10</b><span>maps</span></div>
          <div><b>0 MB</b><span>uploaded</span></div>
        </div>
      </section>

      <section className="site-section pricing-teaser">
        <div>
          <h2 className="section-title">Free</h2>
          <p className="muted">Everything you need is free. Pro adds unlimited history{PRO_EARLY_ACCESS ? ', and it\'s free during early access too' : ''}.</p>
        </div>
        <a className="cta" href="#/pricing">See plans</a>
      </section>

      <section className="site-section">
        <h2 className="section-title">Questions</h2>
        <div className="faq">
          {FAQ.map(q => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}
        </div>
      </section>

      <footer className="site-footer">
        <span className="brand-small"><LogoMark size={18} /> {APP_NAME}</span>
        <nav>
          <a href="#/cs2/review">Review</a><a href="#/cs2/tactical">Tactical</a><a href="#/profile">Profile</a><a href="#/pricing">Pricing</a><a href="#/settings">Settings</a>
        </nav>
        <span className="muted">Not affiliated with any game publisher. Game names and logos belong to their owners.</span>
      </footer>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'play', title: 'Graded replay', text: 'Every play scored, with a live win chance.' },
  { icon: 'route', title: 'The engine', text: 'The better play, and what it was worth.' },
  { icon: 'star', title: 'A real coach', text: 'You against level 10 and pros.' },
  { icon: 'bolt', title: 'Rage mode', text: 'The coach yells at your plays. 18+.' },
  { icon: 'goal', title: 'Goals', text: 'Pick 3 habits. Watch them improve.' },
  { icon: 'friends', title: 'Friends', text: 'Your stats next to theirs.' },
  { icon: 'share', title: 'Share card', text: 'Your match as a picture for Discord.' },
];

const FAQ = [
  { q: 'Which games?', a: `${LIVE.name} now. Next: ${SOON_GAMES.slice(0, 3).map(g => g.name).join(', ')}, then more.` },
  { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access. No card needed.' },
  { q: 'Is my match uploaded?', a: 'No. It\'s read in your browser. Logged in, only your numbers are saved, never the replay.' },
  { q: 'Do I need an account?', a: 'No. Log in with Steam only to sync your profile between devices.' },
  { q: `Which ${LIVE.short} demos work?`, a: 'Valve, FACEIT and HLTV demos, on the competitive maps.' },
  { q: 'How good is the coach?', a: `Trained on ${MATCHES} FACEIT level-10 matches${PRO_MATCHES ? ` and ${PRO_MATCHES} pro ones` : ''}. It can't hear your team's calls, and says so.` },
];

/** A picture of the review screen: a radar, a graded move and the coach's bars (an illustration, not a real match). */
function HeroPreview() {
  return (
    <div className="hero-preview" aria-hidden="true">
      <div className="pv-frame">
        <img className="pv-map" src="/images/maps/de_mirage.png" alt="" />
        <i className="pv-dot ct" style={{ left: '62%', top: '30%' }} /><i className="pv-dot ct" style={{ left: '44%', top: '55%' }} />
        <i className="pv-dot t" style={{ left: '70%', top: '64%' }} /><i className="pv-dot t dead" style={{ left: '55%', top: '72%' }} />
        <div className="pv-card">
          <div className="pv-card-head"><span className="pv-mark" style={{ background: '#e58f2a' }}>?</span><b>Mistake</b><span className="pv-gain">−11%</span></div>
          <p>Died alone at Palace: no teammate within 20 m could trade.</p>
          <p className="muted">Better: hold Ramp with your teammate.</p>
        </div>
        <div className="pv-eval"><i style={{ width: '58%' }} /></div>
      </div>
      <div className="pv-coach">
        <div className="pv-grades">
          <span style={{ background: LETTER_COLOR.A }}>A</span><small>Level</small>
        </div>
        {[['Dying alone', -0.55], ['ADR', 0.62], ['Counter-strafing', 0.4]].map(([k, v]) => (
          <div key={k as string} className="pv-row"><span>{k}</span><span className="pv-track"><i className={(v as number) < 0 ? 'down' : 'up'} style={{ [(v as number) < 0 ? 'right' : 'left']: '50%', width: `${Math.abs(v as number) * 50}%` }} /></span></div>
        ))}
      </div>
      <span className="pv-label">{LIVE_GAMES[0].short} review · preview</span>
    </div>
  );
}
