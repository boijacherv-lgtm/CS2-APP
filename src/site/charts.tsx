import { useId, useMemo, useState } from 'react';

/**
 * Small hand-drawn SVG charts for the site's dashboards (profile, dev page), in the Tactical night colours: a mini
 * line for KPI tiles, an area chart with a hover readout, a radar, a donut and a bar list. No chart library.
 */

/** A tiny line for a KPI tile: the shape of the last few values, the newest dot coloured. */
export function MiniLine({ values, good = true, width = 96, height = 30 }: { values: number[]; good?: boolean | null; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1, P = 3;
  const x = (i: number) => P + (i * (width - 2 * P)) / (values.length - 1);
  const y = (v: number) => height - P - ((v - lo) / span) * (height - 2 * P);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg className="mini-line" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <circle cx={x(last)} cy={y(values[last])} r={2.6} className={good === null ? 'dot-flat' : good ? 'dot-up' : 'dot-down'} />
    </svg>
  );
}

export interface AreaPoint { label: string; value: number; note?: string }
/** A line with a soft area under it, gridlines, and a readout of the point under the pointer. */
export function AreaChart({ points, fmt, height = 220, color = 'var(--ct)' }: { points: AreaPoint[]; fmt: (v: number) => string; height?: number; color?: string }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, L = 48, R = 24, T = 14, B = 26;
  const geo = useMemo(() => {
    const vs = points.map(p => p.value);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
    lo -= pad; hi += pad;
    const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = [0, 1, 2, 3].map(k => lo + ((hi - lo) * k) / 3);
    return { x, y, ticks };
  }, [points, H]);
  if (!points.length) return null;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${geo.x(i).toFixed(1)} ${geo.y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${geo.x(points.length - 1).toFixed(1)} ${H - B} L${geo.x(0).toFixed(1)} ${H - B} Z`;
  const step = Math.max(1, Math.ceil(points.length / 8));
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="area-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend over your matches"
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
          let best = 0; points.forEach((_, i) => { if (Math.abs(geo.x(i) - px) < Math.abs(geo.x(best) - px)) best = i; });
          setHover(best);
        }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {geo.ticks.map((t, k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={geo.y(t)} y2={geo.y(t)} className="grid" />
            <text x={L - 8} y={geo.y(t)} className="axis" textAnchor="end" dominantBaseline="central">{fmt(t)}</text>
          </g>
        ))}
        {points.map((p, i) => i % step === 0 || i === points.length - 1
          ? <text key={i} x={geo.x(i)} y={H - 8} className="axis" textAnchor={i === points.length - 1 && i > 0 ? 'end' : i === 0 && points.length > 1 ? 'start' : 'middle'}>{p.label}</text> : null)}
        <path d={area} fill={`url(#g${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={i} cx={geo.x(i)} cy={geo.y(p.value)} r={hover === i ? 5 : 2.6} fill={color} stroke="var(--bg-0)" strokeWidth={hover === i ? 2 : 0} />)}
        {hover !== null && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={T} y2={H - B} className="cursor" />}
      </svg>
      {h && (
        <div className="area-tip" style={{ left: `${(geo.x(hover!) / W) * 100}%` }}>
          <b>{fmt(h.value)}</b><span>{h.label}{h.note ? ` · ${h.note}` : ''}</span>
        </div>
      )}
    </div>
  );
}

export interface RadarAxis { label: string; you: number | null; tip?: string }
/**
 * A radar of skills, each in spreads from a reference (0 = the reference, like a typical level-10 player): the dashed
 * ring is the reference, the filled shape is you. Values are clamped to ±2 spreads.
 */
export function Radar({ axes, refLabel = 'Level 10' }: { axes: RadarAxis[]; refLabel?: string }) {
  const S = 300, C = S / 2, Rmax = 104;
  const r = (z: number | null) => (((Math.max(-2, Math.min(2, z ?? 0)) + 2) / 4) * 0.85 + 0.15) * Rmax;
  const pt = (i: number, rad: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    return [C + Math.cos(a) * rad, C + Math.sin(a) * rad] as const;
  };
  const poly = (f: (i: number) => number) => axes.map((_, i) => pt(i, f(i)).map(v => v.toFixed(1)).join(',')).join(' ');
  return (
    <div className="radar">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Your skills against ${refLabel.toLowerCase()}`}>
        {[0.25, 0.5, 0.75, 1].map(f => <polygon key={f} points={poly(() => Rmax * f)} className="radar-grid" />)}
        {axes.map((_, i) => { const [x, y] = pt(i, Rmax); return <line key={i} x1={C} y1={C} x2={x} y2={y} className="radar-grid" />; })}
        <polygon points={poly(() => r(0))} className="radar-ref" />
        <polygon points={poly(i => r(axes[i].you))} className="radar-you" />
        {axes.map((a, i) => { const [x, y] = pt(i, r(a.you)); return <circle key={i} cx={x} cy={y} r={3} className={a.you === null ? 'radar-dot none' : (a.you ?? 0) >= 0 ? 'radar-dot up' : 'radar-dot down'}><title>{a.tip ?? a.label}</title></circle>; })}
        {axes.map((a, i) => {
          const [x, y] = pt(i, Rmax + 16);
          const anchor = Math.abs(x - C) < 8 ? 'middle' : x > C ? 'start' : 'end';
          return <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="central" className="radar-label">{a.label}</text>;
        })}
      </svg>
      <div className="radar-legend"><span className="you">You</span><span className="ref">{refLabel}</span></div>
    </div>
  );
}

export interface DonutPart { label: string; value: number; color: string }
/** A ring split into parts, with the headline number in the middle and a legend. */
export function Donut({ parts, center, sub }: { parts: DonutPart[]; center: string; sub?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1, R = 52, Cc = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={parts.map(p => `${p.label} ${p.value}`).join(', ')}>
        <circle cx={70} cy={70} r={R} className="donut-track" />
        {parts.filter(p => p.value > 0).map(p => {
          const len = (p.value / total) * Cc, gap = parts.filter(q => q.value > 0).length > 1 ? 3 : 0;
          const el = <circle key={p.label} cx={70} cy={70} r={R} fill="none" stroke={p.color} strokeWidth={14} strokeLinecap="butt"
            strokeDasharray={`${Math.max(0, len - gap)} ${Cc}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />;
          acc += len;
          return el;
        })}
        <text x={70} y={66} textAnchor="middle" dominantBaseline="central" className="donut-center">{center}</text>
        {sub && <text x={70} y={88} textAnchor="middle" dominantBaseline="central" className="donut-sub">{sub}</text>}
      </svg>
      <ul className="donut-legend">
        {parts.map(p => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.value}</b></li>)}
      </ul>
    </div>
  );
}

export interface BarRow { label: string; value: string; share: number; tone: 'up' | 'down' | 'flat'; note?: string }
/** Rows of label, bar and value (weakest / strongest habits, maps): the bar's length is `share` (0–1). */
export function BarList({ rows }: { rows: BarRow[] }) {
  return (
    <ul className="bar-list">
      {rows.map(r => (
        <li key={r.label} title={r.note}>
          <div className="bar-top"><span>{r.label}</span><b className={r.tone}>{r.value}</b></div>
          <div className="bar-track"><i className={r.tone} style={{ width: `${Math.max(4, Math.min(100, r.share * 100))}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
