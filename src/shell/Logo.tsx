/** App name and mark in one place, so the brand is easy to change. */
export const APP_NAME = 'Stratboard';
export const APP_TAGLINE = 'Plan rounds. Simulate fights. Review your matches.';

/** Crosshair over a tactics board: four ticks, a ring and a route arrow. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#141a22" stroke="#2f3a48" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#4ea3ff" strokeWidth="2" />
      <path d="M16 3.5v5M16 23.5v5M3.5 16h5M23.5 16h5" stroke="#4ea3ff" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 20.5 L15 15 L18.5 17.5 L22 11.5" fill="none" stroke="#e8a33c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="11.5" r="1.8" fill="#e8a33c" />
    </svg>
  );
}
