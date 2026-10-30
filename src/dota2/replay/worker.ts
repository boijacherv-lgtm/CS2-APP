/// <reference lib="webworker" />
/** Downloads and reads a Dota 2 replay off the main thread, so the page stays smooth while it does. */
import { readReplay, type ReplayTracks } from './parser';
import { unpackReplay } from './unpack';

export type ReplayWorkerIn = { url: string };
export type ReplayWorkerOut = { step: 'download' | 'unpack' | 'read'; share: number } | { tracks: ReplayTracks } | { error: string };

const post = (m: ReplayWorkerOut) => (self as unknown as Worker).postMessage(m);
/** Progress, whole percents only: every message redraws the board, and a download comes in thousands of pieces. */
let lastStep = '', lastPercent = -1;
const report = (step: 'download' | 'unpack' | 'read', share: number) => {
  const percent = Math.floor(share * 100);
  if (step === lastStep && percent === lastPercent) return;
  lastStep = step; lastPercent = percent;
  post({ step, share });
};

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (res.status === 404) throw new Error('Valve no longer has this replay: it keeps them for about two weeks.');
  if (!res.ok || !res.body) throw new Error(`Couldn't download the replay (${res.status}).`);
  if (res.headers.get('Content-Type')?.includes('text/html')) throw new Error('The server has no replay proxy: restart it.');
  const total = Number(res.headers.get('Content-Length')) || 0;
  const parts: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) report('download', got / total);
  }
  const file = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { file.set(p, at); at += p.length; }
  return file;
}

self.onmessage = async (e: MessageEvent<ReplayWorkerIn>) => {
  try {
    const file = await download(e.data.url);
    const dem = unpackReplay(file, share => report('unpack', share));
    post({ tracks: readReplay(dem, share => report('read', share)) });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
