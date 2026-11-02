import { useEffect, useState } from 'react';
import { MarkFace } from '../ui/MarkFace';
import { Loading } from '../ui/Loading';
import { navigate } from '../shell/router';
import { openMatch } from '../deadlock/open';
import { useDl } from '../deadlock/store';
import { ownerDisputes, rule, type DlDispute } from '../deadlock/disputes';
import type { Annotation } from '../engine/recap';

const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The dev page's Deadlock disputes: players saying a mark should be better or worse; watch it and rule. */
export function DevDlDisputes() {
  const [rows, setRows] = useState<DlDispute[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<'open' | 'ruled'>('open');
  const load = () => ownerDisputes().then(setRows, e => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const act = async (id: string, body: Parameters<typeof rule>[1]) => { await rule(id, body).catch(e => setErr(String(e))); await load(); };
  const watch = async (d: DlDispute) => { await openMatch(d.match); useDl.getState().setTime(Math.max(0, d.t - 4)); navigate({ page: 'deadlock', mode: 'review' }); };
  const shown = (rows ?? []).filter(d => (show === 'open' ? !d.ruling : !!d.ruling));
  return (
    <section className="site-card">
      <div className="card-head">
        <h2>Deadlock: Coach wrong?</h2>
        <span className="seg-mini"><button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>To check</button><button className={show === 'ruled' ? 'on' : ''} onClick={() => setShow('ruled')}>Checked</button></span>
      </div>
      {err && <p className="warn-text small">{err}</p>}
      {!rows ? <Loading>Loading…</Loading> : !shown.length ? <p className="empty-state">{show === 'open' ? 'Nothing to check.' : 'Nothing checked yet.'}</p> : (
        <ul className="dl-moves">
          {shown.map(d => (
            <li key={d.id}>
              <MarkFace note={d.note as Annotation} size={24} />
              <span className="dl-move-text"><b>{d.title}</b>
                <span className="muted small">Should be <b>{d.want}</b>{d.comment ? `: "${d.comment}"` : ''} · match {d.match} at {mins(d.t)}{d.tags.length ? ` · ${d.tags.join(', ').toLowerCase()}` : ''}{d.ruling ? ` · ruled: ${d.ruling.side === 'player' ? "player's right" : "coach's right"}` : ''}</span></span>
              <span className="dl-dd-actions">
                <button className="chip" onClick={() => void watch(d)}>Watch</button>
                {!d.ruling ? <>
                  <button className="chip" onClick={() => void act(d.id, { ruling: 'player' })}>Player's right</button>
                  <button className="chip" onClick={() => void act(d.id, { ruling: 'coach' })}>Coach's right</button>
                </> : <button className="chip" onClick={() => void act(d.id, { ruling: null })}>Undo</button>}
                <button className="chip" onClick={() => void act(d.id, { delete: true })}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
