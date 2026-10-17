import POSITIONS from './generated/positions.json';
import type { Phase } from '../engine/situations';
import type { Side } from '../engine/types';

/**
 * Where FACEIT level-10 players stand, learned from their demos by `npm run learn:positions`
 * (tools/learn-positions.ts → generated/positions.json): per map, side and phase of the round, each callout's share
 * of their time there and how often that side went on to win the round.
 */
/** `gain`: how much choosing it changed the round for level-10 players (round won − win chance when chosen, shrunk); `n`: choices measured. */
export interface ProSpot { place: string; share: number; winRate: number; rounds: number; gain?: number; n?: number }
export interface ProMove { from: string; to: string; count: number; phases: Partial<Record<Phase, number>>; triggers: { why: string; n: number }[]; gain?: number }
export interface ProReaction { from: string; trigger: string; phase?: Phase; n: number; to: { place: string; n: number; gain?: number }[] }
interface MapPositions {
  demos: number; rounds: number;
  spots: Record<Side, Partial<Record<Phase, ProSpot[]>>>;
  situations?: Record<Side, Record<string, ProSpot[]>>;
  moves: Record<Side, ProMove[]>;
  reactions?: Record<Side, ProReaction[]>;
  risks?: Record<Side, Record<string, ProRisk>>;
}
/** How holding a spot goes for level-10 players in a given pressure / support (see tools/learn-positions.ts). */
export interface ProRisk { n: number; died: number; moved: number; won: number; to: { place: string; n: number }[] }
export const riskKey = (place: string, pressure: number, alone: boolean) => `${place}|${Math.min(2, pressure)}|${alone ? 'alone' : 'team'}`;
export const proRisk = (map: string, side: Side, place: string, pressure: number, alone: boolean): ProRisk | null =>
  DATA[map]?.risks?.[side][riskKey(place, pressure, alone)] ?? null;
/** Players alive: your side vs theirs. */
export type Advantage = 'even' | 'up' | 'down';
export const advantageOf = (alive: [number, number]): Advantage => (alive[0] > alive[1] ? 'up' : alive[0] < alive[1] ? 'down' : 'even');

const DATA = POSITIONS as unknown as Record<string, MapPositions>;

export const proPositions = (map: string): MapPositions | null => DATA[map] ?? null;
export const proSpots = (map: string, side: Side, phase: Phase): ProSpot[] => DATA[map]?.spots[side][phase] ?? [];

/** Spots in a situation (phase + who's up), when there's enough data for it; otherwise null. */
export const proSituationSpots = (map: string, side: Side, phase: Phase, adv: Advantage, site?: 'A' | 'B', target?: 'A' | 'B'): ProSpot[] | null => {
  const sit = DATA[map]?.situations?.[side];
  if (!sit) return null;
  // Ts before the plant: compared with Ts going for the same site
  if (side === 'T' && phase !== 'post-plant' && target && sit[`${phase}|${adv}|go${target}`]) return sit[`${phase}|${adv}|go${target}`];
  // after the plant: the bomb's site with the same numbers, else that site with any numbers
  if (phase === 'post-plant' && site) return sit[`${phase}|${adv}|${site}`] ?? sit[`${phase}|any|${site}`] ?? null;
  return sit[`${phase}|${adv}`] ?? null;
};
export const proReactions = (map: string, side: Side): ProReaction[] => DATA[map]?.reactions?.[side] ?? [];
/** What level-10 players do from a spot after a trigger: in the same phase of the round when there's enough data, else overall. */
export const proReaction = (map: string, side: Side, from: string, trigger: string, phase: Phase, minN: number): ProReaction | undefined => {
  const all = proReactions(map, side).filter(r => r.from === from && r.trigger === trigger);
  return all.find(r => r.phase === phase && r.n >= minN) ?? all.find(r => !r.phase && r.n >= minN);
};
export const proMoves = (map: string, side: Side): ProMove[] => DATA[map]?.moves[side] ?? [];
