import STANDS from './generated/stand-spots.json';
import type { Phase } from '../engine/situations';
import type { Side } from '../engine/types';

/**
 * Exactly where FACEIT level-10 players hold (radar px on the 1024 px radar), learned from their demos by
 * `npm run learn:stands` (tools/learn-stands.ts → generated/stand-spots.json): per map, level, side and part of the
 * round, the spots they stand still at and each one's share of that held time.
 */
export interface StandSpot { x: number; y: number; share: number; place: string }
type Data = Record<string, { demos: number; levels: Record<string, Partial<Record<Side, Partial<Record<Phase, StandSpot[]>>>>> }>;
const DATA = STANDS as unknown as Data;

export const standSpots = (map: string, level: number, side: Side, phase: Phase): StandSpot[] =>
  DATA[map]?.levels[String(level)]?.[side]?.[phase] ?? [];
export const standDemos = (map: string) => DATA[map]?.demos ?? 0;
