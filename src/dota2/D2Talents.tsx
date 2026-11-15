import { abilityById, mins } from './data';
import TALENTS from './generated/talents.json';

const TREES = TALENTS as unknown as Record<string, [string, string][]>;
/** The hero levels a talent can be taken at, top of the tree first, as in the game. */
const TIERS = [25, 20, 15, 10];
/** The levels that give a point to spend, in order: a match's skill order lists one choice for each. */
const POINT_LEVELS = [...Array.from({ length: 16 }, (_, i) => i + 1), 18, 20, 25, 26, 27, 28, 29, 30];

/** The talents taken in this skill order, and by which hero level each came (Infinity past the known levels). */
export function talentPicks(upgrades: number[]): Map<string, number> {
  const picks = new Map<string, number>();
  upgrades.forEach((id, i) => {
    const a = abilityById(id);
    if (a?.talent) picks.set(a.key, POINT_LEVELS[i] ?? Infinity);
  });
  return picks;
}

/**
 * A hero's talent tree as in the game: two choices at each of levels 10, 15, 20 and 25, the one taken lit.
 * With `level`, as things stood at that hero level; without it, by the end of the match.
 */
export function TalentTree({ hero, upgrades, level, at }: { hero: number; upgrades: number[]; level?: number; at?: number }) {
  const tree = TREES[hero];
  if (!tree?.length) return null;
  const picks = talentPicks(upgrades);
  const taken = (key: string) => { const by = picks.get(key); return by !== undefined && (level === undefined || by <= level); };
  const label = at === undefined ? 'Talents taken by the end of the match' : `Talents at ${mins(at)}`;
  return (
    <div className="d2-talents" role="group" aria-label={label}>
      {TIERS.map(tier => {
        const i = (tier - 10) / 5 * 2, left = tree[i], right = tree[i + 1];
        const open = level === undefined || level >= tier;
        return (
          <div key={tier} className={`d2-talent-tier ${open ? '' : 'locked'}`}>
            <span className={`d2-talent left ${left && taken(left[0]) ? 'on' : ''}`} title={left?.[1]}>{left?.[1]}</span>
            <b className="d2-talent-level num">{tier}</b>
            <span className={`d2-talent right ${right && taken(right[0]) ? 'on' : ''}`} title={right?.[1]}>{right?.[1]}</span>
          </div>
        );
      })}
    </div>
  );
}
