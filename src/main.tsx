import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell';
import { applyTokens } from './ui/tokens';
import './styles.css';

import { ONLINE } from './env';

// clickjacking guard: the website never runs inside another site's frame (GitHub Pages can't send X-Frame-Options)
if (ONLINE && window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try { window.top!.location.href = window.self.location.href; } catch { /* blocked: the page just stays hidden */ }
}
applyTokens(); // colours as CSS variables, before the first paint

createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
