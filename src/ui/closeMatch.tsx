import { useEffect, useState } from 'react';
import { navigate } from '../shell/router';
import { useStore } from '../store';
import { useDl } from '../deadlock/store';

/**
 * Closing a match (round 10, E1): one click from anywhere lands on the game's Review start, with "Match closed · Undo" for a
 * few seconds. The match stays in memory for the undo.
 */
const TOAST = 'rv:toast';
interface ToastDetail { text: string; undo?: () => void }
const toast = (d: ToastDetail) => window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST, { detail: d }));

export function closeCs2Match() {
  const st = useStore.getState(), prev = { review: st.review, report: st.report };
  if (!prev.review) return;
  st.exitReview();
  navigate({ page: 'cs2', mode: 'review' });
  toast({ text: 'Match closed', undo: () => { useStore.setState(prev); navigate({ page: 'cs2', mode: 'report' }); } });
}
export function closeDlMatch() {
  const st = useDl.getState(), prev = { match: st.match, demo: st.demo, demoStatus: st.demoStatus };
  if (!prev.match) return;
  st.close();
  navigate({ page: 'deadlock', mode: 'review' });
  toast({ text: 'Match closed', undo: () => { useDl.setState(prev); navigate({ page: 'deadlock', mode: 'report' }); } });
}

/** The toast host: one at a time, 8 s, with Undo. */
export function ToastHost() {
  const [t, setT] = useState<ToastDetail | null>(null);
  useEffect(() => {
    let timer = 0;
    const on = (e: Event) => { setT((e as CustomEvent<ToastDetail>).detail); clearTimeout(timer); timer = window.setTimeout(() => setT(null), 8000); };
    window.addEventListener(TOAST, on);
    return () => { window.removeEventListener(TOAST, on); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return (
    <div className="hint-card rv-toast" role="status">
      <span>{t.text}</span>
      {t.undo && <button className="cta small-btn" onClick={() => { t.undo!(); setT(null); }}>Undo</button>}
      <button className="ghost small-btn" onClick={() => setT(null)}>Dismiss</button>
    </div>
  );
}
