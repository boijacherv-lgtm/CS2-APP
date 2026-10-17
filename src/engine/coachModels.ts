import { DEFAULT_MODEL, type CoachModel } from './coach';
import faceit10 from './models/faceit10.json';

/**
 * The model the coach judges with: what FACEIT level-10 players do, learned from their demos by `npm run train:coach`
 * (tools/train-coach.ts → models/faceit10.json). Until that has been trained, the hand-set Premier numbers.
 */
const trained = faceit10 as CoachModel;
export const COACH_MODEL: CoachModel = trained.trainedOn > 0 ? trained : DEFAULT_MODEL;
