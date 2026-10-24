import type { Cs2Icon } from './cs2Icons';
import { GameIcon } from './Icon';

/**
 * The killfeed's kill modifiers after the weapon, CS2's own pictograms (deathnotice icons from the game files): the
 * killer flashed, no-scope, through a smoke, through a wall, in the air, headshot.
 */
export type KillMod = 'headshot' | 'wall' | 'smoke' | 'noscope' | 'blind' | 'air';

const ICON: Record<KillMod, { src: Cs2Icon; title: string }> = {
  headshot: { src: 'deathnotice/icon_headshot', title: 'Headshot' },
  wall: { src: 'deathnotice/penetrate', title: 'Through a wall (wallbang)' },
  smoke: { src: 'deathnotice/smoke_kill', title: 'Through a smoke' },
  noscope: { src: 'deathnotice/noscope', title: 'No-scope' },
  blind: { src: 'deathnotice/blind_kill', title: 'The killer was flashed' },
  air: { src: 'deathnotice/inairkill', title: 'The killer was in the air' },
};

export function KillIcon({ mod, size = 16 }: { mod: KillMod; size?: number }) {
  const i = ICON[mod];
  return <GameIcon src={i.src} size={size} title={i.title} className={`kill-icon ${mod}`} />;
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

/** A kill by a grenade that hit them directly (a smoke, flash or decoy to the head), CS2's own pictogram. */
export const IMPACT_ICON: Cs2Icon = 'deathnotice/smokegrenade_impact';
export const isImpactWeapon = (w: string) => /smokegrenade|flashbang|decoy/.test(w.toLowerCase());
