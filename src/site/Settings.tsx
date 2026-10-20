import { useState } from 'react';
import { STEAM_AVAILABLE } from '../env';
import { PRO_MODEL } from '../engine/coachModels';
import { useStore } from '../store';
import { Icon } from '../ui/Icon';
import { forgetProfile, refreshProfile, setPrefs, useProfile } from '../ui/profileApi';
import { SteamLoginButton } from '../ui/SteamLogin';
import { steamSignOut } from '../ui/steamApi';

/** Your account, privacy, the coach's and Review's defaults, and your data. */
export function Settings() {
  const { me, data, remote } = useProfile();
  const s = useStore();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const signOut = async () => { await steamSignOut(); useStore.setState({ me: null }); await refreshProfile(); };
  const forget = async () => {
    try { await forgetProfile(); setDone(remote ? 'Your profile and match list were deleted from your account.' : 'This browser\'s profile was deleted.'); }
    catch (e) { setDone(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`); }
    setConfirm(false);
  };
  return (
    <div className="page settings">
      <header className="page-head"><h1>Settings</h1></header>

      <section className="site-card">
        <h2>Account</h2>
        {me ? (
          <div className="setting">
            <div className="setting-text">
              <b>{me.avatar && <img src={me.avatar} alt="" width={20} height={20} className="inline-avatar" />} {me.name ?? me.steamId}</b>
              <span className="muted">Logged in with Steam. We only know your SteamID, public name and avatar.</span>
            </div>
            <button className="cta" onClick={signOut}><Icon name="signOut" size={14} /> Sign out</button>
          </div>
        ) : (
          <div className="setting">
            <div className="setting-text"><b>Not logged in</b><span className="muted">Your profile is kept in this browser. Log in to keep it on every device and compare with friends.</span></div>
            {STEAM_AVAILABLE ? <SteamLoginButton compact /> : <span className="muted small">Steam login isn't available in this build.</span>}
          </div>
        )}
        <div className="setting">
          <div className="setting-text">
            <b>You in demos</b>
            <span className="muted">{s.me ? 'Your Steam account decides which player is you.' : s.claimed ? `Picked with This is me: ${s.review?.data.names[s.claimed] ?? `SteamID ${s.claimed}`}.` : 'Pick yourself in Review (Mine…) or in the recap (This is me).'}</span>
          </div>
          {!s.me && s.claimed && <button className="cta" onClick={() => s.setClaimed(null)}>Forget</button>}
        </div>
      </section>

      <section className="site-card">
        <h2>Privacy</h2>
        <Toggle label="Public profile" on={data.prefs.public} disabled={!remote}
          text={remote ? 'Friends who know your Steam profile can compare their last matches with yours (your name, avatar and the numbers of your last 5 matches; never your demos).' : 'Log in with Steam to make your profile public.'}
          onChange={v => setPrefs({ public: v })} />
        <div className="setting">
          <div className="setting-text"><b>Delete my data</b><span className="muted">{remote ? 'Removes your profile, goals and match list from your account. Demos you reviewed are not stored anywhere.' : 'Removes the profile kept in this browser.'}</span></div>
          {confirm
            ? <span className="confirm-row"><button className="cta danger" onClick={forget}>Delete for good</button><button className="ghost" onClick={() => setConfirm(false)}>Cancel</button></span>
            : <button className="cta" onClick={() => setConfirm(true)}>Delete…</button>}
        </div>
        {done && <p className="muted small">{done}</p>}
      </section>

      <section className="site-card">
        <h2>Coach</h2>
        <div className="setting">
          <div className="setting-text"><b>Compare with</b><span className="muted">What the recap's coach and analyst compare you with first.</span></div>
          <div className="seg-mini">
            <button className={data.prefs.compare === 'lvl10' ? 'on' : ''} onClick={() => setPrefs({ compare: 'lvl10' })}>Level 10</button>
            <button className={data.prefs.compare === 'pro' ? 'on' : ''} disabled={!PRO_MODEL} onClick={() => setPrefs({ compare: 'pro' })}>Pro</button>
          </div>
        </div>
      </section>

      <section className="site-card">
        <h2>Review</h2>
        <Toggle label="Move cards" on={s.popups} text="A card with the grade and the reasons for each graded move." onChange={s.setPopups} />
        <Toggle label="Arrows" on={s.engineLines} text="For checking the engine: its best option drawn next to what was done, and a line from each card to its player. Off by default." onChange={s.setEngineLines} />
        <Toggle label="Slow motion while reading" on={s.readSlow} text="The replay slows down while a card is open." onChange={s.setReadSlow} />
        <div className="setting">
          <div className="setting-text"><b>Grade</b><span className="muted">Every player's moves, or only yours (when the site knows which player you are).</span></div>
          <div className="seg-mini">
            <button className={s.evalScope === 'all' ? 'on' : ''} onClick={() => s.setEvalScope('all')}>All</button>
            <button className={s.evalScope === 'mine' ? 'on' : ''} onClick={() => s.setEvalScope('mine')}>Mine</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, text, on, disabled, onChange }: { label: string; text: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`setting ${disabled ? 'disabled' : ''}`}>
      <span className="setting-text"><b>{label}</b><span className="muted">{text}</span></span>
      <input type="checkbox" role="switch" className="switch" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}
