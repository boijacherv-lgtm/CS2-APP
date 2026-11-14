import { DL_MATCHES, FAQ, MATCHES, PRO_MATCHES } from './faq';
import { proEarlyAccess, useSiteConfig } from '../ui/siteConfig';

import { APP_NAME, LogoMark } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, PLAYABLE, STATUS_LABEL } from './games';
import { SiteFooter } from './SiteFooter';
import { GameMark } from './gameMarks';
import { useEffect, useRef, useState } from 'react';
import { setNotifyGame, useProfile } from '../ui/profileApi';
import { openCs2Sample, openDlSample } from '../ui/sample';


/** The hero's loop with a pause button (a moving picture that runs over 5 s needs one: WCAG 2.2.2). */
function HeroLoop() {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  // plays only while it's on screen (and only if you haven't paused it)
  const paused = useRef(false);
  useEffect(() => {
    const v = ref.current; if (!v || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { if (!paused.current) void v.play().catch(() => {}); } else v.pause(); }, { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) { paused.current = false; void v.play(); setPlaying(true); } else { paused.current = true; v.pause(); setPlaying(false); } };
  return (
    <figure className="hero-loop">
      <video ref={ref} src="/videos/hero-cs2.webm" poster="/videos/hero-cs2.jpg" autoPlay muted loop playsInline preload="metadata" aria-label="A graded round from the CS2 sample playing on the radar" />
      <button className="hero-loop-btn" onClick={toggle} aria-label={playing ? 'Pause the video' : 'Play the video'}><Icon name={playing ? 'pause' : 'play'} size={14} /></button>
    </figure>
  );
}

const ROASTS = ['You killed your own teammate. The enemy says thanks.', 'Wrong team, genius.', 'Friendly fire isn\'t a strategy.'];

const toGames = () => document.getElementById('games')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The front page, about every game rather than one: what it is, which games, how it works, what you get, what it
 * costs. Short on purpose; dressed in the neutral theme (tokens.ts themeOf). */
export function Home() {
  const cfg = useSiteConfig(), coming = cfg.flags.comingSoon;
  const top = GAMES.slice(0, 3), more = GAMES.slice(3);
  // a public high-rank Deadlock match, opened on the board: the product without a demo of your own
  const [sample, setSample] = useState<'idle' | 'opening' | 'failed'>('idle');
  const tryCs2Sample = async () => {
    setSample('opening');
    try { await openCs2Sample(); } catch { setSample('failed'); }
  };
  const trySample = async () => {
    setSample('opening');
    try { await openDlSample(); } catch { setSample('failed'); }
  };
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow"><Icon name="bolt" size={12} /> Free · Nothing uploaded</span>
          <h1>{cfg.hero.h1 || 'Every move you make, graded.'}</h1>
          <p className="lead">{cfg.hero.lead || 'Load a match. The coach marks every kill, death and grenade, right or wrong, and shows the better play.'}</p>
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
        {/* the hero: a real graded round from the CS2 sample, playing (still frame with reduced motion) */}
        <HeroLoop />
      </section>

      <section className="site-section" id="games">
        <h2 className="section-title">Pick your game</h2>
        {/* set on the dev page (Content → flags) */}
        {coming && <p className="muted coming-soon"><Icon name="bell" size={13} /> Coming soon: {coming}</p>}
        <div className="game-cards">
          {top.map(g => g.review ? (
            <article key={g.id} className={`game-card live ${g.status}`} style={{ '--game': g.color } as React.CSSProperties}>
              <div className="game-card-head"><GameMark game={g} size={48} /><div><b>{g.name}</b><span className={`games-status ${g.status}`}>{g.status === 'live' ? 'Live now' : STATUS_LABEL[g.status]}</span></div></div>
              <p>{g.note}</p>
              {g.points && <ul className="game-card-points">{g.points.map(x => <li key={x}>{x}</li>)}</ul>}
              <div className="game-card-cta">
                <a className="cta primary" href={g.review}>Review a {g.id === 'deadlock' ? g.name : g.short} match</a>
                {g.plan && <a className="cta" href={g.plan}>{g.planLabel ?? 'Tactical board'}</a>}
                {g.page && <a className="cta ghost" href={g.page}>About {g.id === 'deadlock' ? g.name : g.short}</a>}
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
        <h2 className="section-title">See it: a graded kill, a graded fight, a puzzle</h2>
        <div className="shots">
          {SHOTS.map(x => (
            <figure key={x.src} className="shot">
              <img src={x.src} alt={x.alt} width={x.w} height={x.h} loading="lazy" />
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

      <section className="site-section rage-band rage-loud">
        <div className="rage-head">
          <h2 className="section-title">Rage mode.</h2>
          <span className="chip rage-18">18+</span>
        </div>
        <p className="rage-lead">The coach roasts your worst plays. Loud. At the play, never at you.</p>
        {/* real lines from the coach's list (src/engine/coach-remarks.json) */}
        <ul className="rage-samples">
          {ROASTS.map(t => <li key={t}>“{t}”</li>)}
        </ul>
        <a className="cta primary" href="/settings">Turn it on in Settings</a>
      </section>

      {/* the last word: back to the main job */}
      <section className="site-section final-cta" style={{ '--poster': 'url(/videos/hero-cs2.jpg)' } as React.CSSProperties}>
        <h2 className="section-title">Your last match is waiting.</h2>
        <div className="hero-cta">
          <a className="cta primary" href="/cs2/review">Review my match <Icon name="arrowRight" size={14} /></a>
        </div>
      </section>

      <section className="site-section">
        <h2 className="section-title">Questions</h2>
        <div className="faq">
          {(cfg.faq.length ? cfg.faq : FAQ).map(q => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

/** Real screens (a public Deadlock match with the players' names hidden, a top players' CS2 puzzle). */
/** Real screens from both games (sample matches, players' names hidden). */
const SHOTS = [
  { src: '/images/shots/cs2-moment.jpg', w: 1819, h: 700, alt: 'CS2: the map at the moment of an opening kill, and its coach card: the kill, the win chance 88% to 92%, the tags and the duel odds' },
  { src: '/images/shots/dl-moment.jpg', w: 1206, h: 706, alt: 'Deadlock: the map at a death marked Mistake, and its card: Player 7 died alone against 2, the win chance, and the better play: farm camps instead of fighting' },
  { src: '/images/shots/puzzle.jpg', w: 1067, h: 505, alt: 'A CS2 puzzle on Nuke: the map with both teams and three moves to choose from' },
];

const WHY: { icon: IconName; title: string; text: string }[] = [
  { icon: 'shield', title: 'Nothing uploaded', text: 'Your demo stays on your PC.' },
  { icon: 'target', title: 'One coach, every game', text: 'The same marks and grades in every game.' },
  { icon: 'star', title: 'Free', text: proEarlyAccess() ? 'Pro is free in early access.' : 'Everything you need is free.' },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'play', title: 'Graded replay', text: 'Every play scored, with a live win-chance bar.' },
  { icon: 'route', title: 'The better play', text: 'The better play, and how much it would have helped.' },
  { icon: 'star', title: 'Pro comparison', text: 'You next to the best players in your game.' },
  { icon: 'goal', title: 'Goals', text: 'Pick 3 habits. Watch them get better.' },
  { icon: 'friends', title: 'Friends', text: 'Your stats next to theirs. Settle it.' },
  { icon: 'share', title: 'Share card', text: 'Your match as an image. Post it in Discord.' },
];



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
