/**
 * Privacy (what the site keeps, where, and what it sends) and What's new (the changelog). Plain pages; the privacy
 * text follows the code: worker/src/profile.ts, clips.ts, dlDisputes.ts, the Deadlock bot and the browser stores.
 */
import { APP_NAME } from '../shell/Logo';

export function Privacy() {
  return (
    <div className="page info-page">
      <h1>Privacy</h1>
      <p className="lead">Short version: your demos are read on your computer, there's no tracking, and logged in we keep your numbers, not your matches.</p>

      <h2>Without logging in</h2>
      <ul>
        <li>CS2 demos and Deadlock replay files are read in your browser. They aren't uploaded.</li>
        <li>Your profile, puzzles and settings are kept in this browser only (local storage). Clearing site data removes them.</li>
        <li>No analytics, no ad trackers, no cookies for tracking.</li>
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
  { date: 'Nov 10, 2026', items: ['A CS2 page (/cs2) like Deadlock\'s, linked from the front page; samples for both games in one menu.', 'The same recap tabs in both games (Overview, Coach, Scoreboard, Timeline) and letter grades for Deadlock.', 'Late rotations: no more "rotated too late" cards; the old rule flagged players already on their way. The coach report still counts them, at a small weight.', 'Deadlock\'s Meta & builds has one name and its own address (/deadlock/meta).', 'A skip link, a labelled speed control, and a page that breaks no longer blanks the whole site.'] },
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
