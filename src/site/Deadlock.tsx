import { useState } from 'react';
import { APP_NAME } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { setNotifyGame, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const GAME = GAMES.find(g => g.id === 'deadlock')!;

/**
 * Deadlock's page before it's live: what the coach will do there, how far along it is, and "tell me when it's live"
 * (saved on the profile: the account when logged in, else this browser). Honest about the state: nothing is built yet.
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
          <h1>The same coach, for Deadlock.</h1>
          <p className="lead">Every lane, rotation and fight graded, with the better play. Next game on {APP_NAME}.</p>
          <div className="hero-cta">
            <button className={on ? 'cta' : 'cta primary'} onClick={toggle} disabled={busy} aria-pressed={on}>
              <Icon name={on ? 'check' : 'bell'} size={14} /> {on ? 'You\'ll be told when it\'s live' : 'Tell me when it\'s live'}
            </button>
            <a className="cta" href="#/cs2/review">Review a CS2 match meanwhile</a>
          </div>
          {on && (me && remote
            ? <p className="muted small">It'll show on your profile when Deadlock is live. No emails.</p>
            : <div className="dl-login"><span className="muted small">Saved in this browser. Log in so it follows you to any device:</span><SteamLoginButton compact /></div>)}
        </div>
        <div className="dl-hero-mark" aria-hidden>
          <GameMark game={GAME} size={168} />
        </div>
      </section>

      <section className="site-section">
        <h2 className="section-title">What it will grade</h2>
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
        <h2 className="section-title">How it will work</h2>
        <ol className="steps">
          <li><b>Bring a match</b><span>A Deadlock demo or match ID.</span></li>
          <li><b>Read in your browser</b><span>Nothing uploaded, like CS2.</span></li>
          <li><b>Every play graded</b><span>Brilliant to blunder, with a win chance.</span></li>
          <li><b>Fix one thing</b><span>The coach picks it. You track it.</span></li>
        </ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">Where it's at</h2>
        <p className="muted dl-why">Deadlock runs on Source 2 like CS2, so its demos can be read the same way. The heroes, the map and what a good play looks like are new work.</p>
        <ol className="dl-road">
          {ROAD.map((r, i) => (
            <li key={r.title} className={i === 0 ? 'next' : ''}>
              <span className="dl-road-dot" aria-hidden />
              <div><b>{r.title}</b><span>{r.text}</span></div>
              <span className={`games-status ${i === 0 ? 'next' : 'planned'}`}>{i === 0 ? 'Next' : 'Planned'}</span>
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
        <span className="muted">Not affiliated with Valve. Deadlock and its logo belong to Valve.</span>
      </footer>
    </div>
  );
}

const GRADES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'swords', title: 'Laning', text: 'Last hits, denies and souls against your lane. When the lane was lost, and why.' },
  { icon: 'route', title: 'Rotations', text: 'When you left lane, ganks you joined or missed, getting to fights on time.' },
  { icon: 'target', title: 'Teamfights', text: 'Who you hit, what landed, the death that lost the fight.' },
  { icon: 'map', title: 'Objectives', text: 'Guardians, Walkers, Shrines and the Patron. Mid Boss and Urn timing.' },
  { icon: 'trendUp', title: 'Souls and items', text: 'Your build against theirs. Souls left unspent when you died.' },
  { icon: 'bolt', title: 'Rage mode', text: 'The coach yells at your Deadlock plays too. 18+.' },
];

const ROAD = [
  { title: 'Read Deadlock demos', text: 'Heroes, positions, souls, damage and objectives over the match.' },
  { title: 'Map and replay', text: 'The match on the map, like CS2\'s Review.' },
  { title: 'Grading', text: 'Every fight, rotation and objective scored.' },
  { title: 'The coach', text: 'Your habits across matches, one thing to fix.' },
];

const FAQ = [
  { q: 'When?', a: 'No date yet. Turn on "Tell me" and it shows on your profile when it\'s live.' },
  { q: 'Will it be free?', a: 'Yes, same as CS2. Pro adds unlimited history and is free during early access.' },
  { q: 'Which matches?', a: 'Your own Deadlock matches. When it\'s ready, this page says exactly how to get the file.' },
];
