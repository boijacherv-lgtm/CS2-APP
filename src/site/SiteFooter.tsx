import { APP_NAME, LogoMark } from '../shell/Logo';
import { PLAYABLE } from './games';

/** The one footer: on the home page and every game page. `note`: the game's own line (whose logo it is). */
export function SiteFooter({ note = 'Not affiliated with Valve.' }: { note?: string }) {
  return (
    <footer className="site-footer">
      <span className="brand-small"><LogoMark size={18} /> {APP_NAME}</span>
      <nav>
        {PLAYABLE.map(g => <a key={g.id} href={g.page ?? g.review}>{g.name}</a>)}<a href="/profile">Profile</a><a href="/pricing">Pricing</a><a href="/settings">Settings</a><a href="/puzzles">Puzzles</a><a href="/guides">Guides</a><a href="/changelog">What's new</a><a href="/privacy">Privacy</a>
      </nav>
      <span className="muted">Made by a player. {note} © {new Date().getFullYear()} {APP_NAME}</span>
    </footer>
  );
}
