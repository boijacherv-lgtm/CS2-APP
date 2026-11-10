// The page check before every deploy (.github/workflows/pages.yml): serves the built site (dist), opens it in headless
// Chrome and visits every page twice, with no match open and with the CS2 sample match open. Fails when a page shows
// "This page broke", comes up blank, or throws. No dependency: Chrome over its DevTools protocol (Node 22's WebSocket).
//   npm run build && node tools/smoke.mjs        (CHROME=/path/to/chrome to pick the browser)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4179, DEBUG = 9339, BASE = `http://localhost:${PORT}`;
const ROUTES = ['/', '/cs2', '/cs2/review', '/cs2/report', '/cs2/tactical', '/deadlock', '/deadlock/review', '/deadlock/report', '/deadlock/meta',
  '/puzzles', '/profile', '/settings', '/pricing', '/changelog', '/privacy', '/no-such-page'];
const CHROMES = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].filter(Boolean);
const chrome = CHROMES.find(p => fs.existsSync(p));
if (!chrome) { console.error('smoke: no Chrome found (set CHROME)'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const quit = code => { for (const p of procs) p.kill(); process.exit(code); };
setTimeout(() => { console.error('smoke: timed out'); quit(1); }, 8 * 60_000).unref();

// the built site, and the browser
procs.push(spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
procs.push(spawn(chrome, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-sandbox', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' }));
let tabs = null;
for (let i = 0; i < 60 && !tabs; i++) { await sleep(500); tabs = await fetch(`http://127.0.0.1:${DEBUG}/json`).then(r => r.json()).catch(() => null); }
for (let i = 0; i < 60; i++) { if (await fetch(BASE).then(r => r.ok, () => false)) break; await sleep(500); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const wait = {}, errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
  if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; }
};
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const go = async p => { await ev(`history.pushState(null,'',${JSON.stringify(p)});dispatchEvent(new Event('rv:navigate'))`); await sleep(2000); };
await cmd('Page.enable'); await cmd('Runtime.enable');
await cmd('Page.navigate', { url: BASE }); await sleep(4000);

let failed = 0;
const check = async label => {
  for (const p of ROUTES) {
    errs.length = 0;
    await go(p);
    const st = await ev(`(()=>{const m=document.querySelector('.shell-main');const t=m?m.innerText:'';return {broke:t.includes('This page broke'),blank:t.trim().length<20}})()`);
    const bad = st?.broke ? 'BROKE' : !st || st.blank ? 'BLANK' : errs.length ? `ERROR ${[...new Set(errs)].join(' | ')}` : null;
    if (bad) failed++;
    console.log(`${bad ? '✗' : '✓'} ${label.padEnd(9)} ${p}${bad ? `: ${bad}` : ''}`);
  }
};
await check('no match');
// the CS2 sample, opened the way a visitor does (front page → Try a sample → CS2 sample)
await go('/');
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('CS2 sample'))?.click()`);
for (let i = 0; i < 60 && await ev('location.pathname') !== '/cs2/review'; i++) await sleep(500);
await sleep(3000);
if (!await ev(`!!document.querySelector('.match-tab')`)) { console.log('✗ the CS2 sample did not open'); failed++; }
await check('cs2 match');
console.log(failed ? `smoke: ${failed} page${failed > 1 ? 's' : ''} failed` : 'smoke: every page fine');
quit(failed ? 1 : 0);
