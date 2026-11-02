import { useEffect, useMemo, useRef, useState } from 'react';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const short = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k` : String(Math.round(v)));

export interface Series { label: string; color: string; points: { t: number; v: number }[]; dashed?: boolean }
/**
 * Lines over match time (s): each series in its colour, an optional shaded band (an average ± its spread), an optional
 * strip under the chart for the gap between the first two series (coloured by who's ahead), and a hover readout.
 */
export function LinesChart({ series, band, gap, height = 220, marks = [] }: {
  series: Series[]; band?: { t: number; lo: number; hi: number }[]; gap?: boolean; height?: number;
  /** Moments to tick under the chart (the mid boss, …). */
  marks?: { t: number; color: string; label: string }[];
}) {
  // drawn at the width it gets (text stays its size), not stretched
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height, L = 46, R = 10, T = 10, B = 24, G = gap ? 46 : 0;
  const end = Math.max(1, ...series.flatMap(s => s.points.map(p => p.t)));
  const top = Math.max(1, ...series.flatMap(s => s.points.map(p => p.v)), ...(band ?? []).map(b => b.hi)) * 1.05;
  const x = (t: number) => L + (t / end) * (W - L - R), y = (v: number) => T + (1 - v / top) * (H - T - B);
  const path = (pts: { t: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const at = (s: Series, t: number) => { const ps = s.points; let best = ps[0]; for (const p of ps) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; return best; };
  const gaps = useMemo(() => (gap && series.length >= 2 ? series[0].points.map(p => ({ t: p.t, d: p.v - at(series[1], p.t).v })) : []), [gap, series]); // eslint-disable-line react-hooks/exhaustive-deps
  const gmax = Math.max(1, ...gaps.map(g => Math.abs(g.d)));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * top);
  const xTicks: number[] = []; for (let t = 0; t <= end; t += W < 520 ? 600 : 300) xTicks.push(t);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    setHover(px < L || px > W - R ? null : ((px - L) / (W - L - R)) * end);
  };
  const H2 = H + G;
  return (
    <div className="dl-lines" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H2}`} width={W} height={H2} role="img" onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {yTicks.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="dl-lines-grid" /><text x={L - 6} y={y(v)} className="dl-lines-ax" textAnchor="end" dominantBaseline="middle">{short(v)}</text></g>)}
        {xTicks.map(t => <text key={t} x={x(t)} y={H - 6} className="dl-lines-ax" textAnchor="middle">{Math.round(t / 60)}m</text>)}
        {band && <path d={`${band.map((b, i) => `${i ? 'L' : 'M'}${x(b.t)},${y(b.hi)}`).join('')}${[...band].reverse().map(b => `L${x(b.t)},${y(b.lo)}`).join('')}Z`} className="dl-lines-band" />}
        {series.map(s => <path key={s.label} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />)}
        {marks.map((m, i) => <circle key={i} cx={x(m.t)} cy={H - B + 2} r={3.2} fill={m.color}><title>{m.label} · {mins(m.t)}</title></circle>)}
        {gap && gaps.length > 1 && (
          <g>
            <line x1={L} x2={W - R} y1={H + G / 2} y2={H + G / 2} className="dl-lines-grid" />
            {gaps.map((g, i) => {
              const w = Math.max(1, (W - L - R) / gaps.length - 0.6), h = (Math.abs(g.d) / gmax) * (G / 2 - 4);
              return <rect key={i} x={x(g.t) - w / 2} width={w} y={g.d >= 0 ? H + G / 2 - h : H + G / 2} height={h} fill={g.d >= 0 ? series[0].color : series[1].color} opacity={0.85} />;
            })}
            <text x={L - 6} y={H + G / 2} className="dl-lines-ax" textAnchor="end" dominantBaseline="middle">lead</text>
          </g>
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H2 - (gap ? 0 : B)} className="dl-lines-hover" />}
      </svg>
      <div className="dl-lines-legend">
        {hover !== null ? <>
          <span className="num muted">{mins(hover)}</span>
          {series.map(s => <span key={s.label}><i style={{ background: s.color }} />{s.label} <b className="num">{Math.round(at(s, hover).v).toLocaleString()}</b></span>)}
          {gap && series.length >= 2 && (() => { const d = at(series[0], hover).v - at(series[1], hover).v; return <span>lead <b className="num" style={{ color: d >= 0 ? series[0].color : series[1].color }}>{d >= 0 ? '+' : '−'}{Math.abs(Math.round(d)).toLocaleString()}</b></span>; })()}
        </> : series.map(s => <span key={s.label}><i className={s.dashed ? 'dashed' : ''} style={{ background: s.color }} />{s.label}</span>)}
        {band && hover === null && <span><i className="band" />average ± spread</span>}
      </div>
    </div>
  );
}
