import { useState } from 'react';
import { matchFingerprint, type Move } from '../engine/recap';
import { VERDICT_LABEL, verdictKey, type VerdictReason } from '../engine/profile';
import { removeClip, sendClip, setVerdict, useProfile } from './profileApi';
import { useStore } from '../store';
import { Icon } from './Icon';

/**
 * "Coach was wrong" on a move card: one press. A move the coach marked a mistake (? / ??): "Not a mistake"; any other
 * move: "It was a mistake". A note can be added afterwards, if they want to. Saved on
 * the profile (your account, or this browser) and used to check and tune the coach; when logged in, the round also goes
 * to the site owner's dev page, where their call on it teaches the coach (engine/corrections.ts).
 */
export function VerdictBar({ m }: { m: Move }) {
  const data = useStore(s => s.review?.data);
  const round = useStore(s => (s.review ? s.review.round + 1 : 0));
  const verdicts = useProfile(s => s.data.verdicts);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return null;
  const match = matchFingerprint(data);
  const key = verdictKey({ match, round, t: m.t, player: m.player, kind: m.kind });
  const mine = verdicts.find(v => verdictKey(v) === key);
  const flagged = m.note === '?' || m.note === '??';
  const save = (verdict: 'ok' | 'fault', reason: VerdictReason, text = note ?? '') => {
    setNote(null);
    const v = { match, map: data.map, round, t: m.t, player: m.player, kind: m.kind, title: m.title, coach: m.note, verdict, reason, ...(text.trim() ? { note: text.trim().slice(0, 200) } : {}), at: Date.now() };
    void setVerdict(v);
    // the round goes to the site owner too, to watch the moment and check the coach by hand
    sendClip(v, { note: m.note, title: m.title, why: m.why, tags: m.tags }, data);
  };
  // the card scrolls: bring the field and its buttons into view when it opens
  const show = (el: HTMLDivElement | null) => { el?.scrollIntoView({ block: 'nearest' }); };
  const noteField = (onEnter: () => void) => (
    <input className="verdict-note" type="text" maxLength={200} autoFocus placeholder="What did the coach miss? (optional)" value={note ?? ''}
      onChange={e => setNote(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') onEnter(); if (e.key === 'Escape') setNote(null); }} />
  );
  if (mine && note === null) return (
    <div className="verdict done">
      <Icon name="check" size={12} />
      <span>You: {mine.verdict === 'ok' ? `not a mistake${mine.reason !== 'other' ? ` · ${VERDICT_LABEL[mine.reason].toLowerCase()}` : ''}` : 'it was a mistake'}{mine.note ? <em className="muted"> · “{mine.note}”</em> : null}</span>
      <button className="verdict-undo" onClick={() => setNote(mine.note ?? '')} title="Write what the coach missed">{mine.note ? 'Edit note' : 'Add a note'}</button>
      <button className="verdict-undo" onClick={() => { void setVerdict({ remove: key }); removeClip(key); }} title="Take it back">Undo</button>
    </div>
  );
  if (mine) return (
    <div className="verdict asking" ref={show}>
      {noteField(() => save(mine.verdict, mine.reason))}
      <button className="chip" onClick={() => save(mine.verdict, mine.reason)}>Save</button>
      <button className="verdict-undo" onClick={() => setNote(null)} aria-label="Cancel"><Icon name="close" size={11} /></button>
    </div>
  );
  return (
    <div className="verdict" title="Your answer (and, when logged in, this round) goes to the coach's developer to check it">
      <span className="muted">Coach wrong?</span>
      {flagged
        ? <button className="chip" onClick={() => save('ok', 'other')} title="The coach called this a mistake and it wasn't">Not a mistake</button>
        : <button className="chip" onClick={() => save('fault', 'mistake')} title="The coach let this pass and it was a mistake">It was a mistake</button>}
    </div>
  );
}
