/** Small formatting helpers for the site pages. */
const MAP_NAMES: Record<string, string> = { de_dust2: 'Dust II' };
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

const RULES = new Intl.PluralRules('en');
/** "1 match", "3 matches" (Intl.PluralRules, so every count reads right). */
export const plural = (n: number, one: string, many = `${one}${/(s|x|ch|sh)$/.test(one) ? 'es' : 's'}`) => `${n.toLocaleString()} ${RULES.select(n) === 'one' ? one : many}`;
/** "Last match" for one, "Last 5 matches" for more. */
export const lastN = (n: number, one: string) => (n === 1 ? `Last ${one}` : `Last ${plural(n, one)}`);
