/** Small formatting helpers for the site pages. */
const MAP_NAMES: Record<string, string> = { de_dust2: 'Dust 2' };
export const mapName = (id: string) => MAP_NAMES[id] ?? id.replace(/^de_/, '').replace(/^\w/, c => c.toUpperCase());
export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
export const fmtKd = (v: number | null) => (v === null ? '–' : v.toFixed(2));
export function fmtDate(ms: number) {
  if (!ms) return '';
  const d = new Date(ms), days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
