import { useEffect } from 'react';
import { App as Cs2App } from '../App';
import type { RoundSummary } from '../engine/match';
import type { MatchWorkerIn, MatchWorkerOut } from '../engine/match.worker';
import { MatchReportPage } from '../ui/Report';
import { SteamAccount } from '../ui/SteamLogin';
import { finishSteamLogin, steamFetch } from '../ui/steamApi';
import { useStore } from '../store';
import { APP_NAME, APP_TAGLINE, LogoMark } from './Logo';
import { Icon } from '../ui/Icon';
import { navigate, routeHref, useRoute, type Route } from './router';

interface Game { id: string; name: string; short: string; live: boolean; blurb: string; color: string }

/** Games on the platform. Only CS2 is built so far; the rest are placeholders. */
const GAMES: Game[] = [
  { id: 'cs2', name: 'Counter-Strike 2', short: 'CS2', live: true, color: '#e8a33c', blurb: 'Tactical board on 10 maps (the 9 competitive ones plus Cache), round simulation with fights, and chess-style match review.' },
  { id: 'valorant', name: 'Valorant', short: 'VAL', live: false, color: '#ff4655', blurb: 'Agent abilities, sites and executes.' },
  { id: 'r6', name: 'Rainbow Six Siege', short: 'R6', live: false, color: '#6aa7ff', blurb: 'Destruction, reinforcements and site setups.' },
];

export function Shell() {
  const route = useRoute();
  const setMode = useStore(s => s.setMode);

  // the URL decides the CS2 mode (so Back/Forward and bookmarks work); the report page has no board
  useEffect(() => { if (route.page === 'cs2' && route.mode !== 'report') setMode(route.mode); }, [route, setMode]);
  useMatchGrader();
  // website: Steam just sent us back from its login page → finish the login (once)
  useEffect(() => {
    // after a Steam login comes back, learn who you are (Review can evaluate only your moves)
    finishSteamLogin().then(() => steamFetch('/me')).then(r => (r.ok ? r.json() : null))
      .then(j => useStore.setState({ me: j?.me?.steamId ?? null })).catch(() => {});
  }, []);

  return (
    <div className="shell">
      <NavBar route={route} />
      <main className="shell-main">
        {route.page !== 'cs2' ? <Home /> : route.mode === 'report' ? <MatchReportPage /> : <Cs2App />}
      </main>
    </div>
  );
}

/** Grades every round of the loaded match in a worker, so the report fills in while you watch. */
function useMatchGrader() {
  const data = useStore(s => s.review?.data);
  useEffect(() => {
    if (!data) return;
    const rounds: (RoundSummary | null)[] = Array(data.rounds.length).fill(null);
    useStore.setState({ report: { data, rounds: [...rounds], done: false } });
    const w = new Worker(new URL('../engine/match.worker.ts', import.meta.url), { type: 'module' });
    let error: string | undefined;
    const finish = () => { useStore.setState({ report: { data, rounds: [...rounds], done: true, ...(error ? { error } : {}) } }); w.terminate(); };
    w.onmessage = (e: MessageEvent<MatchWorkerOut>) => {
      const m = e.data;
      if ('error' in m) { error = m.error; console.error('grading stopped:', m.error); return; }
      if ('done' in m) { finish(); return; }
      rounds[m.i] = m.summary;
      useStore.setState({ report: { data, rounds: [...rounds], done: false } });
    };
    // the worker itself crashed (out of memory, failed to load): stop waiting, keep what was graded
    w.onerror = e => { e.preventDefault(); error = e.message || 'the grader crashed (the match may be too big for this browser)'; finish(); };
    w.onmessageerror = () => { error = 'a graded round could not be read back'; finish(); };
    w.postMessage({ data, context: useStore.getState().board.context } satisfies MatchWorkerIn);
    return () => w.terminate();
  }, [data]);
}

function NavBar({ route }: { route: Route }) {
  const loaded = useStore(s => s.review);
  return (
    <header className="navbar">
      <a className="brand" href="#/"><LogoMark /><span>{APP_NAME}</span></a>
      <nav className="games">
        {GAMES.map(g => g.live ? (
          <a key={g.id} href={routeHref({ page: 'cs2', mode: route.page === 'cs2' ? route.mode : 'tactical' })}
            className={`game-tab ${route.page === g.id ? 'on' : ''}`}>{g.short}</a>
        ) : (
          <span key={g.id} className="game-tab soon" title={`${g.name}: coming soon`}>{g.short}<i>soon</i></span>
        ))}
      </nav>
      {route.page === 'cs2' && (
        <div className="modes" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={route.mode === 'tactical'} className={route.mode === 'tactical' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'tactical' })} title="Plan rounds on the board">
            <Icon name="grid" className="mode-ico" /> Tactical
          </button>
          <button role="tab" aria-selected={route.mode === 'review'} className={route.mode === 'review' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'review' })} title="Replay and grade a played match">
            <Icon name="play" className="mode-ico" /> Review{loaded ? <i className="dot-live" title="A match is loaded" /> : null}
          </button>
          <button role="tab" aria-selected={route.mode === 'report'} className={route.mode === 'report' ? 'on' : ''}
            onClick={() => navigate({ page: 'cs2', mode: 'report' })} title="The coach's notes, every player's grades and estimated rating for the match">
            <Icon name="star" className="mode-ico" /> Match recap
          </button>
        </div>
      )}
      <div className={`steam-slot ${route.page === 'cs2' ? '' : 'push'}`}><SteamAccount /></div>
    </header>
  );
}

function Home() {
  return (
    <div className="home">
      <section className="hero">
        <LogoMark size={64} />
        <h1>{APP_NAME}</h1>
        <p>{APP_TAGLINE}</p>
        <div className="hero-cta">
          <a className="cta primary" href="#/cs2/tactical">Plan a round in CS2</a>
          <a className="cta" href="#/cs2/review">Review a CS2 match</a>
        </div>
      </section>
      <section className="game-grid">
        {GAMES.map(g => {
          const body = (
            <>
              <div className="game-badge" style={{ background: g.color }}>{g.short}</div>
              <div className="game-text">
                <h3>{g.name}</h3>
                <p>{g.blurb}</p>
              </div>
              <span className={`game-state ${g.live ? 'live' : ''}`}>{g.live ? 'Open →' : 'Coming soon'}</span>
            </>
          );
          return g.live
            ? <a key={g.id} className="game-card live" href="#/cs2/tactical">{body}</a>
            : <div key={g.id} className="game-card">{body}</div>;
        })}
      </section>
    </div>
  );
}
