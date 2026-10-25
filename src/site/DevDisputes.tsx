import { useEffect, useState } from 'react';
import type { DemoData } from '../engine/recap';
import { VERDICT_LABEL, type MoveVerdict } from '../engine/profile';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { steamFetch } from '../ui/steamApi';
import { fmtDate, mapName } from './format';

/** One disputed moment (worker/src/clips.ts). */
interface Clip {
  id: string; from: string; at: number; verdict: MoveVerdict; done?: boolean; size: number;
  card: { note: string; title: string; why: string[]; tags: string[] };
}
/** The moment is watched from this long before it, to see what led to it. */
const LEAD = 15;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * The dev page's Disputes tab: every "Coach wrong?" a logged-in player pressed, with the coach's card and their
 * answer. Watch opens that round in Review, 15 s before the moment; Done files it away once checked.
 */
export function DevDisputes({ myId }: { myId: string | null }) {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<'open' | 'done'>('open');
  const [opening, setOpening] = useState<string | null>(null);
  const startReview = useStore(s => s.startReview), setTime = useStore(s => s.setTime), setPlaying = useStore(s => s.setPlaying);

  const call = async (path: string, body?: unknown) => {
    const res = await steamFetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `The Worker answered ${res.status}.`);
    return out;
  };
  const load = async () => {
    setErr(null);
    try { setClips((await call('/admin/clips')).clips ?? []); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const watch = async (c: Clip) => {
    setOpening(c.id); setErr(null);
    try {
      const data = await call(`/admin/clip/${c.id}`) as DemoData;
      startReview(data);
      location.hash = '#/cs2/review';
      setTime(Math.max(0, c.verdict.t - LEAD));
      setPlaying(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setOpening(null);
  };
  const update = async (c: Clip, change: { done?: boolean; delete?: boolean }) => {
    try {
      await call(`/admin/clip/${c.id}`, change);
      setClips(cs => (change.delete ? (cs ?? []).filter(x => x.id !== c.id) : (cs ?? []).map(x => (x.id === c.id ? { ...x, done: change.done } : x))));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const open = (clips ?? []).filter(c => !c.done), done = (clips ?? []).filter(c => c.done);
  const rows = show === 'open' ? open : done;
  return (
    <section className="site-card">
      <div className="card-head">
        <h2>Disputed moments</h2>
        <span className="muted small">"Coach wrong?" from logged-in players · Watch starts {LEAD} s before</span>
      </div>
      <div className="dispute-filter">
        <button className={`chip${show === 'open' ? ' on' : ''}`} onClick={() => setShow('open')}>To check {open.length}</button>
        <button className={`chip${show === 'done' ? ' on' : ''}`} onClick={() => setShow('done')}>Checked {done.length}</button>
        <button className="ghost small-btn" onClick={load}>Refresh</button>
      </div>
      {err && <p className="warn-text small">{err}</p>}
      {!clips ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">{show === 'open' ? 'Nothing to check.' : 'Nothing checked yet.'}</p> : (
        <ul className="dispute-list">
          {rows.map(c => {
            const v = c.verdict;
            return (
              <li key={c.id} className="dispute">
                <div className="dispute-top">
                  <span className="dispute-where">{mapName(v.map)} · R{v.round} · {clock(v.t)}</span>
                  <span className="muted small">{c.from === myId ? 'You' : c.from} · {fmtDate(c.at)}</span>
                </div>
                <div className="dispute-card">
                  <b className={`dispute-note ${c.card.note === '?' || c.card.note === '??' ? 'bad' : c.card.note === '?!' ? 'warn' : c.card.note.startsWith('!') ? 'good' : ''}`}>{c.card.note === 'book' ? '·' : c.card.note}</b>
                  <span>{c.card.title}</span>
                </div>
                <div className={`dispute-says ${v.verdict}`}>
                  {v.verdict === 'ok' ? `Not a mistake · ${VERDICT_LABEL[v.reason]}` : 'It was a mistake'}{v.note ? `: ${v.note}` : ''}
                </div>
                {c.card.why.length > 0 && (
                  <details className="dispute-why"><summary className="muted small">Coach's reasons</summary>
                    <ul>{c.card.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}
                <div className="dispute-actions">
                  <button className="cta primary small-btn" onClick={() => watch(c)} disabled={opening === c.id}><Icon name="play" size={12} /> {opening === c.id ? 'Opening…' : 'Watch'}</button>
                  <button className="ghost small-btn" onClick={() => update(c, { done: !c.done })}>{c.done ? 'Back to check' : 'Done'}</button>
                  <button className="ghost small-btn" onClick={() => update(c, { delete: true })}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
