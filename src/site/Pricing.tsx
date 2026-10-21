import { useState } from 'react';
import { STEAM_AVAILABLE } from '../env';
import { FREE_HISTORY, MAX_HISTORY, PRO_EARLY_ACCESS } from '../engine/profile';
import { Icon } from '../ui/Icon';
import { setNotifyPro, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';

const FREE = [
  'Graded replay of every round',
  'The coach against FACEIT level 10',
  'The engine\'s biggest mistakes in each match',
  `Profile with your last ${FREE_HISTORY} matches`,
  'Up to 3 goals, map stats, share cards',
  'Compare with a friend',
];
const PRO = [
  'Everything in Free',
  `Unlimited history (your last ${MAX_HISTORY} matches, trends over all of them)`,
  'Engine deep dive: the best line for every moment, not just the worst',
  'Compare with pro players, not just level 10',
  'Supporter badge on your profile',
  'New features first',
];

/** Plans. There are no payments yet: during early access everyone has Pro. */
export function Pricing() {
  const me = useProfile(s => s.me), notify = useProfile(s => s.data.notifyPro), remote = useProfile(s => s.remote);
  const [busy, setBusy] = useState(false);
  const toggle = async () => { setBusy(true); await setNotifyPro(!notify); setBusy(false); };
  return (
    <div className="page pricing">
      <header className="page-head">
        <h1>Plans</h1>
        <p className="lead">The coach is free. Pro is for people who review every match{PRO_EARLY_ACCESS ? ', and right now it\'s free too.' : '.'}</p>
      </header>
      {PRO_EARLY_ACCESS && (
        <div className="notice"><Icon name="bolt" size={16} /> <span><b>Early access:</b> every Pro feature is unlocked for everyone while RageView is new. Nothing to pay, no card needed.</span></div>
      )}
      <div className="plans">
        <section className="plan">
          <h2>Free</h2>
          <p className="price"><b>$0</b><span>forever</span></p>
          <ul>{FREE.map(f => <li key={f}><Icon name="check" size={14} /> {f}</li>)}</ul>
          <a className="cta" href="#/cs2/review">Review a match</a>
        </section>
        <section className="plan featured">
          <span className="plan-tag">{PRO_EARLY_ACCESS ? 'Free in early access' : 'Most complete'}</span>
          <h2>Pro</h2>
          <p className="price"><b>Coming soon</b><span>{PRO_EARLY_ACCESS ? 'unlocked for you now' : ''}</span></p>
          <ul>{PRO.map(f => <li key={f}><Icon name="check" size={14} /> {f}</li>)}</ul>
          {me && remote ? (
            <button className={notify ? 'cta' : 'cta primary'} onClick={toggle} disabled={busy} aria-pressed={notify}>
              <Icon name="bell" size={14} /> {notify ? 'You\'ll be told when Pro launches' : 'Tell me when Pro launches'}
            </button>
          ) : STEAM_AVAILABLE ? (
            <div className="plan-login"><span className="muted">Log in to be told when Pro launches:</span><SteamLoginButton compact /></div>
          ) : <p className="muted">Pro launches later; everything is unlocked until then.</p>}
          {me && remote && notify && <p className="muted small">You'll see it on your profile when it launches. We don't email you.</p>}
        </section>
      </div>
    </div>
  );
}
