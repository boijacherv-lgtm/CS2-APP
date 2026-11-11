// The link-preview pictures (Discord, X, iMessage): 1200×630 PNGs for the site, CS2 and Deadlock, drawn from an HTML
// card with a real screen of the app, in headless Chrome (no dependency). Writes public/images/og*.png.
//   node tools/og-images.mjs        (CHROME=/path/to/chrome to pick the browser)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), IMG = path.join(ROOT, 'public/images');
const data = f => `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(IMG, f)).toString('base64')}`;
const CARDS = [
  { file: 'og.png', accent: '#f2b13c', glow: '#3a2a10', line1: 'Was it your fault?', line2: 'Find out free.', sub: 'Every play in your CS2 or Deadlock match graded S+ to F, with the better play.', shot: 'shots/cs2-recap.jpg', tag: 'CS2 · DEADLOCK' },
  { file: 'og-cs2.png', accent: '#f2b13c', glow: '#3a2a10', line1: 'Every round,', line2: 'graded.', sub: 'Drop a CS2 demo: every round S+ to F, every move Brilliant to Blunder, with the better play. Read in your browser.', shot: 'shots/cs2-moment.jpg', tag: 'COUNTER-STRIKE 2' },
  { file: 'og-deadlock.png', accent: '#4fd1a5', glow: '#0f2f26', line1: 'Who lost the fight?', line2: 'Find out free.', sub: 'Paste a Deadlock match ID: every fight graded, and what top players do instead.', shot: 'shots/replay.jpg', tag: 'DEADLOCK' },
];
const html = c => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Rajdhani:wght@700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;font-family:Inter,sans-serif;color:#e8ecf2;
    background:radial-gradient(900px 600px at 0% 0%, ${c.glow}, transparent 60%), radial-gradient(700px 500px at 100% 100%, #10161f, transparent 70%), #0b0e12}
  .left{position:absolute;left:64px;top:56px;width:560px}
  .brand{display:flex;align-items:center;gap:14px;font:700 34px Rajdhani,sans-serif;letter-spacing:.02em}
  .brand img{width:56px;height:56px;border-radius:12px}
  .tag{margin-top:34px;font:600 16px Inter;letter-spacing:.14em;color:${c.accent}}
  h1{margin-top:12px;font:700 80px/0.98 Rajdhani,sans-serif;letter-spacing:.01em}
  h1 span{display:block;color:${c.accent}}
  p{margin-top:24px;font:400 25px/1.4 Inter;color:#aeb7c4}
  .url{position:absolute;left:64px;bottom:44px;font:500 22px Inter;color:#8792a2}
  .shot{position:absolute;right:-40px;top:96px;width:600px;border-radius:16px;overflow:hidden;
    border:1px solid color-mix(in srgb, ${c.accent} 35%, #2a313b);box-shadow:0 30px 80px -20px #000, 0 0 0 1px #0006}
  .shot img{display:block;width:100%}
  .bar{position:absolute;left:0;right:0;bottom:0;height:8px;background:${c.accent}}
</style></head><body>
  <div class="left">
    <div class="brand"><img src="${data('logo-512.png')}" alt="">RageView</div>
    <div class="tag">${c.tag}</div>
    <h1>${c.line1}<span>${c.line2}</span></h1>
    <p>${c.sub}</p>
  </div>
  <div class="url">tsakhstvo.xyz</div>
  <div class="shot"><img src="${data(c.shot)}" alt=""></div>
  <div class="bar"></div>
</body></html>`;

const CHROMES = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].filter(Boolean);
const chrome = CHROMES.find(p => fs.existsSync(p));
if (!chrome) { console.error('og-images: no Chrome found (set CHROME)'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
const b = spawn(chrome, ['--headless=new', '--remote-debugging-port=9341', `--user-data-dir=${prof}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let tabs = null;
for (let i = 0; i < 60 && !tabs; i++) { await sleep(500); tabs = await fetch('http://127.0.0.1:9341/json').then(r => r.json()).catch(() => null); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const wait = {};
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m); delete wait[m.id]; } };
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; wait[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
for (const c of CARDS) {
  const file = path.join(prof, `${c.file}.html`);
  fs.writeFileSync(file, html(c));
  await cmd('Page.navigate', { url: `file://${file}` });
  await sleep(2500); // fonts
  const { result } = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(IMG, c.file), Buffer.from(result.data, 'base64'));
  console.log('og-images:', c.file);
}
b.kill();
process.exit(0);
