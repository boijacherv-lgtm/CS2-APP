import { useEffect, useRef, useState } from 'react';
import type { ControlMap } from '../engine/control';
import type { TacticalEngine } from '../engine/predict';
import { equipValue, GRADE_INFO, isMarked, moments, type Moment, LETTER_COLOR, letterGrade, movesUntil, TAG_INFO, teamEconomy, type DemoData, type Grade, type Move, type Replay, type Review, type Tag } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { gunFromName, primaryGun } from '../engine/guns';
import { useStore } from '../store';
import { SteamMatches } from './SteamMatches';
import { DemoFolder } from './DemoFolder';
import { ONLINE, STEAM_AVAILABLE } from '../env';
import { DEMO_PASSES, readDemoInBrowser } from './readDemo';
import { GameIcon, Icon } from './Icon';
import type { Cs2Icon } from './cs2Icons';
import { shownNow, useShown } from './shown';

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}%`;

/** Reads a .dem (desktop: the dev server; website: in the browser) or a previously saved .json into a review. */
function useDemoLoader() {
  const startReview = useStore(s => s.startReview);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (file: File) => {
    setBusy(true);
    try {
      let data: DemoData;
      if (file.name.endsWith('.json')) data = JSON.parse(await file.text());
      else if (ONLINE) {
        // website: read it right here in the browser (nothing is uploaded)
        setStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB) in your browser…`);
        data = await readDemoInBrowser(file, pass => setStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB) in your browser… step ${pass} of ~${DEMO_PASSES}`));
      } else {
        setStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)… big demos take a few seconds.`);
        const res = await fetch(`/api/demo?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        data = body;
      }
      if (!MAPS.some(m => m.id === data.map)) throw new Error(`${data.map} isn't one of the supported maps.`);
      if (!data.rounds.length) throw new Error('No rounds found in this demo.');
      setStatus(null);
      startReview(data);
    } catch (e) {
      setStatus(`Couldn't load: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return { load, status, busy };
}

/** Sidebar controls for the loaded match. */
export function DemoLoader() {
  const s = useStore();
  if (!s.review) return null;
  const d = s.review.data;
  return (
    <section>
      <h3>Match</h3>
      <p className="muted">{MAPS.find(m => m.id === d.map)?.name ?? d.map} · {d.rounds.length} rounds · {Object.keys(d.names).length} players</p>
      <div className="row">
        <button onClick={() => exportJson(d)} title="Save the parsed rounds so they load instantly next time">Save .json</button>
        <button onClick={s.exitReview} title="Close this match and load another">Load another</button>
      </div>
    </section>
  );
}

/** Review mode with no match loaded: a big place to drop a demo. */
export function ReviewStart() {
  const { load, status, busy } = useDemoLoader();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="review-start">
      <div
        className={`dropzone ${over ? 'over' : ''} ${busy ? 'busy' : ''}`}
        onClick={() => !busy && input.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !busy) load(f); }}
      >
        <div className="dz-icon"><Icon name={busy ? 'hourglass' : 'upload'} size={34} /></div>
        <h2>{busy ? 'Reading your match…' : 'Drop a demo here'}</h2>
        <p>{busy ? status : 'or click to choose a .dem file (or a .json you saved before)'}</p>
        <input ref={input} type="file" accept=".dem,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
      </div>
      {status && !busy && <p className="warn-text center">{status}</p>}
      <div className="review-how">
        <div><b>1. Get a demo</b><span>CS2 → Watch → Your Matches → download. FACEIT and HLTV demos work too (unzip them first).</span></div>
        <div><b>2. Drop it in</b><span>{ONLINE ? "It's read right here in your browser; nothing is uploaded." : "It's read on this computer only; nothing is uploaded anywhere."}</span></div>
        <div><b>3. Watch it back</b><span>Each round replays with a live win-chance bar, and every kill, grenade and costly death gets a letter from S+ (round-swinging) to F.</span></div>
      </div>
      {ONLINE && <DemoFolder />}
      {STEAM_AVAILABLE && <SteamMatches />}
    </div>
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
  const { shown } = useShown();
  const names = replay.names;
  const sideOf = (id: string) => replay.board.players.find(p => p.id === id)?.side ?? 'CT';
  // Like a chess game review: only what has happened so far, unless "show whole round" is on.
  const seen = movesUntil(recap, s.time, all);
  const finished = all || s.time >= r.duration - 0.3;
  const moves = seen.filter(m => filter === 'all' ? true : filter === 'key' ? shown(m) : filter === 'util' ? !!m.util : m.player === filter);
  const latest = [...seen].reverse().find(shown);
  const jump = (t: number) => { s.setPlaying(false); s.setTime(Math.max(0, t - 1.5)); };
  const players = scoreboard(recap, seen);
  const tp = recap.turningPoint && (all || recap.turningPoint.t <= s.time) ? recap.turningPoint : null;
  const [tab, setTab] = useState<'moves' | 'economy' | 'players'>('moves');

  return (
    <aside className="panel review-panel">
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
            : <>Round in progress · press <b>Play</b> (Space) to watch it unfold</>}
          {r.plant !== null && (all || s.time >= r.plant) ? ` · bomb planted ${fmt(r.plant)}` : ''}
        </p>
      </section>

      <div className="tabs" role="tablist">
        {([['moves', 'Moves'], ['economy', 'Economy'], ['players', 'Players']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'economy' && <Economy replay={replay} totalRounds={rv.data.rounds.length} />}

      {tab === 'moves' && <>
      <section>
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
      </>}

      {tab === 'players' && <section>
        <h3>Players {finished ? '' : '(so far)'}</h3>
        <table className="kills">
          <thead><tr><th /><th title="Round grade: S+ (won the round) … F (threw it). Win-chance impact plus clutches, multi-kills, team damage, unused grenades">Grade</th><th title="Total change in their team's win chance">Impact</th>
            {COUNTED.map(g => <th key={g} title={`${GRADE_INFO[g].label} moves`} style={{ color: GRADE_INFO[g].color }}>{GRADE_INFO[g].mark}</th>)}
          </tr></thead>
          <tbody>
            {Object.entries(players).sort(([a], [b]) => sideOf(a).localeCompare(sideOf(b)) || players[b].impact - players[a].impact).map(([id, p]) => (
              <tr key={id} className={filter === id ? 'sel' : ''} onClick={() => { setFilter(filter === id ? 'key' : id); if (filter !== id) setTab('moves'); }}>
                <td>
                  <b className={sideOf(id).toLowerCase()}>{names[id] ?? id}</b>
                  {finished && recap.roles[id] && <span className="role" title={recap.roles[id].note}>{recap.roles[id].role}</span>}
                </td>
                <td><Letter moves={seen.filter(m => m.player === id)} /></td>
                <td style={{ color: p.impact > 0.02 ? '#7fbf4d' : p.impact < -0.02 ? '#e5483a' : undefined }}>{signed(p.impact)}</td>
                {COUNTED.map(g => <td key={g}>{p.counts[g] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">Click a player to see only their moves (Moves tab).{finished ? ' Hover a role to see why.' : ' Roles show when the round ends.'}</p>
      </section>}

      {/* A quiet history: new moves are added at the top, nothing scrolls or flashes. */}
      {tab === 'moves' && <section>
        <h3>Moves{moves.length ? ` · ${moves.length}` : ''}</h3>
        <div className="row km">
          <select value={filter.length > 4 ? 'key' : filter} onChange={e => setFilter(e.target.value)}>
            <option value="key">Key moves</option><option value="util">Grenades</option><option value="all">Everything</option>
          </select>
        </div>
        <div className="move-list">
          {[...moves].reverse().map(m => (
            <div key={`${m.t}-${m.player}-${m.kind}`} className="move past" onClick={() => jump(m.t)}>
              <MoveRow m={m} />
            </div>
          ))}
          {!moves.length && <p className="muted">{all ? 'No moves for this filter.' : 'Nothing has happened yet. Press Play.'}</p>}
        </div>
        {moves.length > 0 && <p className="muted">Newest first. Click a move to jump to it.</p>}
      </section>}

      {control && (
        <p className="muted foot">
          Win chance blends players alive, health, bomb timer, time left and map control at each moment.
          Moves are graded by how much they changed their team's chance (traded deaths count less). It's an estimate, not a pro's opinion.
        </p>
      )}
    </aside>
  );
}

const SHOW_AFTER = 0.1; // a moment is shown just after it happens (badges and banner up)

/**
 * Step through a round's key moments like chess moves (◀ ▶ / arrow keys). Past the last moment ▶ goes
 * to the next round's start; before the first, ◀ goes to the end of the previous round.
 */
export function stepMoment(recap: Review, dir: 1 | -1) {
  const st = useStore.getState();
  const rv = st.review;
  if (!rv) return;
  const list = moments(recap, shownNow());
  const now = st.time;
  st.setPlaying(false);
  if (dir > 0) {
    const next = list.find(m => m.t + SHOW_AFTER > now + 0.05);
    if (next) return st.setTime(next.t + SHOW_AFTER);
    if (rv.round < rv.data.rounds.length - 1) st.setReviewRound(rv.round + 1);
  } else {
    const prev = [...list].reverse().find(m => m.t + SHOW_AFTER < now - 0.05);
    if (prev) return st.setTime(prev.t + SHOW_AFTER);
    if (now > 0.05) return st.setTime(0);
    if (rv.round > 0) {
      const n = rv.round - 1;
      st.setReviewRound(n);
      st.setTime(rv.data.rounds[n].duration);
    }
  }
}

/** ◀ moment n/N ▶ bar over the board. */
export function MomentNav({ recap }: { recap: Review }) {
  const time = useStore(s => s.time);
  const rv = useStore(s => s.review);
  const { shown } = useShown();
  const list = moments(recap, shown);
  if (!rv) return null;
  const idx = list.reduce((a, m, i) => (m.t + SHOW_AFTER <= time + 0.05 ? i : a), -1);
  const cur: Moment | undefined = list[idx];
  const atMoment = cur && Math.abs(time - (cur.t + SHOW_AFTER)) < 0.06;
  const main = cur ? cur.moves.find(m => m.kind === 'kill') ?? cur.moves[0] : undefined;
  const g = main ? GRADE_INFO[main.grade] : undefined;
  const first = rv.round === 0 && time < 0.05, last = rv.round === rv.data.rounds.length - 1 && idx === list.length - 1;
  const watch = () => { if (!cur) return; const st = useStore.getState(); st.setTime(Math.max(0, cur.t - 3)); st.setPlaying(true); };
  return (
    <div className="moment-nav">
      <button onClick={() => stepMoment(recap, -1)} disabled={first} title="Previous moment (←)" aria-label="Previous moment"><Icon name="prev" /></button>
      <div className="moment-label">
        {idx < 0
          ? <span className="muted">Round {rv.round + 1} start · {list.length} moments</span>
          : <>
              <span className="muted">{idx + 1}/{list.length}</span>
              {g && <span className="badge" style={{ background: g.color }}>{g.mark}</span>}
              <span className={atMoment ? '' : 'muted'}>{main?.title}{cur.moves.length > 1 ? ` +${cur.moves.length - 1}` : ''}</span>
              {cur && <button className="mini" onClick={watch} title="Watch the 3 s leading up to it" aria-label="Watch the lead-up"><Icon name="rewind" size={12} /></button>}
            </>}
      </div>
      <button onClick={() => stepMoment(recap, 1)} disabled={last && time >= (list[list.length - 1]?.t ?? 0) + SHOW_AFTER - 0.05} title="Next moment (→)" aria-label="Next moment"><Icon name="next" /></button>
    </div>
  );
}

/** Move letters counted per player in the Players tab: the big ones, both ways. */
const COUNTED: Grade[] = ['S+', 'S', 'A', 'D', 'E', 'F'];

/** Impact and grade counts from the moves seen so far. */
function scoreboard(recap: Review, seen: Move[]) {
  const out: Review['players'] = {};
  for (const id of Object.keys(recap.players)) out[id] = { impact: 0, counts: { 'S+': 0, S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 } };
  for (const m of seen) if (out[m.player]) { out[m.player].impact += m.gain; if (m.kind !== 'death' || isMarked(m)) out[m.player].counts[m.grade]++; }
  return out;
}

const BUY_COLOR: Record<string, string> = { 'Full buy': '#3ddc84', 'Force buy': '#ffb020', 'Semi-eco': '#e58f2a', Eco: '#e5483a', 'Pistol round': '#a39b8f' };
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
/** Grenades in an inventory, as CS2's buy-menu pictograms. */
const NADE_PICS: { re: RegExp; src: Cs2Icon; name: string }[] = [
  { re: /smoke/, src: 'equipment/smokegrenade', name: 'Smoke' },
  { re: /flash/, src: 'equipment/flashbang', name: 'Flashbang' },
  { re: /he ?grenade|hegrenade|high explosive/, src: 'equipment/hegrenade', name: 'HE grenade' },
  { re: /molotov/, src: 'equipment/molotov', name: 'Molotov' },
  { re: /incendiary|incgrenade/, src: 'equipment/incgrenade', name: 'Incendiary' },
  { re: /decoy/, src: 'equipment/decoy', name: 'Decoy' },
];
function NadeIcons({ weapons }: { weapons: string[] }) {
  const w = weapons.map(x => x.toLowerCase());
  return (
    <span className="nade-pics">
      {NADE_PICS.map(n => {
        const count = w.filter(x => n.re.test(x)).length;
        return count ? (
          <span key={n.src} className="nade-pic" title={count > 1 ? `${n.name} ×${count}` : n.name}>
            {Array.from({ length: count }, (_, i) => <GameIcon key={i} src={n.src} size={15} />)}
          </span>
        ) : null;
      })}
    </span>
  );
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
                <td title={e?.weapons.join(', ')} className="loadout">{e ? loadout(e.weapons) : '–'}{e?.helmet ? <Icon name="helmet" size={13} title="Kevlar + helmet" className="inline" /> : e && e.armor > 0 ? <Icon name="vest" size={13} title="Kevlar" className="inline" /> : null}{e?.defuser ? <Icon name="scissors" size={13} title="Defuse kit" className="inline" /> : null}</td>
                <td>{e ? <NadeIcons weapons={e.weapons} /> : ''}</td>
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
  const death = false; // every listed move shows its letter (deaths too)
  return (
    <>
      <div className="move-head">
        <span className="muted">{fmt(m.t)}</span>
        {death
          ? <span className="badge death" title="Ordinary deaths aren't marked (only costly untraded ones are); the loss still counts toward impact and the round grade"><Icon name="cross" size={11} /></span>
          : <span className="badge" style={{ background: g.color }} title={g.label}>{g.mark}</span>}
        <b className={m.side.toLowerCase()}>{m.title}</b>
        <span className="pct" style={{ color: m.gain > 0.02 ? '#7fbf4d' : m.gain < -0.02 ? '#e5483a' : 'var(--muted)' }}>{signed(m.gain)}</span>
      </div>
      {m.tags.length > 0 && <Tags tags={m.tags} />}
      {!compact && <div className="why">{death ? '' : `${g.label}. `}{m.why.join(' ')}</div>}
    </>
  );
}

export function Tags({ tags }: { tags: Tag[] }) {
  return (
    <div className="tags">
      {tags.map(t => <span key={t} className="tag" style={{ color: TAG_INFO[t].color, borderColor: TAG_INFO[t].color }} title={TAG_INFO[t].tip}>{t}</span>)}
    </div>
  );
}

function Letter({ moves }: { moves: Move[] }) {
  const { letter, points } = letterGrade(moves);
  return <span className="letter" style={{ background: LETTER_COLOR[letter] }} title={`${points >= 0 ? '+' : ''}${points.toFixed(0)} points`}>{letter}</span>;
}

