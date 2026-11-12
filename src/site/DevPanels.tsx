import { useEffect, useState } from 'react';
import REMARKS from '../engine/coach-remarks.json';
import { rageLine, setRageOverride } from '../engine/rage';
import type { Move } from '../engine/recap';
import { type CoachEval, type LogEntry, type SiteConfig } from '../../worker/src/site';
import { Icon } from '../ui/Icon';
import { Loading } from '../ui/Loading';
import { setSiteConfig } from '../ui/siteConfig';
import { steamFetch } from '../ui/steamApi';
import { SplitChart } from './charts';
import { fmtDate } from './format';

/**
 * The dev page's control panel (spec §11), talking to the Worker's /admin/* (worker/src/site.ts): Users, Content (the
 * site's config, live without a deploy), Settings (secrets present or missing), Log (every change, with Undo), the
 * bots' pause switch and the coach's nightly checks.
 */
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await steamFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) throw new Error(out.error ?? `The Worker answered ${res.status} (deploy it: npx wrangler deploy in worker/).`);
  return out as T;
}
const when = (ms: number) => `${fmtDate(ms)}, ${new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null), [err, setErr] = useState<string | null>(null);
  const reload = () => api<T>(path).then(d => { setData(d); setErr(null); }, e => setErr(e.message));
  useEffect(() => { void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload, setData };
}

// ---- Users ---------------------------------------------------------------------------------------------------------

interface UserRow { steamId: string; name: string | null; matches: number; lastSeen: number; public: boolean; puzzles: number; banned: boolean }
export function DevUsers() {
  const [q, setQ] = useState(''), [ask, setAsk] = useState('');
  const { data, err, reload } = useLoad<{ rows: UserRow[]; total: number }>(`/admin/users?q=${encodeURIComponent(ask)}`, [ask]);
  const [msg, setMsg] = useState<string | null>(null);
  const del = async (u: UserRow) => {
    try { await api('/admin/user/delete', { steamId: u.steamId }); setMsg(`Deleted ${u.name ?? u.steamId}. Undo in Log (7 days).`); void reload(); } catch (e) { setMsg((e as Error).message); }
  };
  const ban = async (u: UserRow) => {
    const { config } = await api<{ config: SiteConfig }>('/admin/config');
    const banned = u.banned ? config.banned.filter(x => x !== u.steamId) : [...config.banned, u.steamId];
    await api(`/admin/config?what=${encodeURIComponent(`${u.banned ? 'Back on' : 'Off'} the leaderboard: ${u.steamId}`)}`, { banned });
    void reload();
  };
  return (
    <section className="site-card">
      <div className="card-head"><h2>Users</h2>{data && <span className="muted small">{data.total} with a profile · newest first</span>}</div>
      <form className="dev-search" onSubmit={e => { e.preventDefault(); setAsk(q); }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="SteamID or in-game name" aria-label="Find a player" />
        <button className="cta small-btn">Find</button>
      </form>
      {msg && <p className="muted small">{msg}</p>}
      {err ? <p className="warn-text small">{err}</p> : !data ? <Loading>Loading players…</Loading> : !data.rows.length ? <p className="muted">Nobody found.</p> : (
        <div className="dev-table-wrap"><table className="site-table sticky">
          <thead><tr><th>Player</th><th>Matches</th><th>Puzzles</th><th>Last match</th><th>Public</th><th /></tr></thead>
          <tbody>{data.rows.map(u => (
            <tr key={u.steamId}>
              <td><a href={`https://steamcommunity.com/profiles/${u.steamId}`} target="_blank" rel="noreferrer">{u.name ?? u.steamId}</a>{u.banned && <span className="chip small">off board</span>}</td>
              <td className="num">{u.matches}</td><td className="num">{u.puzzles}</td><td className="num">{u.lastSeen ? fmtDate(u.lastSeen) : '–'}</td><td>{u.public ? 'Yes' : 'No'}</td>
              <td className="dev-row-actions"><button className="ghost small-btn" onClick={() => void ban(u)}>{u.banned ? 'Back on board' : 'Off leaderboard'}</button><button className="ghost small-btn danger" onClick={() => void del(u)}>Delete data</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

// ---- Content -------------------------------------------------------------------------------------------------------

const PAGE_NAMES = ['home', 'cs2', 'deadlock', 'puzzles', 'profile', 'pricing', 'settings'];
export function DevContent() {
  const { data, err, setData } = useLoad<{ config: SiteConfig }>('/admin/config');
  const [draft, setDraft] = useState<SiteConfig | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (data) setDraft(data.config); }, [data]);
  if (err) return <section className="site-card"><p className="warn-text small">{err}</p></section>;
  if (!draft) return <Loading>Loading the site's config…</Loading>;
  const c = draft, set = (p: Partial<SiteConfig>) => setDraft({ ...c, ...p });
  const save = async (what: string, patch: Partial<SiteConfig>) => {
    try {
      const { config } = await api<{ config: SiteConfig }>(`/admin/config?what=${encodeURIComponent(what)}`, patch);
      setData({ config }); setSiteConfig(config); setSaved(`${what}: live for everyone within a minute.`);
    } catch (e) { setSaved((e as Error).message); }
  };
  const lines = (s: string[]) => s.join('\n'), unlines = (s: string) => s.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  return (
    <>
      {saved && <p className="muted small dev-saved"><Icon name="check" size={13} /> {saved}</p>}
      <section className="site-card">
        <div className="card-head"><h2>Announcement</h2></div>
        <label className="dev-field"><span>Text</span><input value={c.banner.text} maxLength={200} onChange={e => set({ banner: { ...c.banner, text: e.target.value } })} /></label>
        <label className="dev-field"><span>Link (optional)</span><input value={c.banner.link} placeholder="/changelog or https://…" onChange={e => set({ banner: { ...c.banner, link: e.target.value } })} /></label>
        <label className="dev-field"><span>Until (optional)</span><input type="date" value={c.banner.until ? new Date(c.banner.until).toISOString().slice(0, 10) : ''} onChange={e => set({ banner: { ...c.banner, until: e.target.value ? Date.parse(`${e.target.value}T23:59:59Z`) : null } })} /></label>
        <div className="dev-actions">
          <label className="dev-check-row"><input type="checkbox" checked={c.banner.on} onChange={e => set({ banner: { ...c.banner, on: e.target.checked } })} /> Show it</label>
          <button className="cta primary small-btn" onClick={() => void save('Announcement', { banner: c.banner })}>Save</button>
        </div>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>Switches</h2></div>
        {([['rage', 'Rage mode', 'Off hides the switch and every Rage line'], ['proEarlyAccess', 'Pro early access', 'Pro free for everyone (the site; the Worker\'s PRO_FOR_ALL decides on its side)'], ['puzzlesBoard', 'Puzzle leaderboards', 'Off hides the Leaderboard tab']] as const).map(([k, label, tip]) => (
          <label key={k} className="dev-check-row" title={tip}><input type="checkbox" checked={c.flags[k]} onChange={e => set({ flags: { ...c.flags, [k]: e.target.checked } })} /> {label} <span className="muted small">{tip}</span></label>
        ))}
        <label className="dev-field"><span>"Coming soon" on the front page (empty: none)</span><input value={c.flags.comingSoon} maxLength={40} placeholder="e.g. Dota 2" onChange={e => set({ flags: { ...c.flags, comingSoon: e.target.value } })} /></label>
        <div className="dev-field"><span>Back in a moment (pages taken down; you still see them)</span>
          <div className="chips">{PAGE_NAMES.map(p => <button key={p} className={`chip ${c.maintenance.includes(p) ? 'on' : ''}`} aria-pressed={c.maintenance.includes(p)}
            onClick={() => set({ maintenance: c.maintenance.includes(p) ? c.maintenance.filter(x => x !== p) : [...c.maintenance, p] })}>{p}</button>)}</div>
        </div>
        <div className="dev-actions"><button className="cta primary small-btn" onClick={() => void save('Switches', { flags: c.flags, maintenance: c.maintenance })}>Save</button></div>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>Samples and the daily puzzle</h2></div>
        <label className="dev-field"><span>CS2 sample (a file in public/samples)</span><input value={c.samples.cs2} onChange={e => set({ samples: { ...c.samples, cs2: e.target.value } })} /></label>
        <label className="dev-field"><span>Deadlock sample (match ID)</span><input inputMode="numeric" value={c.samples.deadlock} onChange={e => set({ samples: { ...c.samples, deadlock: +e.target.value || 0 } })} /></label>
        <label className="dev-field"><span>Pin today's daily (puzzle ID, empty: the usual pick)</span><input value={c.puzzles.pin} onChange={e => set({ puzzles: { ...c.puzzles, pin: e.target.value } })} /></label>
        <label className="dev-field"><span>Never as the daily (IDs, one a line)</span><textarea rows={2} value={lines(c.puzzles.skip)} onChange={e => set({ puzzles: { ...c.puzzles, skip: unlines(e.target.value) } })} /></label>
        <label className="dev-field"><span>Hidden everywhere (IDs, one a line)</span><textarea rows={2} value={lines(c.puzzles.hide)} onChange={e => set({ puzzles: { ...c.puzzles, hide: unlines(e.target.value) } })} /></label>
        <div className="dev-actions"><button className="cta primary small-btn" onClick={() => void save('Samples and the daily puzzle', { samples: c.samples, puzzles: c.puzzles })}>Save</button></div>
      </section>

      <RageEditor config={c} onSave={rage => void save('Rage lines', { rage })} />

      <section className="site-card">
        <div className="card-head"><h2>Hints</h2><span className="muted small">version {c.hintsVersion}</span></div>
        <p className="muted small">Everyone sees the welcome card and the one-line hints once more on their next visit.</p>
        <div className="dev-actions"><button className="cta small-btn" onClick={() => void save('Hints shown again to everyone', { hintsVersion: c.hintsVersion + 1 })}>Show the hints to everyone again</button></div>
      </section>
    </>
  );
}

type RageKind = { when: string; chance: number; lines: ({ text: string; weight: number } | string)[] };
/** Rage lines per situation: chance and weighted lines over coach-remarks.json, with a preview on a sample card. */
function RageEditor({ config, onSave }: { config: SiteConfig; onSave: (rage: SiteConfig['rage']) => void }) {
  const kinds = REMARKS.rage.moves as Record<string, RageKind>;
  const [k, setK] = useState(Object.keys(kinds)[0]);
  const base = kinds[k], over = config.rage[k];
  const [chance, setChance] = useState(over?.chance ?? base.chance);
  const [text, setText] = useState('');
  useEffect(() => {
    const o = config.rage[k], b = kinds[k];
    setChance(o?.chance ?? b.chance);
    setText((o?.lines ?? b.lines.map(l => (typeof l === 'string' ? { text: l, weight: 2 } : l))).map(l => `${l.weight} ${l.text}`).join('\n'));
  }, [k, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = text.split('\n').map(l => l.match(/^\s*([0-3])\s+(.+)$/) ?? [null, '2', l.trim()]).filter(m => m[2]).map(m => ({ weight: +m[1]!, text: m[2]!.trim() }));
  // the preview: a few made-up moves of this situation, with the lines as they'd be after saving
  const preview = (() => {
    setRageOverride({ ...config.rage, [k]: { chance: 1, lines: parsed } });
    const tag = TAG_FOR[k];
    const out = [0, 1, 2].map(i => rageLine({ t: 10 + i * 7.3, player: String(i), side: 'CT', kind: KIND_FOR[k] ?? 'death', gain: -0.2, note: NOTE_FOR[k] ?? '?', title: '', why: [], tags: tag ? [tag] : [] } as unknown as Move, 'full'));
    setRageOverride(config.rage);
    return out;
  })();
  return (
    <section className="site-card">
      <div className="card-head"><h2>Rage lines</h2><span className="muted small">over coach-remarks.json · weight 1 rare, 2 normal, 3 common</span></div>
      <label className="dev-field"><span>Situation</span>
        <select value={k} onChange={e => setK(e.target.value)}>{Object.entries(kinds).map(([id, v]) => <option key={id} value={id}>{id}{config.rage[id] ? ' (changed)' : ''} — {v.when}</option>)}</select>
      </label>
      <label className="dev-field"><span>Chance: {Math.round(chance * 100)}% of these cards get a line</span><input type="range" min={0} max={1} step={0.05} value={chance} onChange={e => setChance(+e.target.value)} /></label>
      <label className="dev-field"><span>Lines (weight, space, text; one a line)</span><textarea rows={6} value={text} onChange={e => setText(e.target.value)} /></label>
      <div className="dev-rage-preview"><b>On a card:</b>{preview.map((l, i) => <div key={i} className="feed-rage">{l ?? '(no line)'}</div>)}</div>
      <div className="dev-actions">
        {config.rage[k] && <button className="ghost small-btn" onClick={() => { const r = { ...config.rage }; delete r[k]; onSave(r); }}>Back to the file's lines</button>}
        <button className="cta primary small-btn" onClick={() => onSave({ ...config.rage, [k]: { chance, lines: parsed } })}>Save</button>
      </div>
    </section>
  );
}
/** A tag / kind / grade that picks each situation, for the preview cards. */
const TAG_FOR: Record<string, string> = { teamKill: 'TEAM KILL', teamFlashDied: 'TEAM FLASH', teamFlash: 'TEAM FLASH', ecoDeath: 'ECO DEATH', noTrade: 'NO TRADE', lostToBlind: 'BLIND SHOT', knifeOut: 'KNIFE OUT', whiff: 'WHIFF', awpLost: 'AWP LOST', unusedUtil: 'UNUSED UTIL', dryPeek: 'DRY PEEK', lowHp: 'LOW HP', loud: 'LOUD', movingShot: 'MOVING SHOT', noAmmo: 'NO AMMO', openingDeath: 'OPENING', isolated: 'ISOLATED', wallbanged: 'WALLBANG', smokeSprayed: 'THROUGH SMOKE', wasted: 'WASTED', lateRotation: 'LATE ROTATION', overRotation: 'OVER-ROTATION', wallbang: 'WALLBANG', smokeKill: 'THROUGH SMOKE' };
const KIND_FOR: Record<string, string> = { badPosition: 'position', inaccuracy: 'position', wallbang: 'kill', smokeKill: 'kill', brilliant: 'kill', good: 'kill', teamFlashDied: 'flash', teamFlash: 'flash', wasted: 'flash' };
const NOTE_FOR: Record<string, string> = { teamFlashDied: '??', badPosition: '??', inaccuracy: '?!', brilliant: '!!', good: '!', blunder: '??', wallbang: '!', smokeKill: '!' };

// ---- Settings, Log, Bots, Coach --------------------------------------------------------------------------------------

export function DevSettings() {
  const { data, err } = useLoad<{ secrets: Record<string, boolean>; owners: string[]; origins: string[]; proForAll: boolean; rateLimits: boolean }>('/admin/health');
  return (
    <section className="site-card">
      <div className="card-head"><h2>Worker</h2><span className="muted small">present or missing, never the values</span></div>
      {err ? <p className="warn-text small">{err}</p> : !data ? <Loading>Checking…</Loading> : (
        <table className="site-table"><tbody>
          {Object.entries(data.secrets).map(([k, on]) => <tr key={k}><td className="num">{k}</td><td className={on ? 'up' : 'down'}>{on ? 'set' : 'missing'}</td></tr>)}
          <tr><td>Owners</td><td className="num">{data.owners.map(o => `…${o.slice(-4)}`).join(', ') || 'none'}</td></tr>
          <tr><td>Site addresses</td><td>{data.origins.join(', ')}</td></tr>
          <tr><td>Pro for everyone (Worker)</td><td>{data.proForAll ? 'yes' : 'no'}</td></tr>
          <tr><td>Rate limits</td><td className={data.rateLimits ? 'up' : 'down'}>{data.rateLimits ? 'on' : 'off'}</td></tr>
        </tbody></table>
      )}
    </section>
  );
}

export function DevLog() {
  const { data, err, reload } = useLoad<{ rows: LogEntry[] }>('/admin/log');
  const [msg, setMsg] = useState<string | null>(null);
  const undo = async (at: number) => {
    try { const out = await api<{ config?: SiteConfig }>('/admin/undo', { at }); if (out.config) setSiteConfig(out.config); setMsg('Undone.'); void reload(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="site-card">
      <div className="card-head"><h2>Log</h2><span className="muted small">every change made here, newest first</span></div>
      {msg && <p className="muted small">{msg}</p>}
      {err ? <p className="warn-text small">{err}</p> : !data ? <Loading>Loading…</Loading> : !data.rows.length ? <p className="muted">No changes yet.</p> : (
        <div className="dev-table-wrap"><table className="site-table sticky">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th /></tr></thead>
          <tbody>{data.rows.map(r => (
            <tr key={r.at} className={r.undone ? 'muted' : ''}><td className="num">{when(r.at)}</td><td className="num">…{r.who.slice(-4)}</td><td>{r.what}{r.undone ? ' (undone)' : ''}</td>
              <td>{!r.undone && !r.what.startsWith('Undid') && (r.before || r.what.startsWith('Deleted user')) && <button className="ghost small-btn" onClick={() => void undo(r.at)}><Icon name="undo" size={12} /> Undo</button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

/** Pause the bots (each run asks the Worker first and stops while paused). */
export function BotSwitch() {
  const { data, err, setData } = useLoad<{ paused: boolean }>('/admin/bots');
  const flip = async () => { try { setData(await api<{ paused: boolean }>('/admin/bots', { paused: !data?.paused })); } catch { /* shown below */ } };
  return (
    <section className="site-card">
      <div className="card-head"><h2>Bots</h2><span className="muted small">CS2 and Deadlock, every 15 min on GitHub Actions</span></div>
      {err ? <p className="warn-text small">{err}</p> : !data ? <Loading>Checking…</Loading> : (
        <div className="dev-actions">
          <span className={`dev-check ${data.paused ? 'warn' : 'ok'}`}><i />{data.paused ? 'Paused' : 'Running'}</span>
          <button className="cta small-btn" onClick={() => void flip()}>{data.paused ? 'Start the bots again' : 'Pause the bots'}</button>
        </div>
      )}
    </section>
  );
}

/** The nightly check: how often the coach agrees with your rulings, run after run; and "Check now". */
export function CoachChecks() {
  const { data, err, reload } = useLoad<{ rows: CoachEval[] }>('/admin/coach');
  const [msg, setMsg] = useState<string | null>(null);
  const now = async () => { try { const { result } = await api<{ result: string }>('/admin/coach/check', {}); setMsg(result === 'started' ? 'Started: the result shows here in about 5 minutes.' : `GitHub said: ${result}`); } catch (e) { setMsg((e as Error).message); } };
  const rows = [...(data?.rows ?? [])].filter(r => r.total > 0).reverse();
  const last = rows.at(-1);
  return (
    <section className="site-card">
      <div className="card-head"><h2>Coach vs your rulings</h2><span className="muted small">every night on GitHub Actions (coach-check.yml)</span>
        <button className="cta small-btn" onClick={() => void now()}>Check now</button><button className="ghost small-btn" onClick={() => void reload()}>Refresh</button></div>
      {msg && <p className="muted small">{msg}</p>}
      {err ? <p className="warn-text small">{err}</p> : !data ? <Loading>Loading…</Loading> : !last ? <p className="muted">No check yet: the first runs tonight, or press Check now.</p> : (
        <>
          <p><b className="num">{last.right} of {last.total}</b> ({Math.round((100 * last.right) / last.total)}%) on {fmtDate(last.at)}{last.sha && <span className="muted small"> · {last.sha}</span>}</p>
          <SplitChart caption="Agreement with your rulings over the checks" base={80} top={100} bottom={0} colors={['var(--good)', 'var(--bad)']}
            points={rows.map((r, i) => ({ t: i, v: (100 * r.right) / r.total }))} fmt={v => `${Math.round(v)}%`} xfmt={i => fmtDate(rows[Math.round(i)]?.at ?? 0)} height={140} />
        </>
      )}
      <p className="muted small">Retraining needs the training demos on your PC: npm run learn:all. The check above runs on every change and every night; a model that agrees less shows here first.</p>
    </section>
  );
}


/** Puzzle quality: answers served and how often right, overall and the hardest / easiest; the set's rule checks. */
export function PuzzleQuality() {
  const { data, err, reload } = useLoad<{ rows: { id: string; tried: number; right: number; skipped?: number }[]; reports?: { id: string; why: string; pick: string; at: number }[] }>('/admin/puzzles');
  const [hidden, setHidden] = useState<string[]>([]);
  const hide = async (id: string) => {
    const { config } = await api<{ config: SiteConfig }>('/admin/config');
    if (config.puzzles.hide.includes(id)) return;
    const out = await api<{ config: SiteConfig }>(`/admin/config?what=${encodeURIComponent(`Hid puzzle ${id}`)}`, { puzzles: { ...config.puzzles, hide: [...config.puzzles.hide, id] } });
    setSiteConfig(out.config); setHidden(h => [...h, id]); void reload();
  };
  const [set, setSet] = useState<{ n: number; ties: number; plants: number; sameRound: number } | null>(null);
  useEffect(() => {
    Promise.all([import('../moments/generated/puzzles.json'), import('../moments/quality'), import('../moments/moments')]).then(([j, q, mm]) => {
      const d = j.default as { cs2: unknown[]; deadlock: unknown[] };
      const all = [...d.cs2, ...d.deadlock].map(mm.cleanMoment).filter((m): m is NonNullable<typeof m> => !!m);
      const shaped = q.shapeSet(all);
      const ties = shaped.filter(m => { const v = m.options.map(o => o.value).sort((a, b) => b - a); return v.some((x, i) => i > 0 && v[i - 1] - x < (m.game === 'deadlock' ? 0.015 : q.RULES.apart)); }).length;
      const plants = shaped.filter(m => q.ideaOf(m.options[0].label) === 'plant').length;
      setSet({ n: shaped.length, ties, plants, sameRound: all.length - shaped.length });
    }).catch(() => {});
  }, []);
  const rows = data?.rows ?? [], tried = rows.reduce((a, r) => a + r.tried, 0), right = rows.reduce((a, r) => a + r.right, 0);
  const rated = rows.filter(r => r.tried >= 10).map(r => ({ ...r, share: r.right / r.tried })).sort((a, b) => a.share - b.share);
  return (
    <section className="site-card">
      <div className="card-head"><h2>Puzzle quality</h2><span className="muted small">answers the Worker counted · the set's rule checks</span></div>
      {err ? <p className="warn-text small">{err}</p> : !data ? <Loading>Counting…</Loading> : (
        <div className="kpi-strip">
          <div className="kpi-tile"><span>Answers</span><b className="num">{tried.toLocaleString('en-US')}</b><em className="muted">{rows.length} puzzles</em></div>
          <div className="kpi-tile"><span>Right</span><b className="num">{tried ? Math.round((100 * right) / tried) : 0}%</b><em className="muted">of all answers</em></div>
          {set && <div className="kpi-tile"><span>Tied answers</span><b className={`num ${set.ties ? 'down' : 'up'}`}>{set.ties}</b><em className="muted">target 0 · {set.n} puzzles live</em></div>}
          {set && <div className="kpi-tile"><span>Plant puzzles</span><b className="num">{set.plants}</b><em className="muted">at most a fifth · {set.sameRound} cut by the rules</em></div>}
        </div>
      )}
      {rated.length > 0 && (
        <table className="site-table"><thead><tr><th>Hardest (10+ answers)</th><th>Right</th></tr></thead><tbody>
          {rated.slice(0, 5).map(r => <tr key={r.id}><td className="num">{r.id.slice(0, 48)}</td><td className="num">{Math.round(r.share * 100)}% of {r.tried}</td></tr>)}
        </tbody></table>
      )}
      {rows.some(r => r.skipped) && (
        <table className="site-table"><thead><tr><th>Most skipped</th><th>Skips</th><th /></tr></thead><tbody>
          {[...rows].filter(r => r.skipped).sort((a, b) => (b.skipped ?? 0) - (a.skipped ?? 0)).slice(0, 5).map(r => <tr key={r.id}><td className="num">{r.id.slice(0, 48)}</td><td className="num">{r.skipped}</td>
            <td>{hidden.includes(r.id) ? 'hidden' : <button className="ghost small-btn" onClick={() => void hide(r.id)}>Hide</button>}</td></tr>)}
        </tbody></table>
      )}
      <h3 className="dev-h">Reported answers</h3>
      {!data?.reports?.length ? <p className="muted small">No reports yet.</p> : (
        <table className="site-table"><thead><tr><th>When</th><th>Puzzle</th><th>Why</th><th>They picked</th><th /></tr></thead><tbody>
          {data.reports.slice(0, 30).map(r => <tr key={r.at}><td className="num">{when(r.at)}</td><td className="num">{r.id.slice(0, 40)}</td><td>{r.why}</td><td>{r.pick}</td>
            <td>{hidden.includes(r.id) ? 'hidden' : <button className="ghost small-btn" onClick={() => void hide(r.id)}>Hide</button>}</td></tr>)}
        </tbody></table>
      )}
    </section>
  );
}

/** Status pills from the site's own sampled numbers: recap grading time (p50 / p95) and client errors in the last 24 h. */
export function TelemetryPills() {
  const { data, err } = useLoad<{ grading: { n: number; p50: number | null; p95: number | null }; errors: { n: number; recent: { msg: string; page: string; at: number }[] } }>('/admin/telemetry');
  if (err) return <p className="warn-text small">{err}</p>;
  if (!data) return null;
  const s = (ms: number | null) => (ms === null ? '–' : `${Math.round(ms / 1000)} s`);
  return (
    <section className="site-card">
      <div className="card-head"><h2>The site, last 24 h</h2><span className="muted small">sampled: a quarter of the gradings, 3 errors a visit at most</span></div>
      <div className="dev-checks">
        <span className={`dev-check ${data.grading.p50 === null ? 'off' : data.grading.p50 < 60000 ? 'ok' : 'warn'}`} title="Time to grade a whole match (target: p50 under 60 s)"><i />Recap grading<b>p50 {s(data.grading.p50)} · p95 {s(data.grading.p95)} · {data.grading.n} sampled</b></span>
        <span className={`dev-check ${data.errors.n ? 'warn' : 'ok'}`}><i />Client errors<b>{data.errors.n}</b></span>
      </div>
      {data.errors.recent.length > 0 && (
        <table className="site-table"><tbody>{data.errors.recent.map((e, i) => <tr key={i}><td className="num">{when(e.at)}</td><td className="num">{e.page}</td><td>{e.msg}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}
