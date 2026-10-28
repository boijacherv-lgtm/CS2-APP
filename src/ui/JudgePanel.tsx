import { useEffect, useState } from 'react';
import { VERDICT_LABEL } from '../engine/profile';
import { JUDGE_REASONS, type JudgeReason } from '../engine/corrections';
import { useStore } from '../store';
import { changeClip, listClips, openClip, toJudge, type Clip } from './disputesApi';
import { Icon } from './Icon';

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Judging disputed moments one after another, on the board: the 20 s clip plays, this panel shows what the coach said
 * and what the player answered. Your call (player's right / coach was right), why (what the coach missed: the coach
 * counts these and names the usual one on the cards it corrects) and a note (for fixing the coach's rules by hand) go
 * to the coach, and the next moment opens. Keys: 1 player's right, 2 coach was right, S skip, R replay.
 */
export function JudgePanel() {
  const judging = useStore(s => s.judging)!;
  const c = judging.clip;
  const [queue, setQueue] = useState<Clip[] | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<JudgeReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => { listClips().then(cs => setQueue(toJudge(cs))).catch(() => setQueue([])); }, []);
  useEffect(() => { setNote(c.ruling?.note ?? ''); setReason(c.ruling?.reason ?? null); setErr(null); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = (queue ?? []).filter(x => x.id !== c.id);
  const next = async (change: Parameters<typeof changeClip>[1] | null) => {
    setBusy(true); setErr(null);
    try {
      if (change) await changeClip(c, change);
      setQueue(left);
      if (left.length) await openClip(left[0]);
      else { setFinished(true); useStore.setState({ playing: false }); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const replay = () => useStore.setState({ time: judging.from, playing: true });
  const rule = (side: 'player' | 'coach') => next({ ruling: side, ...(reason ? { rulingReason: reason } : {}), rulingNote: note });
  // keys, to judge fast (not while typing the note)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey || busy || finished) return;
      const k = e.key.toLowerCase();
      if (k === '1') rule('player'); else if (k === '2') rule('coach'); else if (k === 's') next({ done: true }); else if (k === 'r') replay();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  const exit = () => { useStore.setState({ judging: null, playing: false }); location.hash = '#/dev'; };

  if (finished) return (
    <div className="judge">
      <div className="judge-head"><b>All checked</b><button className="judge-x" onClick={exit} aria-label="Back to Disputes"><Icon name="close" size={12} /></button></div>
      <p className="muted">No more moments to judge. Your calls are with the coach.</p>
      <button className="cta primary small-btn" onClick={exit}>Back to Disputes</button>
    </div>
  );
  const v = c.verdict, mark = c.card.note;
  return (
    <div className="judge" onKeyDown={e => e.stopPropagation()}>
      <div className="judge-head">
        <b>Judging</b>
        <span className="muted small">{queue ? `${left.length} more after this` : '…'}</span>
        <button className="judge-x" onClick={exit} title="Stop judging (back to Disputes)" aria-label="Stop judging"><Icon name="close" size={12} /></button>
      </div>
      <div className="judge-card">
        <b className={`dispute-note ${mark === '?' || mark === '??' ? 'bad' : mark === '?!' ? 'warn' : mark.startsWith('!') ? 'good' : ''}`}>{mark === 'book' ? '·' : mark}</b>
        <span>{c.card.title}</span>
      </div>
      {c.ask ? <div className="dispute-says ask">Coach asks: {c.ask.why}</div>
        : <div className={`dispute-says ${v.verdict}`}>Player: {v.verdict === 'ok' ? 'not a mistake' : 'it was a mistake'}{v.reason !== 'other' && v.reason !== 'mistake' ? ` · ${VERDICT_LABEL[v.reason].toLowerCase()}` : ''}</div>}
      {v.note && !c.ask && <blockquote className="dispute-quote">{v.note}</blockquote>}
      {c.card.why.length > 0 && (
        <details className="dispute-why"><summary className="muted small">Coach's reasons</summary>
          <ul>{c.card.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      <div className="judge-clip muted small">
        Clip {clock(judging.from)}–{clock(judging.to)} · the moment at {clock(v.t)}
        <button className="ghost small-btn" onClick={replay}><Icon name="toStart" size={11} /> Replay <kbd>R</kbd></button>
      </div>
      <div className="judge-why">
        <span className="muted small">Why: what the coach missed (or the player did wrong)</span>
        <div className="judge-reasons">
          {(Object.keys(JUDGE_REASONS) as JudgeReason[]).map(r => (
            <button key={r} className={`chip${reason === r ? ' on' : ''}`} onClick={() => setReason(reason === r ? null : r)}>{JUDGE_REASONS[r]}</button>
          ))}
        </div>
      </div>
      <input className="verdict-note" type="text" maxLength={400} placeholder="Your note: what the coach should have seen (optional)" value={note}
        onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
      <div className="judge-actions">
        <button className="cta primary small-btn" disabled={busy} onClick={() => rule('player')} title="The coach got it wrong: it learns from this (key 1)">{c.ask ? 'Mark is wrong' : 'Player\'s right'} <kbd>1</kbd></button>
        <button className="cta small-btn" disabled={busy} onClick={() => rule('coach')} title="The coach's mark was right (key 2)">{c.ask ? 'Mark is right' : 'Coach was right'} <kbd>2</kbd></button>
        <button className="ghost small-btn" disabled={busy} onClick={() => next({ done: true })} title="Leave it out: it moves to Checked, without a call (key S)">Skip <kbd>S</kbd></button>
      </div>
      {err && <p className="warn-text small">{err}</p>}
    </div>
  );
}
