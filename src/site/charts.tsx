import { useId, useMemo, useState } from 'react';

/**
 * Small hand-drawn SVG charts for the site's dashboards (profile, dev page), in the Tactical night colours: a mini
 * line for KPI tiles, an area chart with a hover readout, a radar, a donut and a bar list. No chart library.
 */

/**
 * A line that fills whatever width it gets: the line stretches, the dots are placed on top so they stay round.
 * `invert`: for numbers where lower is better, so up always means better. `target`: a dashed reference line.
 */
export function StretchLine({ values, target = null, invert = false, height = 30, dots = 'last', tone = () => 'flat', className = '' }: {
  values: (number | null)[]; target?: number | null; invert?: boolean; height?: number; dots?: 'last' | 'all';
  tone?: (v: number, i: number) => 'up' | 'down' | 'flat'; className?: string;
}) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const all = target !== null ? [...pts.map(p => p.v), target] : pts.map(p => p.v);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  // 0–100 on both axes; up is better
  const x = (i: number) => (values.length === 1 ? 50 : (i / (values.length - 1)) * 100);
  const y = (v: number) => { const t = (v - lo) / (hi - lo); return (invert ? t : 1 - t) * 100; };
  const line = pts.map(p => `${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join(' ');
  const shown = dots === 'all' ? pts : [pts[pts.length - 1]];
  return (
    <div className={`stretch-line ${className}`} style={{ height }} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {target !== null && <line x1={0} x2={100} y1={y(target)} y2={y(target)} className="sl-target" vectorEffect="non-scaling-stroke" />}
        <polyline points={line} className="sl-line" vectorEffect="non-scaling-stroke" />
      </svg>
      {shown.map((p, k) => (
        <i key={p.i} className={`sl-dot ${tone(p.v, p.i)} ${k === shown.length - 1 ? 'now' : ''}`} style={{ left: `${x(p.i)}%`, top: `${y(p.v)}%` }} />
      ))}
    </div>
  );
}

/** A tiny line for a KPI tile: the shape of the last few values, the newest dot coloured. */
export function MiniLine({ values, good = true }: { values: number[]; good?: boolean | null }) {
  return <StretchLine values={values} className="mini-line" tone={() => (good === null ? 'flat' : good ? 'up' : 'down')} />;
}

/** A half-ring gauge with a value in the middle (a model's accuracy, a share). `value` is 0–1. */
/** `text`: what to print in the middle when the value isn't a share (a correlation: "r = 0.29"). */
export function Gauge({ value, label, sub, tone = 'flat', text }: { value: number; label: string; sub?: string; tone?: 'up' | 'down' | 'flat'; text?: string }) {
  const v = Math.max(0, Math.min(1, value)), R = 52, half = Math.PI * R;
  return (
    <div className="gauge-card">
      <svg viewBox="0 0 140 84" role="img" aria-label={`${label}: ${text ?? `${Math.round(v * 100)}%`}`}>
        <path d="M18 74 A52 52 0 0 1 122 74" className="gauge-track" />
        <path d="M18 74 A52 52 0 0 1 122 74" className={`gauge-fill ${tone}`} strokeDasharray={`${v * half} ${half}`} />
        <text x={70} y={64} textAnchor="middle" className="gauge-value">{text ?? `${Math.round(v * 100)}%`}</text>
      </svg>
      <b>{label}</b>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

/** Which x labels to draw: every step-th and the last, never two that would touch, never the same date twice in a row. */
export function axisLabels(labels: string[], step: number): Set<number> {
  const out = new Set<number>();
  let prev = '';
  for (let i = 0; i < labels.length; i++) {
    const last = i === labels.length - 1;
    if (!(i % step === 0 || last) || (!last && labels.length - 1 - i < step * 0.7) || labels[i] === prev) continue;
    out.add(i); prev = labels[i];
  }
  return out;
}

export interface AreaPoint { label: string; value: number; note?: string }
/** A line with a soft area under it, gridlines, and a readout of the point under the pointer. */
export function AreaChart({ points, fmt, height = 220, color = 'var(--theme)' }: { points: AreaPoint[]; fmt: (v: number) => string; height?: number; color?: string }) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, L = 48, R = 24, T = 14, B = 26;
  const geo = useMemo(() => {
    const vs = points.map(p => p.value);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
    lo -= pad; hi += pad;
    if (Math.min(...vs) >= 0) lo = Math.max(0, lo); // no axis below zero for counts and ratings
    const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = [0, 1, 2, 3].map(k => lo + ((hi - lo) * k) / 3);
    return { x, y, ticks };
  }, [points, H]);
  if (!points.length) return null;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${geo.x(i).toFixed(1)} ${geo.y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${geo.x(points.length - 1).toFixed(1)} ${H - B} L${geo.x(0).toFixed(1)} ${H - B} Z`;
  const step = Math.max(1, Math.ceil(points.length / 8));
  const labelled = axisLabels(points.map(p => p.label), step);
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
        {points.map((p, i) => labelled.has(i)
          ? <text key={i} x={geo.x(i)} y={H - 8} className="axis" textAnchor={i === points.length - 1 && i > 0 ? 'end' : i === 0 && points.length > 1 ? 'start' : 'middle'}>{p.label}</text> : null)}
        <path d={area} fill={`url(#g${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
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
      <svg viewBox={`-78 -4 ${S + 156} ${S + 8}`} role="img" aria-label={`Your skills against ${refLabel.toLowerCase()}`}>
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
        {parts.map(p => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.value.toLocaleString('en-US')}</b></li>)}
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

// ---- §7 charts: one look everywhere (2 px lines, rounded ends, recessive grid, numbers in text colour, tabular
// numbers, a tooltip, a Table toggle for screen readers, one y-axis) ---------------------------------------------

/** A "Table" switch under a chart: the same numbers as a table (for screen readers, and anyone who wants them). */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  const [on, setOn] = useState(false);
  return (
    <div className="chart-table">
      <button className="link-btn small" onClick={() => setOn(!on)} aria-expanded={on}>{on ? 'Hide table' : 'Table'}</button>
      {on && (
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="num">{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

export interface SplitPoint { t: number; v: number }
/**
 * A diverging area around a baseline (50% for win chance, 0 for a lead): above it in one colour, below in the other,
 * 12% fill, a 2 px line, the baseline dashed. Dots for marked moments; one direct label (the biggest swing or the
 * biggest lead); a crosshair with a tooltip.
 */
export function SplitChart({ points, base, top, bottom, colors, fmt, axis = fmt, xfmt, label, dots = [], ticks = [], height = 170, onPick, caption }: {
  points: SplitPoint[]; base: number;
  /** The y range (for win chance 100 and 0; for a lead, ± the biggest lead when left out). */
  top?: number; bottom?: number;
  colors: [string, string]; fmt: (v: number) => string; xfmt: (t: number) => string;
  /** How the y-axis reads (short: 20k), when not like the values. */
  axis?: (v: number) => string;
  /** One direct label on the chart. */
  label?: { t: number; text: string } | null;
  dots?: { t: number; color: string; title: string }[];
  /** Faint ticks along the bottom (round starts, …). */
  ticks?: number[];
  height?: number; onPick?: (t: number) => void; caption: string;
}) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, L = 50, R = 12, T = 18, B = 22;
  const geo = useMemo(() => {
    const t0 = points[0]?.t ?? 0, t1 = Math.max(t0 + 1, points.at(-1)?.t ?? 1);
    const far = Math.max(1e-9, ...points.map(p => Math.abs(p.v - base)));
    const hi = top ?? base + far * 1.1, lo = bottom ?? base - far * 1.1;
    const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    return { x, y, hi, lo };
  }, [points, base, top, bottom, H]);
  if (points.length < 2) return <p className="muted small">2 more points to draw this.</p>;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${geo.x(p.t).toFixed(1)} ${geo.y(p.v).toFixed(1)}`).join(' ');
  const yb = geo.y(base);
  const area = `${line} L${geo.x(points.at(-1)!.t).toFixed(1)} ${yb} L${geo.x(points[0].t).toFixed(1)} ${yb} Z`;
  const at = (t: number) => points.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), points[0]);
  const h = hover !== null ? at(hover) : null;
  const dotAt = (t: number) => dots.find(d => Math.abs(d.t - t) < 1e-6);
  return (
    <div className="split-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W; setHover(px < L || px > W - R ? null : points[0].t + ((px - L) / (W - L - R)) * (points.at(-1)!.t - points[0].t)); }}
        onMouseLeave={() => setHover(null)} onClick={() => { if (hover !== null && onPick) onPick(at(hover).t); }} style={onPick ? { cursor: 'pointer' } : undefined}>
        <defs>
          <clipPath id={`up${id}`}><rect x={0} y={0} width={W} height={yb} /></clipPath>
          <clipPath id={`dn${id}`}><rect x={0} y={yb} width={W} height={H - yb} /></clipPath>
        </defs>
        {[geo.hi, base, geo.lo].map((v, k) => (
          <g key={k}>
            {k !== 1 && <line x1={L} x2={W - R} y1={geo.y(v)} y2={geo.y(v)} className="sc-grid" />}
            <text x={L - 6} y={geo.y(v)} className="sc-axis" textAnchor="end" dominantBaseline="central">{axis(v)}</text>
          </g>
        ))}
        {ticks.map(t => <line key={t} x1={geo.x(t)} x2={geo.x(t)} y1={H - B} y2={H - B + 4} className="sc-tick" />)}
        <text x={L} y={H - 6} className="sc-axis">{xfmt(points[0].t)}</text>
        <text x={W - R} y={H - 6} className="sc-axis" textAnchor="end">{xfmt(points.at(-1)!.t)}</text>
        <path d={area} fill={colors[0]} fillOpacity={0.12} clipPath={`url(#up${id})`} />
        <path d={area} fill={colors[1]} fillOpacity={0.12} clipPath={`url(#dn${id})`} />
        <line x1={L} x2={W - R} y1={yb} y2={yb} className="sc-base" />
        <path d={line} fill="none" stroke={colors[0]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#up${id})`} />
        <path d={line} fill="none" stroke={colors[1]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#dn${id})`} />
        {dots.map((d, i) => { const p = at(d.t); return <circle key={i} cx={geo.x(p.t)} cy={geo.y(p.v)} r={4} fill={d.color} className="sc-dot"><title>{d.title}</title></circle>; })}
        {label && (() => { const p = at(label.t), x = geo.x(p.t), y = geo.y(p.v), up = p.v >= base;
          return <g className="sc-label"><circle cx={x} cy={y} r={3} /><text x={Math.min(W - R - 4, Math.max(L + 4, x))} y={up ? y - 9 : y + 15} textAnchor={x > W * 0.8 ? 'end' : x < W * 0.2 ? 'start' : 'middle'}>{label.text}</text></g>; })()}
        {h && <line x1={geo.x(h.t)} x2={geo.x(h.t)} y1={T} y2={H - B} className="sc-cursor" />}
      </svg>
      {h && (
        <div className="area-tip" style={{ left: `${(geo.x(h.t) / W) * 100}%` }}>
          <b className="num">{fmt(h.v)}</b><span>{xfmt(h.t)}{dotAt(h.t) ? ` · ${dotAt(h.t)!.title}` : ''}</span>
        </div>
      )}
      <ChartTable caption={caption} head={['Time', 'Value']} rows={points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 40)) === 0).map(p => [xfmt(p.t), fmt(p.v)])} />
    </div>
  );
}

/** A trend as a tile: the last value big, ↑/↓ against the average of all, a sparkline (from 2 points). */
export function TrendTile({ label, values, fmt, higherBetter = true, sub }: { label: string; values: number[]; fmt: (v: number) => string; higherBetter?: boolean; sub?: string }) {
  if (values.length < 2) return null;
  const last = values.at(-1)!, avg = values.reduce((a, b) => a + b, 0) / values.length, d = last - avg;
  const good = Math.abs(d) < 1e-9 ? null : (d > 0) === higherBetter;
  return (
    <div className="trend-tile">
      <span className="tt-label">{label}</span>
      <div className="tt-body">
        <b className="num">{fmt(last)}</b>
        <span className={`tt-delta ${good === null ? '' : good ? 'up' : 'down'}`} title={`Your last match against your average over these ${values.length}`}>
          {good === null ? 'at your average' : <>{d > 0 ? '↑' : '↓'} {fmt(Math.abs(d))} vs average</>}</span>
      </div>
      <MiniLine values={values} good={good} />
      {sub && <span className="muted small">{sub}</span>}
      <ChartTable caption={label} head={['Match', label]} rows={values.map((v, i) => [i + 1, fmt(v)])} />
    </div>
  );
}

/** Rows of a label and a dot on a track (0–100, 50 = the reference), the number at the end: compares at a glance. */
export function TrackRows({ rows, refLabel }: { rows: { label: string; pct: number | null; tip?: string; onClick?: () => void }[]; refLabel: string }) {
  return (
    <ul className="track-rows" aria-label={`Against ${refLabel.toLowerCase()} (50 = ${refLabel.toLowerCase()})`}>
      {rows.map(r => (
        <li key={r.label} title={r.tip}>
          {r.onClick ? <button className="link-btn" onClick={r.onClick}>{r.label}</button> : <span>{r.label}</span>}
          {r.pct !== null
            ? <span className="sk-track" aria-label={`${r.pct} out of 100`}><i className="sk-mid" /><i className="sk-dot" style={{ left: `${Math.max(0, Math.min(100, r.pct))}%` }} /></span>
            : <span className="muted small">not graded</span>}
          <b className="num">{r.pct ?? ''}</b>
        </li>
      ))}
    </ul>
  );
}

/** The last matches as W/L squares (oldest first, a grade letter on each when given), and one tile: the share won. */
export function ResultStrip({ results }: { results: { win: boolean | null; letter?: string | null; title: string }[] }) {
  const last = results.slice(-20), won = last.filter(r => r.win).length;
  return (
    <div className="result-strip">
      <div className="rs-tile"><b className="num">{Math.round((won / Math.max(1, last.length)) * 100)}%</b><span>won · last {last.length}</span></div>
      <ol aria-label="Results, oldest first">
        {last.map((r, i) => <li key={i} className={r.win === null ? 'tie' : r.win ? 'win' : 'loss'} title={r.title}>{r.letter ?? ''}</li>)}
      </ol>
    </div>
  );
}
