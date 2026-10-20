import { useRef, useState } from 'react';
import { profileMatchOf } from '../engine/habits';
import { buildMatchReport } from '../engine/match';
import { useStore, whoAmI } from '../store';
import { gradeMatch } from '../ui/gradeMatch';
import { Icon } from '../ui/Icon';
import { recordMatch, useProfile } from '../ui/profileApi';
import { matchKey } from '../engine/profile';
import { readDemoFile } from '../ui/readDemo';
import { mapName } from './format';

type Item = { name: string; state: 'waiting' | 'reading' | 'grading' | 'added' | 'skipped' | 'failed'; share: number; note?: string };

/**
 * Several of your demos onto your profile in one go: each is read in this browser, graded, and added (only your
 * numbers; the demo isn't kept), one after another so the browser's memory holds one match at a time.
 */
export function AddMatches() {
  const me = useStore(whoAmI);
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<Item>) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const run = async (picked: File[]) => {
    // the replays folder also holds a small .info file per match: only demos (and saved reads) count
    const files = picked.filter(f => /\.(dem|json)$/i.test(f.name));
    if (!me || !files.length) return;
    setItems(files.map(f => ({ name: f.name, state: 'waiting', share: 0 })));
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      try {
        set(i, { state: 'reading', share: 0 });
        const data = await readDemoFile(files[i], share => set(i, { share }));
        if (!data.rounds.some(r => r.frames.players[me])) { set(i, { state: 'skipped', note: 'you aren\'t in this match' }); continue; }
        if (useProfile.getState().data.matches.some(m => m.id === matchKey(data.map, data.rounds))) { set(i, { state: 'skipped', note: 'already on your profile' }); continue; }
        set(i, { state: 'grading', share: 0 });
        const { rounds, error } = await gradeMatch(data, useStore.getState().board.context,
          rs => set(i, { share: rs.filter(Boolean).length / rs.length })).done;
        if (error && !rounds.some(Boolean)) throw new Error(error);
        const view = buildMatchReport(data, rounds);
        const p = view.players.find(x => x.id === me);
        if (!p?.played) { set(i, { state: 'skipped', note: 'no rounds of yours could be graded' }); continue; }
        const m = profileMatchOf(data, view, p, rounds.map(r => r?.analyst));
        await recordMatch(m);
        set(i, { state: 'added', note: `${mapName(m.map)} ${m.score[0]}:${m.score[1]}, ${m.kills}/${m.deaths}` });
      } catch (e) {
        set(i, { state: 'failed', note: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
  };

  return (
    <section className="site-card add-matches">
      <div className="card-head">
        <h2><Icon name="upload" size={16} /> Add matches</h2>
        {me && <button className="cta small-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Adding…' : 'Choose demos'}</button>}
      </div>
      {!me ? (
        <p className="muted">Log in with Steam (or pick yourself with Mine… in Review) so the site knows which player you are in your demos.</p>
      ) : !items.length ? (
        <p className="muted">Pick several of your demos at once (.dem, or FACEIT/HLTV ones unzipped). Each is read and graded here, about a minute each,
          and goes on your profile. Keep this tab open while it works.</p>
      ) : (
        <ul className="add-list">
          {items.map((it, i) => (
            <li key={i} className={it.state}>
              <span className="add-name" title={it.name}>{it.name}</span>
              <span className="add-state">
                {it.state === 'waiting' && <span className="muted">waiting</span>}
                {(it.state === 'reading' || it.state === 'grading') && <>
                  <span className="add-bar"><i style={{ width: `${Math.max(3, it.share * 100)}%` }} /></span>
                  <span className="muted">{it.state === 'reading' ? 'reading' : 'grading'} {Math.round(it.share * 100)}%</span>
                </>}
                {it.state === 'added' && <span className="up"><Icon name="check" size={13} /> {it.note}</span>}
                {it.state === 'skipped' && <span className="muted">skipped: {it.note}</span>}
                {it.state === 'failed' && <span className="down">couldn't read: {it.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" accept=".dem,.json,.info" multiple hidden onChange={e => { run([...(e.target.files ?? [])]); e.target.value = ''; }} />
    </section>
  );
}
