import { API_URL } from '../env';

/**
 * The site's own numbers for the dev page (round 8, D5): how long a recap takes to grade, and client errors. No IDs,
 * no cookies: the time in ms, or the error's first line and the page's name. Sampled (a quarter of the grading times,
 * at most 3 errors a visit) so the Worker's free KV writes hold. Said on Privacy.
 */
let errorsSent = 0;
function send(body: Record<string, unknown>) {
  if (!API_URL) return;
  try { void fetch(`${API_URL}/t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch { /* never in the way */ }
}
export function reportGradingTime(ms: number) { if (Math.random() < 0.25) send({ kind: 'grade', ms }); }
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
