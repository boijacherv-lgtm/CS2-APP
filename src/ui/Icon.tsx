import { CS2_ICONS, type Cs2Icon } from './cs2Icons';

/**
 * The app's icons: CS2's own pictograms wherever the game has one (GAME below), drawn in the text colour with a CSS
 * mask so they follow the theme; a few small markers are simple line drawings. No emoji anywhere.
 */
const P = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  toStart: <><path d="M6 5v14" /><path d="M18 6l-8 6 8 6z" fill="currentColor" stroke="none" /></>,
  revealAll: <><path d="M5 6l7 6-7 6z" fill="currentColor" stroke="none" /><path d="M12 6l7 6-7 6z" fill="currentColor" stroke="none" /><path d="M20 5v14" /></>,
  rewind: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></>,
  rotateLeft: <><path d="M5 10a7.5 7.5 0 1 1 1.8 7.6" /><path d="M4.5 5v5h5" /></>,
  rotateRight: <><path d="M19 10a7.5 7.5 0 1 0-1.8 7.6" /><path d="M19.5 5v5h-5" /></>,
  undo: <><path d="M9 7L4.5 11.5 9 16" /><path d="M5 11.5h9a5 5 0 0 1 0 10h-3" /></>,
  redo: <><path d="M15 7l4.5 4.5L15 16" /><path d="M19 11.5h-9a5 5 0 0 0 0 10h3" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chevronDown: <path d="M7 10l5 5 5-5" />,
  layers: <><path d="M12 4l9 5-9 5-9-5z" /><path d="M3 14l9 5 9-5" /></>,
  panelOpen: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M14.5 4.5v15M10 9.5L7.5 12 10 14.5" /></>,
  panelClose: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M14.5 4.5v15M7.5 9.5L10 12l-2.5 2.5" /></>,
  cursor: <path d="M6 4l12 7.5-5.2 1.3L10.5 18z" />,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M7.5 16.5C10 10 14 14 16.5 7.5" strokeDasharray="2.5 2.5" /></>,
  target: <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  eraser: <><path d="M16 4.5l4.5 4.5-9.5 9.5H6.5L3.5 15.5z" /><path d="M10 9.5l4.5 4.5M11 18.5h9" /></>,
  chat: <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z" />,
  slow: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2M10 3h4" /></>,
  swords: <><path d="M4 4l10 10M4 4h3.5M4 4v3.5" /><path d="M20 4L10 14M20 4h-3.5M20 4v3.5" /><path d="M7 17l-3 3M17 17l3 3M8.5 15.5l-2 2M15.5 15.5l2 2" /></>,
  dice: <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  warning: <><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.3v.2" /></>,
  bomb: <><rect x="4" y="7" width="16" height="11" rx="2" /><rect x="7" y="10" width="7" height="5" rx="1" /><circle cx="17" cy="12.5" r="1.2" fill="currentColor" stroke="none" /><path d="M9 7V5h6v2" /></>,
  skull: <><path d="M12 3.5c-4.4 0-7.5 3-7.5 7 0 2.5 1.2 4.3 3 5.3V19h9v-3.2c1.8-1 3-2.8 3-5.3 0-4-3.1-7-7.5-7z" /><circle cx="9" cy="11" r="1.6" fill="currentColor" stroke="none" /><circle cx="15" cy="11" r="1.6" fill="currentColor" stroke="none" /><path d="M10.5 19v-2M13.5 19v-2" /></>,
  burst: <path d="M12 3l1.8 5.2L19 6l-2.6 4.8L21 13l-5.2 1.2L17 20l-5-3.3L7 20l1.2-5.8L3 13l4.6-2.2L5 6l5.2 2.2z" />,
  flame: <path d="M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.3-4.6.2 1.6 1 2.6 2.2 3.1C11 9.5 11.3 6 12 3z" />,
  scissors: <><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /><path d="M8.3 15.7L18 4M15.7 15.7L6 4" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4.5h3.5M10 3h4" /></>,
  helmet: <><path d="M4 15a8 8 0 0 1 16 0v1H4z" /><path d="M12 7v9M3 16h18" /></>,
  vest: <path d="M8 4l-4 3v12h6v-5h4v5h6V7l-4-3-2 3h-4z" />,
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 3v5M12 16v5M3 12h5M16 12h5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3.5h16V16" /></>,
  hourglass: <><path d="M7 3.5h10M7 20.5h10" /><path d="M8 3.5c0 5 8 6 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 6-8 8.5s8 3.5 8 8.5" /></>,
  grid: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></>,
  star: <path d="M12 3.5l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.8l-5.3 2.9 1.2-5.9-4.5-4.1 6-.7z" />,
  cross: <path d="M12 4v16M7 9h10" />,
  up: <path d="M12 6l7 11H5z" fill="currentColor" stroke="none" />,
  down: <path d="M12 18L5 7h14z" fill="currentColor" stroke="none" />,
  dot: <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />,
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof P;

/**
 * Which of CS2's own pictograms each icon uses (mirrored or turned where the game only has one direction). Icons not
 * listed here (small markers) are drawn from P above.
 */
const GAME: Partial<Record<IconName, { src: Cs2Icon; flip?: boolean; rotate?: number }>> = {
  close: { src: 'ui/cancel' }, check: { src: 'ui/check' }, play: { src: 'ui/play' }, pause: { src: 'ui/pause' },
  prev: { src: 'ui/back' }, next: { src: 'ui/back', flip: true }, toStart: { src: 'ui/skip', flip: true }, revealAll: { src: 'ui/skip' },
  rewind: { src: 'ui/replay' }, rotateLeft: { src: 'ui/refresh', flip: true }, rotateRight: { src: 'ui/refresh' },
  undo: { src: 'ui/undo' }, redo: { src: 'ui/undo', flip: true }, menu: { src: 'ui/menu' }, chevronDown: { src: 'ui/arrowhead', rotate: 180 },
  layers: { src: 'ui/stats_grid' }, panelOpen: { src: 'ui/popout', flip: true }, panelClose: { src: 'ui/popout' },
  cursor: { src: 'ui/pointer', rotate: -30 }, route: { src: 'ui/followme' }, target: { src: 'ui/crosshair' }, eraser: { src: 'ui/trash' },
  chat: { src: 'ui/message' }, slow: { src: 'ui/timer' }, swords: { src: 'equipment/knife' }, dice: { src: 'ui/random' },
  warning: { src: 'ui/warning' }, bomb: { src: 'equipment/c4' }, skull: { src: 'ui/kill' }, burst: { src: 'equipment/hegrenade' },
  flame: { src: 'equipment/inferno' }, scissors: { src: 'equipment/defuser' }, timer: { src: 'ui/timer' },
  helmet: { src: 'equipment/armor_helmet' }, vest: { src: 'equipment/armor' }, crosshair: { src: 'ui/kill_headshot' },
  upload: { src: 'ui/downloaded', rotate: 180 }, hourglass: { src: 'ui/hourglass' }, grid: { src: 'ui/small_tiles' }, star: { src: 'ui/star' },
  cross: { src: 'ui/map_death' },
};

/** One of CS2's pictograms, `size` px tall (wide ones like guns get wider), in the text colour. */
export function GameIcon({ src, size = 14, title, className, flip, rotate }: {
  src: Cs2Icon; size?: number; title?: string; className?: string; flip?: boolean; rotate?: number;
}) {
  const url = `url(/icons/cs2/${src}.svg)`;
  const transform = [flip ? 'scaleX(-1)' : '', rotate ? `rotate(${rotate}deg)` : ''].join(' ').trim() || undefined;
  return (
    <span className={`icon gicon ${className ?? ''}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} title={title}
      style={{ width: size * CS2_ICONS[src], height: size, WebkitMaskImage: url, maskImage: url, transform }} />
  );
}

export function Icon({ name, size = 14, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  const g = GAME[name];
  if (g) return <GameIcon src={g.src} size={size} title={title} className={className} flip={g.flip} rotate={g.rotate} />;
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {P[name]}
    </svg>
  );
}
