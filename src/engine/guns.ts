import type { Player, Side, Weapon } from './types';

/**
 * CS2 weapon database. Prices, damage, fire rate, armour penetration and movement speed follow
 * the game's values (rounded); `killRate` (kills per second with a stable sight, close range) and
 * `range` (distance in units where that halves) are this app's fight-model numbers.
 */
export interface Gun {
  id: string;
  name: string;
  short: string;
  cls: Weapon;
  side: Side | 'both';
  price: number;
  damage: number; // per bullet, unarmoured body
  rpm: number;
  armorPen: number; // %
  speed: number; // units/s while holding it
  killRate: number;
  range: number; // units; Infinity = no falloff
  oneTap?: 'head' | 'body'; // AWP one-shots the body, SSG/Deagle need the head
  aliases: string[]; // demo / inventory spellings, normalised (lowercase, letters+digits)
}

const g = (gun: Gun) => gun;

export const GUNS: Gun[] = [
  // rifles
  g({ id: 'ak47', name: 'AK-47', short: 'AK', cls: 'rifle', side: 'T', price: 2700, damage: 36, rpm: 600, armorPen: 77.5, speed: 215, killRate: 2.7, range: 2600, oneTap: 'head', aliases: ['ak47'] }),
  g({ id: 'm4a4', name: 'M4A4', short: 'M4A4', cls: 'rifle', side: 'CT', price: 3100, damage: 33, rpm: 666, armorPen: 70, speed: 225, killRate: 2.6, range: 2500, aliases: ['m4a4', 'm4a1'] }),
  g({ id: 'm4a1s', name: 'M4A1-S', short: 'M4A1', cls: 'rifle', side: 'CT', price: 2900, damage: 38, rpm: 600, armorPen: 70, speed: 225, killRate: 2.55, range: 2700, aliases: ['m4a1s', 'm4a1silencer', 'm4a1silencer'] }),
  g({ id: 'galil', name: 'Galil AR', short: 'Galil', cls: 'rifle', side: 'T', price: 1800, damage: 30, rpm: 666, armorPen: 77.5, speed: 215, killRate: 2.2, range: 2000, aliases: ['galilar', 'galil'] }),
  g({ id: 'famas', name: 'FAMAS', short: 'FAMAS', cls: 'rifle', side: 'CT', price: 2050, damage: 30, rpm: 666, armorPen: 70, speed: 220, killRate: 2.2, range: 2000, aliases: ['famas'] }),
  g({ id: 'sg553', name: 'SG 553', short: 'SG', cls: 'rifle', side: 'T', price: 3000, damage: 30, rpm: 545, armorPen: 100, speed: 210, killRate: 2.75, range: 3200, aliases: ['sg553', 'sg556'] }),
  g({ id: 'aug', name: 'AUG', short: 'AUG', cls: 'rifle', side: 'CT', price: 3300, damage: 28, rpm: 600, armorPen: 90, speed: 220, killRate: 2.7, range: 3200, aliases: ['aug'] }),
  // snipers
  g({ id: 'awp', name: 'AWP', short: 'AWP', cls: 'awp', side: 'both', price: 4750, damage: 115, rpm: 41, armorPen: 97.5, speed: 200, killRate: 3.2, range: Infinity, oneTap: 'body', aliases: ['awp'] }),
  g({ id: 'ssg08', name: 'SSG 08', short: 'Scout', cls: 'rifle', side: 'both', price: 1700, damage: 88, rpm: 48, armorPen: 85, speed: 230, killRate: 2.4, range: 5000, oneTap: 'head', aliases: ['ssg08', 'scout'] }),
  // SMGs
  g({ id: 'mp9', name: 'MP9', short: 'MP9', cls: 'smg', side: 'CT', price: 1250, damage: 26, rpm: 857, armorPen: 60, speed: 240, killRate: 2.1, range: 1300, aliases: ['mp9'] }),
  g({ id: 'mac10', name: 'MAC-10', short: 'MAC', cls: 'smg', side: 'T', price: 1050, damage: 29, rpm: 800, armorPen: 57.5, speed: 240, killRate: 2.0, range: 1200, aliases: ['mac10'] }),
  g({ id: 'mp7', name: 'MP7', short: 'MP7', cls: 'smg', side: 'both', price: 1500, damage: 29, rpm: 800, armorPen: 62.5, speed: 220, killRate: 2.05, range: 1400, aliases: ['mp7'] }),
  g({ id: 'mp5', name: 'MP5-SD', short: 'MP5', cls: 'smg', side: 'both', price: 1500, damage: 27, rpm: 750, armorPen: 62.5, speed: 235, killRate: 1.95, range: 1300, aliases: ['mp5sd', 'mp5'] }),
  g({ id: 'ump45', name: 'UMP-45', short: 'UMP', cls: 'smg', side: 'both', price: 1200, damage: 35, rpm: 666, armorPen: 65, speed: 230, killRate: 2.0, range: 1500, aliases: ['ump45', 'ump'] }),
  g({ id: 'p90', name: 'P90', short: 'P90', cls: 'smg', side: 'both', price: 2350, damage: 26, rpm: 857, armorPen: 69, speed: 230, killRate: 2.3, range: 1500, aliases: ['p90'] }),
  g({ id: 'bizon', name: 'PP-Bizon', short: 'Bizon', cls: 'smg', side: 'both', price: 1400, damage: 27, rpm: 750, armorPen: 57.5, speed: 240, killRate: 1.85, range: 1100, aliases: ['bizon', 'ppbizon'] }),
  // shotguns & heavy (fight like SMGs at close range)
  g({ id: 'nova', name: 'Nova', short: 'Nova', cls: 'smg', side: 'both', price: 1050, damage: 234, rpm: 68, armorPen: 50, speed: 220, killRate: 1.9, range: 550, aliases: ['nova'] }),
  g({ id: 'xm1014', name: 'XM1014', short: 'XM', cls: 'smg', side: 'both', price: 2000, damage: 120, rpm: 171, armorPen: 80, speed: 215, killRate: 2.2, range: 600, aliases: ['xm1014'] }),
  g({ id: 'mag7', name: 'MAG-7', short: 'MAG7', cls: 'smg', side: 'CT', price: 1300, damage: 150, rpm: 71, armorPen: 75, speed: 225, killRate: 2.0, range: 600, aliases: ['mag7'] }),
  g({ id: 'sawedoff', name: 'Sawed-Off', short: 'Sawed', cls: 'smg', side: 'T', price: 1100, damage: 256, rpm: 71, armorPen: 75, speed: 210, killRate: 1.9, range: 450, aliases: ['sawedoff'] }),
  g({ id: 'negev', name: 'Negev', short: 'Negev', cls: 'rifle', side: 'both', price: 1700, damage: 35, rpm: 800, armorPen: 71, speed: 150, killRate: 2.2, range: 2000, aliases: ['negev'] }),
  // pistols
  g({ id: 'glock', name: 'Glock-18', short: 'Glock', cls: 'pistol', side: 'T', price: 200, damage: 30, rpm: 400, armorPen: 47, speed: 240, killRate: 1.2, range: 1100, aliases: ['glock', 'glock18'] }),
  g({ id: 'usps', name: 'USP-S', short: 'USP', cls: 'pistol', side: 'CT', price: 200, damage: 35, rpm: 352, armorPen: 50.5, speed: 240, killRate: 1.35, range: 1300, aliases: ['usps', 'uspsilencer'] }),
  g({ id: 'p2000', name: 'P2000', short: 'P2K', cls: 'pistol', side: 'CT', price: 200, damage: 35, rpm: 352, armorPen: 50.5, speed: 240, killRate: 1.3, range: 1200, aliases: ['p2000', 'hkp2000'] }),
  g({ id: 'p250', name: 'P250', short: 'P250', cls: 'pistol', side: 'both', price: 300, damage: 38, rpm: 400, armorPen: 64, speed: 240, killRate: 1.45, range: 1200, aliases: ['p250'] }),
  g({ id: 'fiveseven', name: 'Five-SeveN', short: '57', cls: 'pistol', side: 'CT', price: 500, damage: 32, rpm: 400, armorPen: 91, speed: 240, killRate: 1.5, range: 1300, aliases: ['fiveseven'] }),
  g({ id: 'tec9', name: 'Tec-9', short: 'Tec9', cls: 'pistol', side: 'T', price: 500, damage: 33, rpm: 500, armorPen: 90, speed: 240, killRate: 1.55, range: 1100, aliases: ['tec9'] }),
  g({ id: 'cz75', name: 'CZ75-Auto', short: 'CZ', cls: 'pistol', side: 'both', price: 500, damage: 31, rpm: 600, armorPen: 77.5, speed: 240, killRate: 1.5, range: 900, aliases: ['cz75a', 'cz75auto', 'cz75'] }),
  g({ id: 'deagle', name: 'Desert Eagle', short: 'Deagle', cls: 'pistol', side: 'both', price: 700, damage: 53, rpm: 267, armorPen: 93, speed: 230, killRate: 1.9, range: 2000, oneTap: 'head', aliases: ['deagle', 'deserteagle'] }),
  g({ id: 'r8', name: 'R8 Revolver', short: 'R8', cls: 'pistol', side: 'both', price: 600, damage: 86, rpm: 120, armorPen: 93, speed: 220, killRate: 1.4, range: 1800, aliases: ['revolver', 'r8revolver', 'r8'] }),
  g({ id: 'dualies', name: 'Dual Berettas', short: 'Duals', cls: 'pistol', side: 'both', price: 300, damage: 38, rpm: 500, armorPen: 57.5, speed: 240, killRate: 1.4, range: 900, aliases: ['elite', 'dualberettas', 'duals'] }),
];

const BY_ID = new Map(GUNS.map(x => [x.id, x]));
const BY_ALIAS = new Map(GUNS.flatMap(x => x.aliases.map(a => [a, x] as const)));

/** "weapon_m4a1_silencer", "M4A1-S", "m4a1_silencer_off" → the gun (undefined for knives, grenades…). */
export function gunFromName(name: string): Gun | undefined {
  let k = name.toLowerCase().replace(/^weapon_/, '').replace(/_off$/, '').replace(/[^a-z0-9]/g, '');
  if (BY_ALIAS.has(k)) return BY_ALIAS.get(k);
  k = k.replace(/(silencer|auto)$/, '');
  return BY_ALIAS.get(k);
}

export const gunById = (id: string | undefined) => (id ? BY_ID.get(id) : undefined);

/** Default gun for a class on a side (used when a player has no specific gun picked). */
export function defaultGun(cls: Weapon, side: Side): Gun {
  const id = { rifle: side === 'T' ? 'ak47' : 'm4a1s', awp: 'awp', smg: side === 'T' ? 'mac10' : 'mp9', pistol: side === 'T' ? 'glock' : 'usps' }[cls];
  return BY_ID.get(id)!;
}

/** The gun a player fights with. */
export const gunOf = (p: Pick<Player, 'gun' | 'weapon' | 'side'>): Gun => gunById(p.gun) ?? defaultGun(p.weapon, p.side);

/** Best gun in an inventory: primary over pistol, pricier first. */
export function primaryGun(names: string[]): Gun | undefined {
  const guns = names.map(gunFromName).filter((x): x is Gun => !!x);
  return guns.sort((a, b) => Number(b.cls !== 'pistol') - Number(a.cls !== 'pistol') || b.price - a.price)[0];
}

/** Fight strength falloff with distance (world units): 1 up close, ½ at the gun's range. */
export const gunRangeFactor = (gun: Gun, units: number) => (Number.isFinite(gun.range) ? 1 / (1 + (units / gun.range) ** 2 * 0.6) : 1);

/** Kills per second at a distance, for the fight model. */
export const gunHazard = (gun: Gun, units: number) => gun.killRate * gunRangeFactor(gun, units);

export const GUN_GROUPS: { label: string; cls: Weapon[]; ids: string[] }[] = [
  { label: 'Rifles', cls: ['rifle'], ids: ['ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug', 'ssg08', 'negev'] },
  { label: 'AWP', cls: ['awp'], ids: ['awp'] },
  { label: 'SMGs & shotguns', cls: ['smg'], ids: ['mp9', 'mac10', 'mp7', 'mp5', 'ump45', 'p90', 'bizon', 'nova', 'xm1014', 'mag7', 'sawedoff'] },
  { label: 'Pistols', cls: ['pistol'], ids: ['glock', 'usps', 'p2000', 'p250', 'fiveseven', 'tec9', 'cz75', 'deagle', 'r8', 'dualies'] },
];
