/**
 * The drop zone's backdrop: a tiny match playing on loop. A made-up map seen from above, both teams walking in, two
 * kills,. Drawn with SVG animation (no JS);
 * still when the visitor prefers less motion.
 */
const LOOP = 12; // seconds

// lanes from each spawn (the map's corridors are these paths drawn thick)
const T_LANES = ['M300,232 L150,232 L132,184 L132,112', 'M300,232 L300,150', 'M300,232 L450,232 L468,184 L468,118', 'M300,232 L170,232 L150,196'];
const CT_LANES = ['M300,40 L160,40 L140,84', 'M300,40 L300,95', 'M300,40 L440,40 L460,86', 'M300,40 L430,40 L420,70'];
// [team, lane, dies at (fraction of the loop) or null]
const DOTS: ['t' | 'ct', number, number | null][] = [['t', 0, null], ['t', 1, null], ['t', 2, 0.72], ['t', 3, null], ['ct', 0, 0.5], ['ct', 1, null], ['ct', 2, null], ['ct', 3, null]];
// [at, killer's spot, victim's spot, killer's team]
const KILLS: [number, [number, number], [number, number], 't' | 'ct'][] = [[0.5, [132, 112], [140, 84], 't'], [0.72, [460, 86], [468, 118], 'ct']];

const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = (f: number) => +f.toFixed(3);
/** Where a lane ends (a player standing still there). */
const endOf = (d: string) => d.split(' ').at(-1)!.slice(1).split(',').map(Number);

export function DemoReel() {
  const dur = `${LOOP}s`;
  return (
    <div className="dz-reel" aria-hidden="true">
    <svg viewBox="20 14 560 246" preserveAspectRatio="xMidYMid meet">
      {/* the map: corridors and two sites */}
      <g className="reel-map">
        {[...T_LANES, ...CT_LANES].map((d, i) => <path key={i} d={d} />)}
        <rect x="70" y="50" width="120" height="84" rx="10" />
        <rect x="410" y="50" width="120" height="84" rx="10" />
        <rect x="250" y="214" width="100" height="38" rx="10" />
        <rect x="250" y="22" width="100" height="34" rx="10" />
      </g>
      {/* crates on the sites */}
      <g className="reel-crates">
        <rect x="92" y="62" width="14" height="14" /><rect x="106" y="62" width="14" height="14" /><rect x="160" y="108" width="16" height="16" />
        <rect x="490" y="62" width="16" height="16" /><rect x="424" y="110" width="14" height="14" /><rect x="438" y="110" width="14" height="14" />
      </g>

      {/* players: walk their lane in the first 60% of the loop, then hold; fade out at a death and at the loop's end */}
      {DOTS.map(([team, lane, dies], i) => {
        const d = (team === 't' ? T_LANES : CT_LANES)[lane];
        const fade = dies !== null ? `0;1;1;0;0` : '0;1;1;0';
        const fadeAt = dies !== null ? `0;0.05;${pct(dies)};${pct(dies + 0.02)};1` : '0;0.05;0.94;1';
        return (
          <circle key={i} r="7" className={`reel-dot ${team}`} opacity={still ? 1 : 0} cx={still ? endOf(d)[0] : 0} cy={still ? endOf(d)[1] : 0}>
            {!still && <animateMotion dur={dur} repeatCount="indefinite" path={d} keyPoints="0;1;1" keyTimes={`0;${pct(0.45 + (i % 4) * 0.04)};1`} calcMode="linear" />}
            {!still && <animate attributeName="opacity" dur={dur} repeatCount="indefinite" values={fade} keyTimes={fadeAt} />}
          </circle>
        );
      })}

      {/* kills: a shot line flashes, then an X stays where the player fell */}
      {!still && KILLS.map(([at, [x1, y1], [x2, y2], team], i) => (
        <g key={i} className={`reel-kill ${team}`} opacity="0">
          <line x1={x1} y1={y1} x2={x2} y2={y2}>
            <animate attributeName="opacity" dur={dur} repeatCount="indefinite" values="0;0;1;0;0" keyTimes={`0;${pct(at - 0.01)};${pct(at)};${pct(at + 0.03)};1`} />
          </line>
          <path d={`M${x2 - 6},${y2 - 6} L${x2 + 6},${y2 + 6} M${x2 + 6},${y2 - 6} L${x2 - 6},${y2 + 6}`} />
          <animate attributeName="opacity" dur={dur} repeatCount="indefinite" values="0;0;1;1;0" keyTimes={`0;${pct(at)};${pct(at + 0.01)};0.94;1`} />
        </g>
      ))}

    </svg>
    </div>
  );
}
