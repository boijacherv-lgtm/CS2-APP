import { useEffect, useRef, useState } from 'react';
import type { ControlMap } from '../engine/control';
import type { TacticalEngine } from '../engine/predict';
import { equipValue, evalAt, GRADE_INFO, movesUntil, teamEconomy, type DemoData, type Grade, type Move, type Replay, type Review } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { gunFromName, primaryGun } from '../engine/guns';
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
  const all = s.reviewSpoilers;
  const [filter, setFilter] = useState<'all' | 'key' | string>('key');
  const names = replay.names;
  const sideOf = (id: string) => replay.board.players.find(p => p.id === id)?.side ?? 'CT';
  // Like a chess game review: only what has happened so far, unless "show whole round" is on.
  const seen = movesUntil(recap, s.time, all);
  const finished = all || s.time >= r.duration - 0.3;
  const moves = seen.filter(m => filter === 'all' ? true : filter === 'key' ? m.grade !== 'book' : m.player === filter);
  const latest = [...seen].reverse().find(m => m.grade !== 'book');
  const jump = (t: number) => { s.setPlaying(false); s.setTime(Math.max(0, t - 1.5)); };
  const players = scoreboard(recap, seen);
  const tp = recap.turningPoint && (all || recap.turningPoint.t <= s.time) ? recap.turningPoint : null;
  const ct = evalAt(recap.curve, s.time);

  // keep the newest move in view while the round plays
  const listEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!all) listEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [seen.length, all]);

  return (
    <aside className="panel">
      <section>
        <h3>{engine.map.name} · round {r.n} of {rv.data.rounds.length}</h3>
        <div className="rounds">
          {rv.data.rounds.map((x, i) => (
            <button key={i} className={`rnd ${i === rv.round ? 'on' : ''} ${all ? (x.winner === 'CT' ? 'ctw' : x.winner === 'T' ? 'tw' : '') : ''}`}
              onClick={() => s.setReviewRound(i)} title={all ? `${x.winner ?? '?'} won${x.reason ? ` (${x.reason})` : ''}` : `Round ${x.n}`}>{x.n}</button>
          ))}
        </div>
        <p className="muted">
          {finished
            ? <>{r.winner ? <b className={r.winner.toLowerCase()}>{r.winner} won</b> : 'Result unknown'}{r.reason ? ` · ${r.reason}` : ''}</>
            : <>Round in progress · press <b>▶ Play</b> (Space) to watch it unfold</>}
          {r.plant !== null && (all || s.time >= r.plant) ? ` · bomb planted ${fmt(r.plant)}` : ''}
        </p>
        <button className={`wide reveal ${all ? 'on' : ''}`} onClick={() => s.setReviewSpoilers(!all)} title="Shortcut: R">
          {all ? '◀ Back to live (hide what hasn\'t happened)' : '⏭ Reveal all: full eval, every move and the result'}
        </button>
      </section>

      <Economy replay={replay} totalRounds={rv.data.rounds.length} />

      <section>
        <h3>Win chance · {fmt(s.time)} · <span className="ct">CT {Math.round(ct * 100)}%</span> – <span className="t">T {Math.round((1 - ct) * 100)}%</span></h3>
        <EvalGraph recap={recap} duration={r.duration} time={s.time} until={all ? Infinity : s.time} onSeek={t => { s.setPlaying(false); s.setTime(t); }} />
        {latest && !all && (
          <div className="turning" onClick={() => jump(latest.t)}>
            <span className="muted">Last move</span>
            <MoveRow m={latest} />
          </div>
        )}
        {tp && finished && (
          <div className="turning" onClick={() => jump(tp.t)}>
            <span className="muted">Turning point · {fmt(tp.t)}</span>
            <MoveRow m={tp} compact />
          </div>
        )}
      </section>

      <section>
        <h3>Players {finished ? '' : '(so far)'}</h3>
        <table className="kills">
          <thead><tr><th /><th title="Total change in their team's win chance">Impact</th>
            {(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'] as Grade[]).map(g => <th key={g} title={GRADE_INFO[g].label} style={{ color: GRADE_INFO[g].color }}>{GRADE_INFO[g].mark}</th>)}
          </tr></thead>
          <tbody>
            {Object.entries(players).sort(([a], [b]) => sideOf(a).localeCompare(sideOf(b)) || players[b].impact - players[a].impact).map(([id, p]) => (
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
          <div key={`${m.t}-${m.player}-${m.kind}`} className={`move past ${m === latest && !all ? 'fresh' : ''}`} onClick={() => jump(m.t)}>
            <MoveRow m={m} />
          </div>
        ))}
        {!moves.length && <p className="muted">{all ? 'No moves for this filter.' : 'Nothing has happened yet. Press ▶ Play.'}</p>}
        <div ref={listEnd} />
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

/** Impact and grade counts from the moves seen so far. */
function scoreboard(recap: Review, seen: Move[]) {
  const out: Review['players'] = {};
  for (const id of Object.keys(recap.players)) out[id] = { impact: 0, counts: { brilliant: 0, great: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, blunder: 0 } };
  for (const m of seen) if (out[m.player]) { out[m.player].impact += m.gain; out[m.player].counts[m.grade]++; }
  return out;
}

const BUY_COLOR: Record<string, string> = { 'Full buy': '#3ddc84', 'Force buy': '#ffb020', 'Semi-eco': '#e58f2a', Eco: '#e5483a', 'Pistol round': '#a39b8f' };
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
/** Grenades in an inventory as compact icons: S smoke, F flash(es), H HE, M molotov/incendiary. */
function nadeIcons(weapons: string[]) {
  const w = weapons.map(x => x.toLowerCase());
  const n = (re: RegExp) => w.filter(x => re.test(x)).length;
  const flashes = n(/flash/), out: string[] = [];
  if (n(/smoke/)) out.push('S');
  if (flashes) out.push(flashes > 1 ? `F×${flashes}` : 'F');
  if (n(/he ?grenade|hegrenade|high explosive/)) out.push('H');
  if (n(/molotov|incendiary|inferno/)) out.push('M');
  return out.join(' ');
}

/** Each team's buy and every player's gun, gear value and bank. Known at round start, so never a spoiler. */
function Economy({ replay, totalRounds }: { replay: Replay; totalRounds: number }) {
  const r = replay.round;
  if (!r.econ || !Object.keys(r.econ).length) return null;
  const teams = teamEconomy(r, totalRounds);
  const ids = Object.keys(r.frames.players);
  return (
    <section>
      <h3>Economy</h3>
      <div className="econ-teams">
        {(['CT', 'T'] as const).map(side => (
          <div key={side} className="econ-team">
            <b className={side.toLowerCase()}>{side}</b>
            <span className="buy" style={{ background: BUY_COLOR[teams[side].buy] }}>{teams[side].buy}</span>
            <span className="muted">{usd(teams[side].equip)} gear · {usd(teams[side].money)} bank</span>
          </div>
        ))}
      </div>
      <table className="kills econ">
        <thead><tr><th /><th>Loadout</th><th title="S smoke · F flash · H HE · M molotov">Nades</th><th title="Value of what they carry">Gear</th><th title="Cash left after buying">Bank</th></tr></thead>
        <tbody>
          {ids.sort((a, b) => r.frames.players[a].side.localeCompare(r.frames.players[b].side) || (equipValue(r.econ?.[b]) ?? 0) - (equipValue(r.econ?.[a]) ?? 0)).map(id => {
            const e = r.econ?.[id];
            const side = r.frames.players[id].side;
            return (
              <tr key={id}>
                <td><b className={side.toLowerCase()}>{replay.names[id] ?? id}</b></td>
                <td title={e?.weapons.join(', ')} className="loadout">{e ? loadout(e.weapons) : '–'}{e?.helmet ? ' ⛑' : e && e.armor > 0 ? ' 🦺' : ''}{e?.defuser ? ' ✂' : ''}</td>
                <td className="muted">{e ? nadeIcons(e.weapons) : ''}</td>
                <td>{e ? usd(equipValue(e) ?? 0) : '–'}</td>
                <td>{e?.money != null ? usd(e.money) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted">Equipment is part of the win chance: a full buy against an eco starts near 90/10, and kills on eco players count for less.</p>
    </section>
  );
}

/** "AK-47 + Glock" style summary: best gun, plus the pistol if they also carry a primary. */
function loadout(weapons: string[]) {
  const primary = primaryGun(weapons);
  if (!primary) return 'Knife';
  const pistol = weapons.map(gunFromName).find(g => g && g.cls === 'pistol' && g.id !== primary.id);
  return primary.cls === 'pistol' ? primary.name : `${primary.name}${pistol ? ` + ${pistol.short}` : ''}`;
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
function EvalGraph({ recap, duration, time, until, onSeek }: { recap: Review; duration: number; time: number; until: number; onSeek: (t: number) => void }) {
  const W = 320, H = 110;
  const x = (t: number) => (t / Math.max(1, duration)) * W;
  const y = (v: number) => H - v * H;
  const shown = recap.curve.filter(c => c.t <= until + 0.01);
  if (shown.length && shown.at(-1)!.t < Math.min(until, duration)) shown.push({ t: Math.min(until, duration), ct: evalAt(recap.curve, until) });
  const line = shown.map((c, i) => `${i ? 'L' : 'M'}${x(c.t).toFixed(1)},${y(c.ct).toFixed(1)}`).join(' ');
  const area = shown.length ? `${line} L${x(shown.at(-1)!.t)},${H} L0,${H} Z` : '';
  const marks = recap.moves.filter(m => m.grade !== 'book' && m.kind !== 'death' && m.t <= until + 0.01);
  return (
    <svg className="evalgraph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      onClick={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * duration); }}>
      <rect width={W} height={H} fill="var(--panel2)" />
      {shown.length > 0 && <rect width={x(shown.at(-1)!.t)} height={H} fill="var(--t)" opacity={0.22} />}
      <path d={area} fill="var(--ct)" opacity={0.35} />
      <path d={line} fill="none" stroke="var(--ct)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#fff" strokeOpacity={0.25} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      {marks.map((m, i) => {
        const v = evalAt(recap.curve, m.t);
        return <circle key={i} cx={x(m.t)} cy={y(v)} r={3} fill={GRADE_INFO[m.grade].color} stroke="#000" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />;
      })}
      <line x1={x(time)} x2={x(time)} y1={0} y2={H} stroke="#fff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
