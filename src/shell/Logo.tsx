/** App name and mark in one place, so the brand is easy to change. */
export const APP_NAME = 'RageView';
export const APP_TAGLINE = 'Watch the demo. Prove you were right.';

/**
 * The mark: a pixel-art eye with a heavy, angry lid and a red skull for a pupil (public/images/logo.svg, drawn on a
 * 32 x 32 pixel grid so it stays sharp from the browser tab up; public/images/logo-512.png for profile pictures).
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return <img className="logo-mark" src="/images/logo.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
