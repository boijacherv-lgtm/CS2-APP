// The FACEIT Data API for the tools: the key from cs2-tactics/.env (FACEIT_API_KEY, never committed), a gentle pace
// (~4 calls a second) and backoff on 429 / 5xx. Used by fetch-faceit.ts and match-dates.ts.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(): Record<string, string> {
  const p = path.resolve(import.meta.dirname, '../.env');
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}
export const env = { ...loadEnv(), ...process.env };
export const API_KEY = env.FACEIT_API_KEY;
export function needKey() {
  if (API_KEY) return;
  console.error(`No FACEIT_API_KEY. Create a server-side API key at developers.faceit.com (Apps → your app → API keys) and add this line to ${path.resolve(import.meta.dirname, '../.env')}:\n  FACEIT_API_KEY=<your key>`);
  process.exit(1);
}

const DATA = 'https://open.faceit.com/data/v4';
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
/** A Data API GET with a gentle pace (~4 a second) and backoff on 429 / 5xx. */
export async function api<T>(p: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = `${DATA}${p}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  for (let attempt = 0; ; attempt++) {
    const wait = 250 - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' } });
    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`FACEIT refused the API key (${res.status}): check FACEIT_API_KEY in .env.`);
    throw new Error(`FACEIT ${p}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
