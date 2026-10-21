/**
 * The games on RageView: CS2 is live; the rest are planned, in the order they're likely to come (how much of their
 * match data a coach can get at: replay files or APIs with player positions over time).
 */
export interface Game {
  id: string; short: string; name: string;
  status: 'live' | 'next' | 'planned' | 'waiting';
  /** One line: what it would do, or what it's waiting on. */
  note: string;
}

export const GAMES: Game[] = [
  { id: 'cs2', short: 'CS2', name: 'Counter-Strike 2', status: 'live', note: 'Graded replays, the engine and a coach trained on FACEIT level-10 and pro matches.' },
  { id: 'deadlock', short: 'DL', name: 'Deadlock', status: 'next', note: 'Valve\'s Source 2 demos, the same family as CS2: replays and fight grades come first.' },
  { id: 'dota2', short: 'D2', name: 'Dota 2', status: 'planned', note: 'Full replays and open match data: lanes, rotations, fights and item timings.' },
  { id: 'r6', short: 'R6', name: 'Rainbow Six Siege', status: 'planned', note: 'Round-based like CS: replays from Siege\'s match files, site setups and entries.' },
  { id: 'pubg', short: 'PUBG', name: 'PUBG', status: 'planned', note: 'Every player\'s path from PUBG\'s official match data: rotations, zones and fights.' },
  { id: 'rl', short: 'RL', name: 'Rocket League', status: 'planned', note: 'Car and ball positions from replay files: rotation and positioning coaching.' },
  { id: 'lol', short: 'LoL', name: 'League of Legends', status: 'planned', note: 'Riot\'s match timelines: objectives, rotations and the moments games turn.' },
  { id: 'valorant', short: 'VAL', name: 'Valorant', status: 'waiting', note: 'No replay files; waiting on access to Riot\'s match data.' },
];

export const STATUS_LABEL: Record<Game['status'], string> = { live: 'Live', next: 'Next up', planned: 'Planned', waiting: 'Waiting on Riot' };
