import { useState } from 'react';
import { matchFingerprint, type Move } from '../engine/recap';
import { VERDICT_LABEL, VERDICT_REASONS, verdictKey, type VerdictReason } from '../engine/profile';
import { removeClip, sendClip, setVerdict, useProfile } from './profileApi';
import { useStore } from '../store';
import { Icon } from './Icon';

/**
 * "Coach was wrong" on a move card. A move the coach marked a mistake (? / ??): "Not a mistake", then why. Any other
 * move: "It was a mistake". Saved on the profile (your account, or this browser) and used to check and tune the coach;
 * when logged in, the round also goes to the site owner's dev page, to check the moment by hand.
 */
export function VerdictBar({ m }: { m: Move }) {
  const data = useStore(s => s.review?.data);
  const round = useStore(s => (s.review ? s.review.round + 1 : 0));
  const verdicts = useProfile(s => s.data.verdicts);
  const [asking, setAsking] = useState(false);
  if (!data) return null;
  const match = matchFingerprint(data);
  const key = verdictKey({ match, round, t: m.t, player: m.player, kind: m.kind });
  const mine = verdicts.find(v => verdictKey(v) === key);
  const flagged = m.note === '?' || m.note === '??';
  const save = (verdict: 'ok' | 'fault', reason: VerdictReason) => {
    setAsking(false);
    const v = { match, map: data.map, round, t: m.t, player: m.player, kind: m.kind, title: m.title, coach: m.note, verdict, reason, at: Date.now() };
    void setVerdict(v);
    // the round goes to the site owner too, to watch the moment and check the coach by hand
    sendClip(v, { note: m.note, title: m.title, why: m.why, tags: m.tags }, data);
  };
  if (mine) return (
    <div className="verdict done">
      <Icon name="check" size={12} />
      <span>You: {mine.verdict === 'ok' ? `not a mistake · ${VERDICT_LABEL[mine.reason].toLowerCase()}` : 'it was a mistake'}</span>
      <button className="verdict-undo" onClick={() => { void setVerdict({ remove: key }); removeClip(key); }} title="Take it back">Undo</button>
    </div>
  );
  if (asking) return (
    <div className="verdict asking">
      <span className="muted">Why?</span>
      {VERDICT_REASONS.filter(r => r !== 'mistake').map(r => <button key={r} className="chip" onClick={() => save('ok', r)}>{VERDICT_LABEL[r]}</button>)}
      <button className="verdict-undo" onClick={() => setAsking(false)} aria-label="Cancel"><Icon name="close" size={11} /></button>
    </div>
  );
  return (
    <div className="verdict" title="Your answer (and, when logged in, this round) goes to the coach's developer to check it">
      <span className="muted">Coach wrong?</span>
      {flagged
        ? <button className="chip" onClick={() => setAsking(true)} title="The coach called this a mistake and it wasn't">Not a mistake</button>
        : <button className="chip" onClick={() => save('fault', 'mistake')} title="The coach let this pass and it was a mistake">It was a mistake</button>}
    </div>
  );
}
