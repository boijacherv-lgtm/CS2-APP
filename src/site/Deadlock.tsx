import { useState } from 'react';
import { APP_NAME } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { setNotifyGame, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { GAMES, STATUS_LABEL } from './games';
import { GameMark } from './gameMarks';

const GAME = GAMES.find(g => g.id === 'deadlock')!;

/**
 * Deadlock's page while it's in beta: Review works (by match ID), what the coach will grade next, and "tell me when
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
          <h1>The same coach, for Deadlock.</h1>
          <p className="lead">Replay any match on the real map, second by second: every hero, kill and objective. The coach that grades every lane, rotation and fight is next on {APP_NAME}.</p>
          <div className="hero-cta">
            <a className="cta primary" href="#/deadlock/review">Review a match <Icon name="arrowRight" size={14} /></a>
            <button className="cta" onClick={toggle} disabled={busy} aria-pressed={on}>
              <Icon name={on ? 'check' : 'bell'} size={14} /> {on ? 'You\'ll be told when the coach is in' : 'Tell me when the coach is in'}
            </button>
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
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          <li><b>Pick a match</b><span>Yours after logging in with Steam, or any by its match ID.</span></li>
          <li><b>Replay it</b><span>Every hero on the map, kills and objectives as they happened.</span></li>
          <li><b>Every play graded</b><span>Brilliant to blunder, with a win chance.</span></li>
          <li><b>Fix one thing</b><span>The coach picks it. You track it.</span></li>
        </ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">Where it's at</h2>
        <p className="muted dl-why">Match data comes from deadlock-api.com (positions every second, deaths, items, souls, objectives), so any match works without a file. Reading a .dem you saved comes later.</p>
        <ol className="dl-road">
          {ROAD.map(r => (
            <li key={r.title} className={r.state === 'next' ? 'next' : ''}>
              <span className="dl-road-dot" aria-hidden />
              <div><b>{r.title}</b><span>{r.text}</span></div>
              <span className={`games-status ${r.state === 'done' ? 'live' : r.state}`}>{r.state === 'done' ? 'Live' : r.state === 'next' ? 'Next' : 'Planned'}</span>
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

const ROAD: { title: string; text: string; state: 'done' | 'next' | 'planned' }[] = [
  { title: 'Map and replay', text: 'Any match by its ID on the real map: heroes, kills, objectives, souls.', state: 'done' },
  { title: 'The coach and Match recap', text: 'Deaths, laning, fights, objectives and items graded, with the better play.', state: 'next' },
  { title: 'Tactical', text: 'A macro planner, a teamfight planner and builds with power spikes.', state: 'planned' },
  { title: 'Your .dem files', text: 'Open a demo you saved, like CS2.', state: 'planned' },
];

const FAQ = [
  { q: 'Where do matches come from?', a: 'deadlock-api.com, a free community service with Deadlock match data. A match shows up there a few minutes to an hour after it ends.' },
  { q: 'Will it be free?', a: 'Yes, same as CS2. Pro adds unlimited history and is free during early access.' },
  { q: 'Which matches?', a: 'Any public match: log in with Steam for yours, or paste a match ID (in game: Match history).' },
];
