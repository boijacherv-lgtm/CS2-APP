import { useEffect, useState } from 'react';
import { Arc, Circle, Group, Image as KImage, Line, Rect, RegularPolygon, Star, Text } from 'react-konva';
import { DL_MAP, DL_MAP_IMAGE, type DlTeam } from './data';
import { clock, RULES, urnLane } from './timings';
import { upAt, type DlDemo } from './demo';

/**
 * The Deadlock map drawn like the game's own minimap (Oct 2026): a dark round map with the two bases, each lane a
 * chain of objectives from the patron out (base guardian, walker, guardian) in that lane's colour for your team and
 * red for the other, the mid boss in the middle, camps as stacked triangles by how strong they are. Shared by
 * Review (DlBoard) and Tactical (MapBase); everything is in Konva nodes for a Layer, in map units 0–1 times S.
 */

/** The game's lane colours (generic data's lane_info): York, Broadway, Greenwich, and the enemy's. */
export const LANE_COLOR: Record<1 | 3 | 4, string> = { 1: '#F1CC30', 3: '#29B1CC', 4: '#59B247' };
const LANE_LINE: Record<1 | 3 | 4, string> = { 1: '#BEA94E', 3: '#559BBE', 4: '#66995C' };
const ENEMY = '#E0533A', ENEMY_LINE = '#A8432E';
/** Your base: the patron and shrines. */
const HOME = '#EFE3CC';
const DOWN = '#0b0e12';

type Obj = (typeof DL_MAP.objectives)[number];
const objAt = (team: DlTeam, key: string): Obj | undefined => DL_MAP.objectives.find(o => o.id === `team${team}_${key}`);
const titan = (team: DlTeam) => objAt(team, 'titan')!;

/** A team's base, a little behind its patron (for the glow under your base). */
const base = (team: DlTeam) => { const t = titan(team); return { x: t.x, y: t.y + (team === 0 ? 0.04 : -0.04) }; };

/** The underpasses (deadlock-api's tunnel minimaps, same frame as the map): the mid boss pit with its side passages,
 * and the sewer tunnels. Only their passages are kept, drawn warm and see-through over the streets. */
const TUNNELS = ['minimap_midtown_mid_tunnels.png', 'minimap_midtown_rat_tunnels.png'].map(f => `https://assets-bucket.deadlock-api.com/assets-api-res/images/maps/${f}`);
export function useTunnels() {
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let left = TUNNELS.length;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const g = c.getContext('2d')!;
    for (const src of TUNNELS) {
      const i = new window.Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => {
        const t = document.createElement('canvas');
        t.width = 1024; t.height = 1024;
        const tg = t.getContext('2d')!;
        tg.drawImage(i, 0, 0, 1024, 1024);
        const d = tg.getImageData(0, 0, 1024, 1024);
        // a passage is an exactly neutral dark grey, solid (e.g. 38,38,38); the haze around them is a touch green
        // (e.g. 44,53,47)
        for (let k = 0; k < d.data.length; k += 4) {
          const [r, g2, b] = [d.data[k], d.data[k + 1], d.data[k + 2]];
          const solid = d.data[k + 3] > 200 && r < 75 && Math.abs(g2 - r) <= 2 && Math.abs(b - r) <= 2;
          d.data[k] = 200; d.data[k + 1] = 164; d.data[k + 2] = 106; d.data[k + 3] = solid ? 120 : 0;
        }
        tg.putImageData(d, 0, 0);
        g.drawImage(t, 0, 0);
        if (--left === 0) setImg(c);
      };
      i.onerror = () => { if (--left === 0) setImg(c); };
      i.src = src;
    }
  }, []);
  return img;
}

/** The minimap in the game's dark colours: streets dark grey, buildings near black. */
export function useGameMap(src = DL_MAP_IMAGE) {
  const [img, setImg] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const i = new window.Image();
    i.onload = () => {
      const c = document.createElement('canvas');
      c.width = i.width; c.height = i.height;
      const g = c.getContext('2d')!;
      g.drawImage(i, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      for (let k = 0; k < d.data.length; k += 4) {
        if (d.data[k + 3] < 20) continue;
        const [r, gg, b] = d.data[k] > 160 ? [11, 13, 16] : [31, 35, 41];
        d.data[k] = r; d.data[k + 1] = gg; d.data[k + 2] = b;
      }
      g.putImageData(d, 0, 0);
      setImg(c);
    };
    i.src = src;
  }, [src]);
  return img;
}

export type ArtLayer = 'lanes' | 'objectives' | 'camps' | 'urn' | 'shops' | 'teleporters' | 'buffs' | 'tunnels';
const ALL: Set<ArtLayer> = new Set(['lanes', 'objectives', 'camps', 'urn', 'shops', 'teleporters', 'buffs', 'tunnels']);

/**
 * The map and what's on it. `you`: the team drawn in lane colours (the other one red), like the game shows your own
 * team. `down(team, key)`: whether that objective is destroyed (drawn hollow with a cross).
 */
export function MapArt({ S, k, img, tunnels = null, you = 0, layers = ALL, down, at, part = 'all' }: {
  S: number; k: number; img: HTMLCanvasElement | null; you?: DlTeam; layers?: Set<ArtLayer>;
  /** The underpasses (useTunnels), drawn over the streets. */
  tunnels?: HTMLCanvasElement | null;
  /** Which part to draw: the map and what never moves ('base': its own layer, redrawn only when that changes), what
   * comes and goes with time ('live'), or both. */
  part?: 'all' | 'base' | 'live';
  down?: (team: DlTeam, key: string) => boolean;
  /** A moment of a match (Review): then only what's up at that time shows (timings.ts), with when it came, and the
   * mid boss only while it's alive (its kills in this match). Without it, everything shows (Tactical). */
  at?: { time: number; midBoss: { t: number }[];
    /** The match's demo (demo.ts): then camps and bridge buffs as they really were, and the urn where it really was
     * (`urnNow`: on the ground, or with its carrier; null: no urn out). */
    demo?: DlDemo | null; urnNow?: { x: number; y: number; label: string; carried: boolean; fromLeft: boolean } | null };
}) {
  const demo = at?.demo ?? null;
  const B = part !== 'live', L = part !== 'base';
  const tm = at?.time;
  const up = (from: number) => tm === undefined || tm >= from;
  // the latest spawn mark at or before now, for things on a schedule
  const lastMark = (first: number, every: number) => (tm === undefined || tm < first ? null : first + Math.floor((tm - first) / every) * every);
  const urnAt = lastMark(RULES.urn.spawn, RULES.urn.every), urn = urnAt === null ? null : { lane: urnLane(urnAt), t: urnAt };
  const buffsAt = lastMark(RULES.bridgeBuffs.spawn, RULES.bridgeBuffs.every);
  // the rift: shown for 2 min from each expected spawn (it can be a minute either side, on either side lane)
  const riftAt = lastMark(RULES.rift.spawn, RULES.rift.every);
  const riftOn = tm === undefined || (riftAt !== null && tm - riftAt < 120);
  const bossDown = at ? (() => { const dead = at.midBoss.filter(b => b.t <= at.time); const last = dead[dead.length - 1];
    return !!last && at.time < last.t + RULES.midBoss.respawn[Math.min(dead.length - 1, RULES.midBoss.respawn.length - 1)]; })() : false;
  const tag = (text: string, color: string, dy = 10) => (
    <Text text={text} x={-20 * k} y={dy * k} width={40 * k} align="center" fontSize={8.5 * k} fontStyle="bold" fill={color} stroke="#0b0e12" strokeWidth={2.5 * k} fillAfterStrokeEnabled />
  );
  const P = (p: { x: number; y: number }) => ({ x: p.x * S, y: p.y * S });
  const mine = base(you);
  const colorOf = (o: Obj) => (o.team !== you ? ENEMY : o.lane ? LANE_COLOR[o.lane as 1 | 3 | 4] : HOME);
  const lineOf = (team: DlTeam, lane: 1 | 3 | 4) => (team !== you ? ENEMY_LINE : LANE_LINE[lane]);
  const isDown = (o: Obj) => !!down?.(o.team as DlTeam, o.id.replace(/^team\d_/, ''));
  return (
    <>
      {/* the whole map, the underpasses over it, your base glowing */}
      {B && <Group listening={false}>
        <Rect width={S} height={S} fill="#0e1115" />
        {img && <KImage image={img} width={S} height={S} />}
        {layers.has('tunnels') && tunnels && <KImage image={tunnels} width={S} height={S} />}
        <Circle {...P(mine)} radius={0.32 * S} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={0.32 * S}
          fillRadialGradientColorStops={[0, 'rgba(90,200,175,0.30)', 0.55, 'rgba(90,200,175,0.08)', 1, 'rgba(90,200,175,0)']} />
      </Group>}

      <Group listening={false}>
        {/* each lane: patron → base guardian → walker → guardian */}
        {B && layers.has('lanes') && ([0, 1] as DlTeam[]).flatMap(team => ([1, 3, 4] as const).map(lane => {
          const pts = [titan(team), objAt(team, `base_${lane}`), objAt(team, `tier2_${lane}`), objAt(team, `tier1_${lane}`)].filter((o): o is Obj => !!o);
          return <Line key={`l${team}${lane}`} points={pts.flatMap(o => [o.x * S, o.y * S])} stroke={lineOf(team, lane)} strokeWidth={1.6 * k} opacity={0.9} lineJoin="round" />;
        }))}

        {/* neutral camps: one triangle for a small camp, with a bar for each step stronger; a vault as a box */}
        {L && layers.has('camps') && DL_MAP.camps.map((c, i) => {
          const tier = c.kind === 'strong' ? 2 : c.kind === 'medium' ? 1 : 0;
          // camps come at 2 / 5 / 8 min by size, Sinner's Sacrifice (the vaults) at 8
          if (demo && tm !== undefined ? !upAt(demo.camps[i] ?? [], tm)
            : !up(c.kind === 'vault' ? RULES.sinners.spawn : c.kind === 'strong' ? RULES.camps.strong.spawn : c.kind === 'medium' ? RULES.camps.medium.spawn : RULES.camps.small.spawn)) return null;
          if (c.kind === 'vault') return <Group key={`c${i}`} {...P(c)}><Rect x={-3.6 * k} y={-3.6 * k} width={7.2 * k} height={7.2 * k} stroke="#9cc4b9" strokeWidth={1 * k} cornerRadius={1 * k} /><Circle radius={1.6 * k} stroke="#9cc4b9" strokeWidth={1 * k} /></Group>;
          return (
            <Group key={`c${i}`} {...P(c)}>
              <RegularPolygon sides={3} radius={3.4 * k} y={-tier * 1.4 * k} fill="#9cc4b9" />
              {Array.from({ length: tier }, (_, b) => <Rect key={b} x={-3.4 * k} y={(1.4 + b * 2.2 - tier * 1.4) * k} width={6.8 * k} height={1.3 * k} fill="#9cc4b9" />)}
            </Group>
          );
        })}
        {/* shops */}
        {B && layers.has('shops') && DL_MAP.shops.map((s, i) => (
          <Group key={`s${i}`} {...P(s)}>
            <Rect x={-5 * k} y={-2.6 * k} width={10 * k} height={5.6 * k} fill="#5fd39a" cornerRadius={1.2 * k} />
            <Rect x={-3.2 * k} y={-0.6 * k} width={6.4 * k} height={2.4 * k} fill="#0e1115" />
            <Rect x={-3.6 * k} y={-4.4 * k} width={7.2 * k} height={1.4 * k} fill="#5fd39a" cornerRadius={0.7 * k} />
          </Group>
        ))}
        {/* the urn: it lands by the Yellow (left) or Green (right) bridge, alternating, and is delivered on the other
            side; with `urn`, the one out now and its drop-off, else both spots (the API's other spawn spots are from
            before the May 2026 rework) */}
        {/* from the demo: the urn where it really is (on the ground, or a ring round its carrier), its drop-off across */}
        {L && layers.has('urn') && demo && at?.urnNow && (() => {
          const u = at.urnNow, drop = DL_MAP.urnPads.find(p => (p.x < 0.5) !== u.fromLeft);
          return (
            <>
              {drop && <Circle {...P(drop)} radius={7 * k} stroke="#3fd0e6" strokeWidth={1.2 * k} dash={[3 * k, 2 * k]} />}
              <Group {...P(u)}>
                {u.carried
                  ? <Circle radius={13 * k} stroke="#3fd0e6" strokeWidth={1.6 * k} dash={[4 * k, 2.5 * k]} />
                  : <Circle radius={9 * k} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={9 * k} fillRadialGradientColorStops={[0, 'rgba(63,208,230,0.5)', 1, 'rgba(63,208,230,0)']} />}
                <Group y={u.carried ? -16 * k : 0}>
                  <Rect x={-2.4 * k} y={-3.4 * k} width={4.8 * k} height={1.2 * k} fill="#3fd0e6" cornerRadius={0.5 * k} />
                  <Circle y={0.8 * k} radius={3 * k} fill="#3fd0e6" />
                </Group>
                {tag(u.label, '#3fd0e6', u.carried ? 14 : 10)}
              </Group>
            </>
          );
        })()}
        {L && layers.has('urn') && !demo && (tm === undefined || urn) && DL_MAP.urnPads.map((u, i) => {
          const left = u.x < 0.5, out = urn ? (urn.lane === 'Yellow') === left : true, dropOff = !!urn && !out;
          return (
            <Group key={`u${i}`} {...P(u)}>
              {dropOff && <Circle radius={7 * k} stroke="#3fd0e6" strokeWidth={1.2 * k} dash={[3 * k, 2 * k]} />}
              {out && <Circle radius={urn ? 9 * k : 0} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={9 * k} fillRadialGradientColorStops={[0, 'rgba(63,208,230,0.5)', 1, 'rgba(63,208,230,0)']} />}
              {out && <Rect x={-2.4 * k} y={-3.4 * k} width={4.8 * k} height={1.2 * k} fill="#3fd0e6" cornerRadius={0.5 * k} opacity={urn ? 1 : 0.7} />}
              {out && <Circle y={0.8 * k} radius={3 * k} fill="#3fd0e6" opacity={urn ? 1 : 0.7} />}
              {out && urn && tag(clock(urn.t), '#3fd0e6')}
            </Group>
          );
        })}
        {/* bridge buffs and the unstable rifts */}
        {L && layers.has('buffs') && DL_MAP.bridgeBuffs.map((b, i) => {
          // from the demo: only while one lies there (since when); else on the schedule
          const since = demo && tm !== undefined ? (demo.buffs[i] ?? []).find(([a, z]) => tm >= a && tm < z)?.[0] ?? null : buffsAt;
          if (tm !== undefined && since === null) return null;
          return (
            <Group key={`b${i}`} {...P(b)}>
              <Circle radius={7 * k} stroke="#b07ce8" strokeWidth={1.3 * k} fill="rgba(176,124,232,0.15)" />
              <Star numPoints={5} innerRadius={2 * k} outerRadius={4.4 * k} fill="#b07ce8" />
              {since !== null && tag(clock(since), '#b07ce8', 9)}
            </Group>
          );
        })}
        {L && layers.has('buffs') && riftOn && DL_MAP.rifts.map((b, i) => (
          <Group key={`r${i}`} {...P(b)}>
            <Circle radius={8 * k} stroke="#3fc7b4" strokeWidth={1.3 * k} />
            <Circle radius={4.5 * k} stroke="#3fc7b4" strokeWidth={1 * k} dash={[2 * k, 1.6 * k]} />
            {tm !== undefined && riftAt !== null && tag(`~${clock(riftAt)}`, '#3fc7b4', 10)}
          </Group>
        ))}

        {/* teleporters, like the game's icon: a ring with a doorway and someone stepping through it */}
        {B && layers.has('teleporters') && DL_MAP.teleporters.map((t, i) => (
          <Group key={`t${i}`} {...P(t)}>
            <Circle radius={7.5 * k} fill="rgba(14,17,21,0.85)" stroke="#8a929c" strokeWidth={1.2 * k} />
            <Line points={[0.6, 4.6, 0.6, -4.2, 4.4, -4.2, 4.4, 4.6].map(v => v * k)} stroke="#8a929c" strokeWidth={1.1 * k} lineJoin="round" />
            <Circle x={-1.6 * k} y={-3.1 * k} radius={1.15 * k} fill="#c3c9d0" />
            <Line points={[-1.4, -1.6, -1.9, 1.2, -0.2, 2.6, 0.2, 4.4].map(v => v * k)} stroke="#c3c9d0" strokeWidth={1.1 * k} lineCap="round" lineJoin="round" />
            <Line points={[-1.9, 1.2, -3.4, 4.2].map(v => v * k)} stroke="#c3c9d0" strokeWidth={1.1 * k} lineCap="round" />
            <Line points={[-3.6, -0.6, -1.6, -0.9, 0.4, 0.4].map(v => v * k)} stroke="#c3c9d0" strokeWidth={1 * k} lineCap="round" lineJoin="round" />
            {[-1.6, 0, 1.6].map((y, j) => <Line key={j} points={[5.6 * k, y * k, 6.6 * k, y * k]} stroke="#8a929c" strokeWidth={0.8 * k} />)}
          </Group>
        ))}

        {/* the mid boss, while it's alive */}
        {L && !bossDown && <Group {...P(DL_MAP.midBoss)}>
          <Circle radius={13 * k} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={13 * k} fillRadialGradientColorStops={[0, 'rgba(242,194,48,0.45)', 1, 'rgba(242,194,48,0)']} />
          <Line points={[-9, -3, -2, -1, 0, 7, 2, -1, 9, -3, 3, -5, 0, -2, -3, -5].map(v => v * k)} closed fill="#f2c230" stroke="#7a5a10" strokeWidth={0.6 * k} />
          <Circle y={-6.5 * k} radius={2 * k} stroke="#f2c230" strokeWidth={1 * k} />
        </Group>}

        {/* the objectives: guardians, walkers (big, hollow middle), base guardians, shrines, the patron with its arch */}
        {B && layers.has('objectives') && DL_MAP.objectives.map(o => {
          const c = colorOf(o), off = isDown(o);
          const r = (o.kind === 'tier2' ? 10.5 : o.kind === 'titan' ? 9 : o.kind === 'tier1' ? 7 : 6) * k;
          const team = o.team as DlTeam;
          return (
            <Group key={o.id} {...P(o)} opacity={off ? 0.8 : 1}>
              {o.kind === 'titan' && <Arc innerRadius={11 * k} outerRadius={17 * k} angle={180} rotation={team === 0 ? 0 : 180} fill={off ? DOWN : c} stroke={off ? c : undefined} strokeWidth={off ? 1 * k : 0} />}
              {off
                ? <RegularPolygon sides={4} radius={r} fill={DOWN} stroke={c} strokeWidth={1.3 * k} dash={[2.5 * k, 2 * k]} />
                : o.kind === 'shrine'
                  ? <RegularPolygon sides={4} radius={r} fill={DOWN} stroke={c} strokeWidth={1.8 * k} />
                  : <RegularPolygon sides={4} radius={r} fill={c} stroke="#0b0e12" strokeWidth={1.2 * k} shadowColor={c} shadowBlur={off ? 0 : 6 * k} shadowOpacity={0.5} />}
              {!off && o.kind === 'tier2' && <RegularPolygon sides={4} radius={r * 0.45} fill="rgba(0,0,0,0.55)" />}
              {!off && o.kind === 'shrine' && <RegularPolygon sides={4} radius={r * 0.4} fill={c} />}
              {off && <Line points={[-r * 0.45, -r * 0.45, r * 0.45, r * 0.45, 0, 0, r * 0.45, -r * 0.45, -r * 0.45, r * 0.45]} stroke={c} strokeWidth={1.5 * k} lineCap="round" />}
            </Group>
          );
        })}
      </Group>
    </>
  );
}
