import { useEffect, useState } from 'react';
import type { DemoData } from '../engine/recap';
import { VERDICT_LABEL, type MoveVerdict } from '../engine/profile';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { steamFetch } from '../ui/steamApi';
import { fmtDate, mapName } from './format';
import { MIN_CASES, MIN_SHARE, type CorrectionTable } from '../engine/corrections';

/** One disputed moment (worker/src/clips.ts). */
interface Clip {
  id: string; from: string; at: number; verdict: MoveVerdict; done?: boolean; size: number;
  card: { note: string; title: string; why: string[]; tags: string[] };
  /** Your call: the player was right (the coach was wrong) or the coach was. The coach learns from these. */
  ruling?: { side: 'player' | 'coach'; note?: string; at: number };
}
/** The moment is watched from this long before it, to see what led to it. */
const LEAD = 15;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * The dev page's Disputes tab: every "Coach wrong?" a logged-in player pressed, with the coach's card, their answer and
 * what they wrote. Watch opens that round in Review, 15 s before the moment. Your call (player's right / coach was
 * right, with a note) teaches the coach: enough calls on one kind of move change how it's marked for everyone
 * (engine/corrections.ts). Download gives the checked moments to the coach's own tests (tools/verdicts-lib.ts).
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
  // what the rulings have taught the coach so far
  const [learned, setLearned] = useState<CorrectionTable | null>(null);
  const loadLearned = async () => { try { setLearned((await call('/corrections')).table ?? {}); } catch { /* an older Worker */ } };
  useEffect(() => { load(); loadLearned(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const update = async (c: Clip, change: { done?: boolean; delete?: boolean; ruling?: 'player' | 'coach' | null; rulingNote?: string }) => {
    try {
      const out = await call(`/admin/clip/${c.id}`, change);
      setClips(cs => (change.delete ? (cs ?? []).filter(x => x.id !== c.id) : (cs ?? []).map(x => (x.id === c.id ? (out.clip as Clip) ?? x : x))));
      if ('ruling' in change) loadLearned();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  // your note on a moment, while you write it
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteOf = (c: Clip) => notes[c.id] ?? c.ruling?.note ?? '';

  // the checked moments with their rounds, for the coach's tests (put the file in the my-demos folder)
  const [saving, setSaving] = useState(false);
  const download = async () => {
    setSaving(true); setErr(null);
    try {
      const moments = [];
      for (const c of (clips ?? []).filter(x => x.ruling)) {
        try { moments.push({ verdict: c.verdict, card: c.card, ruling: c.ruling, demo: await call(`/admin/clip/${c.id}`) as DemoData }); } catch { /* gone */ }
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify({ moments })], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `disputes-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setSaving(false);
  };
  const ruled = (clips ?? []).filter(c => c.ruling).length;

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
        <span className="dispute-filter-end">
          <button className="ghost small-btn" onClick={download} disabled={!ruled || saving} title="The moments you've ruled on, with their rounds, for the coach's tests: put the file in the my-demos folder">{saving ? 'Packing…' : `Download ${ruled} checked`}</button>
          <button className="ghost small-btn" onClick={load}>Refresh</button>
        </span>
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
                  {v.verdict === 'ok' ? `Not a mistake · ${VERDICT_LABEL[v.reason]}` : 'It was a mistake'}
                </div>
                {v.note && <blockquote className="dispute-quote">{v.note}</blockquote>}
                {c.card.why.length > 0 && (
                  <details className="dispute-why"><summary className="muted small">Coach's reasons</summary>
                    <ul>{c.card.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}
                <div className="dispute-actions">
                  <button className="cta primary small-btn" onClick={() => watch(c)} disabled={opening === c.id}><Icon name="play" size={12} /> {opening === c.id ? 'Opening…' : 'Watch'}</button>
                  <span className="dispute-ruling" role="group" aria-label="Who was right">
                    <button className={`chip${c.ruling?.side === 'player' ? ' on' : ''}`} onClick={() => update(c, { ruling: c.ruling?.side === 'player' ? null : 'player', rulingNote: noteOf(c) })}
                      title="The coach got it wrong: it learns from this">Player's right</button>
                    <button className={`chip${c.ruling?.side === 'coach' ? ' on' : ''}`} onClick={() => update(c, { ruling: c.ruling?.side === 'coach' ? null : 'coach', rulingNote: noteOf(c) })}
                      title="The coach's mark was right">Coach was right</button>
                  </span>
                  {!c.ruling && <button className="ghost small-btn" onClick={() => update(c, { done: !c.done })}>{c.done ? 'Back to check' : 'Skip'}</button>}
                  <button className="ghost small-btn" onClick={() => update(c, { delete: true })} title="Removes the moment; a call you made on it still counts">Delete</button>
                </div>
                <div className="dispute-mynote">
                  <input type="text" maxLength={400} placeholder="Your note: what the coach should have seen (optional)" value={noteOf(c)}
                    onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} />
                  {c.ruling && notes[c.id] !== undefined && notes[c.id] !== (c.ruling.note ?? '') &&
                    <button className="ghost small-btn" onClick={() => { void update(c, { ruling: c.ruling!.side, rulingNote: notes[c.id] }); setNotes(n => { const { [c.id]: _, ...rest } = n; return rest; }); }}>Save note</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {learned && Object.keys(learned).length > 0 && (
        <details className="dispute-learned">
          <summary className="muted small">What the coach learned from your calls ({(n => `${n} kind${n === 1 ? '' : 's'} of move changed`)(Object.values(learned).filter(c => c.wrong >= MIN_CASES && c.wrong / (c.wrong + c.right) >= MIN_SHARE).length)})</summary>
          <table className="site-table"><tbody>
            {Object.entries(learned).sort((a, b) => b[1].wrong - a[1].wrong).map(([pattern, c]) => {
              const [kind, note, tags] = pattern.split('|');
              const on = c.wrong >= MIN_CASES && c.wrong / (c.wrong + c.right) >= MIN_SHARE;
              return (
                <tr key={pattern}>
                  <td>{kind} <b>{note === 'book' ? '·' : note}</b>{tags ? ` · ${tags.replace(/,/g, ', ')}` : ''}</td>
                  <td className="num">player {c.wrong} · coach {c.right}</td>
                  <td className={on ? 'up' : 'muted'}>{on ? 'changed' : c.wrong < MIN_CASES ? `${MIN_CASES - c.wrong} more to change` : 'coach mostly right'}</td>
                </tr>
              );
            })}
          </tbody></table>
        </details>
      )}
    </section>
  );
}
