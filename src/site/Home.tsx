import { COACH_MODEL, PRO_MODEL } from '../engine/coachModels';
import { FREE_HISTORY, PRO_EARLY_ACCESS } from '../engine/profile';
import { LETTER_COLOR } from '../engine/recap';
import { APP_NAME, LogoMark } from '../shell/Logo';
import { Icon, type IconName } from '../ui/Icon';
import { GAMES, STATUS_LABEL } from './games';

const MATCHES = COACH_MODEL.source?.demos ?? COACH_MODEL.trainedOn;
const PRO_MATCHES = PRO_MODEL?.source?.demos ?? 0;

/** The front page: what it is, how it works, what you get, what it costs. */
export function Home() {
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow"><Icon name="bolt" size={12} /> Free CS2 coach · runs in your browser</span>
          <h1>You were right. Prove it.</h1>
          <p className="lead">
            The argument after the match ends here. Drop the CS2 demo: every kill, death and grenade gets a grade, an engine shows the better
            play, and a coach trained on {MATCHES} FACEIT level-10 matches settles who threw the round. Sometimes it's them. Sometimes it's you.
          </p>
          <div className="hero-cta">
            <a className="cta primary" href="#/cs2/review">Settle it <Icon name="arrowRight" size={14} /></a>
            <a className="cta" href="#/cs2/tactical">Plan a round</a>
          </div>
          <ul className="hero-trust">
            <li><Icon name="shield" size={14} /> Your demo never leaves your computer</li>
            <li><Icon name="check" size={14} /> Valve, FACEIT and HLTV demos</li>
          </ul>
        </div>
        <HeroPreview />
      </section>

      <section className="stat-strip" aria-label="In numbers">
        <div><b>{MATCHES}</b><span>level-10 matches learned</span></div>
        {PRO_MATCHES > 0 && <div><b>{PRO_MATCHES}</b><span>pro matches to compare with</span></div>}
        <div><b>2 s</b><span>between engine checks</span></div>
        <div><b>0 MB</b><span>uploaded</span></div>
      </section>

      <section className="site-section">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">
          <li><b>Get a demo</b><span>CS2 → Watch → Your Matches → download. Or log in with Steam and paste your match code once.</span></li>
          <li><b>Drop it in</b><span>The demo is read right here in your browser, about 40 s for a full match.</span></li>
          <li><b>Watch it back</b><span>Each round replays on the radar with a live win chance. The worst moments stop and explain themselves.</span></li>
          <li><b>Fix one thing</b><span>The coach picks what costs you most. Set it as a goal and see it change match after match.</span></li>
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
        <h2 className="section-title">Games</h2>
        <div className="games-grid">
          {GAMES.map(g => {
            const body = (
              <>
                <span className="games-badge">{g.short}</span>
                <div><b>{g.name}</b><p>{g.note}</p></div>
                <span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span>
              </>
            );
            return g.status === 'live'
              ? <a key={g.id} className="games-card live" href="#/cs2/review">{body}</a>
              : <div key={g.id} className="games-card">{body}</div>;
          })}
        </div>
      </section>

      <section className="site-section pricing-teaser">
        <div>
          <h2 className="section-title">Free to use</h2>
          <p className="muted">Reviews, grades, the coach and your last {FREE_HISTORY} matches are free. Pro adds unlimited history, the engine's
            line for every moment and early features{PRO_EARLY_ACCESS ? ', and it costs nothing during early access' : ''}.</p>
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
        <span className="muted">Not affiliated with Valve or FACEIT. Counter-Strike is a trademark of Valve Corporation.</span>
      </footer>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'bolt', title: 'Rage mode', text: 'Turn it on and the coach loses it at your plays, like your angriest teammate: "Why the fuck did you go there?" Grades stay honest. 18+.' },
  { icon: 'play', title: 'Graded replay', text: 'Every round on the radar with a live win chance. Kills, deaths and grenades get a grade, like a chess game review.' },
  { icon: 'route', title: 'The engine\'s line', text: 'Every 2 s it weighs holding, moving, peeking, your grenades and the bomb, and shows where the better play was.' },
  { icon: 'star', title: 'A coach, not a scoreboard', text: `Your numbers against FACEIT level 10${PRO_MATCHES ? ' and pros' : ''}, with the one thing to work on first and the rounds to watch.` },
  { icon: 'goal', title: 'Goals that track', text: 'Pick up to 3 habits to fix. Your profile shows each one, match by match, against level 10.' },
  { icon: 'friends', title: 'Compare with a friend', text: 'Put your last matches side by side with a friend\'s, when they make their profile public.' },
  { icon: 'share', title: 'Share card', text: 'Turn any match into a picture for Discord: the map, the score, your grade and your numbers.' },
];

const FAQ = [
  { q: 'Is it really free?', a: `Yes. Reviews, grades, the coach, goals and your last ${FREE_HISTORY} matches are free. Pro (unlimited history, the engine for every moment, supporter badge) is free during early access; there is no payment yet.` },
  { q: 'Is my demo uploaded?', a: 'No. The demo is read in your browser with a WebAssembly parser. Only if you log in with Steam does your profile (each reviewed match\'s numbers, never the demo) get saved to your account.' },
  { q: 'Do I need to log in?', a: 'No. Without logging in, your profile is kept in this browser. Log in with Steam (Steam\'s own login page; we only ever see your SteamID) to keep it on every device and to compare with friends.' },
  { q: 'Which demos work?', a: 'Valve matchmaking and Premier demos, FACEIT and HLTV demos (unzip them first), on the 9 competitive maps plus Cache.' },
  { q: 'How good is the coach?', a: `It learned from ${MATCHES} FACEIT level-10 matches${PRO_MATCHES ? ` and ${PRO_MATCHES} pro matches` : ''}. It sees positions, fights, grenades and economy, but not your team's calls: when it flags something you did on a call, it says so.` },
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
      <span className="pv-label">Preview</span>
    </div>
  );
}
