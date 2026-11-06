import { COACH_MODEL, PRO_MODEL } from '../engine/coachModels';
import { PRO_EARLY_ACCESS } from '../engine/profile';
import { matches as DL_MATCHES } from '../deadlock/generated/winmodel.json';
import { DL_MAP_IMAGE } from '../deadlock/data';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, PLAYABLE, SOON_GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';
import { MarkFace } from '../ui/MarkFace';
import { useState } from 'react';
import { openMatch } from '../deadlock/open';
import { navigate } from '../shell/router';

/** The sample: a public Phantom+ match (46 min, both teams' fights and objectives), opened from deadlock-api. */
const SAMPLE_MATCH = 131074890;

const MATCHES = COACH_MODEL.source?.demos ?? COACH_MODEL.trainedOn;
const PRO_MATCHES = PRO_MODEL?.source?.demos ?? 0;
const names = (gs: { name: string }[]) => gs.map(g => g.name).join(' and ');
const toGames = () => document.getElementById('games')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The front page, about every game rather than one: what it is, which games, how it works, what you get, what it
 * costs. Short on purpose; dressed in the neutral theme (tokens.ts themeOf). */
export function Home() {
  const top = GAMES.slice(0, 3), more = GAMES.slice(3);
  // a public high-rank Deadlock match, opened on the board: the product without a demo of your own
  const [sample, setSample] = useState<'idle' | 'opening' | 'failed'>('idle');
  const trySample = async () => {
    setSample('opening');
    try { await openMatch(SAMPLE_MATCH); navigate({ page: 'deadlock', mode: 'review' }); } catch { setSample('failed'); }
  };
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow"><Icon name="bolt" size={12} /> Free game coach</span>
          <h1>Prove you were right.</h1>
          <p className="lead">Bring your match. Every play gets a grade and the better option. {names(PLAYABLE)} now, more games coming.</p>
          <div className="hero-games" aria-label="Games">
            {PLAYABLE.map(g => (
              <a key={g.id} className="hero-games-live" href={g.review ?? g.page}><GameMark game={g} size={30} /><b>{g.name}</b><span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></a>
            ))}
            <span className="hero-games-soon" aria-label="Coming later">
              <small className="muted">Coming:</small>
              {SOON_GAMES.map(g => <span key={g.id} title={`${g.name}: ${STATUS_LABEL[g.status].toLowerCase()}`}><GameMark game={g} size={30} muted /></span>)}
            </span>
          </div>
          <div className="hero-cta">
            {PLAYABLE.map((g, i) => <a key={g.id} className={`cta${i === 0 ? ' primary' : ''}`} href={g.review}>Review a {g.short === 'DL' ? 'Deadlock' : g.short} match <Icon name="arrowRight" size={14} /></a>)}
            <button className="cta" onClick={toGames}>All games <Icon name="arrowRight" size={14} /></button>
          </div>
          <p className="hero-sample"><button className="link-btn" onClick={trySample} disabled={sample === 'opening'}><Icon name="play" size={12} /> {sample === 'opening' ? 'Opening a sample match…' : 'Try a sample match'}</button> <span className="muted">{sample === 'failed' ? 'couldn\'t open it, try again' : 'a public Deadlock match: no file, no login'}</span></p>
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
          {top.map(g => g.review ? (
            <article key={g.id} className={`game-card live ${g.status}`} style={{ '--game': g.color } as React.CSSProperties}>
              <div className="game-card-head"><GameMark game={g} size={48} /><div><b>{g.name}</b><span className={`games-status ${g.status}`}>{g.status === 'live' ? 'Live now' : STATUS_LABEL[g.status]}</span></div></div>
              <p>{g.note}</p>
              {g.points && <ul className="game-card-points">{g.points.map(x => <li key={x}>{x}</li>)}</ul>}
              <div className="game-card-cta">
                <a className="cta primary" href={g.review}>Review a match</a>
                {g.plan && <a className="cta" href={g.plan}>Plan</a>}
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
        <h2 className="section-title">In numbers</h2>
        <div className="stat-strip" aria-label="RageView in numbers">
          <div><b>{MATCHES}</b><span>CS2 level-10 matches learned</span></div>
          {PRO_MATCHES > 0 && <div><b>{PRO_MATCHES}</b><span>CS2 pro matches</span></div>}
          <div><b>{DL_MATCHES.toLocaleString()}</b><span>Deadlock Phantom+ matches</span></div>
          <div><b>0 MB</b><span>uploaded</span></div>
        </div>
      </section>

      <section className="site-section pricing-teaser">
        <div>
          <h2 className="section-title">Free</h2>
          <p className="muted">Everything you need is free, in every game. Pro adds unlimited history{PRO_EARLY_ACCESS ? ', and it\'s free during early access too' : ''}.</p>
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
          {PLAYABLE.map(g => <a key={g.id} href={g.review}>{g.name}</a>)}<a href="#/profile">Profile</a><a href="#/pricing">Pricing</a><a href="#/settings">Settings</a><a href="#/puzzles">Puzzles</a>
        </nav>
        <span className="muted">© {new Date().getFullYear()} {APP_NAME}. Not affiliated with any game publisher. Game names and logos belong to their owners.</span>
      </footer>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'play', title: 'Graded replay', text: 'Every play scored, with a live win chance.' },
  { icon: 'route', title: 'The engine', text: 'The better play, and what it was worth.' },
  { icon: 'star', title: 'A real coach', text: 'You against the best players in your game.' },
  { icon: 'bolt', title: 'Rage mode', text: 'The coach yells at your plays. 18+.' },
  { icon: 'goal', title: 'Goals', text: 'Pick 3 habits. Watch them improve.' },
  { icon: 'friends', title: 'Friends', text: 'Your stats next to theirs.' },
  { icon: 'share', title: 'Share card', text: 'Your match as a picture for Discord.' },
];

const FAQ = [
  { q: 'Which games?', a: `${names(PLAYABLE)} now. Next: ${SOON_GAMES.slice(0, 3).map(g => g.name).join(', ')}, then more.` },
  { q: 'Is it free?', a: 'Yes. Pro adds unlimited history and is free during early access. No card needed.' },
  { q: 'Is my match uploaded?', a: 'No. Demos and replay files are read in your browser. A Deadlock match ID is looked up in deadlock-api\'s public match data. Logged in, only your numbers are saved, never the replay.' },
  { q: 'Do I need an account?', a: 'No. Log in with Steam only to sync your profile between devices.' },
  { q: 'What do I bring?', a: PLAYABLE.map(g => `${g.name}: ${g.source}`).join('. ') + '.' },
  { q: 'How good is the coach?', a: `In CS2 it learned from ${MATCHES} FACEIT level-10 matches${PRO_MATCHES ? ` and ${PRO_MATCHES} pro ones` : ''}; in Deadlock from ${DL_MATCHES.toLocaleString()} Phantom-and-up matches since the patch. It can't hear your team's calls, and says so.` },
];

/** A picture of two reviews, one per game: a graded moment on each map (illustrations, not real matches). */
function HeroPreview() {
  return (
    <div className="hero-preview duo" aria-hidden="true">
      <div className="pv-frame cs2">
        <img className="pv-map" src="/images/maps/de_mirage.png" alt="Mirage radar with a graded CS2 moment" />
        <i className="pv-dot ct" style={{ left: '62%', top: '30%' }} /><i className="pv-dot ct" style={{ left: '44%', top: '55%' }} />
        <i className="pv-dot t" style={{ left: '70%', top: '64%' }} /><i className="pv-dot t dead" style={{ left: '55%', top: '72%' }} />
        <div className="pv-card">
          <div className="pv-card-head"><MarkFace note="?" size={22} /><b>Mistake</b><span className="pv-gain">−11%</span></div>
          <p>Died alone at Palace: nobody could trade.</p>
        </div>
        <div className="pv-eval"><i style={{ width: '58%' }} /></div>
        <span className="pv-label">CS2</span>
      </div>
      <div className="pv-frame dl">
        <img className="pv-map" src={DL_MAP_IMAGE} alt="Deadlock map with a graded fight" />
        <i className="pv-dot t" style={{ left: '40%', top: '60%' }} /><i className="pv-dot t" style={{ left: '46%', top: '64%' }} />
        <i className="pv-dot ct" style={{ left: '50%', top: '47%' }} /><i className="pv-dot ct" style={{ left: '56%', top: '52%' }} /><i className="pv-dot ct" style={{ left: '44%', top: '45%' }} />
        <div className="pv-card">
          <div className="pv-card-head"><MarkFace note="??" size={22} /><b>Blunder</b><span className="pv-gain">−14%</span></div>
          <p>Fought 2 against 3 with your ultimate down.</p>
        </div>
        <div className="pv-eval"><i style={{ width: '41%' }} /></div>
        <span className="pv-label">Deadlock</span>
      </div>
    </div>
  );
}
