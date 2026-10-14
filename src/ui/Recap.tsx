import { useRef, useState } from 'react';
import type { ControlMap } from '../engine/control';
import type { TacticalEngine } from '../engine/predict';
import { GRADE_INFO, type DemoData, type Grade, type Move, type Replay, type Review } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { useStore } from '../store';

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;

/** Load a .dem (parsed locally by the dev server) or a previously exported .json. */
export function DemoLoader() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = async (file: File) => {
    try {
      let data: DemoData;
      if (file.name.endsWith('.json')) data = JSON.parse(await file.text());
      else {
        setStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)…`);
        const res = await fetch('/api/demo', { method: 'POST', body: file });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        data = body;
      }
      if (!MAPS.some(m => m.id === data.map)) throw new Error(`${data.map} isn't one of the supported maps.`);
      if (!data.rounds.length) throw new Error('No rounds found in this demo.');
      setStatus(null);
      s.startReview(data);
    } catch (e) {
      setStatus(`Couldn't load: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section>
      <h3>Review a match</h3>
      {s.review ? (
        <div className="row">
          <button onClick={() => exportJson(s.review!.data)} title="Save the parsed rounds so they load instantly next time">Save .json</button>
          <button onClick={s.exitReview}>Exit review</button>
        </div>
      ) : (
        <>
          <button className="wide" onClick={() => input.current?.click()}>Load demo (.dem)…</button>
          <input ref={input} type="file" accept=".dem,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
          <p className="muted">CS2 → Watch → Your matches → download, or a FACEIT / HLTV demo (unzip first). It's read on this Mac only.</p>
        </>
      )}
      {status && <p className={status.startsWith("Couldn't") ? 'warn-text' : 'muted'}>{status}</p>}
    </section>
  );
}

function exportJson(data: DemoData) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.map}-review.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RecapPanel({ recap, replay, engine, control }: { recap: Review; replay: Replay; engine: TacticalEngine; control: ControlMap | null }) {
  const s = useStore();
  const rv = s.review!;
  const r = replay.round;
  const [filter, setFilter] = useState<'all' | 'key' | string>('key');
  const names = replay.names;
  const sideOf = (id: string) => replay.board.players.find(p => p.id === id)?.side ?? 'CT';
  const moves = recap.moves.filter(m => filter === 'all' ? true : filter === 'key' ? m.grade !== 'book' : m.player === filter);
  const jump = (t: number) => { s.setPlaying(false); s.setTime(Math.max(0, t - 1.5)); };

  return (
    <aside className="panel">
      <section>
        <h3>{engine.map.name} · round {r.n} of {rv.data.rounds.length}</h3>
        <div className="rounds">
          {rv.data.rounds.map((x, i) => (
            <button key={i} className={`rnd ${i === rv.round ? 'on' : ''} ${x.winner === 'CT' ? 'ctw' : x.winner === 'T' ? 'tw' : ''}`}
              onClick={() => s.setReviewRound(i)} title={`${x.winner ?? '?'} won${x.reason ? ` (${x.reason})` : ''}`}>{x.n}</button>
          ))}
        </div>
        <p className="muted">{r.winner ? <b className={r.winner.toLowerCase()}>{r.winner} won</b> : 'Result unknown'}{r.reason ? ` · ${r.reason}` : ''}{r.plant !== null ? ` · bomb planted ${fmt(r.plant)}` : ''}</p>
      </section>

      <section>
        <h3>Win chance (CT) · {fmt(s.time)}</h3>
        <EvalGraph recap={recap} duration={r.duration} time={s.time} onSeek={t => { s.setPlaying(false); s.setTime(t); }} />
        {recap.turningPoint && (
          <div className="turning" onClick={() => jump(recap.turningPoint!.t)}>
            <span className="muted">Turning point · {fmt(recap.turningPoint.t)}</span>
            <MoveRow m={recap.turningPoint} compact />
          </div>
        )}
      </section>

      <section>
        <h3>Players</h3>
        <table className="kills">
          <thead><tr><th /><th title="Total change in their team's win chance">Impact</th>
            {(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'] as Grade[]).map(g => <th key={g} title={GRADE_INFO[g].label} style={{ color: GRADE_INFO[g].color }}>{GRADE_INFO[g].mark}</th>)}
          </tr></thead>
          <tbody>
            {Object.entries(recap.players).sort(([a], [b]) => sideOf(a).localeCompare(sideOf(b)) || recap.players[b].impact - recap.players[a].impact).map(([id, p]) => (
              <tr key={id} className={filter === id ? 'sel' : ''} onClick={() => setFilter(filter === id ? 'key' : id)}>
                <td><b className={sideOf(id).toLowerCase()}>{names[id] ?? id}</b></td>
                <td style={{ color: p.impact > 0.02 ? '#7fbf4d' : p.impact < -0.02 ? '#e5483a' : undefined }}>{signed(p.impact)}</td>
                {(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'] as Grade[]).map(g => <td key={g}>{p.counts[g] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Click a player to see only their moves.</p>
      </section>

      <section>
        <div className="row km">
          <h3 className="grow" style={{ margin: 0 }}>Moves</h3>
          <select value={filter.length > 4 ? 'key' : filter} onChange={e => setFilter(e.target.value)}>
            <option value="key">Key moves</option><option value="all">Everything</option>
          </select>
        </div>
        {moves.map((m, i) => (
          <div key={i} className={`move ${m.t <= s.time ? 'past' : ''}`} onClick={() => jump(m.t)}>
            <MoveRow m={m} />
          </div>
        ))}
        {!moves.length && <p className="muted">No moves for this filter.</p>}
      </section>

      {control && (
        <p className="muted foot">
          Win chance blends players alive, health, bomb timer, time left and map control at each moment.
          Moves are graded by how much they changed their team's chance (traded deaths count less). It's an estimate, not a pro's opinion.
        </p>
      )}
    </aside>
  );
}

function MoveRow({ m, compact }: { m: Move; compact?: boolean }) {
  const g = GRADE_INFO[m.grade];
  return (
    <>
      <div className="move-head">
        <span className="muted">{fmt(m.t)}</span>
        <span className="badge" style={{ background: g.color }} title={g.label}>{g.mark}</span>
        <b className={m.side.toLowerCase()}>{m.title}</b>
        <span className="pct" style={{ color: m.gain > 0.02 ? '#7fbf4d' : m.gain < -0.02 ? '#e5483a' : 'var(--muted)' }}>{signed(m.gain)}</span>
      </div>
      {!compact && <div className="why">{g.label}. {m.why.join(' ')}</div>}
    </>
  );
}

/** CT win chance over the round, like a chess eval graph. Click to jump. */
function EvalGraph({ recap, duration, time, onSeek }: { recap: Review; duration: number; time: number; onSeek: (t: number) => void }) {
  const W = 320, H = 110;
  const x = (t: number) => (t / Math.max(1, duration)) * W;
  const y = (v: number) => H - v * H;
  const line = recap.curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.t).toFixed(1)},${y(c.ct).toFixed(1)}`).join(' ');
  const area = `${line} L${x(recap.curve.at(-1)!.t)},${H} L0,${H} Z`;
  const marks = recap.moves.filter(m => m.grade !== 'book' && m.kind !== 'death');
  return (
    <svg className="evalgraph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      onClick={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * duration); }}>
      <rect width={W} height={H} fill="var(--t)" opacity={0.18} />
      <path d={area} fill="var(--ct)" opacity={0.35} />
      <path d={line} fill="none" stroke="var(--ct)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#fff" strokeOpacity={0.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      {marks.map((m, i) => {
        const v = recap.curve[Math.min(recap.curve.length - 1, Math.round(m.t / 0.5))]?.ct ?? 0.5;
        return <circle key={i} cx={x(m.t)} cy={y(v)} r={3} fill={GRADE_INFO[m.grade].color} stroke="#000" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />;
      })}
      <line x1={x(time)} x2={x(time)} y1={0} y2={H} stroke="#fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
