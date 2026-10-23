import { useEffect, useMemo, useRef, useState } from 'react';
import type { ControlMap } from '../engine/control';
import { isDecision, roundDecisions } from '../engine/situations';
import { judgeHold, judgeMove, USUAL_LABEL, type Usual } from '../engine/positioning';
import { engineHold, engineLine, engineMove } from '../engine/engineEval';
import { roundAnalysis } from '../engine/analysis';
import { proPositions } from '../map/positions';
import { OPENING, SEARCH_COLOR, type RoundSearch } from '../engine/search';
import { moveLook, NoteMark } from './NoteMark';
import { brief } from './MoveFeed';
import type { TacticalEngine } from '../engine/predict';
import { equipValue, LETTER_COLOR, LETTER_INFO, moments, type Moment, movesUntil, NOTE_INFO, NOTES, roundFacts, roundGrade, TAG_INFO, teamEconomy, type Annotation, type DemoData, type DemoRound, type Move, type Replay, type Review, type Tag } from '../engine/recap';
import { MAPS } from '../map/catalog';
import { gunFromName, primaryGun } from '../engine/guns';
import { useStore, whoAmI } from '../store';
import { T as TOK } from './tokens';
import { SteamMatches } from './SteamMatches';
import { DemoFolder } from './DemoFolder';
import { ONLINE, STEAM_AVAILABLE } from '../env';
import { readDemoFile } from './readDemo';
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
  /** Reading in the browser: the share done (null when it can't be told), and the seconds since it started. */
  const [progress, setProgress] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const t0 = performance.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((performance.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const load = async (file: File) => {
    setBusy(true);
    setProgress(null);
    try {
      if (ONLINE && !file.name.endsWith('.json')) {
        // website: read it right here in the browser (nothing is uploaded)
        // about 6 MB a second on a laptop: a 250 MB demo takes ~40 s
        setStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB) in your browser. Usually about ${Math.max(5, Math.round(file.size / 6e6 / 5) * 5)} s.`);
        setProgress(0);
      } else setStatus(`Reading ${file.name} (${(file.size / 1e6).toFixed(0)} MB)… big demos take a few seconds.`);
      const data = await readDemoFile(file, setProgress);
      setStatus(null);
      startReview(data);
    } catch (e) {
      setStatus(`Couldn't load: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return { load, status, busy, progress, elapsed };
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
        <button onClick={s.exitReview} title="Close this match: load another, or go back to Tactical">Close match</button>
      </div>
    </section>
  );
}

/** Review mode with no match loaded: a big place to drop a demo. */
export function ReviewStart() {
  const { load, status, busy, progress, elapsed } = useDemoLoader();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="review-start">
      <header className="rs-head">
        <h1 className="display">Review a match</h1>
        <p>Drop a demo file, or pick one of your recent matches.</p>
      </header>
      <div className="rs-grid">
        <div className="rs-left">
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
            {busy && progress !== null && (
              <div className="dz-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <i style={{ width: `${Math.max(3, progress * 100)}%` }} />
                <span className="muted num">{Math.round(progress * 100)}% · {elapsed} s</span>
              </div>
            )}
            <input ref={input} type="file" accept=".dem,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
          </div>
          {status && !busy && <p className="warn-text center">{status}</p>}
          <div className="review-how">
            <div><b>1. Get a demo</b><span>CS2 → Watch → Your Matches → download. FACEIT and HLTV demos work too (unzip them first).</span></div>
            <div><b>2. Drop it in</b><span>{ONLINE ? "It's read right here in your browser; nothing is uploaded." : "It's read on this computer only; nothing is uploaded anywhere."}</span></div>
            <div><b>3. Watch it back</b><span>Each round replays with a live win-chance bar, and every kill, grenade and costly death gets a letter from S+ (round-swinging) to F.</span></div>
          </div>
        </div>
        <div className="rs-right">
          {ONLINE && <DemoFolder />}
          {STEAM_AVAILABLE && <SteamMatches />}
        </div>
      </div>
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
  const [tab, setTab] = useState<'moves' | 'positions' | 'economy' | 'players'>('moves');

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
        {([['moves', 'Moves'], ['positions', 'Positions'], ['economy', 'Economy'], ['players', 'Players']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'economy' && <Economy replay={replay} totalRounds={rv.data.rounds.length} />}
      {tab === 'positions' && <Positions engine={engine} replay={replay} until={all ? Infinity : s.time} focus={filter !== 'all' && filter !== 'key' && filter !== 'util' ? filter : s.me}
        onJump={jump} search={recap.search} />}

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
          <thead><tr><th /><th title="Round grade, S+ (dominated the round) … F (a game-losing mistake). Hover a grade for why">Grade</th><th title="Total change in their team's win chance">Impact</th>
            {COUNTED.map(g => <th key={g} title={`${NOTE_INFO[g].label} moves`} style={{ color: NOTE_INFO[g].color }}>{NOTE_INFO[g].mark}</th>)}
          </tr></thead>
          <tbody>
            {Object.entries(players).sort(([a], [b]) => sideOf(a).localeCompare(sideOf(b)) || players[b].impact - players[a].impact).map(([id, p]) => (
              <tr key={id} className={filter === id ? 'sel' : ''} onClick={() => { setFilter(filter === id ? 'key' : id); if (filter !== id) setTab('moves'); }}>
                <td>
                  <b className={sideOf(id).toLowerCase()}>{names[id] ?? id}</b>
                  {finished && recap.roles[id] && <span className="role" title={recap.roles[id].note}>{recap.roles[id].role}</span>}
                </td>
                <td><Letter moves={seen.filter(m => m.player === id)} round={r} id={id} upTo={all ? Infinity : s.time} /></td>
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
              {main && <NoteMark m={main} />}
              <span className={atMoment ? '' : 'muted'}>{main && brief(main.title)}{cur.moves.length > 1 ? ` +${cur.moves.length - 1}` : ''}</span>
              {cur && <button className="mini" onClick={watch} title="Watch the 3 s leading up to it" aria-label="Watch the lead-up"><Icon name="rewind" size={12} /></button>}
            </>}
      </div>
      <button onClick={() => stepMoment(recap, 1)} disabled={last && time >= (list[list.length - 1]?.t ?? 0) + SHOW_AFTER - 0.05} title="Next moment (→)" aria-label="Next moment"><Icon name="next" /></button>
    </div>
  );
}

/** Annotations counted per player in the Players tab (book moves aren't counted). */
const COUNTED: Annotation[] = NOTES.filter(n => n !== 'book');

/** Impact and grade counts from the moves seen so far. */
function scoreboard(recap: Review, seen: Move[]) {
  const out: Review['players'] = {};
  for (const id of Object.keys(recap.players)) out[id] = { impact: 0, counts: { '!!': 0, '!': 0, book: 0, '?!': 0, '?': 0, '??': 0 } };
  for (const m of seen) if (out[m.player]) { if (m.kind !== 'position') out[m.player].impact += m.gain; out[m.player].counts[m.note]++; }
  return out;
}

const BUY_COLOR: Record<string, string> = { 'Full buy': TOK.good, 'Force buy': '#ffb020', 'Semi-eco': '#e58f2a', Eco: '#e5483a', 'Pistol round': '#a39b8f' };
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
  const g = moveLook(m);
  return (
    <>
      <div className="move-head">
        <span className="muted">{fmt(m.t)}</span>
        <NoteMark m={m} />
        <b className={m.side.toLowerCase()}>{m.title}</b>
        <span className="pct" style={{ color: m.gain > 0.02 ? '#7fbf4d' : m.gain < -0.02 ? '#e5483a' : 'var(--muted)' }}>{signed(m.gain)}</span>
      </div>
      {m.tags.length > 0 && <Tags tags={m.tags} />}
      {!compact && <div className="why">{`${g.label}. `}{m.why.join(' ')}</div>}
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

function Letter({ moves, round, id, upTo }: { moves: Move[]; round: DemoRound; id: string; upTo: number }) {
  const { letter, why } = roundGrade(moves, roundFacts(round, id, upTo));
  return <span className="letter" style={{ background: LETTER_COLOR[letter] }} title={`${letter}: ${why} (${LETTER_INFO[letter]})`}>{letter}</span>;
}

const USUAL_COLOR: Record<Usual, string> = { common: TOK.good, rare: '#f0c33c', unusual: '#e5483a', unknown: '#6e7886' };

/**
 * The search engine for one player this round: accuracy over the round as a line (a dot every 2 s, coloured by
 * class), and the moments where they gave up the most, each with the engine's best option.
 */
function EngineSection({ search, id, until, duration, onJump }: { search: RoundSearch; id: string; until: number; duration: number; onJump: (t: number) => void }) {
  const ms = search.moments.filter(m => m.player === id && m.t <= until);
  if (!ms.length) return null;
  const acc = ms.reduce((a, m) => a + m.accuracy, 0) / ms.length;
  const W = 300, Hh = 46, x = (t: number) => (t / Math.max(1, duration)) * W, y = (a: number) => Hh - 3 - (a / 100) * (Hh - 6);
  // the costliest, one per decision (the same grenade or move seen at two moments counts once)
  const worst = ms.filter(m => m.t >= OPENING && (m.cls === 'Inaccuracy' || m.cls === 'Mistake' || m.cls === 'Blunder')).sort((a, b) => b.loss - a.loss)
    .filter((m, i, xs) => !xs.slice(0, i).some(o => o.did.label === m.did.label && Math.abs(o.t - m.t) <= 4)).slice(0, 6).sort((a, b) => a.t - b.t);
  const counts = (['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'] as const).map(c => [c, ms.filter(m => m.cls === c).length] as const).filter(([, n]) => n);
  return (
    <div className="engine-sec">
      <div className="engine-head">
        <b>Engine</b>
        <span className="pos-acc" title="Every 2 s, what they did against the best option the engine calculated (100 = always the best). Level-10 players average about 88.">Accuracy <b className="num">{acc.toFixed(1)}</b></span>
        <span className="engine-counts">{counts.map(([c, n]) => <i key={c} style={{ color: SEARCH_COLOR[c] }} title={c}>{n} {c}</i>)}</span>
      </div>
      <svg className="engine-graph" viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" role="img" aria-label="Accuracy over the round">
        <polyline points={ms.map(m => `${x(m.t)},${y(m.accuracy)}`).join(' ')} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {ms.map(m => (
          <circle key={m.t} cx={x(m.t)} cy={y(m.accuracy)} r={2.2} fill={SEARCH_COLOR[m.cls]} onClick={() => onJump(m.t)} style={{ cursor: 'pointer' }}>
            <title>{`${fmt(m.t)} ${m.cls}: ${m.did.label} (best: ${m.options[0].label})`}</title>
          </circle>
        ))}
      </svg>
      {worst.length > 0 && (
        <ol className="pos-list engine-list">
          {worst.map(m => (
            <li key={m.t} className="pos-row" onClick={() => onJump(m.t)} title="Watch it (turn on Engine lines to see both on the map)">
              <div className="pos-top">
                <span className="muted num">{fmt(m.t)}</span>
                <b>{m.did.label}</b>
                <span className="usual" style={{ color: SEARCH_COLOR[m.cls], borderColor: SEARCH_COLOR[m.cls] }}>{m.cls} −{(m.cost * 100).toFixed(1)}%</span>
              </div>
              <p>Best: <b style={{ color: SEARCH_COLOR.Best }}>{m.options[0].label}</b>{m.options[0].death < m.did.death - 0.1 ? ` (${Math.round(m.options[0].death * 100)}% to die instead of ${Math.round(m.did.death * 100)}%)` : ''}. Then: {m.options.slice(1, 3).map(o => o.label).join(', ')}.</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Positions tab: one player's decisions this round (where they held, where they moved and why), each next to what
 * FACEIT level-10 players do in the same situation.
 */
function Positions({ engine, replay, until, focus, onJump, search }: { engine: TacticalEngine; replay: Replay; until: number; focus: string | null; onJump: (t: number) => void; search?: RoundSearch }) {
  const ids = replay.board.players.map(p => p.id);
  const [who, setWho] = useState<string | null>(null);
  const id = who && ids.includes(who) ? who : focus && ids.includes(focus) ? focus : ids[0];
  const dec = useMemo(() => roundDecisions(engine, replay.round), [engine, replay.round]);
  const known = !!proPositions(engine.map.id);
  const rows = [
    ...dec.holds.filter(h => h.player === id && h.from <= until && isDecision(h)).map(h => ({ t: h.from, kind: 'hold' as const, h, v: judgeHold(engine.map.id, h), e: engineHold(engine.map.id, h) })),
    ...dec.moves.filter(m => m.player === id && m.t <= until && isDecision({ place: m.from, from: m.t })).map(m => ({ t: m.t, kind: 'move' as const, m, v: judgeMove(engine.map.id, m), e: engineMove(engine.map.id, m) })),
  ].sort((a, b) => a.t - b.t);
  const side = replay.board.players.find(p => p.id === id)?.side ?? 'CT';
  return (
    <section className="positions">
      <div className="pos-head">
        <select value={id} onChange={e => setWho(e.target.value)} title="Whose decisions">
          {ids.map(x => <option key={x} value={x}>{replay.names[x] ?? x}</option>)}
        </select>
        <span className={`muted ${side.toLowerCase()}`}>{side}</span>
      </div>
      {search && <EngineSection search={search} id={id} until={until} duration={replay.round.duration} onJump={onJump} />}
      {(() => { const t = roundAnalysis(engine.map.id, id, dec, until); return t ? <p className="pos-summary">{t}</p> : null; })()}
      {!known && <p className="muted">No level-10 positions for {engine.map.name} yet: run <code>npm run learn:positions</code> on demos of this map.</p>}
      {rows.length === 0 && <p className="muted">No decisions yet this round.</p>}
      <ol className="pos-list">
        {rows.map((r, i) => (
          <li key={i} className="pos-row" onClick={() => onJump(r.t + 1.5)} title="Watch it">
            <div className="pos-top">
              <span className="muted num">{fmt(r.t)}</span>
              <b>{r.kind === 'hold' ? `${r.h.contact ? 'Fought at' : 'Held'} ${r.h.place}` : `${r.m.from} → ${r.m.to}`}</b>
              {r.kind === 'hold' && !r.h.contact && <span className="muted num">{Math.round(r.h.to - r.h.from)} s</span>}
              {/* how common the choice is among level-10 players; the engine's grades (Best … Blunder) are only the search's, above */}
              <span className="usual" style={{ color: USUAL_COLOR[r.v.kind], borderColor: USUAL_COLOR[r.v.kind] }} title={r.v.basis}>{USUAL_LABEL[r.v.kind]}</span>
            </div>
            {r.e && (
              <div className="pos-engine">
                <span>{engineLine(r.e, r.kind, r.kind === 'hold' ? r.h.place : r.m.to)}</span>
                <span className="pos-cands">
                  {r.e.candidates.slice(0, 4).map(c => (
                    <i key={c.place} className={c.place === r.e!.best!.place ? 'best' : ''} title={`${Math.round(c.share * 100)}% of level-10 players, measured on ${c.n}`}>
                      {c.place} <b className="num">{c.gain >= 0 ? '+' : '−'}{Math.abs(Math.round(c.gain * 1000) / 10)}%</b>
                    </i>
                  ))}
                </span>
                {r.e.next.length > 0 && <span className="muted">Next, level-10 players go: {r.e.next.map(c => `${c.place} ${Math.round(c.share * 100)}%`).join(', ')}</span>}
              </div>
            )}
            <p>{r.v.text}</p>
          </li>
        ))}
      </ol>
      <p className="muted">Compared with {known ? `${proPositions(engine.map.id)!.demos} FACEIT level-10 matches on this map` : 'level-10 players'}, in the same part of the round and with the same numbers alive. Click a row to watch it.</p>
    </section>
  );
}
