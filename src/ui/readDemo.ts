import type { DemoData } from '../engine/recap';
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

