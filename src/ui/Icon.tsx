import {
  ArrowArcLeft, ArrowArcRight, BookOpen, ArrowCounterClockwise, ArrowUUpLeft, ArrowUUpRight, CaretDown, CaretLeft, CaretRight, CaretUp,
  ChartBar, ChatCircleText, Check, Circle, Crosshair, CrosshairSimple, Cursor, DiceFive, Eraser, GridFour, HourglassMedium, List,
  Path, Pause, Play, SidebarSimple, SkipBack, SkipForward, Skull, Stack, Star, Sword, Timer, UploadSimple, Warning, X,
  ArrowRight, Bell, Copy, DownloadSimple, GearSix, Lightning, LockSimple, MapTrifold, ShareNetwork, ShieldCheck, SignOut, Target,
  TrendDown, TrendUp, Trophy, UserCircle, UsersThree,
  type Icon as PhIcon, type IconWeight,
} from '@phosphor-icons/react';
import { CS2_ICONS, type Cs2Icon } from './cs2Icons';

/**
 * The app's icons, in two families:
 *   interface   Phosphor icons (bold, or filled for the playback controls), drawn in the text colour
 *   equipment   CS2's own pictograms for grenades, armour, the bomb, the defuse kit and weapons (public/images/icons/cs2,
 *               from the game files), drawn in the text colour with a CSS mask; see GameIcon
 * No emoji anywhere.
 */
type Ui = { C: PhIcon; weight?: IconWeight; flip?: boolean };
type Game = { src: Cs2Icon };

const ICONS = {
  // playback (filled, like media controls)
  play: { C: Play, weight: 'fill' }, pause: { C: Pause, weight: 'fill' },
  toStart: { C: SkipBack, weight: 'fill' }, revealAll: { C: SkipForward, weight: 'fill' },
  prev: { C: CaretLeft }, next: { C: CaretRight }, rewind: { C: ArrowCounterClockwise },
  // editing and navigation
  close: { C: X }, check: { C: Check }, menu: { C: List }, chevronDown: { C: CaretDown },
  undo: { C: ArrowUUpLeft }, redo: { C: ArrowUUpRight }, rotateLeft: { C: ArrowArcLeft }, rotateRight: { C: ArrowArcRight },
  layers: { C: Stack }, panelOpen: { C: SidebarSimple, flip: true }, panelClose: { C: SidebarSimple, flip: true },
  cursor: { C: Cursor }, route: { C: Path }, target: { C: Crosshair }, eraser: { C: Eraser },
  chat: { C: ChatCircleText }, slow: { C: Timer }, swords: { C: Sword }, dice: { C: DiceFive },
  warning: { C: Warning }, skull: { C: Skull }, timer: { C: Timer }, crosshair: { C: CrosshairSimple },
  upload: { C: UploadSimple }, hourglass: { C: HourglassMedium }, grid: { C: GridFour }, star: { C: Star, weight: 'fill' },
  stats: { C: ChartBar }, cross: { C: X }, book: { C: BookOpen, weight: 'fill' },
  up: { C: CaretUp, weight: 'fill' }, down: { C: CaretDown, weight: 'fill' }, dot: { C: Circle, weight: 'fill' },
  // the site: profile, pricing, settings
  arrowRight: { C: ArrowRight }, bell: { C: Bell }, copy: { C: Copy }, download: { C: DownloadSimple }, gear: { C: GearSix },
  bolt: { C: Lightning, weight: 'fill' }, lock: { C: LockSimple }, map: { C: MapTrifold }, share: { C: ShareNetwork }, shield: { C: ShieldCheck },
  signOut: { C: SignOut }, goal: { C: Target }, trendUp: { C: TrendUp }, trendDown: { C: TrendDown }, trophy: { C: Trophy }, user: { C: UserCircle },
  friends: { C: UsersThree },
  // equipment: CS2's own pictograms
  bomb: { src: 'equipment/c4' }, burst: { src: 'equipment/hegrenade' }, flame: { src: 'equipment/inferno' },
  scissors: { src: 'equipment/defuser' }, helmet: { src: 'equipment/armor_helmet' }, vest: { src: 'equipment/armor' },
} satisfies Record<string, Ui | Game>;

export type IconName = keyof typeof ICONS;

/** One of CS2's pictograms, `size` px tall (wide ones like guns get wider), in the text colour. */
export function GameIcon({ src, size = 14, title, className }: { src: Cs2Icon; size?: number; title?: string; className?: string }) {
  const url = `url(/images/icons/cs2/${src}.svg)`;
  return (
    <span className={`icon gicon ${className ?? ''}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} title={title}
      style={{ width: size * CS2_ICONS[src], height: size, WebkitMaskImage: url, maskImage: url }} />
  );
}

export function Icon({ name, size = 14, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  const i: Ui | Game = ICONS[name];
  if ('src' in i) return <GameIcon src={i.src} size={size} title={title} className={className} />;
  const { C, weight = 'bold', flip } = i;
  return (
    <C className={`icon ${className ?? ''}`} size={size} weight={weight} aria-hidden={title ? undefined : true}
      style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      {title && <title>{title}</title>}
    </C>
  );
}
