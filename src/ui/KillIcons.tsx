/**
 * The killfeed's kill modifiers, drawn after the weapon like CS2's: headshot, through a wall, through a smoke,
 * no-scope, the killer flashed, the killer in the air. Our own line drawings in the text colour (16 × 16 grid).
 */
export type KillMod = 'headshot' | 'wall' | 'smoke' | 'noscope' | 'blind' | 'air';

const TITLE: Record<KillMod, string> = {
  headshot: 'Headshot', wall: 'Through a wall (wallbang)', smoke: 'Through a smoke', noscope: 'No-scope', blind: 'The killer was flashed', air: 'The killer was in the air',
};

const PATHS: Record<KillMod, JSX.Element> = {
  // a head in the crosshair
  headshot: <><circle cx="8" cy="7" r="3.2" /><path d="M3.5 14.5c.8-2.4 2.5-3.5 4.5-3.5s3.7 1.1 4.5 3.5" /><path d="M8 .8v2.4M8 11v.1M.8 7h2.4M12.8 7h2.4" /></>,
  // a bullet through a wall
  wall: <><path d="M7 1.5v13M10 1.5v13" /><path d="M7 5h3M7 9h3M7 12.5h3" /><path d="M1 8h14m-3-2.5L15 8l-3 2.5" /></>,
  // a cloud of smoke
  smoke: <path d="M4.5 12.5a3 3 0 0 1-.4-6A4 4 0 0 1 11.7 5a3.3 3.3 0 0 1 .3 7.5Z" />,
  // a scope, crossed out
  noscope: <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5v2M8 9.5v2M4.5 8h2M9.5 8h2" /><path d="M2 14 14 2" /></>,
  // an eye, crossed out
  blind: <><path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.9" /><path d="M2.5 14 13.5 2" /></>,
  // off the ground: rising, above a floor line
  air: <><path d="M8 11V2.5M4.8 5.5 8 2.3l3.2 3.2" /><path d="M2.5 14.5h11" /></>,
};

export function KillIcon({ mod, size = 14 }: { mod: KillMod; size?: number }) {
  return (
    <svg className={`kill-icon ${mod}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={TITLE[mod]}>
      <title>{TITLE[mod]}</title>
      {PATHS[mod]}
    </svg>
  );
}

/** The modifiers of one kill (newer parses have all of them; older ones only the headshot), in CS2's order. */
export function killMods(k: { headshot: boolean; wall?: number; smoke?: boolean; noscope?: boolean; blind?: boolean; air?: boolean }): KillMod[] {
  const out: KillMod[] = [];
  if (k.blind) out.push('blind');
  if (k.noscope) out.push('noscope');
  if (k.smoke) out.push('smoke');
  if (k.wall) out.push('wall');
  if (k.air) out.push('air');
  if (k.headshot) out.push('headshot');
  return out;
}
