import { useEffect, useState } from 'react';
import { Arc, Circle, Group, Image as KImage, Line, Rect, RegularPolygon, Star } from 'react-konva';
import type Konva from 'konva';
import { DL_MAP, DL_MAP_IMAGE, type DlTeam } from './data';

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

/** The map's outline: the round map and each base sticking out of it (map units). */
const ROUND = { x: 0.5, y: 0.5, r: 0.495 };
const bump = (team: DlTeam) => { const t = titan(team); return { x: t.x, y: t.y + (team === 0 ? 0.04 : -0.04), r: 0.1 }; };
/** Clips a Konva group to the map's outline. */
export const mapClip = (S: number) => (ctx: Konva.Context) => {
  ctx.beginPath();
  for (const c of [ROUND, bump(0), bump(1)]) { ctx.moveTo((c.x + c.r) * S, c.y * S); ctx.arc(c.x * S, c.y * S, c.r * S, 0, Math.PI * 2, false); }
};

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

export type ArtLayer = 'lanes' | 'objectives' | 'camps' | 'urn' | 'shops' | 'teleporters' | 'buffs';
const ALL: Set<ArtLayer> = new Set(['lanes', 'objectives', 'camps', 'urn', 'shops', 'teleporters', 'buffs']);

/**
 * The map and what's on it. `you`: the team drawn in lane colours (the other one red), like the game shows your own
 * team. `down(team, key)`: whether that objective is destroyed (drawn hollow with a cross).
 */
export function MapArt({ S, k, img, you = 0, layers = ALL, down }: {
  S: number; k: number; img: HTMLCanvasElement | null; you?: DlTeam; layers?: Set<ArtLayer>;
  down?: (team: DlTeam, key: string) => boolean;
}) {
  const P = (p: { x: number; y: number }) => ({ x: p.x * S, y: p.y * S });
  const mine = bump(you);
  const colorOf = (o: Obj) => (o.team !== you ? ENEMY : o.lane ? LANE_COLOR[o.lane as 1 | 3 | 4] : HOME);
  const lineOf = (team: DlTeam, lane: 1 | 3 | 4) => (team !== you ? ENEMY_LINE : LANE_LINE[lane]);
  const isDown = (o: Obj) => !!down?.(o.team as DlTeam, o.id.replace(/^team\d_/, ''));
  return (
    <>
      {/* the round map, your base glowing */}
      <Group clipFunc={mapClip(S)} listening={false}>
        <Rect width={S} height={S} fill="#0e1115" />
        {img && <KImage image={img} width={S} height={S} />}
        <Circle {...P(mine)} radius={0.32 * S} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={0.32 * S}
          fillRadialGradientColorStops={[0, 'rgba(90,200,175,0.30)', 0.55, 'rgba(90,200,175,0.08)', 1, 'rgba(90,200,175,0)']} />
      </Group>
      <Group listening={false}>
        {[ROUND, bump(0), bump(1)].map((c, i) => <Arc key={i} {...P(c)} innerRadius={c.r * S} outerRadius={c.r * S + 1.2 * k} angle={360} fill="#262b33" />)}
      </Group>

      <Group listening={false}>
        {/* each lane: patron → base guardian → walker → guardian */}
        {layers.has('lanes') && ([0, 1] as DlTeam[]).flatMap(team => ([1, 3, 4] as const).map(lane => {
          const pts = [titan(team), objAt(team, `base_${lane}`), objAt(team, `tier2_${lane}`), objAt(team, `tier1_${lane}`)].filter((o): o is Obj => !!o);
          return <Line key={`l${team}${lane}`} points={pts.flatMap(o => [o.x * S, o.y * S])} stroke={lineOf(team, lane)} strokeWidth={1.6 * k} opacity={0.9} lineJoin="round" />;
        }))}

        {/* neutral camps: one triangle for a small camp, with a bar for each step stronger; a vault as a box */}
        {layers.has('camps') && DL_MAP.camps.map((c, i) => {
          const tier = c.kind === 'strong' ? 2 : c.kind === 'medium' ? 1 : 0;
          if (c.kind === 'vault') return <Group key={`c${i}`} {...P(c)}><Rect x={-3.6 * k} y={-3.6 * k} width={7.2 * k} height={7.2 * k} stroke="#9cc4b9" strokeWidth={1 * k} cornerRadius={1 * k} /><Circle radius={1.6 * k} stroke="#9cc4b9" strokeWidth={1 * k} /></Group>;
          return (
            <Group key={`c${i}`} {...P(c)}>
              <RegularPolygon sides={3} radius={3.4 * k} y={-tier * 1.4 * k} fill="#9cc4b9" />
              {Array.from({ length: tier }, (_, b) => <Rect key={b} x={-3.4 * k} y={(1.4 + b * 2.2 - tier * 1.4) * k} width={6.8 * k} height={1.3 * k} fill="#9cc4b9" />)}
            </Group>
          );
        })}
        {/* shops */}
        {layers.has('shops') && DL_MAP.shops.map((s, i) => (
          <Group key={`s${i}`} {...P(s)}>
            <Rect x={-5 * k} y={-2.6 * k} width={10 * k} height={5.6 * k} fill="#5fd39a" cornerRadius={1.2 * k} />
            <Rect x={-3.2 * k} y={-0.6 * k} width={6.4 * k} height={2.4 * k} fill="#0e1115" />
            <Rect x={-3.6 * k} y={-4.4 * k} width={7.2 * k} height={1.4 * k} fill="#5fd39a" cornerRadius={0.7 * k} />
          </Group>
        ))}
        {/* the urn: where it can appear, and the two drop-off pads */}
        {layers.has('urn') && DL_MAP.urnSpawns.map((u, i) => (
          <Group key={`u${i}`} {...P(u)}>
            <Rect x={-2.4 * k} y={-3.4 * k} width={4.8 * k} height={1.2 * k} fill="#3fd0e6" cornerRadius={0.5 * k} />
            <Circle y={0.8 * k} radius={3 * k} fill="#3fd0e6" />
          </Group>
        ))}
        {layers.has('urn') && DL_MAP.urnPads.map((u, i) => <Circle key={`up${i}`} {...P(u)} radius={6.5 * k} stroke="#3fd0e6" strokeWidth={1.2 * k} dash={[3 * k, 2 * k]} />)}
        {/* bridge buffs and the unstable rifts */}
        {layers.has('buffs') && DL_MAP.bridgeBuffs.map((b, i) => (
          <Group key={`b${i}`} {...P(b)}>
            <Circle radius={7 * k} stroke="#b07ce8" strokeWidth={1.3 * k} fill="rgba(176,124,232,0.15)" />
            <Star numPoints={5} innerRadius={2 * k} outerRadius={4.4 * k} fill="#b07ce8" />
          </Group>
        ))}
        {layers.has('buffs') && DL_MAP.rifts.map((b, i) => (
          <Group key={`r${i}`} {...P(b)}>
            <Circle radius={8 * k} stroke="#3fc7b4" strokeWidth={1.3 * k} />
            <Circle radius={4.5 * k} stroke="#3fc7b4" strokeWidth={1 * k} dash={[2 * k, 1.6 * k]} />
          </Group>
        ))}
        {layers.has('teleporters') && DL_MAP.teleporters.map((t, i) => (
          <Group key={`t${i}`} {...P(t)}>
            <Circle radius={6 * k} stroke="#8a929c" strokeWidth={1.2 * k} />
            <RegularPolygon sides={3} radius={2.6 * k} rotation={90} fill="#8a929c" />
          </Group>
        ))}

        {/* the mid boss */}
        <Group {...P(DL_MAP.midBoss)}>
          <Circle radius={13 * k} fillRadialGradientStartRadius={0} fillRadialGradientEndRadius={13 * k} fillRadialGradientColorStops={[0, 'rgba(242,194,48,0.45)', 1, 'rgba(242,194,48,0)']} />
          <Line points={[-9, -3, -2, -1, 0, 7, 2, -1, 9, -3, 3, -5, 0, -2, -3, -5].map(v => v * k)} closed fill="#f2c230" stroke="#7a5a10" strokeWidth={0.6 * k} />
          <Circle y={-6.5 * k} radius={2 * k} stroke="#f2c230" strokeWidth={1 * k} />
        </Group>

        {/* the objectives: guardians, walkers (big, hollow middle), base guardians, shrines, the patron with its arch */}
        {layers.has('objectives') && DL_MAP.objectives.map(o => {
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
