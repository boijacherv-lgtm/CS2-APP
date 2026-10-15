import { Arc, Arrow, Circle, Group, Line, Path, Star, Text } from 'react-konva';
import { HE_RADIUS_U } from '../engine/combat';
import { lifeOf, popAt, SMOKE_RADIUS_UNITS } from '../engine/grid';
import { GRADE_INFO, type Grade } from '../engine/recap';
import type { Utility, Vec2 } from '../engine/types';

/**
 * Grenades drawn like a 2D replay: an icon where it will land, the grenade flying along its arc,
 * then the effect itself — a smoke cloud with a countdown ring, flickering fire, a flash burst,
 * an HE shockwave. Everything is a function of round time, so scrubbing plays it back.
 */

const MOLLY_RADIUS_U = 120;
const FLASH_SHOW = 0.55; // s the burst stays on screen
const HE_SHOW = 0.7;
const BLOOM = 0.7; // s for a smoke to reach full size
const FADE = 1.5; // s of fade at the end of a smoke

export const NADE_COLOR: Record<Utility['type'], string> = { smoke: '#b9c2cc', flash: '#fff3a3', molotov: '#ff6a1f', he: '#7bd88f' };

/** 24×24 glyphs for the grenade icons. */
const GLYPH: Record<Utility['type'], string> = {
  smoke: 'M7 18.5a4.2 4.2 0 0 1-.7-8.35A5.6 5.6 0 0 1 17.2 9a3.8 3.8 0 0 1 .3 7.5V18.5z',
  flash: 'M13.5 2 4.5 13.5h6.5L9.5 22l9.5-12h-6.5z',
  molotov: 'M12 2.5c.8 3.6 5.5 5.6 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.8 1.6-4.6 2.6-6.4.2 2.6 1.5 3.8 2.7 3.8.2-2.9-1.9-4.6.2-8z',
  he: 'M12 8.5a6 6 0 1 0 .01 0zM10.2 3.5h3.6v3.2h-3.6zM14.5 4.4l3.2-1.6.8 1.6-3.3 1.6z',
};

/** Round icon with the grenade's glyph. */
export function NadeIcon({ type, size, opacity = 1, ring }: { type: Utility['type']; size: number; opacity?: number; ring?: string }) {
  return (
    <Group opacity={opacity} listening={false}>
      <Circle radius={size} fill="#11161d" stroke={ring ?? NADE_COLOR[type]} strokeWidth={size * 0.16} />
      <Path data={GLYPH[type]} fill={NADE_COLOR[type]} x={-size * 0.62} y={-size * 0.62} scaleX={(size * 1.24) / 24} scaleY={(size * 1.24) / 24} />
    </Group>
  );
}

/** Pseudo-random but stable per grenade, so puffs and flames don't jump around between frames. */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

/** Countdown ring around an active effect, with seconds left. */
function Countdown({ r, left, total, k, color }: { r: number; left: number; total: number; k: number; color: string }) {
  return (
    <Group listening={false}>
      <Arc innerRadius={r + 1 * k} outerRadius={r + 2.2 * k} angle={360 * Math.max(0, left / total)} rotation={-90} fill={color} opacity={0.6} />
      <Text text={`${Math.ceil(left)}`} fontSize={8 * k} fontStyle="bold" fill="#fff" stroke="#000" strokeWidth={2} fillAfterStrokeEnabled
        width={20 * k} x={-10 * k} y={-r - 13 * k} align="center" />
    </Group>
  );
}

function SmokeCloud({ u, t, k, R }: { u: Utility; t: number; k: number; R: number }) {
  const since = t - popAt(u);
  const life = lifeOf(u);
  const left = life - since;
  const grow = Math.min(1, 0.35 + (0.65 * since) / BLOOM);
  const alpha = left < FADE ? Math.max(0, left / FADE) : 1;
  const rnd = rand(u.id);
  const puffs = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.5;
    const d = i === 0 ? 0 : R * (0.38 + rnd() * 0.18);
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: R * (i === 0 ? 0.72 : 0.5 + rnd() * 0.14) };
  });
  return (
    <Group listening={false}>
      <Group scaleX={grow} scaleY={grow} opacity={alpha}>
        {puffs.map((p, i) => (
          <Circle key={i} x={p.x} y={p.y} radius={p.r}
            fillRadialGradientStartPoint={{ x: 0, y: 0 }} fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={p.r}
            fillRadialGradientColorStops={[0, 'rgba(232,236,240,0.95)', 0.55, 'rgba(196,203,210,0.85)', 1, 'rgba(160,168,178,0)']} />
        ))}
      </Group>
      {alpha > 0.3 && <Countdown r={R} left={left} total={life} k={k} color="#dfe4ea" />}
    </Group>
  );
}

function Fire({ u, t, k, R }: { u: Utility; t: number; k: number; R: number }) {
  const since = t - popAt(u);
  const life = lifeOf(u);
  const left = life - since;
  const spread = Math.min(1, 0.4 + since / 0.8);
  const alpha = left < 0.8 ? Math.max(0, left / 0.8) : 1;
  const rnd = rand(u.id);
  const flames = Array.from({ length: 12 }, () => {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 0.75;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: R * (0.28 + rnd() * 0.22), ph: rnd() * 6.28 };
  });
  return (
    <Group listening={false}>
      <Circle radius={R} fill="rgba(60,20,8,0.45)" opacity={alpha} />
      <Group scaleX={spread} scaleY={spread} opacity={alpha}>
        {flames.map((f, i) => {
          const flick = 1 + 0.12 * Math.sin(t * 14 + f.ph);
          return (
            <Circle key={i} x={f.x} y={f.y} radius={f.r * flick}
              fillRadialGradientStartPoint={{ x: 0, y: 0 }} fillRadialGradientEndPoint={{ x: 0, y: 0 }}
              fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={f.r * flick}
              fillRadialGradientColorStops={[0, 'rgba(255,240,150,0.95)', 0.35, 'rgba(255,150,40,0.85)', 0.75, 'rgba(220,60,20,0.5)', 1, 'rgba(180,30,10,0)']} />
          );
        })}
      </Group>
      {alpha > 0.3 && <Countdown r={R} left={left} total={life} k={k} color="#ff7a2f" />}
    </Group>
  );
}

function FlashBurst({ u, t, k }: { u: Utility; t: number; k: number }) {
  const f = (t - popAt(u)) / FLASH_SHOW;
  const r = (14 + 26 * f) * k;
  return (
    <Group listening={false} opacity={1 - f}>
      <Circle radius={r * 1.2} fillRadialGradientStartPoint={{ x: 0, y: 0 }} fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={r * 1.2}
        fillRadialGradientColorStops={[0, 'rgba(255,255,255,1)', 0.4, 'rgba(255,250,200,0.7)', 1, 'rgba(255,250,200,0)']} />
      <Star numPoints={8} innerRadius={r * 0.25} outerRadius={r} fill="#fffbe0" rotation={f * 40} />
    </Group>
  );
}

function HeBlast({ u, t, k, R }: { u: Utility; t: number; k: number; R: number }) {
  const f = (t - popAt(u)) / HE_SHOW;
  return (
    <Group listening={false} opacity={1 - f}>
      <Circle radius={R * (0.25 + 0.75 * f)} stroke="#ffb020" strokeWidth={(5 - 3 * f) * k} />
      <Circle radius={R * 0.35 * (1 - f * 0.5)} fillRadialGradientStartPoint={{ x: 0, y: 0 }} fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={R * 0.35}
        fillRadialGradientColorStops={[0, 'rgba(255,230,140,0.95)', 0.6, 'rgba(255,120,30,0.7)', 1, 'rgba(120,40,10,0)']} />
    </Group>
  );
}

export type NadePhase = 'planned' | 'flying' | 'active' | 'done';

export function nadePhase(u: Utility, t: number): NadePhase {
  const pop = popAt(u);
  if (t < u.throwAt) return 'planned';
  if (t < pop) return 'flying';
  const dur = u.type === 'flash' ? FLASH_SHOW : u.type === 'he' ? HE_SHOW : lifeOf(u);
  return t < pop + dur ? 'active' : 'done';
}

/**
 * The grenade at its landing spot (draw inside a Group positioned at u.pos).
 * `editable` keeps a faint icon visible before/after so it can be selected and dragged.
 */
export function NadeAtLanding({ u, t, k, unitsPerPx, selected, doomed, editable, grade }: {
  u: Utility; t: number; k: number; unitsPerPx: number; selected: boolean; doomed: boolean; editable: boolean;
  /** Review grade, shown as a chess-style mark on the grenade once it has popped. */
  grade?: Grade;
}) {
  const phase = nadePhase(u, t);
  const R = u.type === 'smoke' ? SMOKE_RADIUS_UNITS / unitsPerPx : u.type === 'molotov' ? MOLLY_RADIUS_U / unitsPerPx : HE_RADIUS_U / unitsPerPx;
  const ring = doomed ? '#ff4d4d' : selected ? '#ffffff' : undefined;
  // replays don't spoil: a grenade shows up only once it's in the air
  if (!editable && phase === 'planned') return null;
  return (
    <>
      {phase === 'active' && u.type === 'smoke' && <SmokeCloud u={u} t={t} k={k} R={R} />}
      {phase === 'active' && u.type === 'molotov' && <Fire u={u} t={t} k={k} R={R} />}
      {phase === 'active' && u.type === 'flash' && <FlashBurst u={u} t={t} k={k} />}
      {phase === 'active' && u.type === 'he' && <HeBlast u={u} t={t} k={k} R={R} />}
      {(phase === 'planned' || phase === 'flying') && (u.type === 'smoke' || u.type === 'molotov') && !(u.path && phase === 'planned') && (
        <Circle radius={R} stroke={NADE_COLOR[u.type]} strokeWidth={1 * k} dash={[4 * k, 3 * k]} opacity={phase === 'flying' ? 0.7 : 0.35} listening={false} />
      )}
      {grade && phase !== 'planned' && phase !== 'flying' && t - popAt(u) < Math.max(3, lifeOf(u)) && <GradeMark grade={grade} x={R * 0.72} y={-R * 0.72} k={k} />}
      {/* hit area + icon: always there while editing, otherwise only before it pops */}
      {(editable || phase === 'planned' || phase === 'flying' || selected || doomed) && (
        <>
          <Circle radius={9 * k} fill="transparent" />
          <NadeIcon type={u.type} size={(phase === 'active' && !selected && !doomed ? 4.5 : 7) * k} ring={ring}
            opacity={doomed || selected ? 1 : phase === 'planned' ? 0.55 : phase === 'flying' ? 0.9 : phase === 'active' ? 0.5 : 0.35} />
        </>
      )}
    </>
  );
}

/** Thrown grenades flying along their arc from the thrower to the landing spot. */
export function NadeFlight({ u, t, k }: { u: Utility; t: number; k: number }) {
  if (u.path) return <RealFlight u={u} path={u.path} t={t} k={k} />;
  if (!u.from) return null;
  const pop = popAt(u);
  const land = Math.min(pop, u.throwAt + Math.max(0.6, (pop - u.throwAt) * 0.75)); // smokes roll a little after landing
  const show = t <= pop + 0.4;
  if (!show) return null;
  const c = bow(u.from, u.pos);
  const flying = t >= u.throwAt && t < land;
  const f = flying ? (t - u.throwAt) / (land - u.throwAt) : 0;
  const at = quad(u.from, c, u.pos, f);
  return (
    <Group listening={false}>
      <Arrow points={[u.from.x, u.from.y, c.x, c.y, u.pos.x, u.pos.y]} tension={0.5} stroke={NADE_COLOR[u.type]} fill={NADE_COLOR[u.type]}
        strokeWidth={1.4 * k} dash={[5 * k, 4 * k]} pointerLength={4 * k} pointerWidth={4 * k} opacity={t < u.throwAt ? 0.35 : 0.75} />
      <Circle x={u.from.x} y={u.from.y} radius={3 * k} fill="#ffd23f" stroke="#000" strokeWidth={0.8 * k} />
      {flying && <Group x={at.x} y={at.y}><NadeIcon type={u.type} size={5.5 * k} /></Group>}
    </Group>
  );
}

/**
 * A grenade from a demo: the trail grows behind it as it flies the real path (bounces included),
 * then stays faintly for a moment after it pops so you can see where it came from.
 */
function RealFlight({ u, path, t, k }: { u: Utility; path: Vec2[]; t: number; k: number }) {
  const pop = popAt(u);
  if (t < u.throwAt || t > pop + 1.5) return null;
  const f = Math.min(1, (t - u.throwAt) / (pop - u.throwAt || 1));
  // path samples are evenly spaced in time, so the fraction of time is the fraction of samples
  const pos = f * (path.length - 1);
  const i = Math.floor(pos), a = pos - i;
  const p = path[i], q = path[Math.min(path.length - 1, i + 1)];
  const at = { x: p.x + (q.x - p.x) * a, y: p.y + (q.y - p.y) * a };
  const pts = path.slice(0, i + 1).flatMap(v => [v.x, v.y]).concat(at.x, at.y);
  const fade = t > pop ? 1 - (t - pop) / 1.5 : 1;
  return (
    <Group listening={false} opacity={fade}>
      <Line points={pts} stroke="#000" strokeWidth={3 * k} opacity={0.35} lineCap="round" lineJoin="round" />
      <Line points={pts} stroke={NADE_COLOR[u.type]} strokeWidth={1.5 * k} lineCap="round" lineJoin="round" />
      <Circle x={path[0].x} y={path[0].y} radius={2.5 * k} fill={NADE_COLOR[u.type]} stroke="#000" strokeWidth={0.8 * k} />
      {t < pop && <Group x={at.x} y={at.y}><NadeIcon type={u.type} size={5 * k} /></Group>}
    </Group>
  );
}

function GradeMark({ grade, x, y, k }: { grade: Grade; x: number; y: number; k: number }) {
  const g = GRADE_INFO[grade];
  return (
    <Group x={x} y={y} listening={false}>
      <Circle radius={7 * k} fill={g.color} stroke="#000" strokeWidth={1.2 * k} />
      <Text text={g.mark} fontSize={(g.mark.length > 1 ? 7.5 : 9) * k} fontStyle="bold" fill="#111" width={14 * k} x={-7 * k} y={-4.2 * k} align="center" />
    </Group>
  );
}

const bow = (a: Vec2, b: Vec2) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (a.x + b.x) / 2 - ((b.y - a.y) / d) * d * 0.18, y: (a.y + b.y) / 2 + ((b.x - a.x) / d) * d * 0.18 };
};
const quad = (a: Vec2, c: Vec2, b: Vec2, f: number) => ({
  x: (1 - f) ** 2 * a.x + 2 * (1 - f) * f * c.x + f * f * b.x,
  y: (1 - f) ** 2 * a.y + 2 * (1 - f) * f * c.y + f * f * b.y,
});
