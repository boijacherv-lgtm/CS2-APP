import { useState } from 'react';
import { Icon } from '../ui/Icon';
import { liveMatch, rankName, scout, type ScoutRow } from './api';
import { heroOf } from './data';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Scout the other team (round 8, E): your live match from the game's watch list, every player's rank and their record on
 * the hero they're playing. The watch list only has the top 200 matches being played, so most matches aren't in it.
 */
export function DlScout({ account }: { account: string }) {
  const [state, setState] = useState<'idle' | 'looking' | 'none' | { id: number; me: number; rows: ScoutRow[] }>('idle');
  const look = async () => {
    setState('looking');
    const m = await liveMatch(account);
    if (!m) { setState('none'); return; }
    const me = m.players.find(p => String(p.account_id) === account)!.team;
    setState({ id: m.id, me, rows: await scout(m.players) });
  };
  const team = (rows: ScoutRow[], label: string) => (
    <>
      <tr className="dl-scout-team"><th colSpan={5}>{label}</th></tr>
      {rows.sort((a, b) => b.games - a.games).map(r => {
        const h = heroOf(r.hero);
        return (
          <tr key={r.account} className={String(r.account) === account ? 'me' : ''}>
            <td><span className="dl-sb-who">{h.card && <img className="dl-hero-img" src={h.card} alt="" width={26} height={26} />}<span><b>{h.name}</b><span className="muted small">{String(r.account) === account ? 'You' : r.name ?? 'Hidden'}</span></span></span></td>
            <td>{r.badge ? rankName(r.badge) : <span className="muted">–</span>}</td>
            <td className="num">{r.games}</td>
            <td className="num" style={r.wr === null ? undefined : { color: r.wr >= 0.5 ? 'var(--good)' : 'var(--bad)' }}>{r.wr === null ? '–' : pct(r.wr)}</td>
            <td className="num">{r.kda === null ? '–' : r.kda.toFixed(2)}</td>
          </tr>
        );
      })}
    </>
  );
  return (
    <section className="site-card dl-scout">
      <div className="card-head"><h2><Icon name="target" size={16} /> Scout the other team</h2>
        {typeof state === 'object' && <span className="muted small">match {state.id}</span>}</div>
      {typeof state !== 'object' && <>
        <p className="muted small">In a match now? See every player's rank and how they do on the hero they picked.</p>
        <button className="cta small-btn" onClick={() => void look()} disabled={state === 'looking'}>{state === 'looking' ? 'Looking…' : 'Find my live match'}</button>
        {state === 'none' && <p className="muted small">Not found. Only the 200 matches the game lists under Watch can be seen while they're played, so most matches aren't. Try again in a minute, or open it in Review once it's over.</p>}
      </>}
      {typeof state === 'object' && (
        <>
          <div className="dl-sb-scroll"><table className="site-table dl-scout-table">
            <thead><tr><th>Hero · player</th><th>Rank</th><th>Games on it</th><th>Won</th><th>KDA</th></tr></thead>
            <tbody>
              {team(state.rows.filter(r => r.team !== state.me), 'The other team')}
              {team(state.rows.filter(r => r.team === state.me), 'Your team')}
            </tbody>
          </table></div>
          <button className="ghost small-btn" onClick={() => void look()}>Refresh</button>
        </>
      )}
    </section>
  );
}
