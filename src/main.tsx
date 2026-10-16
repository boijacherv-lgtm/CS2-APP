import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell';
import { applyTokens } from './ui/tokens';
import './styles.css';

applyTokens(); // colours as CSS variables, before the first paint

createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
