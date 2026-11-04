import winmodel from '../deadlock/generated/winmodel.json';
import playnet from '../deadlock/generated/playnet.json';
import fightmodel from '../deadlock/generated/fightmodel.json';
import dlsearch from '../deadlock/generated/dlsearch.json';
import spots from '../deadlock/generated/spots.json';
import deathmap from '../deadlock/generated/deathmap.json';
import positions from '../deadlock/generated/positions.json';
import { ACTION_LABEL, type Action } from '../deadlock/playNet';
import { BarList, Gauge } from './charts';
import { fmtInt } from './format';
import { DevDlDisputes } from './DevDlDisputes';

type Scored = { logloss: number; accuracy: number };
const W = winmodel as { since: string; patch: string | null; matches: number; moments: number; kind?: string;
  test: { matches: number; coinflip?: number; calibration: { bin: number; n: number; won: number | null }[] }; compare?: { simple: Scored & Stages; network: Scored & Stages } };
type Stages = { early: { accuracy: number } | null; mid: { accuracy: number } | null; late: { accuracy: number } | null };
const P = playnet as { since: string; matches: number; moments: number; actions: Action[]; share: number[]; ships: boolean;
  test: { matches: number; network: Scored & { top2: number; recall: Record<Action, number | null> }; baseline: Scored & { top2: number } } };
type Even = { evenNumbers: { n: number; accuracy: number } | null };
const F = fightmodel as { at: string; matches: number; fights: number; evenTrades: number; kind: string;
  test: { fights: number; calibration: { bin: number; n: number; won: number | null }[] }; compare: { numbers: Scored & Even; logistic: Scored & Even; network: Scored & Even } };
const S = dlsearch as { thresholds: number[]; replies: string; moments: number; matches: number; calibratedAt: string; bestShare: number; classes: Record<string, number>;
  effectFit: { r2Mean: number; r2Model: number }; check: { corr: number; teams: number; byReplies: Record<string, number> } };
const REPLY_LABEL: Record<string, string> = { worst: 'Worst for you (chess-style)', likely: 'Likely (by the fight odds)', none: 'None (usual effect only)' };
const day = (iso: string) => iso.slice(0, 10);
const pct = (v: number | null | undefined) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const calib = (rows: { bin: number; n: number; won: number | null }[], min: number) => rows.filter(c => c.n >= min).map(c => `${Math.round(c.bin * 100 + 5)}→${Math.round((c.won ?? 0) * 100)}%`).join(' · ');

/** The dev page's Deadlock tab: the engine's models (each next to what it beat), the other trained data, disputes. */
export function DevDeadlock({ owner }: { owner: boolean }) {
  const wc = W.compare, fc = F.compare;
  return (
    <>
      <section className="site-card">
        <div className="card-head"><h2>Engine</h2><span className="muted small">right on matches they never saw · retrain: the patch routine</span></div>
        <div className="gauge-row">
          <Gauge value={W.kind === 'network' && wc ? wc.network.accuracy : wc?.simple.accuracy ?? 0} label="Evaluation" sub={`win chance · ${W.kind === 'network' ? 'value network' : 'simple model'}`} tone="up" />
          <Gauge value={P.test.network.top2} label="Play network" sub={`top 2 of 6 actions · ${pct(P.test.network.accuracy)} first`} tone={P.ships ? 'up' : 'flat'} />
          <Gauge value={fc.network.accuracy >= fc.logistic.accuracy ? fc.network.accuracy : fc.logistic.accuracy} label="Fight model" sub={`who wins · ${F.kind}`} tone="up" />
          <Gauge value={Math.max(0, S.check.corr)} label="2-step search" sub={`matches results · ${S.replies} replies`} tone={S.check.corr > 0.1 ? 'up' : 'flat'} />
        </div>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>1 · Evaluation (win chance)</h2><span className="muted small">{fmtInt(W.matches)} Phantom+ matches since {day(W.since)}{W.patch ? ` (${W.patch})` : ''} · {fmtInt(W.moments)} moments · test {fmtInt(W.test.matches)} matches</span></div>
        {wc ? (
          <table className="site-table"><thead><tr><th>Model</th><th>Log loss</th><th>Right</th><th>0–10 min</th><th>10–20</th><th>20+</th></tr></thead><tbody>
            {(['simple', 'network'] as const).map(k => (
              <tr key={k} className={W.kind === k ? 'on' : ''}><td>{k === 'simple' ? 'Simple (differences)' : 'Value network'}{W.kind === k ? ' · in use' : ''}</td>
                <td className="num">{wc[k].logloss}</td><td className="num">{pct(wc[k].accuracy)}</td>
                <td className="num">{pct(wc[k].early?.accuracy)}</td><td className="num">{pct(wc[k].mid?.accuracy)}</td><td className="num">{pct(wc[k].late?.accuracy)}</td></tr>
            ))}
          </tbody></table>
        ) : <p className="muted">Retrain (npm run dl:train) to compare the two models.</p>}
        <p className="muted small">Coin flip {W.test.coinflip ?? 0.693}. Said → won: {calib(W.test.calibration, 500)}</p>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>2 · Play network (what good players do next)</h2><span className="muted small">{fmtInt(P.matches)} matches since {day(P.since)} · {fmtInt(P.moments)} moments · test {P.test.matches} matches</span></div>
        <table className="site-table"><thead><tr><th>Model</th><th>Log loss</th><th>Right</th><th>Top 2</th></tr></thead><tbody>
          <tr><td>Guess by minute</td><td className="num">{P.test.baseline.logloss}</td><td className="num">{pct(P.test.baseline.accuracy)}</td><td className="num">{pct(P.test.baseline.top2)}</td></tr>
          <tr className="on"><td>Play network{P.ships ? ' · in use' : ''}</td><td className="num">{P.test.network.logloss}</td><td className="num">{pct(P.test.network.accuracy)}</td><td className="num">{pct(P.test.network.top2)}</td></tr>
        </tbody></table>
        <BarList rows={P.actions.map((a, i) => ({ label: `${ACTION_LABEL[a]} · ${Math.round(P.share[i] * 100)}% of moments`, value: `found ${pct(P.test.network.recall[a])}`, share: P.test.network.recall[a] ?? 0, tone: (P.test.network.recall[a] ?? 0) >= 0.5 ? 'up' as const : 'flat' as const }))} />
        <p className="muted small">Found: of the moments a player really did that, how often it was the network's first guess.</p>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>3 · Fight model (who wins)</h2><span className="muted small">{fmtInt(F.fights)} fights in {F.matches} matches ({fmtInt(F.evenTrades)} even trades left out) · test {fmtInt(F.test.fights)} · {F.at}</span></div>
        <table className="site-table"><thead><tr><th>Model</th><th>Log loss</th><th>Right</th><th>Even numbers</th></tr></thead><tbody>
          {(['numbers', 'logistic', 'network'] as const).map(k => (
            <tr key={k} className={F.kind === k ? 'on' : ''}><td>{k === 'numbers' ? 'More heroes wins' : k === 'logistic' ? 'Logistic' : 'Network'}{F.kind === k ? ' · in use' : ''}</td>
              <td className="num">{fc[k].logloss}</td><td className="num">{pct(fc[k].accuracy)}</td><td className="num">{pct(fc[k].evenNumbers?.accuracy)}</td></tr>
          ))}
        </tbody></table>
        <p className="muted small">Read 12 s before the first death (when you'd decide), from the match data: no ultimates yet (they need demos). Said → won: {calib(F.test.calibration, 60)}</p>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>4 · 2-step search (grades)</h2><span className="muted small">{fmtInt(S.moments)} moments in {S.matches} matches · {S.calibratedAt}</span></div>
        <table className="site-table"><thead><tr><th>Enemy replies</th><th>Matches results</th></tr></thead><tbody>
          {Object.entries(S.check.byReplies).map(([k, v]) => <tr key={k} className={S.replies === k ? 'on' : ''}><td>{REPLY_LABEL[k] ?? k}{S.replies === k ? ' · in use' : ''}</td><td className="num">{v > 0 ? '+' : ''}{v}</td></tr>)}
        </tbody></table>
        <p className="muted small">Matches results: does a team that gave up less against the engine's best options win more than the win chance said at 10 minutes (correlation over {S.check.teams} matches, each graded by move effects learned without it; 0 = no link). The best way of replying ships.</p>
        <BarList rows={['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'].map(c => ({ label: c, value: `${pct(S.classes[c] ?? 0)} of moves`, share: (S.classes[c] ?? 0) / Math.max(...Object.values(S.classes)), tone: c === 'Best' || c === 'Excellent' || c === 'Good' ? 'up' as const : c === 'Inaccuracy' ? 'flat' as const : 'down' as const }))} />
        <p className="muted small">Class edges (win chance given up): {S.thresholds.map(v => `${(v * 100).toFixed(2)}%`).join(' · ')}. Move effects explain {pct(S.effectFit.r2Model)} of the 20-s change in win chance on unseen matches (each move's average alone: {pct(S.effectFit.r2Mean)}).</p>
      </section>

      <section className="site-card">
        <div className="card-head"><h2>Other trained data</h2></div>
        <table className="site-table"><tbody>
          <tr><td>Where you played (dl:spots)</td><td className="num">{fmtInt(spots.matches)} matches · {spots.minBadge}+</td><td className="num">{day(spots.since)}</td></tr>
          <tr><td>Death map (dl:deaths)</td><td className="num">{fmtInt(deathmap.matches)} matches · {deathmap.minBadge}+</td><td className="num">{day(deathmap.since)}</td></tr>
          <tr><td>Hero positions (dl:positions)</td><td className="num">{fmtInt(positions.matches)} matches</td><td className="num">{day(positions.since)}</td></tr>
        </tbody></table>
        <p className="muted small">An older date than the patch above means it wasn't retrained this patch.</p>
      </section>

      {owner ? <DevDlDisputes /> : <p className="muted">Log in with Steam as the owner to see disputed moments.</p>}
    </>
  );
}
