/**
 * The games on RageView: CS2 is live; the rest are planned, in the order they're likely to come (how much of their
 * match data a coach can get at: replay files or APIs with player positions over time).
 */
export interface Game {
  id: string; short: string; name: string;
  status: 'live' | 'beta' | 'next' | 'planned' | 'waiting';
  /** One line: what it would do, or what it's waiting on. */
  note: string;
  /** Its pictogram (gameMarks.tsx) and colour: our own symbols, not the games' logos. */
  mark: 'crosshair' | 'lock' | 'tower' | 'shield' | 'parachute' | 'ball' | 'crown' | 'knife';
  color: string;
  /** What you bring for a review in this game. */
  source: string;
  /** A page of its own (what it does, what's coming), as a URL hash. */
  page?: string;
  /** Where its Review is, once it has one. */
  review?: string;
}

export const GAMES: Game[] = [
  { id: 'cs2', short: 'CS2', name: 'Counter-Strike 2', status: 'live', mark: 'crosshair', color: '#F2B13C', source: 'a .dem demo', note: 'Graded replays, the engine and a coach.' },
  { id: 'deadlock', short: 'DL', name: 'Deadlock', status: 'beta', mark: 'lock', color: '#E8E0D2', source: 'a match ID', note: 'Replays from a match ID with the coach, and three planners.', page: '#/deadlock', review: '#/deadlock/review' },
  { id: 'dota2', short: 'D2', name: 'Dota 2', status: 'beta', mark: 'tower', color: '#BF2E1A', source: 'a match ID', note: 'Matches from an ID with the coach, and two planners.', page: '#/dota2', review: '#/dota2/review' },
  { id: 'r6', short: 'R6', name: 'Rainbow Six Siege', status: 'planned', mark: 'shield', color: '#E9563D', source: 'a match replay', note: 'Round by round, like CS.' },
  { id: 'pubg', short: 'PUBG', name: 'PUBG', status: 'planned', mark: 'parachute', color: '#F4B942', source: 'a match ID', note: 'Rotations, zones, fights.' },
  { id: 'rl', short: 'RL', name: 'Rocket League', status: 'planned', mark: 'ball', color: '#3D8BFF', source: 'a .replay file', note: 'Rotations and positioning.' },
  { id: 'lol', short: 'LoL', name: 'League of Legends', status: 'planned', mark: 'crown', color: '#C28F2C', source: 'a match ID', note: 'Objectives and turning points.' },
  { id: 'valorant', short: 'VAL', name: 'Valorant', status: 'waiting', mark: 'knife', color: '#FA4454', source: 'match data from Riot', note: 'Waiting on Riot\'s match data.' },
];

export const STATUS_LABEL: Record<Game['status'], string> = { live: 'Live', beta: 'Beta', next: 'Next up', planned: 'Planned', waiting: 'Waiting on Riot' };

/** The live game first, then the rest in order. */
export const LIVE_GAMES = GAMES.filter(g => g.status === 'live');
export const BETA_GAMES = GAMES.filter(g => g.status === 'beta');
export const SOON_GAMES = GAMES.filter(g => g.status !== 'live' && g.status !== 'beta');
