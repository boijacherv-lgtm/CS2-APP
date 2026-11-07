/** Small drawings for empty pages, in the game's colour (no image files): a missed shot for 404, a waiting map for
 * empty lists. Decorative: hidden from screen readers. */

/** A crosshair and the shot that missed it. */
export function MissArt({ size = 120 }: { size?: number }) {
  return (
    <svg className="art" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="34" fill="none" stroke="var(--border-strong)" strokeWidth="3" />
      <path d="M60 14v22M60 84v22M14 60h22M84 60h22" stroke="var(--theme)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="60" r="3" fill="var(--theme)" />
      {/* the hole, well off target */}
      <circle cx="94" cy="26" r="5" fill="var(--bg-0)" stroke="var(--bad)" strokeWidth="2" />
      <path d="M94 17v4M94 31v4M85 26h4M99 26h4" stroke="var(--bad)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** A little map with a dashed route and an empty spot: nothing here yet. */
export function EmptyArt({ size = 96 }: { size?: number }) {
  return (
    <svg className="art" width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <rect x="10" y="14" width="76" height="68" rx="10" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M20 66 C34 40, 52 70, 70 34" fill="none" stroke="var(--theme)" strokeWidth="3" strokeDasharray="5 5" strokeLinecap="round" />
      <circle cx="20" cy="66" r="5" fill="var(--theme)" />
      <circle cx="70" cy="34" r="8" fill="none" stroke="var(--text-3)" strokeWidth="2.5" strokeDasharray="3 3" />
    </svg>
  );
}
