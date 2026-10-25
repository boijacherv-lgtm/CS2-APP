import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useRoute, type Route } from '../shell/router';

/**
 * First-visit tours: the page dims, one control at a time is lit up with a short note next to it (Next / Back /
 * Skip; Enter, arrows and Esc work too). Each tour shows once per browser (Settings → "Show the tips again" brings them
 * back). A step lights up every match of its selector; a step with none on screen (a phone layout, a closed panel)
 * is skipped.
 */
export interface TourStep { target: string; title: string; text: string }
export interface Tour { id: string; when: (r: Route) => boolean; steps: TourStep[] }

export const TOURS: Tour[] = [
  {
    id: 'cs2', when: r => r.page === 'cs2' && r.mode !== 'report',
    steps: [
      { target: '.game-bar', title: 'Games', text: 'Pick the game here. CS2 is live; the others are on the way.' },
      { target: '.modes', title: 'Two modes', text: 'Tactical: draw a plan on the map and play it out. Review: load a demo and the coach grades every move. Once a demo is in, Match recap shows up here too.' },
      { target: '.dropzone', title: 'Load a demo', text: 'Drop a .dem file here (or click to pick one). It\'s read right in your browser: nothing is uploaded.' },
      { target: '.rail', title: 'Tools', text: 'Place players and grenades, draw paths. The letter under each tool is its keyboard shortcut.' },
      { target: '.layers', title: 'Layers', text: 'What\'s drawn on the map: callouts, vision cones, pro positions. 1, 2 and 3 switch between the presets.' },
      { target: '.playbar', title: 'Play it out', text: 'Play runs the plan in real time (Space). Drag the bar to scrub.' },
    ],
  },
  {
    id: 'review', when: r => r.page === 'cs2' && r.mode === 'review',
    steps: [
      { target: '.scorebug', title: 'The round', text: 'Score, round clock and which round you\'re watching.' },
      { target: '.timeline', title: 'Timeline', text: 'Every mark is a graded move. Click or drag to jump there.' },
      { target: '.moment-nav', title: 'Move by move', text: 'Step through the round\'s key moments like a chess review: the arrows here, or ← → on the keyboard.' },
      { target: '.eval-toggle', title: 'Whose moves', text: 'Mine grades only you, All grades every player.' },
      { target: '.playbar button:has(.pb-label)', title: 'Coach cards', text: 'Cards shows the coach\'s note on each graded move, Arrows draws the better line, Rage makes the coach lose it at your plays (18+), Slow slows the game down while you read.' },
      { target: '.note-key', title: 'What the marks mean', text: '!! brilliant, ! good, ?! inaccuracy, ? mistake, ?? blunder. Open Key for the details.' },
      { target: '.evalbar', title: 'Win chance', text: 'Each side\'s chance to win the round, moment by moment. A move\'s grade is how much it moved this.' },
      { target: '.teambar.ct', title: 'The teams', text: 'Health, guns, grenades and money. Click a player to follow them.' },
      { target: '.tr-buttons', title: 'Spoilers and the panel', text: 'Reveal all shows every round\'s result and moves (R). Panel lists the rounds and each round\'s moves.' },
      { target: '.modes > button:has(.mode-ico):last-child', title: 'Match recap', text: 'The whole match at once: what to work on, compared with level-10 players and pros.' },
    ],
  },
  {
    id: 'recap', when: r => r.page === 'cs2' && r.mode === 'report',
    steps: [
      { target: '.recap-head', title: 'The match', text: 'Final score and result. Share makes an image of it.' },
      { target: '.recap-tabs-list', title: 'Categories', text: 'Overview first, then the coach\'s lessons, the analyst\'s numbers, positions, the engine\'s accuracy, the scoreboard and every round.' },
      { target: '.level-toggle', title: 'Compared with', text: 'Measure yourself against FACEIT level-10 players or pros.' },
      { target: '.pos-item:first-child .coach-rounds', title: 'Watch it', text: 'Each point links the rounds where it happened: click one to watch it.' },
    ],
  },
];

const KEY = 'stratboard.tours';
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const markSeen = (id: string) => { try { localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), id])])); } catch { /* private mode */ } };
/** Settings → "Show the tips again". */
export const resetTours = () => { try { localStorage.removeItem(KEY); } catch { /* private mode */ } };

/** Where a step's controls are: every match of its selector that's drawn, as one box (null: none is). */
function rectOf(sel: string): DOMRect | null {
  const rs = [...document.querySelectorAll<HTMLElement>(sel)].map(el => el.getBoundingClientRect()).filter(r => r.width > 4 && r.height > 4);
  if (!rs.length) return null;
  const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top));
  return new DOMRect(l, t, Math.max(...rs.map(r => r.right)) - l, Math.max(...rs.map(r => r.bottom)) - t);
}
const visible = (sel: string) => !!rectOf(sel);

/** Runs the first tour this page has that this browser hasn't seen. */
export function Tours() {
  const route = useRoute();
  // the tour on screen: counted as seen as soon as it starts (leaving halfway doesn't bring it back each visit)
  const [active, setActive] = useState<string | null>(null);
  // read on every render (route changes re-render): Settings can bring the tours back
  const done = seen();
  const tour = TOURS.find(t => t.id === active) ?? TOURS.find(t => t.when(route) && !done.includes(t.id));
  const here = !!tour && tour.when(route);
  // wait for the page to draw its controls (a demo loading, a report being worked out)
  useEffect(() => {
    if (!tour || !here || active === tour.id) return;
    const t = setInterval(() => {
      // ready once a couple of steps are there, so a page half-drawn doesn't lose its later steps
      const on = tour.steps.filter(s => visible(s.target)).length;
      if (on >= Math.min(2, tour.steps.length)) { clearInterval(t); markSeen(tour.id); setActive(tour.id); }
    }, 400);
    return () => clearInterval(t);
  }, [tour?.id, here, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // left the page it belongs to: it's over
  useEffect(() => { if (active && !here) setActive(null); }, [active, here]);
  if (!tour || !here || active !== tour.id) return null;
  return <TourRun key={tour.id} tour={tour} onEnd={() => setActive(null)} />;
}

function TourRun({ tour, onEnd }: { tour: Tour; onEnd: () => void }) {
  // the steps whose control is on screen now
  const [steps] = useState(() => tour.steps.filter(s => visible(s.target)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  useLayoutEffect(() => {
    if (!step) return;
    document.querySelector(step.target)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const measure = () => setRect(rectOf(step.target));
    measure();
    // the layout moves (a panel opening, the window resized): follow it
    const t = setInterval(measure, 250);
    addEventListener('resize', measure);
    return () => { clearInterval(t); removeEventListener('resize', measure); };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (!['Escape', 'Enter', 'ArrowRight', 'ArrowLeft', ' '].includes(k)) return;
      // the board's own shortcuts (← → moves, Space play) wait while the tour is open
      e.preventDefault(); e.stopImmediatePropagation();
      if (k === 'Escape') onEnd();
      else if (k === 'ArrowLeft') setI(n => Math.max(0, n - 1));
      else if (i + 1 >= steps.length) onEnd(); else setI(i + 1);
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [i, steps.length, onEnd]);

  if (!step) { queueMicrotask(onEnd); return null; }
  const pad = 6;
  const hole = rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  // the note goes below the control when there's room, else above; kept inside the window
  const W = Math.min(320, innerWidth - 32);
  const below = !hole || hole.top + hole.height + 180 < innerHeight || hole.top < 200;
  const left = hole ? Math.min(innerWidth - W - 16, Math.max(16, hole.left + hole.width / 2 - W / 2)) : (innerWidth - W) / 2;
  // a tall control (the tool rail) gets its note beside it, on whichever side has room
  const beside = !!hole && hole.height > innerHeight * 0.55 && Math.max(hole.left, innerWidth - hole.left - hole.width) > W + 28;
  const pop: CSSProperties = beside
    ? { width: W, top: innerHeight / 3, left: hole!.left + hole!.width + 12 + W <= innerWidth - 16 ? hole!.left + hole!.width + 12 : hole!.left - 12 - W }
    : { width: W, left, ...(hole ? (below ? { top: Math.min(innerHeight - 170, hole.top + hole.height + 12) } : { bottom: Math.max(16, innerHeight - hole.top + 12) }) : { top: innerHeight / 3 }) };

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={`${step.title} (${i + 1} of ${steps.length})`}>
      <div className="tour-hole" style={hole ?? { left: '50%', top: '50%', width: 0, height: 0 }} />
      <div className="tour-pop" style={pop}>
        <div className="tour-head"><b>{step.title}</b><span className="muted num">{i + 1} / {steps.length}</span></div>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button className="ghost small-btn" onClick={onEnd}>Skip</button>
          <span />
          {i > 0 && <button className="ghost small-btn" onClick={() => setI(i - 1)}>Back</button>}
          <button className="cta primary small-btn" onClick={() => (i + 1 >= steps.length ? onEnd() : setI(i + 1))} autoFocus>{i + 1 >= steps.length ? 'Got it' : 'Next'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
