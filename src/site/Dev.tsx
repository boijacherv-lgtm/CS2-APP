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
import winprob from '../engine/models/winprob.json';
import utilSpots from '../map/generated/util-spots.json';
import { useStore, whoAmI } from '../store';
import { Icon } from '../ui/Icon';
import { useProfile } from '../ui/profileApi';
import { steamFetch } from '../ui/steamApi';
import { fmtDate, fmtInt, mapName, pct } from './format';
import { AreaChart, BarList, Donut, Gauge } from './charts';
import { goalInfo } from '../engine/habits';
import type { GoalId } from '../engine/profile';
import { T } from '../ui/tokens';

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

  if (!loaded && !LOCAL) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!allowed) return <div className="page"><h1>Not found</h1><p className="muted">There's nothing here. <a href="#/">Go home</a></p></div>;

  const storage = (() => {
    const rows: { key: string; size: number }[] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; rows.push({ key: k, size: (localStorage.getItem(k) ?? '').length }); } } catch { /* no storage */ }
    return rows.sort((a, b) => b.size - a.size);
  })();
  const maps = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${mapName(m)} ${n}`).join(' · ') || '–';

  return (
    <div className="page dev">
      <header className="page-head"><h1>Dev</h1><p className="lead">Everything about the site, for you only.</p></header>

      <section className="site-card">
        <div className="card-head"><h2><Icon name="gear" size={16} /> Site</h2></div>
        <table className="site-table dev-kv"><tbody>
          <tr><td>Build</td><td className="num">{BUILD.commit}{BUILD.time ? ` · built ${ago(Date.parse(BUILD.time))}` : ''}</td></tr>
          <tr><td>Mode</td><td>{ONLINE ? 'website (demos read in the browser)' : 'local dev server'}{LOCAL ? ' · on this computer' : ''}</td></tr>
          <tr><td>API</td><td>{API_URL || (STEAM_AVAILABLE ? 'dev server /api/steam' : 'none (no Steam login in this build)')}</td></tr>
          <tr><td>Pro</td><td>{PRO_EARLY_ACCESS ? 'early access: everything unlocked for everyone' : 'limits on'} · free history {FREE_HISTORY}, kept {MAX_HISTORY}</td></tr>
          <tr><td>You</td><td>{me ? `${me.name ?? me.steamId} (${me.steamId})${me.owner ? ' · owner' : ''}` : 'not logged in'}{s.claimed && !s.me ? ` · This is me: ${s.claimed}` : ''}</td></tr>
        </tbody></table>
      </section>

      <section className="site-card">
        <div className="card-head">
          <h2><Icon name="friends" size={16} /> Users and data</h2>
          {me?.owner && remote && <button className="ghost small-btn" onClick={load} disabled={busy}>{busy ? 'Counting…' : 'Refresh'}</button>}
        </div>
        {!me?.owner || !remote ? (
          <p className="muted">{LOCAL ? 'The server numbers come from the Worker: open this page on the website, logged in as the owner.' : 'Log in with Steam as the owner to see the server numbers.'}</p>
        ) : err ? <p className="warn-text">{err}{/403/.test(err) || /owner/.test(err) ? '' : ' (if the Worker is older than the dev page: npx wrangler deploy in worker/)'}</p>
          : !stats ? <p className="muted">Counting…</p> : (
          <>
            <div className="kpi-strip">
              {[['Accounts with a profile', stats.keys.profiles], ['Match lists (codes pasted)', `${stats.lists.withCodes} / ${stats.keys.users}`], ['Logged-in sessions', stats.keys.sessions],
                ['Matches on profiles', stats.profiles.matches], ['Demos stored by the bot', stats.keys.demos], ['Want Pro (notify me)', stats.profiles.notifyPro],
                ['Want Deadlock (notify me)', stats.profiles.notifyGames?.deadlock ?? 0]].map(([k, v]) => (
                <div key={k} className="kpi-tile"><span>{k}</span><b>{typeof v === 'number' ? fmtInt(v) : v}</b></div>
              ))}
            </div>
            <div className="dash-row">
              <section className="site-card dash-wide">
                <div className="card-head"><h2><Icon name="trendUp" size={16} /> Matches played per week</h2><span className="muted small">on every profile, last 12 weeks</span></div>
                {stats.profiles.weeks ? <AreaChart fmt={v => fmtInt(v)} height={200}
                  points={Object.entries(stats.profiles.weeks).sort((a, b) => a[0].localeCompare(b[0])).map(([w, n]) => ({ label: new Date(w).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: n, note: `week of ${w}` }))} />
                  : <p className="muted">Redeploy the Worker (npx wrangler deploy in worker/) for weekly numbers.</p>}
              </section>
              <section className="site-card dash-narrow">
                <div className="card-head"><h2><Icon name="star" size={16} /> Level grades</h2><span className="muted small">{stats.profiles.engine != null ? `engine accuracy ${stats.profiles.engine}` : ''}</span></div>
                {stats.profiles.levels && Object.keys(stats.profiles.levels).length ? (() => {
                  const order = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'], L = stats.profiles.levels!;
                  const max = Math.max(...Object.values(L), 1);
                  return <BarList rows={order.filter(g => L[g]).map(g => ({ label: `${g}${g === 'B' ? ' (typical level 10)' : g === 'S' ? ' (typical pro)' : ''}`, value: fmtInt(L[g]), share: L[g] / max, tone: (['S+', 'S', 'A'].includes(g) ? 'up' : ['D', 'F'].includes(g) ? 'down' : 'flat') as 'up' | 'down' | 'flat' }))} />;
                })() : <p className="muted">No graded matches yet.</p>}
              </section>
            </div>
            <div className="dash-row">
              <section className="site-card dash-wide">
                <div className="card-head"><h2><Icon name="map" size={16} /> Maps played</h2><span className="muted small">all profiles</span></div>
                {(() => {
                  const rows = Object.entries(stats.profiles.maps).sort((a, b) => b[1] - a[1]);
                  const max = rows[0]?.[1] ?? 1;
                  return rows.length ? <BarList rows={rows.map(([m, n]) => ({ label: mapName(m), value: fmtInt(n), share: n / max, tone: 'flat' as const }))} /> : <p className="muted">No matches yet.</p>;
                })()}
              </section>
              <section className="site-card dash-narrow">
                <div className="card-head"><h2><Icon name="trophy" size={16} /> Results</h2></div>
                <Donut center={fmtInt(stats.profiles.matches)} sub="matches"
                  parts={[{ label: 'Wins', value: stats.profiles.results.win ?? 0, color: T.good }, { label: 'Losses', value: stats.profiles.results.loss ?? 0, color: T.bad }, { label: 'Draws', value: stats.profiles.results.tie ?? 0, color: T.text3 }]} />
              </section>
            </div>
            <table className="site-table dev-kv"><tbody>
              <tr><td>Profiles</td><td>{stats.profiles.public} public · {stats.profiles.withGoals} with goals · last match {ago(stats.profiles.lastMatchAt)}{stats.profiles.read < stats.profiles.count ? ` · first ${stats.profiles.read} read` : ''}</td></tr>
              <tr><td>Results</td><td>{stats.profiles.results.win ?? 0} wins · {stats.profiles.results.loss ?? 0} losses · {stats.profiles.results.tie ?? 0} draws</td></tr>
              <tr><td>Maps</td><td>{maps(stats.profiles.maps)}</td></tr>
              <tr><td>Match lists</td><td>{fmtInt(stats.lists.matches)} matches: {stats.lists.parsed} ready · {stats.lists.pending} waiting · {stats.lists.failing} failing · {stats.lists.gone} expired · last Valve check {ago(stats.lists.lastSyncAt)}</td></tr>
              <tr><td>Most active</td><td>{stats.profiles.top.map(t => <a key={t.steamId} href={`https://steamcommunity.com/profiles/${t.steamId}`} target="_blank" rel="noreferrer" className="dev-chip">{t.steamId.slice(-6)} · {t.matches}</a>)}</td></tr>
            </tbody></table>
            {Object.keys(stats.profiles.goals).length > 0 && <>
              <h3 className="dev-h">Goals players picked</h3>
              {(() => {
                const rows = Object.entries(stats.profiles.goals).sort((a, b) => b[1] - a[1]).slice(0, 8), max = rows[0][1];
                return <BarList rows={rows.map(([g, n]) => ({ label: goalInfo(g as GoalId).label, value: fmtInt(n), share: n / max, tone: 'flat' as const }))} />;
              })()}
            </>}
            <h3 className="dev-h">Demo bot</h3>
            {stats.bot ? (
              <p className={Date.now() - stats.bot.at > 30 * 60000 ? 'warn-text' : ''}>
                Last ran {ago(stats.bot.at)}{Date.now() - stats.bot.at > 30 * 60000 ? ' (not running?)' : ''}: {stats.bot.users} users, {stats.bot.handled} matches handled
                ({stats.bot.ready} ready, {stats.bot.failed} failed, {stats.bot.gone} expired) in {Math.round(stats.bot.cycleMs / 1000)} s
                · profiles {stats.bot.grading ? 'on' : 'off (npm install missing)'}{stats.bot.version ? ` · code ${stats.bot.version}` : ''}
              </p>
            ) : <p className="muted">The bot hasn't reported yet (not set up, or older than this page).</p>}
            {stats.lists.errors.length > 0 && <>
              <h3 className="dev-h">Recent demo errors</h3>
              <table className="site-table"><thead><tr><th>When</th><th>User</th><th>Match</th><th>Error</th></tr></thead><tbody>
                {stats.lists.errors.map((e, i) => <tr key={i}><td className="num">{fmtDate(e.at)}</td><td className="num">{e.steamId.slice(-6)}</td><td className="num">{e.outcomeId.slice(-8)}</td><td>{e.error}</td></tr>)}
              </tbody></table>
            </>}
            {stats.lists.notes.length > 0 && <p className="muted small">Valve notes: {stats.lists.notes.map(n => `${n.steamId.slice(-6)}: ${n.note}`).join(' · ')}</p>}
            <p className="muted small">Counted {ago(stats.at)}. Each load reads every user's record from Cloudflare KV.</p>
          </>
        )}
      </section>

      <section className="site-card">
        <div className="card-head"><h2><Icon name="star" size={16} /> The coach's models</h2><span className="muted small">right on demos they never saw</span></div>
        <div className="gauge-row">
          <Gauge value={duel.testAccuracy} label="Duels" sub={`who wins a fight · ${fmtInt(duel.samples)} fights`} tone={duel.testAccuracy >= 0.6 ? 'up' : 'flat'} />
          <Gauge value={play.mlp.accuracy} label="Play network" sub={`what level 10 does next · ${Object.keys(play.mlp.vocab ?? {}).length} spots`} tone="up" />
          <Gauge value={play.policy.accuracy} label="Play, simple model" sub="the network's baseline" />
        </div>
      </section>
      <div className="dash-row">
        <section className="site-card dash-narrow">
          <div className="card-head"><h2><Icon name="route" size={16} /> Engine verdicts</h2><span className="muted small">on level-10 moments</span></div>
          <Donut center={fmtInt(search.moments / 1000) + 'k'} sub="moments"
            parts={[{ label: 'Best', value: search.byLoss.best.n, color: T.good }, { label: 'Small loss', value: search.byLoss.small.n, color: T.ct },
              { label: 'Medium loss', value: search.byLoss.medium.n, color: T.warn }, { label: 'Big loss', value: search.byLoss.big.n, color: T.bad }]} />
        </section>
        <section className="site-card dash-wide">
          <div className="card-head"><h2><Icon name="map" size={16} /> Training data per map</h2><span className="muted small">level-10 demos</span></div>
          {(() => {
            const demos = COACH_MODEL.source?.maps ?? {}, max = Math.max(...Object.values(demos), 1);
            const nades = utilSpots as Record<string, unknown[]>;
            return <BarList rows={Object.entries(demos).sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ label: mapName(m), value: `${n} demos · ${nades[m]?.length ?? 0} grenade spots`, share: n / max, tone: n >= 70 ? 'up' as const : n >= 40 ? 'flat' as const : 'down' as const, note: n < 70 ? 'Fewer demos than the other maps: the coach is less sure here' : undefined }))} />;
          })()}
          <p className="muted small skills-tip">Red: thin data (under 40 demos), where the coach is least sure. The download kit's link list fills the gaps.</p>
        </section>
      </div>
      <section className="site-card">
        <div className="card-head"><h2><Icon name="stats" size={16} /> Model details</h2></div>
        <table className="site-table"><thead><tr><th>Model</th><th>Trained on</th><th>Quality</th><th>When</th></tr></thead><tbody>
          <tr><td>Coach (level 10)</td><td>{fmtInt(COACH_MODEL.trainedOn)} player-games, {COACH_MODEL.source?.demos ?? '?'} demos</td><td>{Object.keys(COACH_MODEL.roles ?? {}).length} roles</td><td>{COACH_MODEL.source?.trainedAt ?? '–'}</td></tr>
          <tr><td>Coach (pro)</td><td>{PRO_MODEL ? `${fmtInt(PRO_MODEL.trainedOn)} player-games, ${PRO_MODEL.source?.demos ?? '?'} demos` : 'not trained'}</td><td>–</td><td>{PRO_MODEL?.source?.trainedAt ?? '–'}</td></tr>
          <tr><td>Level ladder</td><td>{fmtInt(level.games.lvl10)} level-10 games, {fmtInt(level.games.pro)} pro</td><td>–</td><td>{level.trainedAt}</td></tr>
          <tr><td>Duels</td><td>{fmtInt(duel.samples)} fights</td><td>{pct(duel.testAccuracy)} right on unseen demos</td><td>–</td></tr>
          <tr><td>Win chance</td><td>{fmtInt(winprob.samples)} moments</td><td>log loss {winprob.logLoss} (guessing {winprob.baselineLogLoss})</td><td>–</td></tr>
          <tr><td>Play (what level 10 does)</td><td>{fmtInt(play.policy.samples)} moments, {play.mlp.vocab ? Object.keys(play.mlp.vocab).length : 0} spots</td><td>network {pct(play.mlp.accuracy)}, simple {pct(play.policy.accuracy)}</td><td>–</td></tr>
          <tr><td>Engine</td><td>{fmtInt(search.moments)} moments, {fmtInt(search.rounds)} rounds</td><td>cost scale {search.costScale}</td><td>{search.calibratedAt}</td></tr>
          <tr><td>Analyst (level 10)</td><td>{analyst.overall.demos} demos, {fmtInt(analyst.overall.rounds)} rounds</td><td>{Object.keys(analyst.maps).length} maps</td><td>{analyst.trainedAt}</td></tr>
          <tr><td>Analyst (pro)</td><td>{analystPro.overall.demos} demos, {fmtInt(analystPro.overall.rounds)} rounds</td><td>{Object.keys(analystPro.maps).length} maps</td><td>{analystPro.trainedAt}</td></tr>
        </tbody></table>
      </section>

      <section className="site-card">
        <div className="card-head"><h2><Icon name="lock" size={16} /> This browser</h2></div>
        <p className="muted small">Profile here: {data.matches.length} matches ({remote ? 'synced to the account' : 'kept in this browser'}) · you in demos: {whoAmI(s) ?? 'unknown'}</p>
        <table className="site-table"><thead><tr><th>Saved key</th><th>Size</th></tr></thead><tbody>
          {storage.map(r => <tr key={r.key}><td className="num">{r.key}</td><td className="num">{r.size > 1024 ? `${(r.size / 1024).toFixed(1)} KB` : `${r.size} B`}</td></tr>)}
        </tbody></table>
      </section>
    </div>
  );
}
