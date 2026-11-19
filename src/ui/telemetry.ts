import { API_URL } from '../env';

/**
 * The site's own numbers for the dev page (round 8, D5): how long a recap takes to grade, how many cards the checked
 * disputes changed in it, and client errors. No IDs, no cookies: the time in ms, counts per kind of move, or the error's
 * first line and the page's name. Sampled (a quarter of the grading times,
 * at most 3 errors a visit) so the Worker's free KV writes hold. Said on Privacy.
 */
let errorsSent = 0;
function send(body: Record<string, unknown>) {
  if (!API_URL) return;
  try { void fetch(`${API_URL}/t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { /* never in the way */ }
}
/** The grading time, and the cards the checked disputes changed in that match (by pattern; no match or player). */
export function reportGradingTime(ms: number, rounds: ({ corrected?: Record<string, number> } | null)[] = []) {
  if (Math.random() >= 0.25) return;
  const corr: Record<string, number> = {};
  for (const r of rounds) for (const [p, n] of Object.entries(r?.corrected ?? {})) corr[p] = (corr[p] ?? 0) + n;
  send({ kind: 'grade', ms, ...(Object.keys(corr).length ? { corr } : {}) });
}
export function reportError(msg: string) {
  if (errorsSent >= 3) return;
  errorsSent++;
  send({ kind: 'error', msg: msg.split('\n')[0].slice(0, 160), page: location.pathname.split('/').slice(0, 3).join('/') });
}
/** Uncaught errors and rejections, once at start-up. */
export function watchErrors() {
  addEventListener('error', e => reportError(String(e.message || e.error)));
  addEventListener('unhandledrejection', e => reportError(String((e.reason as Error)?.message ?? e.reason)));
}
