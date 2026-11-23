// Measures that the review's timeline keeps the same width whichever move is picked (the label beside the arrows has a
// fixed width). Needs the dev server (npm run dev) and Brave or Chrome; run: node tools/check-playbar.mjs [url]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.argv[2] ?? 'http://localhost:5173';
const BIN = ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!BIN) { console.error('no Brave or Chrome found'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-pb-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(BIN, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const wait = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };

let bad = 0;
for (const width of [1100, 1200, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${URL_}/cs2/review` });
  await sleep(2500);
  await run(`(async () => { const { openCs2Sample } = await import('/src/ui/sample.ts'); await openCs2Sample(); await new Promise(r => setTimeout(r, 2500)); })()`);
  const widths = await run(`(async () => {
    const { useStore } = await import('/src/store.ts');
    const st = useStore.getState(); st.setPlaying(false); st.setReviewRound(4); await new Promise(r => setTimeout(r, 1500));
    const out = [], w = () => Math.round(document.querySelector('.timeline').getBoundingClientRect().width);
    useStore.getState().setTime(0); await new Promise(r => setTimeout(r, 400)); out.push({ label: document.querySelector('.moment-label').textContent, w: w() });
    const nxt = document.querySelector('[aria-label="Next moment"]');
    for (let i = 0; i < 24; i++) { nxt.click(); await new Promise(r => setTimeout(r, 250)); out.push({ label: document.querySelector('.moment-label').textContent, w: w() }); }
    return out; })()`);
  const set = new Set(widths.map(x => x.w));
  const longest = widths.reduce((a, b) => (b.label.length > a.label.length ? b : a));
  console.log(`${width}px: timeline ${[...set].join(', ')}px over ${widths.length} states (longest label: "${longest.label.slice(0, 60)}")`);
  if (set.size !== 1) bad++;
}
ws.close(); proc.kill();
console.log(bad ? 'FAIL: the timeline width changes with the label' : 'ok: the timeline width is the same for every label');
process.exit(bad ? 1 : 0);
