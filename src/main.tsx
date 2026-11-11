import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell';
import { handleLinks } from './shell/router';
import { applyGame, applyTokens, lookPref, setLook, themeOf } from './ui/tokens';
import './styles.css';
import './ui/theme.css';

import { ONLINE } from './env';

// clickjacking guard: the website never runs inside another site's frame (GitHub Pages can't send X-Frame-Options)
if (ONLINE && window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try { window.top!.location.href = window.self.location.href; } catch { /* blocked: the page just stays hidden */ }
}
applyTokens(); // colours as CSS variables, before the first paint
// Look: System follows the system's dark / light switch while the page is open
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (lookPref() === 'system') setLook('system'); });
handleLinks(); // in-app links without a reload
applyGame(themeOf(location.pathname.split('/')[1] ?? '')); // and the game's, so the first paint is already right (router.ts already turned an old #/ link into the path)

createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
