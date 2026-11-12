import { useState } from 'react';
import { APP_NAME } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { setNotifyGame, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const GAME = GAMES.find(g => g.id === 'deadlock')!;

/**
 * Deadlock's page while it's in beta: Review works (by match ID), what the coach grades, and "tell me when
 * it's complete" (saved on the profile: the account when logged in, else this browser).
 */
export function Deadlock() {
  const me = useProfile(s => s.me), remote = useProfile(s => s.remote);
  const on = useProfile(s => s.data.notifyGames.includes(GAME.id));
  const [busy, setBusy] = useState(false);
  const toggle = async () => { setBusy(true); await setNotifyGame(GAME.id, !on); setBusy(false); };
  return (
    <div className="page dl" style={{ '--game': GAME.color } as React.CSSProperties}>
      <section className="dl-hero">
        <div className="dl-hero-text">
          <span className="eyebrow"><GameMark game={GAME} size={14} /> {GAME.name} <span className={`games-status ${GAME.status}`}>{STATUS_LABEL[GAME.status]}</span></span>
          <h1>Every Deadlock fight, graded.</h1>
          <p className="lead">Paste a match ID. Watch it on the map while the coach marks every fight, death and lane.</p>
          <div className="hero-cta">
            <a className="cta primary" href="/deadlock/review">Review a Deadlock match <Icon name="arrowRight" size={14} /></a>
            <button className="cta" onClick={toggle} disabled={busy} aria-pressed={on}>
              <Icon name={on ? 'check' : 'bell'} size={14} /> {on ? 'You\'ll be told about new Deadlock features' : 'Tell me about new Deadlock features'}
            </button>
          </div>
          {on && (me && remote
            ? <p className="muted small">It'll show on your profile when Deadlock is live. No emails.</p>
            : <div className="dl-login"><span className="muted small">Saved in this browser. Log in so it follows you to any device:</span><SteamLoginButton compact /></div>)}
        </div>
        {/* a real replay (the public sample, players' names hidden) instead of an empty box with the logo */}
        <img className="dl-hero-shot" src="/images/shots/replay.jpg" alt="A Deadlock replay: both teams on the map and a graded death explained" width={800} height={562} />
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
          <li><b>Pick a match</b><span>Yours after logging in with Steam, or any by its match ID.</span></li>
          <li><b>Replay it</b><span>Every hero on the map, kills and objectives as they happened.</span></li>
          <li><b>Every play graded</b><span>Brilliant to blunder, against players of your hero in your position.</span></li>
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
        <span className="muted">Not affiliated with Valve. Deadlock and its logo belong to Valve.</span>
      </footer>
    </div>
  );
}

const GRADES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'swords', title: 'Kills', text: 'What each kill was worth.' },
  { icon: 'map', title: 'Map activity', text: 'Camps, Urn, bosses, objectives.' },
  { icon: 'bolt', title: 'Abilities', text: 'Damage by ability, ult usage.' },
  { icon: 'route', title: 'Rotations', text: 'Ganks that paid off, and ones that didn\'t.' },
  { icon: 'shield', title: 'Survival', text: 'Deaths you could have avoided.' },
  { icon: 'trendUp', title: 'Laning', text: 'Souls and last hits vs your role.' },
];


const FAQ = [
  { q: 'Where do matches come from?', a: 'deadlock-api.com, a free community service with Deadlock match data. A match shows up there a few minutes to an hour after it ends.' },
  { q: 'Will it be free?', a: 'Yes, same as CS2. Pro adds unlimited history and is free during early access.' },
  { q: 'Which matches?', a: 'Any public match: log in with Steam for yours, or paste a match ID (in game: Match history).' },
];
