import { useEffect, useState } from 'react';
import { API_URL, BUILD, ONLINE, STEAM_AVAILABLE } from '../env';
import { COACH_MODEL, PRO_MODEL } from '../engine/coachModels';
import { FREE_HISTORY, MAX_HISTORY, PRO_EARLY_ACCESS } from '../engine/profile';
import analyst from '../engine/models/analyst.json';
import analystPro from '../engine/models/analyst-pro.json';
import duel from '../engine/models/duel.json';
import level from '../engine/models/level.json';
import play from '../engine/models/play.json';
import search from '../engine/models/search-calibration.json';
import coachEval from '../engine/models/eval.json';
import utilSpots from '../map/generated/util-spots.json';
import { useStore, whoAmI } from '../store';
import { Icon, type IconName } from '../ui/Icon';
import { useProfile } from '../ui/profileApi';
import { steamFetch } from '../ui/steamApi';
import { fmtDate, fmtInt, mapName } from './format';
import { AreaChart, BarList, Donut, Gauge } from './charts';
import { T } from '../ui/tokens';
import { DevDisputes } from './DevDisputes';

/** What the Worker counts for the owner (worker/src/admin.ts). */
interface AdminStats {
  at: number;
  keys: { users: number; profiles: number; sessions: number; demos: number };
  profiles: { count: number; read: number; matches: number; public: number; notifyPro: number; notifyGames?: Record<string, number>; withGoals: number; lastMatchAt: number;
    goals: Record<string, number>; maps: Record<string, number>; results: Record<string, number>; top: { steamId: string; matches: number; lastAt: number }[];
    /** Newer Workers only (the dev page copes without them). */
    weeks?: Record<string, number>; levels?: Record<string, number>; engine?: number | null };
  lists: { count: number; read: number; withCodes: number; matches: number; parsed: number; pending: number; gone: number; failing: number; lastSyncAt: number;
    errors: { steamId: string; outcomeId: string; error: string; at: number }[]; notes: { steamId: string; note: string }[] };
  bot: { at: number; users: number; handled: number; ready: number; failed: number; gone: number; cycleMs: number; grading: boolean; version: string | null } | null;
}

const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const ago = (ms: number) => (!ms ? 'never' : `${fmtDate(ms)}${Date.now() - ms < 86400000 ? `, ${new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`);

/**
 * The owner's dev page (#/dev): the build, the coach's models, everything the Worker counts and this browser's
 * storage. Only the owner (OWNER_IDS in worker/wrangler.toml) gets the server numbers; the page itself hides from
 * everyone else (and is open on a local copy, where there's nothing private to show).
 */
export function Dev() {
  const { me, remote, loaded, data } = useProfile();
  const s = useStore();
  const allowed = LOCAL || !!me?.owner;
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await steamFetch('/admin/stats');
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `The Worker answered ${res.status}.`);
      setStats(out);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  useEffect(() => { if (me?.owner && remote) load(); }, [me?.owner, remote]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState<DevTab>(() => { try { const t = localStorage.getItem('stratboard.devTab') as DevTab | null; return t && DEV_TABS.some(x => x.id === t) ? t : 'users'; } catch { return 'users'; } });
  const pickTab = (t: DevTab) => { setTab(t); try { localStorage.setItem('stratboard.devTab', t); } catch { /* private mode */ } };

  if (!loaded && !LOCAL) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!allowed) return <div className="page"><h1>Not found</h1><p className="muted">There's nothing here. <a href="#/">Go home</a></p></div>;

  const storage = (() => {
    const rows: { key: string; size: number }[] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; rows.push({ key: k, size: (localStorage.getItem(k) ?? '').length }); } } catch { /* no storage */ }
    return rows.sort((a, b) => b.size - a.size);
  })();
  const maps = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${mapName(m)} ${n}`).join(' · ') || '–';

  const e = coachEval as CoachEval;
  const w = e.winChance, v = e.verdicts, du = e.duels, hist = e.history ?? [];
  const sources = COACH_MODEL.source?.packs ?? {};
  const owner = !!me?.owner && remote;
  const lastWeek = stats?.profiles.weeks ? Object.entries(stats.profiles.weeks).sort((a, b) => a[0].localeCompare(b[0])).at(-1)?.[1] ?? 0 : null;
  const botOk = !!stats?.bot && Date.now() - stats.bot.at < 30 * 60000;
  const builtAgo = BUILD.time ? Date.now() - Date.parse(BUILD.time) : null;
  // the health line: one check per moving part, green / amber / red
  const checks: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'off'; tip: string }[] = [
    { label: 'Build', value: `${BUILD.commit}${builtAgo !== null ? ` · ${builtAgo < 3600000 ? `${Math.round(builtAgo / 60000)} min` : builtAgo < 86400000 ? `${Math.round(builtAgo / 3600000)} h` : `${Math.round(builtAgo / 86400000)} d`} ago` : ''}`, tone: 'ok', tip: ONLINE ? 'The website build' : 'Local dev server' },
    { label: 'Worker', value: !owner ? 'log in as owner' : err ? 'error' : !stats ? 'counting…' : stats.profiles.weeks ? 'up to date' : 'old: redeploy', tone: !owner ? 'off' : err ? 'bad' : !stats ? 'off' : stats.profiles.weeks ? 'ok' : 'warn', tip: err ?? 'Profiles, Steam and the owner stats (npx wrangler deploy in worker/)' },
    { label: 'Demo bot', value: !stats ? '–' : stats.bot ? (botOk ? `ran ${ago(stats.bot.at)}` : `last ${ago(stats.bot.at)}`) : 'not set up', tone: !stats ? 'off' : stats.bot ? (botOk ? 'ok' : 'warn') : 'off', tip: 'Downloads and reads new matches for users who pasted their codes (server/README.md)' },
    { label: 'Failing demos', value: !stats ? '–' : String(stats.lists.failing), tone: !stats ? 'off' : stats.lists.failing ? 'warn' : 'ok', tip: 'Matches the bot tried 3 times and couldn\'t read' },
    { label: 'Coach', value: v ? `agrees ${v.right}/${v.total}` : 'not measured', tone: v ? (v.right / Math.max(1, v.total) >= 0.8 ? 'ok' : 'warn') : 'off', tip: 'Agreement with your own verdicts (npm run eval:coach)' },
  ];
  const kpis: [string, string, string?][] = [
    ['Accounts', stats ? fmtInt(stats.keys.profiles) : '–', 'with a profile'],
    ['Matches reviewed', stats ? fmtInt(stats.profiles.matches) : '–', 'on all profiles'],
    ['This week', lastWeek !== null ? fmtInt(lastWeek) : '–', 'matches played'],
    ['Want Pro', stats ? fmtInt(stats.profiles.notifyPro) : '–', 'notify me'],
    ['Want Deadlock', stats ? fmtInt(stats.profiles.notifyGames?.deadlock ?? 0) : '–', 'notify me'],
    ['Trained on', w ? fmtInt(w.trainMatches + w.testMatches) : '–', 'level-10 matches'],
  ];

  return (
    <div className="page dev">
      <header className="dev-head">
        <h1>Dev</h1>
        {owner && <button className="ghost small-btn" onClick={load} disabled={busy}>{busy ? 'Counting…' : 'Refresh'}</button>}
      </header>
      <div className="dev-checks">
        {checks.map(c => <span key={c.label} className={`dev-check ${c.tone}`} title={c.tip}><i />{c.label}<b>{c.value}</b></span>)}
      </div>
      {!owner && <p className="muted small">{LOCAL ? 'Server numbers come from the Worker: open this page on the website, logged in as the owner.' : 'Log in with Steam as the owner for the server numbers.'}</p>}
      {err && <p className="warn-text small">{err}</p>}
      <div className="kpi-strip dev-kpis">
        {kpis.map(([k, val, sub]) => <div key={k} className="kpi-tile"><span>{k}</span><b>{val}</b>{sub && <em className="muted">{sub}</em>}</div>)}
      </div>

      <nav className="recap-tabs dev-tabs" aria-label="Dev">
        <div className="recap-tabs-list" role="tablist">
          {DEV_TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pickTab(t.id)}><Icon name={t.icon} size={14} /> {t.label}</button>
          ))}
        </div>
      </nav>

      {tab === 'users' && (!stats ? <p className="muted">{owner ? 'Counting…' : 'No server numbers here.'}</p> : (
        <>
          <section className="site-card">
            <div className="card-head"><h2>Matches played per week</h2><span className="muted small">last 12 weeks</span></div>
            {stats.profiles.weeks ? <AreaChart fmt={x => fmtInt(x)} height={180}
              points={Object.entries(stats.profiles.weeks).sort((a, b) => a[0].localeCompare(b[0])).map(([wk, n]) => ({ label: new Date(wk).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: n, note: `week of ${wk}` }))} />
              : <p className="muted">Redeploy the Worker for weekly numbers.</p>}
          </section>
          <div className="dash-row">
            <section className="site-card dash-wide">
              <div className="card-head"><h2>Maps</h2></div>
              {(() => { const rows = Object.entries(stats.profiles.maps).sort((a, b) => b[1] - a[1]), max = rows[0]?.[1] ?? 1;
                return rows.length ? <BarList rows={rows.map(([m, n]) => ({ label: mapName(m), value: fmtInt(n), share: n / max, tone: 'flat' as const }))} /> : <p className="muted">No matches yet.</p>; })()}
            </section>
            <section className="site-card dash-narrow">
              <div className="card-head"><h2>Results</h2></div>
              <Donut center={fmtInt(stats.profiles.matches)} sub="matches"
                parts={[{ label: 'Wins', value: stats.profiles.results.win ?? 0, color: T.good }, { label: 'Losses', value: stats.profiles.results.loss ?? 0, color: T.bad }, { label: 'Draws', value: stats.profiles.results.tie ?? 0, color: T.text3 }]} />
            </section>
          </div>
          <section className="site-card">
            <div className="card-head"><h2>Most active</h2><span className="muted small">{stats.profiles.public} public · {stats.profiles.withGoals} with goals · last match {ago(stats.profiles.lastMatchAt)}</span></div>
            <div>{stats.profiles.top.map(t => <a key={t.steamId} href={`https://steamcommunity.com/profiles/${t.steamId}`} target="_blank" rel="noreferrer" className="dev-chip">{t.steamId.slice(-6)} · {t.matches}</a>)}</div>
          </section>
        </>
      ))}

      {tab === 'coach' && (
        <>
          {w && (
            <section className="site-card">
              <div className="card-head"><h2>Win chance</h2><span className="muted small">{w.split ? `test: ${w.split}` : `${fmtInt(w.testMatches)} matches it never learned from`} · {w.at}</span></div>
              <BarList rows={([['Hand-set formula', w.formula], ['Logistic', w.logistic], ['Boosted trees', w.trees]] as const).map(([label, sc]) => ({
                label: `${label}${(w.shipped === 'trees' ? 'Boosted trees' : 'Logistic') === label ? ' (in use)' : ''}`, value: `log loss ${sc.logLoss}`,
                share: Math.max(0.05, (0.52 - sc.logLoss) / (0.52 - 0.44)), tone: (w.shipped === 'trees' ? 'Boosted trees' : 'Logistic') === label ? 'up' as const : 'flat' as const,
              }))} />
              <p className="muted small">Newer matches count more: {w.halfLife ? `yes, half every ${w.halfLife} days` : 'no (it didn\'t beat every match counting the same)'}. Log loss: how far the win % it shows is from what happened, on average. Lower is better; 0.69 is a coin flip. Longer bar = better. Calibration: {(w.shipped === 'trees' ? w.trees : w.logistic).calibration.filter(c => c.n > 300).map(c => `${Math.round(c.said * 100)}→${Math.round((c.won ?? 0) * 100)}%`).join(' · ')}</p>
            </section>
          )}
          <section className="site-card">
            <div className="card-head"><h2>Models</h2><span className="muted small">right on data they never saw</span></div>
            <div className="gauge-row">
              {du ? <Gauge value={du[du.shipped].accuracy} label="Duels" sub={`${fmtInt(du.testFights)} fights · ${du.shipped}`} tone={du[du.shipped].accuracy >= 0.6 ? 'up' : 'flat'} />
                : <Gauge value={duel.testAccuracy} label="Duels" sub={`${fmtInt(duel.samples)} fights`} tone={duel.testAccuracy >= 0.6 ? 'up' : 'flat'} />}
              <Gauge value={play.mlp.accuracy} label="Play network" sub="what level 10 does next" tone="up" />
              {v && <Gauge value={v.right / Math.max(1, v.total)} label="Your verdicts" sub={`${v.right} of ${v.total} agree`} tone={v.right / Math.max(1, v.total) >= 0.8 ? 'up' : 'flat'} />}
            </div>
            <table className="site-table dev-models"><tbody>
              <tr><td>Coach</td><td>{fmtInt(COACH_MODEL.trainedOn)} player-games, {COACH_MODEL.source?.demos ?? '?'} demos{PRO_MODEL ? ` · pro ${PRO_MODEL.source?.demos ?? '?'} demos` : ''}</td><td>{COACH_MODEL.source?.trainedAt ?? '–'}</td></tr>
              <tr><td>Engine</td><td>{fmtInt(search.moments)} moments, {fmtInt(search.rounds)} rounds · matches results {search.check?.corr ?? '–'}</td><td>{search.calibratedAt}</td></tr>
              <tr><td>Analyst</td><td>{analyst.overall.demos} demos · pro {analystPro.overall.demos}</td><td>{analyst.trainedAt}</td></tr>
              <tr><td>Level ladder</td><td>{fmtInt(level.games.lvl10)} level-10 games, {fmtInt(level.games.pro)} pro</td><td>{level.trainedAt}</td></tr>
            </tbody></table>
          </section>
          {(w?.perMap || du?.perMap) && (
            <section className="site-card">
              <div className="card-head"><h2>Per map</h2><span className="muted small">extra trees for a map, kept only where they beat the shared model</span></div>
              <table className="site-table"><thead><tr><th>Map</th><th>Win chance</th><th>Duels</th></tr></thead><tbody>
                {[...new Set([...Object.keys(w?.perMap ?? {}), ...Object.keys(du?.perMap ?? {})])].sort().map(m => {
                  const cell = (x?: { shared: number; tuned: number; kept: boolean }) => !x ? '–'
                    : x.kept ? <>{x.shared} → <b>{x.tuned}</b> <span className="dev-up">own</span></> : <span className="muted">{x.shared} shared</span>;
                  return <tr key={m}><td>{mapName(m)}</td><td className="num">{cell(w?.perMap?.[m])}</td><td className="num">{cell(du?.perMap?.[m])}</td></tr>;
                })}
              </tbody></table>
              <p className="muted small">Log loss on each map's newest matches, lower is better.</p>
            </section>
          )}
          {hist.length > 0 && (
            <section className="site-card">
              <div className="card-head"><h2>Progress</h2><span className="muted small">each retrain, on matches it never learned from</span></div>
              <table className="site-table"><thead><tr><th>Date</th><th>Matches</th><th>Test</th><th>Win chance</th><th>Duels right</th><th>Engine</th><th>Your verdicts</th></tr></thead><tbody>
                {[...hist].reverse().map((h, i, all) => {
                  // arrows only against a row tested the same way
                  const was = all[i + 1] && !!all[i + 1].newest === !!h.newest ? all[i + 1] : undefined;
                  const arrow = (now: number | null, before: number | null | undefined, lowerBetter = false) => now === null || before == null || now === before ? null
                    : <span className={(now < before) === lowerBetter ? 'dev-up' : 'dev-down'}>{(now < before) === lowerBetter ? ' ▲' : ' ▼'}</span>;
                  return (
                    <tr key={h.at}>
                      <td className="num">{h.at}</td>
                      <td className="num">{h.matches !== null ? fmtInt(h.matches) : '–'}</td>
                      <td className="num">{h.testMatches ?? '–'} {h.newest ? 'newest' : 'random'}</td>
                      <td className="num">{h.win ?? '–'}{arrow(h.win, was?.win, true)}</td>
                      <td className="num">{h.duels !== null ? `${(h.duels * 100).toFixed(1)}%` : '–'}{arrow(h.duels, was?.duels)}</td>
                      <td className="num">{h.engine ?? '–'}</td>
                      <td className="num">{h.verdicts.right}/{h.verdicts.total}</td>
                    </tr>
                  );
                })}
              </tbody></table>
              <p className="muted small">Test: the matches it's scored on, the newest ones or a random fifth; numbers are comparable only between rows tested the same way. Win chance: log loss, lower is better. Engine: how well playing like the engine matches winning rounds (correlation, higher is better).</p>
            </section>
          )}
        </>
      )}

      {tab === 'disputes' && (owner ? <DevDisputes myId={me?.steamId ?? null} /> : <p className="muted">Log in with Steam as the owner to see disputed moments.</p>)}

      {tab === 'data' && (
        <>
          <section className="site-card">
            <div className="card-head"><h2>Training data per map</h2><span className="muted small">red: under 40 demos, the coach is least sure</span></div>
            {Object.keys(sources).length > 0 && <p className="muted small">From: {Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p === 'own' ? 'this computer' : p} ${fmtInt(n)}`).join(' · ')}</p>}
            {(() => {
              const demos = COACH_MODEL.source?.maps ?? {}, max = Math.max(...Object.values(demos), 1);
              const nades = utilSpots as Record<string, unknown[]>;
              return <BarList rows={Object.entries(demos).sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ label: mapName(m), value: `${n} demos · ${nades[m]?.length ?? 0} grenade spots`, share: n / max, tone: n >= 70 ? 'up' as const : n >= 40 ? 'flat' as const : 'down' as const }))} />;
            })()}
          </section>
          <section className="site-card">
            <div className="card-head"><h2>Demo bot and match lists</h2></div>
            {!stats ? <p className="muted">No server numbers here.</p> : (
              <>
                <p className={stats.bot && !botOk ? 'warn-text' : ''}>{stats.bot
                  ? <>Last ran {ago(stats.bot.at)}: {stats.bot.users} users, {stats.bot.handled} matches ({stats.bot.ready} ready, {stats.bot.failed} failed) in {Math.round(stats.bot.cycleMs / 1000)} s</>
                  : 'Not set up yet (server/README.md).'}</p>
                <p className="muted small">{fmtInt(stats.lists.matches)} matches in lists: {stats.lists.parsed} ready · {stats.lists.pending} waiting · {stats.lists.failing} failing · {stats.lists.gone} expired · {stats.lists.withCodes} users with codes</p>
                {stats.lists.errors.length > 0 && (
                  <table className="site-table"><thead><tr><th>When</th><th>User</th><th>Error</th></tr></thead><tbody>
                    {stats.lists.errors.slice(0, 8).map((x, i) => <tr key={i}><td className="num">{fmtDate(x.at)}</td><td className="num">{x.steamId.slice(-6)}</td><td>{x.error}</td></tr>)}
                  </tbody></table>
                )}
              </>
            )}
          </section>
        </>
      )}

      {tab === 'browser' && (
        <section className="site-card">
          <div className="card-head"><h2>This browser</h2><span className="muted small">{data.matches.length} matches here ({remote ? 'synced to the account' : 'browser only'}) · you: {whoAmI(s) ?? 'unknown'} · {me ? `${me.name ?? me.steamId}${me.owner ? ' (owner)' : ''}` : 'not logged in'}</span></div>
          <table className="site-table"><tbody>
            {storage.map(r => <tr key={r.key}><td className="num">{r.key}</td><td className="num">{r.size > 1024 ? `${(r.size / 1024).toFixed(1)} KB` : `${r.size} B`}</td></tr>)}
          </tbody></table>
          <p className="muted small">{ONLINE ? 'Website' : 'Local'} · API {API_URL || (STEAM_AVAILABLE ? 'dev server' : 'none')} · Pro {PRO_EARLY_ACCESS ? 'early access' : 'on'} (free history {FREE_HISTORY}, kept {MAX_HISTORY})</p>
        </section>
      )}
    </div>
  );
}

type DevTab = 'users' | 'coach' | 'disputes' | 'data' | 'browser';
const DEV_TABS: { id: DevTab; label: string; icon: IconName }[] = [
  { id: 'users', label: 'Users', icon: 'friends' }, { id: 'coach', label: 'Coach', icon: 'star' }, { id: 'disputes', label: 'Disputes', icon: 'chat' },
  { id: 'data', label: 'Data & bot', icon: 'stats' }, { id: 'browser', label: 'Browser', icon: 'lock' },
];

type Scored = { logLoss: number; brier: number; calibration: { said: number; won: number | null; n: number }[] };
type CoachEval = {
  winChance?: { at: string; testMatches: number; testMoments: number; trainMatches: number; shipped: string; formula: Scored; logistic: Scored; trees: Scored;
    split?: string; halfLife?: number | null; perMap?: Record<string, { shared: number; tuned: number; kept: boolean }> };
  verdicts?: { at: string; right: number; total: number };
  duels?: { at: string; testFights: number; trainFights: number; shipped: 'trees' | 'logistic'; logistic: { logLoss: number; accuracy: number }; trees: { logLoss: number; accuracy: number };
    halfLife?: number | null; perMap?: Record<string, { shared: number; tuned: number; kept: boolean }> };
  history?: { at: string; matches: number | null; testMatches: number | null; newest?: boolean; win: number | null; duels: number | null; engine: number | null; verdicts: { right: number; total: number } }[];
};
