/** App name and mark in one place, so the brand is easy to change. */
export const APP_NAME = 'RageView';
export const APP_TAGLINE = 'Watch the demo. Prove you were right.';

/** An angry eye with a crosshair for a pupil: watching the demo, furious, ready to prove a point. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#12161c" stroke="#2f3a48" />
      <path d="M6.2 8.6 L13.9 12.3 M25.8 8.6 L18.1 12.3" stroke="#e5483a" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M4.2 19 Q16 9.4 27.8 19 Q16 28.6 4.2 19 Z" fill="none" stroke="#e8ecf2" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M8.8 19 H11.4 M20.6 19 H23.2" stroke="#e8ecf2" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="19" r="3.2" fill="none" stroke="#e5483a" strokeWidth="1.9" />
      <circle cx="16" cy="19" r="1.1" fill="#e5483a" />
    </svg>
  );
}
