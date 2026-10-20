import type { DemoData } from '../engine/recap';
import { ONLINE } from '../env';
import { MAPS } from '../map/catalog';
import type { DemoWorkerOut } from './demoWorker';

/** How many full passes over the demo tools/demo-core.mjs makes (for the progress text). */
export const DEMO_PASSES = 20;

/** Website: parse the demo in a Web Worker with the WebAssembly parser (src/ui/demoWorker.ts). */
export function readDemoInBrowser(file: File, onProgress: (pass: number) => void): Promise<DemoData> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./demoWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<DemoWorkerOut>) => {
      const m = e.data;
      if ('progress' in m) return onProgress(m.progress);
      w.terminate();
      if ('error' in m) reject(new Error(m.error)); else resolve(m.data as DemoData);
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || 'The demo reader crashed (the demo may be too big for this browser).')); };
    w.postMessage({ file });
  });
}


/**
 * Any demo file into match data: a saved .json, or a .dem read in the browser (website) or by the dev server
 * (locally). `onProgress` gets the share done (0–1) when it can be told. Throws when it isn't a playable match.
 */
export async function readDemoFile(file: File, onProgress: (share: number) => void = () => {}): Promise<DemoData> {
  let data: DemoData;
  if (file.name.endsWith('.json')) data = JSON.parse(await file.text());
  else if (ONLINE) data = await readDemoInBrowser(file, pass => onProgress(Math.min(0.97, pass / DEMO_PASSES)));
  else {
    const res = await fetch(`/api/demo?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    data = body;
  }
  if (!MAPS.some(m => m.id === data.map)) throw new Error(`${data.map} isn't one of the supported maps.`);
  if (!data.rounds.length) throw new Error('No rounds found in this demo.');
  if (!data.playedAt && /\.dem$/i.test(file.name) && file.lastModified) data.playedAt = file.lastModified;
  return data;
}
