/**
 * Privacy (what the site keeps, where, and what it sends) and What's new (the changelog). Plain pages; the privacy
 * text follows the code: worker/src/profile.ts, clips.ts, dlDisputes.ts, the Deadlock bot and the browser stores.
 */
import { useState } from 'react';
import { APP_NAME } from '../shell/Logo';
import DEATHS from '../map/generated/death-spots.json';
import { mapName } from './format';

export function Privacy() {
  return (
    <div className="page info-page">
      <h1>Privacy</h1>
      <p className="lead">Short version: your demos are read on your computer, there's no tracking, and logged in we keep your numbers, not your matches.</p>

      <h2>Without logging in</h2>
      <ul>
        <li>CS2 demos and Deadlock replay files are read in your browser. They aren't uploaded.</li>
        <li>Your profile, puzzles and settings are kept in this browser only (local storage). Clearing site data removes them.</li>
        <li>No analytics, no ad trackers, no cookies for tracking. The site sends a few numbers of its own, with no ID: how long a match took to grade and how many of its cards the checked disputes changed, by kind of move (a quarter of the time), and the first line of an error, if one happens (at most 3 a visit).</li>
        <li>A Deadlock match ID is looked up on deadlock-api.com (public match data), which sees the request like any website does.</li>
      </ul>

      <h2>Logged in with Steam</h2>
      <ul>
        <li>Steam's own page does the login. We get your SteamID and your public name and avatar, never your password.</li>
        <li>We keep your profile on our server (Cloudflare): each reviewed match's numbers (grades, kills, ADR and the like), your goals, settings and "notify me" choices. Not the demo.</li>
        <li>A friend can see your last matches' numbers only if you turn on Public profile in Settings.</li>
        <li>For Deadlock, the RageView bot (a Steam account) can fetch your new matches if you add it as a friend.</li>
      </ul>

      <h2>When you send something</h2>
      <ul>
        <li>"Coach wrong?" on a CS2 move sends that one round (positions, kills, grenades) and the coach's card, so the owner can check the coach. Deadlock's sends the moment's details, not a file.</li>
        <li>You can take it back from the same button.</li>
      </ul>

      <h2>Login and storage</h2>
      <ul>
        <li>No cookies. After you log in, a session key is kept in this browser's local storage so you stay logged in; Sign out (or clearing site data) removes it, and it stops working on our side too.</li>
        <li>Your settings, puzzles and the profile kept without logging in are in local storage too.</li>
      </ul>

      <h2>Deleting</h2>
      <p>Settings → Delete my data removes your profile, goals and match list from your account, or from this browser when you're not logged in.</p>

      <p className="muted small">Last updated 7 November 2026. {APP_NAME} isn't affiliated with Valve or any game publisher.</p>
    </div>
  );
}

/** Newest first: what changed for players (not the internals). */
const CHANGES: { date: string; items: string[] }[] = [
  { date: 'Nov 10, 2026', items: ['A CS2 page (/cs2) like Deadlock\'s, linked from the front page; samples for both games in one menu.', 'The same recap tabs in both games (Overview, Coach, Scoreboard, Timeline) and letter grades for Deadlock.', 'Late rotations: no more "rotated too late" cards; the old rule flagged players already on their way. The coach report still counts them, at a small weight.', 'Deadlock\'s Meta & builds has one name and its own address (/deadlock/meta).', 'A skip link, a labelled speed control, and a page that breaks no longer blanks the whole site.', 'Pages load about 10 times less code (0.7 MB instead of 8 MB): the replay and the engine come only when you open them.', 'Easier reading and tapping: one set of text sizes, less bold, bigger tap areas.'] },
  { date: 'Nov 7, 2026', items: ['Puzzles: one honest scale for every number, a Why after each answer, the situation at a glance (health, gun, bomb, time), callout names on the map, the path of each move on hover.', 'Daily puzzle, puzzle rush (3 minutes), a puzzle rating, weak spots by kind of situation.', 'Sound and a little celebration on a right answer; Rage mode has words for a wrong one.'] },
  { date: 'Nov 6, 2026', items: ['Clearer errors when a demo is zipped, from CS:GO or not a demo.', 'Rage mode asks before it turns on.', 'Try a sample match from the front page.', 'Phone menu with labels.'] },
  { date: 'Nov 5, 2026', items: ['Puzzles: from your own matches and from top players\', with a 10 s clip on the map.', 'Mistake reel, next-match focus and a fixing streak.', 'Share one moment as a link.', 'Side by side with a friend in both recaps.', 'Since the last patch, on the Deadlock profile.', 'Bolder look: each game in its own colour.'] },
  { date: 'Nov 4, 2026', items: ['Deadlock engine: win chance, likely moves, fights and a 2-step search grade every move, like a chess engine.', 'Every hero\'s abilities and ultimate explained in the recap.', 'Deadlock replay files read in your browser.'] },
];

export function Changelog() {
  return (
    <div className="page info-page">
      <h1>What's new</h1>
      {CHANGES.map(c => (
        <section key={c.date}>
          <h2>{c.date}</h2>
          <ul>{c.items.map(i => <li key={i}>{i}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

/** Guides: getting your match in, and what the numbers mean (round 8, C6). */
export function Guides() {
  const deaths = DEATHS as Record<string, { demos: number; deaths: number; CT: Record<'early' | 'late', { place: string; share: number }[]>; T: Record<'early' | 'late', { place: string; share: number }[]> }>;
  const [map, setMap] = useState(Object.keys(deaths)[0] ?? '');
  const d = deaths[map];
  return (
    <div className="page info-page guides">
      <h1>Guides</h1>
      <p className="lead">Get your match in, read the numbers, and see where level-10 players die.</p>
      <nav className="chips" aria-label="Guides"><a className="chip" href="#cs2-demo">Download your CS2 demo</a><a className="chip" href="#deadlock-id">Find a Deadlock match ID</a><a className="chip" href="#numbers">ADR and KAST</a><a className="chip" href="#deaths">Where level-10 players die</a></nav>

      <h2 id="cs2-demo">Download your CS2 demo</h2>
      <ol>
        <li>In CS2, open <b>Watch → Your Matches</b>.</li>
        <li>Pick the match and press <b>Download</b>. CS2 keeps it in its replays folder.</li>
        <li>On {APP_NAME}, open <a href="/cs2/review">Review</a> and drop the .dem file in, or pick your Steam folder once and new matches show up by themselves.</li>
        <li>FACEIT and HLTV demos work too: unzip them first.</li>
      </ol>
      <p className="muted">Logged in with Steam, the bot can also fetch your Premier matches: paste your match-history code once in Review → Your matches. Valve keeps demos for about a month.</p>

      <h2 id="deadlock-id">Find a Deadlock match ID</h2>
      <ol>
        <li>In Deadlock, open your <b>Match history</b> and pick the match: the ID is shown with it (a number like 52190833).</li>
        <li>On {APP_NAME}, open <a href="/deadlock/review">Deadlock → Review</a> and paste it.</li>
        <li>Logged in with Steam, your matches are listed there already; add the RageView bot as a Steam friend and new ones load by themselves.</li>
      </ol>
      <p className="muted">Match data comes from deadlock-api.com; a match shows up there a few minutes to an hour after it ends.</p>

      <h2 id="numbers">ADR and KAST, explained</h2>
      <dl className="guide-terms">
        <dt>ADR</dt><dd>Average damage per round: all the damage you did to enemies, divided by rounds played. 80 is solid at FACEIT level 10; 100+ means you carried fights.</dd>
        <dt>KAST</dt><dd>The share of rounds where you got a <b>K</b>ill, an <b>A</b>ssist, <b>S</b>urvived or were <b>T</b>raded. It says how often you were useful, even without kills. Around 70% is typical at level 10.</dd>
        <dt>Impact</dt><dd>How much your moves changed your team's chance to win the round, on average. Positive means you added to it.</dd>
        <dt>Grade</dt><dd>S+ to F for a round or a match, against FACEIT level 10: B is a typical level-10 game, S a pro one.</dd>
        <dt>Mark</dt><dd>One move: Brilliant (!!), Great (!), Book (·), Inaccuracy (?!), Mistake (?), Blunder (??).</dd>
      </dl>

      <h2 id="deaths">Where FACEIT level-10 players die</h2>
      {!d ? <p className="muted">Not counted yet.</p> : (
        <>
          <div className="seg-mini" role="group" aria-label="Map">{Object.keys(deaths).map(m => <button key={m} className={m === map ? 'on' : ''} onClick={() => setMap(m)}>{mapName(m)}</button>)}</div>
          <p className="muted small">{d.deaths.toLocaleString('en-US')} deaths in {d.demos} FACEIT level-10 matches. Share of each side's deaths in the first 40 s of a round, and after.</p>
          <div className="guide-deaths">
            {(['CT', 'T'] as const).map(side => (['early', 'late'] as const).map(w => (
              <div key={side + w} className="site-card"><b>{side} · {w === 'early' ? 'first 40 s' : 'after 40 s'}</b>
                <ol>{d[side][w].map(p => <li key={p.place}><span>{p.place}</span><span className="num muted">{Math.round(p.share * 100)}%</span></li>)}</ol></div>
            )))}
          </div>
        </>
      )}
    </div>
  );
}
