import { DL_MATCHES, FAQ, MATCHES, PRO_MATCHES } from './faq';
import { PRO_EARLY_ACCESS } from '../engine/profile';
import { DL_MAP_IMAGE } from '../deadlock/data';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, PLAYABLE, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';
import { MarkFace } from '../ui/MarkFace';
import { useState } from 'react';
import { setNotifyGame, useProfile } from '../ui/profileApi';
import { navigate } from '../shell/router';
import { openCs2Sample } from '../ui/sample';

/** The sample: a public Phantom+ match (46 min, both teams' fights and objectives), opened from deadlock-api. */
const SAMPLE_MATCH = 131074890;

const toGames = () => document.getElementById('games')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The front page, about every game rather than one: what it is, which games, how it works, what you get, what it
 * costs. Short on purpose; dressed in the neutral theme (tokens.ts themeOf). */
export function Home() {
  const top = GAMES.slice(0, 3), more = GAMES.slice(3);
  // a public high-rank Deadlock match, opened on the board: the product without a demo of your own
  const [sample, setSample] = useState<'idle' | 'opening' | 'failed'>('idle');
  const tryCs2Sample = async () => {
    setSample('opening');
    try { await openCs2Sample(); } catch { setSample('failed'); }
  };
  const trySample = async () => {
    setSample('opening');
    try { const { openMatch } = await import('../deadlock/open'); await openMatch(SAMPLE_MATCH); navigate({ page: 'deadlock', mode: 'review' }); } catch { setSample('failed'); }
  };
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow"><Icon name="bolt" size={12} /> Free · Nothing uploaded</span>
          <h1>Every move you make, graded.</h1>
          <p className="lead">Load a match. The coach marks every kill, death and grenade, right or wrong, and shows the better play.</p>
          <div className="hero-games" aria-label="Games">
            {PLAYABLE.map(g => (
              <a key={g.id} className="hero-games-live" href={g.page ?? g.review}><GameMark game={g} size={30} /><b>{g.name}</b><span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></a>
            ))}
          </div>
          {/* two actions: review a match (the game chips above pick the game), or try a sample */}
          <div className="hero-cta">
            <a className="cta primary" href="/cs2/review">Review my match <Icon name="arrowRight" size={14} /></a>
            {/* a sample in either game: a small menu, CS2 or Deadlock */}
            <details className="sample-menu">
              <summary className="cta"><Icon name="play" size={12} /> {sample === 'opening' ? 'Opening…' : 'Watch a sample'}</summary>
              <div className="sample-pop">
                <button onClick={tryCs2Sample} disabled={sample === 'opening'}><Icon name="crosshair" size={14} /> CS2 sample <span className="muted small">a FACEIT Mirage match</span></button>
                <button onClick={trySample} disabled={sample === 'opening'}><Icon name="target" size={14} /> Deadlock sample <span className="muted small">a Phantom+ match</span></button>
              </div>
            </details>
          </div>
          {sample === 'failed' && <p className="warn-text">Couldn't open the sample, try again.</p>}
          <ul className="hero-trust">
            <li><Icon name="shield" size={14} /> Runs in your browser</li>
            <li><Icon name="check" size={14} /> No account needed</li>
          </ul>
        </div>
        <HeroPreview />
      </section>

      <section className="site-section" id="games">
        <h2 className="section-title">Pick your game</h2>
        <div className="game-cards">
          {top.map(g => g.review ? (
            <article key={g.id} className={`game-card live ${g.status}`} style={{ '--game': g.color } as React.CSSProperties}>
              <div className="game-card-head"><GameMark game={g} size={48} /><div><b>{g.name}</b><span className={`games-status ${g.status}`}>{g.status === 'live' ? 'Live now' : STATUS_LABEL[g.status]}</span></div></div>
              <p>{g.note}</p>
              {g.points && <ul className="game-card-points">{g.points.map(x => <li key={x}>{x}</li>)}</ul>}
              <div className="game-card-cta">
                <a className="cta primary" href={g.review}>Review a {g.short} match</a>
                {g.plan && <a className="cta" href={g.plan}>{g.planLabel ?? 'Tactical board'}</a>}
                {g.page && <a className="cta ghost" href={g.page}>About {g.short}</a>}
              </div>
            </article>
          ) : (
            <article key={g.id} className={`game-card soon ${g.status}`} style={{ '--game': g.color } as React.CSSProperties}>
              <div className="game-card-head"><GameMark game={g} size={44} muted={g.status !== 'next'} /><div><b>{g.name}</b><span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></div></div>
              <p>{g.note}</p>
              <div className="game-card-cta">{g.page ? <a className="cta" href={g.page}>What's coming <Icon name="arrowRight" size={14} /></a> : <NotifyGame id={g.id} name={g.name} />}</div>
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
          <li><b>Load a match</b><span>A demo file or a match ID.</span></li>
          <li><b>Watch it back</b><span>Every move gets a mark.</span></li>
          <li><b>Fix one thing</b><span>The coach picks it, you track it.</span></li>
        </ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">See it</h2>
        <div className="shots">
          {SHOTS.map(x => (
            <figure key={x.src} className="shot">
              <img src={x.src} alt={x.alt} width={800} height={600} loading="lazy" />
              <figcaption><b>{x.title}</b> {x.text}</figcaption>
            </figure>
          ))}
        </div>
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
        <h2 className="section-title">Why RageView</h2>
        <div className="feature-grid">
          {WHY.map(f => (
            <div key={f.title} className="feature">
              <span className="feature-ico"><Icon name={f.icon} size={18} /></span>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
        {/* the numbers come from the models the site uses, never typed in */}
        <p className="muted proof">Trained on {MATCHES} level-10 CS2 matches{PRO_MATCHES > 0 ? `, ${PRO_MATCHES} pro matches` : ''} and {DL_MATCHES.toLocaleString('en-US')} Phantom+ Deadlock matches.</p>
      </section>

      <section className="site-section pricing-teaser rage-band">
        <div>
          <h2 className="section-title">Rage mode.</h2>
          <p className="muted">The coach roasts your worst plays. 18+.</p>
        </div>
        <a className="cta" href="/settings">Turn it on</a>
      </section>

      {/* the last word: back to the main job */}
      <section className="site-section final-cta">
        <h2 className="section-title">Your last match is waiting.</h2>
        <div className="hero-cta">
          <a className="cta primary" href="/cs2/review">Review my match <Icon name="arrowRight" size={14} /></a>
        </div>
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
          {PLAYABLE.map(g => <a key={g.id} href={g.page ?? g.review}>{g.name}</a>)}<a href="/profile">Profile</a><a href="/pricing">Pricing</a><a href="/settings">Settings</a><a href="/puzzles">Puzzles</a><a href="/changelog">What's new</a><a href="/privacy">Privacy</a>
        </nav>
        <span className="muted">Made by a player. Not affiliated with Valve. © {new Date().getFullYear()} {APP_NAME}</span>
      </footer>
    </div>
  );
}

/** Real screens (a public Deadlock match with the players' names hidden, a top players' CS2 puzzle). */
/** Real screens from both games (sample matches, players' names hidden). */
const SHOTS = [
  { src: '/images/shots/cs2-replay.jpg', title: 'CS2 · The replay.', text: 'Every kill graded on the radar.', alt: 'CS2 replay on Mirage: both teams, the killfeed and a graded kill card' },
  { src: '/images/shots/replay.jpg', title: 'Deadlock · The replay.', text: 'Every death graded on the map.', alt: 'Deadlock replay: the map, both teams, and a graded death explained' },
  { src: '/images/shots/puzzle.jpg', title: 'Puzzles.', text: 'Find the best move, then see the answer.', alt: 'A CS2 puzzle on Nuke with four moves and the engine answer' },
  { src: '/images/shots/coach.jpg', title: 'Deadlock · The engine.', text: 'Your costliest moves and best calls.', alt: 'Deadlock recap engine card: accuracy 92, costliest moves and best calls with reasons' },
  { src: '/images/shots/dl-meta.jpg', title: 'Deadlock · Meta & builds.', text: 'Every hero on this patch, by position.', alt: 'Deadlock meta table: heroes by position with tier, win rate and pick rate' },
];

const WHY: { icon: IconName; title: string; text: string }[] = [
  { icon: 'shield', title: 'Nothing uploaded', text: 'Your demo stays on your PC.' },
  { icon: 'target', title: 'One coach, every game', text: 'The same marks and grades in every game.' },
  { icon: 'star', title: 'Free', text: PRO_EARLY_ACCESS ? 'Pro is free in early access.' : 'Everything you need is free.' },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'play', title: 'Graded replay', text: 'Every play scored, with a live win-chance bar.' },
  { icon: 'route', title: 'The engine', text: 'The better play, and how much it would have helped.' },
  { icon: 'star', title: 'Pro comparison', text: 'You next to the best players in your game.' },
  { icon: 'bolt', title: 'Rage mode', text: 'The coach roasts your plays. Loud. 18+.' },
  { icon: 'goal', title: 'Goals', text: 'Pick 3 habits. Watch them get better.' },
  { icon: 'friends', title: 'Friends', text: 'Your stats next to theirs. Settle it.' },
  { icon: 'share', title: 'Share card', text: 'Your match as an image. Post it in Discord.' },
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
          <div className="pv-card-head"><MarkFace note="?" size={22} /><b>Mistake</b><span className="pv-gain">−11 pts</span></div>
          <p>Died alone at Palace: nobody could trade.</p>
        </div>
        <div className="pv-eval"><i style={{ width: '58%', '--from': '58%', '--to': '47%' } as React.CSSProperties} /></div>
        <span className="pv-label">CS2</span>
      </div>
      <div className="pv-frame dl">
        <img className="pv-map" src={DL_MAP_IMAGE} alt="Deadlock map with a graded fight" />
        <i className="pv-dot t" style={{ left: '40%', top: '60%' }} /><i className="pv-dot t" style={{ left: '46%', top: '64%' }} />
        <i className="pv-dot ct" style={{ left: '50%', top: '47%' }} /><i className="pv-dot ct" style={{ left: '56%', top: '52%' }} /><i className="pv-dot ct" style={{ left: '44%', top: '45%' }} />
        <div className="pv-card">
          <div className="pv-card-head"><MarkFace note="??" size={22} /><b>Blunder</b><span className="pv-gain">−14 pts</span></div>
          <p>Fought 2 against 3 with your ultimate down.</p>
        </div>
        <div className="pv-eval"><i style={{ width: '41%', '--from': '55%', '--to': '41%' } as React.CSSProperties} /></div>
        <span className="pv-label">Deadlock</span>
      </div>
    </div>
  );
}

/** "Ping me when it's live" for a coming game: saved on your profile (your account logged in, else this browser). */
function NotifyGame({ id, name }: { id: string; name: string }) {
  const on = useProfile(s => s.data.notifyGames.includes(id));
  const [busy, setBusy] = useState(false);
  return (
    <button className="cta" disabled={busy} aria-pressed={on} title={`${name} is coming: it shows on your profile when it's live. No emails.`}
      onClick={async () => { setBusy(true); await setNotifyGame(id, !on); setBusy(false); }}>
      <Icon name={on ? 'check' : 'bell'} size={14} /> {on ? 'We\'ll ping you' : 'Ping me when it\'s live'}
    </button>
  );
}
