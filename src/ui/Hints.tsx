import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useDl } from '../deadlock/store';
import { createPortal } from 'react-dom';
import { navigate, useRoute, type Route } from '../shell/router';
import { gameOf } from './tokens';
import { Icon } from './Icon';
import { openCs2Sample, openDlSample } from './sample';

/**
 * Hints instead of tours (spec §3): a welcome card on the first visit, then one-line hints at the moment they're
 * needed (at most 3 a session, each once ever), and a "?" button in the corner that shows the shortcuts and brings
 * the hints back. Nothing dims the page.
 */
interface Hint { id: string; when: (r: Route) => boolean; ready: string; text: string }
export const HINTS: Hint[] = [
  { id: 'card', when: r => (r.page === 'cs2' || r.page === 'deadlock') && r.mode === 'review', ready: '.feed-card, .dl-card',
    text: 'A coach card: what happened, the grade, the better play. → for the next one.' },
  { id: 'recap', when: r => (r.page === 'cs2' || r.page === 'deadlock') && r.mode === 'report', ready: '.top3, .dl-rc-head',
    text: 'Start with your Biggest leak. Each Watch button jumps to that moment.' },
  { id: 'tactical', when: r => r.page === 'cs2' && r.mode === 'tactical', ready: '.rail',
    text: 'Drag players, drop grenades, then press Play.' },
];
/** The keys that work, by where they work. */
const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'], ['← →', 'Previous / next coach card'], ['Shift + ← →', '10 s back / forward (Deadlock)'], ['J L', '5 s back / forward'], ['↑ ↓', 'Round before / after (CS2)'],
  ['R', 'Reveal the whole round (CS2)'], ['1 2 3', 'Map: clean, standard, full (CS2)'], ['Ctrl / ⌘ + Z', 'Undo (Tactical board)'],
  ['[ ]', 'Turn the selected player (Tactical board)'], ['Delete', 'Remove the selected item (Tactical board)'], ['?', 'This sheet'],
];

const SEEN = 'rageview.hints', WELCOMED = 'rageview.welcomed', SESSION = 'rageview.hintsShown', MAX_A_SESSION = 3;
const read = <T,>(f: () => T, or: T) => { try { return f(); } catch { return or; } };
const seen = (): string[] => read(() => JSON.parse(localStorage.getItem(SEEN) ?? '[]'), []);
const markSeen = (id: string) => read(() => localStorage.setItem(SEEN, JSON.stringify([...new Set([...seen(), id])])), undefined);
const shownThisSession = () => read(() => +(sessionStorage.getItem(SESSION) ?? 0), 0);
/** Settings → Tips, and the "?" sheet: every hint (and the welcome) once more. */
export const resetHints = () => read(() => { localStorage.removeItem(SEEN); localStorage.removeItem(WELCOMED); sessionStorage.removeItem(SESSION); }, undefined);

export function Hints() {
  const route = useRoute();
  const [hint, setHint] = useState<Hint | null>(null);
  const [welcome, setWelcome] = useState(() => !read(() => localStorage.getItem(WELCOMED), '1'));
  const [sheet, setSheet] = useState(false);
  const quiet = route.page === 'moment' || route.page === 'dev';
  // never inside a match (it covered the roster while you watched the sample)
  const cs2Open = useStore(s => !!s.review), dlOpen = useDl(s => !!s.match), inMatch = cs2Open || dlOpen;
  // the page as a string: the route object is new on every render, the hint must survive those
  const where = `${route.page}/${'mode' in route ? route.mode : ''}`;

  // a hint whose moment has come: its page, and the thing it's about on screen
  useEffect(() => {
    setHint(null);
    if (quiet) return;
    const todo = HINTS.find(h => h.when(route) && !seen().includes(h.id));
    if (!todo || shownThisSession() >= MAX_A_SESSION) return;
    const t = setInterval(() => {
      if (!document.querySelector(todo.ready)) return;
      clearInterval(t);
      markSeen(todo.id);
      read(() => sessionStorage.setItem(SESSION, String(shownThisSession() + 1)), undefined);
      setHint(todo);
    }, 600);
    return () => clearInterval(t);
  }, [where, quiet]); // eslint-disable-line react-hooks/exhaustive-deps
  // it goes by itself after a while
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(null), 14000); return () => clearTimeout(t); }, [hint]);
  // ? opens the sheet (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '?' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') setSheet(s => !s);
      if (e.key === 'Escape') setSheet(false);
    };
    // the ? button in the top bar
    const toggle = () => setSheet(s => !s);
    addEventListener('keydown', onKey);
    addEventListener('rv:hints', toggle);
    return () => { removeEventListener('keydown', onKey); removeEventListener('rv:hints', toggle); };
  }, []);

  const game = route.page === 'deadlock' ? 'deadlock' : route.page === 'cs2' ? 'cs2' : gameOf('profile');
  const done = () => { read(() => localStorage.setItem(WELCOMED, '1'), undefined); setWelcome(false); };
  if (quiet) return null;
  return createPortal(
    <>
      {welcome && route.page !== 'home' && !inMatch && (
        <div className="hint-card welcome" role="dialog" aria-label="Welcome">
          <button className="ghost hint-x" onClick={done} aria-label="Close"><Icon name="close" size={14} /></button>
          <b>New here?</b>
          <div className="hint-actions">
            <button className="cta" onClick={() => { done(); void (game === 'deadlock' ? openDlSample() : openCs2Sample()); }}><Icon name="play" size={12} /> Watch a sample</button>
            <button className="cta primary" onClick={() => { done(); navigate({ page: game, mode: 'review' }); }}>Load my match</button>
          </div>
        </div>
      )}
      {hint && !welcome && (
        <div className="hint-card" role="status">
          <span>{hint.text}</span>
          <button className="ghost small-btn" onClick={() => setHint(null)}>Got it</button>
        </div>
      )}
      {sheet && (
        <div className="hint-sheet" role="dialog" aria-label="Shortcuts and hints">
          <div className="hint-sheet-head"><b>Shortcuts</b><button className="ghost hint-x" onClick={() => setSheet(false)} aria-label="Close"><Icon name="close" size={14} /></button></div>
          <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
          <b>Hints</b>
          <ul>{HINTS.map(h => <li key={h.id}>{h.text}</li>)}</ul>
          <button className="cta small-btn" onClick={() => { resetHints(); setSheet(false); setWelcome(true); }}>Show the hints again</button>
        </div>
      )}
    </>,
    document.body,
  );
}
