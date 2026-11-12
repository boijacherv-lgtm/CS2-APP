// The design system check (round 8, B10): counts what's outside the named sets in the stylesheets — hex colours outside
// theme.css, border radii other than 6/10/16/999px (and 50% / inherit), z-index values, blurred box-shadows not on --elev-*/--glow-*, font sizes off the
// scale, transition durations other than 120/200/320 ms. Prints the counts; exits 1 with --strict when any is left.
//   node tools/design-lint.mjs [--strict]
import fs from 'node:fs';

const FILES = ['src/styles.css', 'src/site/site.css', 'src/deadlock/dl.css', 'src/ui/theme.css'];
const RADII = new Set(['6px', '10px', '16px', '999px', '50%', 'inherit', '0']), SIZES = new Set([12, 14, 16, 20, 24, 32, 48, 64]);
/** Splits a list on the commas outside brackets. */
const splitTop = (v) => { const parts = []; let depth = 0, cur = ''; for (const ch of v) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; } return [...parts, cur]; };
const out = { hexOutsideTheme: 0, radius: 0, zIndex: 0, shadows: new Set(), fontSize: 0, durations: 0 };
for (const f of FILES) {
  const css = fs.readFileSync(f, 'utf8');
  if (!f.endsWith('theme.css')) out.hexOutsideTheme += (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  for (const m of css.matchAll(/border-radius:\s*([^;}]+)/g)) if (m[1].trim().split(/\s+/).some(v => !RADII.has(v))) out.radius++;
  for (const m of css.matchAll(/z-index:\s*([^;}]+)/g)) if (!/var\(--z-/.test(m[1])) out.zIndex++;
  // a shadow with no blur is a border (a ring, an inset line); one with blur must be an --elev-* or a --glow-*
  for (const m of css.matchAll(/box-shadow:\s*([^;}]+)/g)) for (const part of splitTop(m[1])) {
    const p = part.trim(), n = p.replace(/^inset\s+/, '').match(/^(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)/);
    if (p !== 'none' && !/var\(--(elev|glow)-/.test(p) && !(n && parseFloat(n[3]) === 0)) out.shadows.add(p);
  }
  for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) if (!SIZES.has(+m[1])) out.fontSize++;
  for (const m of css.matchAll(/transition:[^;}]*/g)) for (const d of m[0].match(/\b\d*\.?\d+m?s\b/g) ?? []) if (!['.12s', '.2s', '.32s', '120ms', '200ms', '320ms', '0s'].includes(d)) out.durations++;
}
const report = { ...out, shadows: out.shadows.size };
console.log(report);
if (process.argv.includes('--strict') && Object.values(report).some(v => v > 0)) process.exit(1);
