import { DEFAULT_MODEL, type CoachModel } from './coach';
import faceit10 from './models/faceit10.json';
import pro from './models/pro.json';

/**
 * The model the coach judges with: what FACEIT level-10 players do, learned from their demos by `npm run train:coach`
 * (tools/train-coach.ts → models/faceit10.json). Until that has been trained, the hand-set Premier numbers.
 */
const trained = faceit10 as CoachModel;
export const COACH_MODEL: CoachModel = trained.trainedOn > 0 ? trained : DEFAULT_MODEL;

/** The pro level: the same numbers learned from pro matches (HLTV demos: npm run train:coach -- <folder> --name pro), or null until trained. */
const proTrained = pro as unknown as CoachModel;
export const PRO_MODEL: CoachModel | null = proTrained.trainedOn > 0 ? proTrained : null;
/** Who the report compares with. */
export type Level = 'lvl10' | 'pro';
export const modelOf = (level: Level): CoachModel => (level === 'pro' && PRO_MODEL ? PRO_MODEL : COACH_MODEL);
