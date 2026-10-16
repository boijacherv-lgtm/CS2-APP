import { Circle, Group, Line } from 'react-konva';
import { simStateAt, type Simulation } from '../engine/combat';
import type { TacticalEngine } from '../engine/predict';
import type { DemoRound } from '../engine/recap';
import type { Vec2 } from '../engine/types';

/**
 * Gunfire in a replay: every bullet from the demo as a muzzle flash and a tracer (to the player it hit, or along
 * where the shooter was looking until it reaches a wall).
 */

const TRACER_SECS = 0.2;
const FLASH_SECS = 0.08;
const HIT_MATCH = 0.06; // a hit this close to a shot (same shooter) is that bullet
const MAX_RANGE = 700; // radar px

/** How far a bullet from `from` along `dir` goes before it reaches a wall (radar px). */
function rangeTo(engine: TacticalEngine, from: Vec2, dir: Vec2) {
  const step = 3;
  let len = 14; // start outside the player's own token
  while (len < MAX_RANGE && engine.grid.isWalkable({ x: from.x + dir.x * len, y: from.y + dir.y * len })) len += step;
  return len;
}

export function Gunfire({ round, sim, engine, t, k, sideOf }: {
  round: DemoRound; sim: Simulation; engine: TacticalEngine; t: number; k: number; sideOf: (id: string) => 'CT' | 'T';
}) {
  const shots = (round.shots ?? []).filter(s => s.t <= t && t - s.t < TRACER_SECS);
  const hits = round.hits ?? [];
  return (
    <Group listening={false}>
      {shots.map((s, i) => {
        const me = simStateAt(sim, s.id, s.t);
        if (!me) return null;
        const hit = hits.find(h => h.attacker === s.id && Math.abs(h.t - s.t) <= HIT_MATCH);
        const victim = hit && simStateAt(sim, hit.victim, hit.t);
        let dir = { x: Math.cos(me.facing), y: Math.sin(me.facing) }, len: number;
        if (victim) {
          const dx = victim.pos.x - me.pos.x, dy = victim.pos.y - me.pos.y, d = Math.hypot(dx, dy) || 1;
          dir = { x: dx / d, y: dy / d };
          len = d;
        } else len = rangeTo(engine, me.pos, dir);
        const age = (t - s.t) / TRACER_SECS;
        const muzzle = { x: me.pos.x + dir.x * 12 * k, y: me.pos.y + dir.y * 12 * k };
        const end = { x: me.pos.x + dir.x * len, y: me.pos.y + dir.y * len };
        // the tracer streaks out from the gun: its tail follows the head
        const head = Math.min(1, age * 2.5), tail = Math.min(head, Math.max(0, age * 2.5 - 0.6));
        const at = (f: number) => [muzzle.x + (end.x - muzzle.x) * f, muzzle.y + (end.y - muzzle.y) * f];
        const color = sideOf(s.id) === 'CT' ? '#d3e6ff' : '#ffe6b0'; // a lighter tint of the team colour, so tracers glow
        return (
          <Group key={`shot-${s.t}-${s.id}-${i}`}>
            <Line points={[...at(tail), ...at(head)]} stroke="#000" strokeWidth={3.6 * k} opacity={0.45 * (1 - age)} lineCap="round" />
            <Line points={[...at(tail), ...at(head)]} stroke={color} strokeWidth={2 * k} opacity={1 - age * 0.8} lineCap="round"
              shadowColor={color} shadowBlur={6} shadowOpacity={0.9} />
            {t - s.t < FLASH_SECS && (
              <>
                <Circle x={muzzle.x} y={muzzle.y} radius={6 * k} fill="#fff3b0" opacity={0.9 * (1 - (t - s.t) / FLASH_SECS)} shadowColor="#ffb020" shadowBlur={8} shadowOpacity={1} />
                <Circle x={muzzle.x} y={muzzle.y} radius={2.5 * k} fill="#fff" />
              </>
            )}
          </Group>
        );
      })}
    </Group>
  );
}
