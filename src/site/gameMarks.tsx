import { CastleTurret, Crown, Crosshair, Knife, LockKey, Parachute, ShieldChevron, SoccerBall, type Icon as PhIcon } from '@phosphor-icons/react';
import type { Game } from './games';
import { EVENODD, GAME_LOGOS, ON_DARK } from './gameLogos';

/**
 * Each game's pictogram: its logo (gameLogos.ts) on a tile in the game's colour, or a symbol of our own for games
 * without one there yet. Live games are in full colour; the rest are muted until they launch.
 */
const MARKS: Record<Game['mark'], PhIcon> = {
  crosshair: Crosshair, lock: LockKey, tower: CastleTurret, shield: ShieldChevron, parachute: Parachute, ball: SoccerBall, crown: Crown, knife: Knife,
};

export function GameMark({ game, size = 28, muted }: { game: Game; size?: number; muted?: boolean }) {
  const M = MARKS[game.mark], logo = GAME_LOGOS[game.id];
  return (
    <span className={`game-mark ${muted ? 'muted' : ''} ${ON_DARK.has(game.id) ? 'on-dark' : ''}`} aria-hidden="true"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), '--game': game.color } as React.CSSProperties}>
      {logo
        ? <svg width={Math.round(size * 0.64)} height={Math.round(size * 0.64)} viewBox="0 0 24 24" fill="currentColor"><path d={logo} fillRule={EVENODD.has(game.id) ? 'evenodd' : undefined} /></svg>
        : <M size={Math.round(size * 0.62)} weight="bold" />}
    </span>
  );
}
