import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Arc, Circle, Group, Image as KImage, Layer, Line, Shape, Text } from 'react-konva';
import { NOTE_INFO } from '../engine/recap';
import { Icon } from '../ui/Icon';
import { loadMatch, requestParse } from './api';
import { speedAt, type D2Move } from './coach';
import { buildingOf, CAMP_ICONS, heroOf, isNight, itemByKey, itemLook, mins, nextDawnOrDusk, OBS_VISION, skillLook, roshanOnMap, RUNE_ICONS, runeIcon, RUNE_NAME, TEAM_COLOR, visionShape, type D2Team } from './data';
import { D2Map, drawCamps, useImages } from './D2Map';
import { TalentTree } from './D2Talents';
import { buildingUp, deadAt, kdAt, lastKnown, netWorthAt, seriesAt, teamKillsAt, type D2Event, type D2Match } from './match';
import { useD2 } from './store';
import { campsNow, heroAt, heroTrail, itemCooldownAt, itemsAt, skillsAt, unitsAt, vitalsAt, type Cooldown, type SkillNow } from './tracks';
import { useTac } from './tacticalStore';
import { useCoach } from './useCoach';
import { navigate } from '../shell/router';

const PHASES = [{ label: 'Laning', t: 0 }, { label: 'Mid game', t: 600 }, { label: 'Late game', t: 1800 }];
const SPEEDS = [1, 2, 4, 8, 16, 32];
/** A moment is shown from this long before it, and marked on the map until this long after. */
const LEAD = 5, MOMENT_AFTER = 8;
const SLOW_KEY = 'stratboard.d2.slow';
/** How long a chat line stays on the board (s), and how many at once. */
const CHAT_SHOWN = 15, CHAT_LINES = 4;

type Show = { creeps: boolean; neutrals: boolean; couriers: boolean };
const SHOW_LABEL: Record<keyof Show, string> = { creeps: 'Creeps', neutrals: 'Neutrals', couriers: 'Couriers' };

/** Dota 2 Review's board: the map (heroes, creeps, Roshan, runes, wards, buildings, fights), both teams, and playback. */
export function D2Board() {
  const match = useD2(s => s.match)!;
  const [show, setShow] = useState<Show>({ creeps: true, neutrals: true, couriers: true });
  const time = useD2(s => s.time), playing = useD2(s => s.playing), speed = useD2(s => s.speed), selected = useD2(s => s.selected);
  const replay = useD2(s => s.replay);
  const tracks = replay.status === 'ready' ? replay.tracks : null;

  const coach = useCoach();
  const graded = useMemo(() => coach.shown.filter(m => m.note !== 'book'), [coach.shown]);
  const [slow, setSlowState] = useState(() => { try { return localStorage.getItem(SLOW_KEY) !== 'off'; } catch { return true; } });
  const setSlow = (on: boolean) => { setSlowState(on); try { localStorage.setItem(SLOW_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const s = useD2.getState();
      const t = Math.min(match.duration, s.time + ((now - last) / 1000) * speedAt(graded, s.time, s.speed, slow));
      last = now;
      useD2.setState({ time: t, ...(t >= match.duration ? { playing: false } : {}) });
      if (t < match.duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, match.duration, graded, slow]);
  // the panel below a team sticks to the column's bottom: don't let it cover the player it's about
  useEffect(() => {
    const row = document.querySelector('.d2-board .dl-player.on'), column = row?.closest('.dl-team');
    const panel = column?.querySelector('.d2-under');
    if (!row || !column || !panel) return;
    const covered = row.getBoundingClientRect().bottom - panel.getBoundingClientRect().top;
    if (covered > 0) column.scrollBy({ top: covered + 4 });
  }, [selected]);
  // the moment being talked about: shown on the map and on its hero's row
  const moment = [...graded].reverse().find(m => time >= m.t - LEAD && time <= m.t + MOMENT_AFTER) ?? null;
  /** The move whose window was closed: the next one opens its own. */
  const [closed, setClosed] = useState<D2Move | null>(null);
  // keys: Space play / pause, ← → the previous / next graded moment, Shift + ← → 30 s
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      const s = useD2.getState();
      if (e.key === ' ') { e.preventDefault(); if (!s.playing && s.time >= match.duration) s.setTime(match.start); s.setPlaying(!s.playing); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) s.setTime(s.time + (e.key === 'ArrowRight' ? 30 : -30));
        else stepMoment(graded, e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [match, graded]);

  const feed = match.deaths.filter(d => d.t <= time && time - d.t < 40).slice(-5).reverse();
  const chatNow = match.chat.filter(c => c.t <= time && time - c.t < CHAT_SHOWN).slice(-CHAT_LINES).reverse();
  const news = match.events.filter(e => e.t <= time && time - e.t < 40).slice(-3).reverse();
  const newsText = (e: D2Event) => {
    if (e.kind === 'rune') return `${nameOf(e.slot)} took ${RUNE_NAME[e.rune] ?? 'a rune'}`;
    if (e.kind === 'building') { const b = buildingOf.get(e.uid)!; return `${match.names[b.team]} lost ${b.name}`; }
    return `${match.names[e.team]} ${e.kind === 'roshan' ? 'killed Roshan' : e.kind === 'tormentor' ? 'killed a Tormentor' : 'took the Aegis'}`;
  };
  const nameOf = (slot: number | null) => {
    if (slot === null) return 'creeps';
    const p = match.players[slot];
    return p.name ?? heroOf(p.hero).name;
  };

  return (
    <div className="dl-board d2-board">
      <div className="dl-top">
        <div className="dl-score">
          <span className="dl-team-score" style={{ color: TEAM_COLOR[0] }}>{match.names[0]} <b>{teamKillsAt(match, 0, time)}</b></span>
          <span className="dl-clock num"><DayNight t={time} />{mins(time)}</span>
          <span className="dl-team-score" style={{ color: TEAM_COLOR[1] }}><b>{teamKillsAt(match, 1, time)}</b> {match.names[1]}</span>
        </div>
      </div>
      {!match.parsed && <NotParsed match={match} />}

      <div className="dl-main">
        {([0, 1] as D2Team[]).map(team => (
          <aside key={team} className={`dl-team t${team}`} aria-label={match.names[team]}>
            <div className="dl-team-head" style={{ color: TEAM_COLOR[team] }}>{match.names[team]}{match.winner === team && time >= match.duration ? ' · won' : ''}</div>
            <TeamGold match={match} team={team} time={time} />
            {match.players.filter(p => p.team === team).map(p => {
              const h = heroOf(p.hero), kd = kdAt(match, p.slot, time), dead = deadAt(match, p.slot, time);
              const slots = tracks ? itemsAt(tracks, p.hero, time) : null, hp = tracks ? heroAt(tracks, p.hero, time)?.hp : undefined;
              const vitals = tracks ? vitalsAt(tracks, p.hero, time) : null, skills = tracks ? skillsAt(tracks, p.hero, time) : [];
              const itemCd = (s: string | null | undefined) => (tracks && s ? itemCooldownAt(tracks, p.hero, s, time) : null);
              return (
                <button key={p.slot} className={`dl-player ${dead ? 'dead' : ''} ${selected === p.slot ? 'on' : ''} ${moment?.slot === p.slot ? 'd2-row-moment' : ''}`} style={moment?.slot === p.slot ? { '--grade': NOTE_INFO[moment.note].color } as CSSProperties : undefined} onClick={() => useD2.getState().select(selected === p.slot ? null : p.slot)} title="Show what this hero carries right now, and their way">
                  {h.icon ? <img className="d2-row-hero" src={h.icon} alt="" width={32} height={32} /> : <span className="dl-hero-dot" style={{ background: TEAM_COLOR[team] }} />}
                  <span className="dl-player-name" title={h.name}>
                    <b>{p.name ?? h.name}</b>
                    {skills.length ? <span className="d2-row-skills">{skills.map(s => <SkillCell key={s.name} skill={s} heroKey={h.key} />)}</span> : <span className="muted small">{h.name}</span>}
                  </span>
                  {vitals && <span className="d2-row-level num" title="Level">{vitals.level}</span>}
                  <span className="dl-player-kda num">{match.parsed ? `${kd.k}/${kd.d}` : `${p.kills}/${p.deaths}/${p.assists}`}</span>
                  <span className="dl-player-souls num muted small">{match.parsed ? `${(netWorthAt(match, p.slot, time) / 1000).toFixed(1)}k` : `${p.gpm} GPM`}</span>
                  <span className="d2-row-cs num small" title="Enemy creeps killed (last hits) / own creeps killed (denies)">
                    {match.parsed ? <>{Math.round(seriesAt(match.minutes[p.slot].lh, time))}<i>/</i>{Math.round(seriesAt(match.minutes[p.slot].dn, time))}</> : <>{p.lastHits}<i>/</i>{p.denies}</>}
                  </span>
                  {slots && (
                    <span className="d2-row-items">
                      {range(0, 5).map(i => <ItemCell key={i} slot={slots[i]} cooldown={itemCd(slots[i])} />)}
                      <span className="d2-row-neutral"><ItemCell slot={slots[16]} cooldown={itemCd(slots[16])} /></span>
                    </span>
                  )}
                  {hp !== undefined && <span className="d2-row-hp"><i style={{ width: `${hp}%`, background: hp <= 30 ? 'var(--bad)' : TEAM_COLOR[team] }} /></span>}
                  {vitals && <span className="d2-row-mana"><i style={{ width: `${vitals.mana}%` }} /></span>}
                  {dead && <span className="dl-respawn num">{Math.ceil(dead.t + dead.respawn - time)}</span>}
                  {moment?.slot === p.slot && <b className="d2-row-grade" title={NOTE_INFO[moment.note].label}>{NOTE_INFO[moment.note].mark}</b>}
                </button>
              );
            })}
            {/* under the team, in its column: if there's no room the column scrolls, nobody is covered for good */}
            {selected !== null && match.players[selected].team === team && <div className="d2-under"><D2Items match={match} slot={selected} time={time} /></div>}
          </aside>
        ))}
        <BoardMap match={match} time={time} selected={selected} show={show} moment={moment} overlay={<>
          {moment && moment !== closed && (
            <article className="d2-moment" style={{ '--grade': NOTE_INFO[moment.note].color } as CSSProperties}>
              <header>
                <b>{NOTE_INFO[moment.note].mark}</b>
                <strong>{NOTE_INFO[moment.note].label}</strong>
                <span className="num muted small">{mins(moment.t)}</span>
                <button className="verdict-undo" onClick={() => setClosed(moment)} aria-label="Close this move's window" title="Close"><Icon name="close" size={12} /></button>
              </header>
              <p>{moment.title}</p>
              {moment.why.length > 0 && <ul>{moment.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </article>
          )}
          <ol className="dl-feed" aria-label="Kills and events">
            {chatNow.map((c, i) => (
              <li key={`c${c.t}-${i}`} className={`d2-feed-chat ${c.wheel ? 'wheel' : ''}`}>
                <b style={{ color: c.slot !== null ? TEAM_COLOR[match.players[c.slot].team] : 'var(--text-3)' }}>{c.slot !== null ? nameOf(c.slot) : c.who ?? 'Someone'}:</b> {c.text}
              </li>
            ))}
            {news.map((e, i) => <li key={`e${e.t}-${i}`} className="d2-feed-event">{e.kind === 'rune' && runeIcon(e.rune) && <img src={runeIcon(e.rune)!} alt="" width={16} height={16} />}{newsText(e)}</li>)}
            {feed.map((d, i) => (
              <li key={`${d.t}-${d.slot}-${i}`}>
                <span style={{ color: d.killer !== null ? TEAM_COLOR[match.players[d.killer].team] : 'var(--text-3)' }}>{nameOf(d.killer)}</span>
                <Icon name="close" size={10} />
                <span style={{ color: TEAM_COLOR[match.players[d.slot].team] }}>{nameOf(d.slot)}</span>
              </li>
            ))}
          </ol>
          <ReplayNote />
        </>} />
      </div>
      <Playbar match={match} time={time} playing={playing} speed={speed} graded={graded} slow={slow} setSlow={setSlow} canMine={coach.canMine}>
        <span className="d2-layers" role="group" aria-label="Show on the map">
          {(Object.keys(SHOW_LABEL) as (keyof Show)[]).map(key => (
            <label key={key} className="dl-layer"><input type="checkbox" checked={show[key]} onChange={e => setShow({ ...show, [key]: e.target.checked })} /> {SHOW_LABEL[key]}</label>
          ))}
          <span className="d2-legend small" title="Wards on the map"><b style={{ color: WARD_RING.obs }}>O</b> Obs <b style={{ color: WARD_RING.sen }}>S</b> Sen</span>
        </span>
      </Playbar>
    </div>
  );
}

const STEP_LABEL = { download: 'Downloading the replay', unpack: 'Unpacking the replay', read: 'Reading the replay' };

/** What the heroes on the map are: real movement once the replay is read, last known places until then. */
function ReplayNote() {
  const replay = useD2(s => s.replay);
  if (replay.status === 'ready' || replay.status === 'idle') return null;
  if (replay.status === 'failed') return <p className="d2-replay-note">Couldn't read the replay ({replay.error}), so heroes are at the last place the logs put them, not live.</p>;
  const step = replay.status === 'loading' && replay.step;
  return <p className="d2-replay-note"><b>{step ? `${STEP_LABEL[step]}… ${Math.round((replay.share ?? 0) * 100)}%` : 'Getting the replay…'}</b> The first time can take a few minutes, depending on Valve's server; after that the match opens at once. Until then heroes are at the last place the logs put them.</p>;
}

function NotParsed({ match }: { match: D2Match }) {
  const [state, setState] = useState<'idle' | 'asked' | 'waiting'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const ask = async () => { setErr(null); try { await requestParse(match.id); setState('asked'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const again = async () => {
    setErr(null); setState('waiting');
    try {
      const m = await loadMatch(match.id, true);
      if (m.parsed) useD2.getState().open(m);
      else { setState('asked'); setErr('Not ready yet: it usually takes a few minutes.'); }
    } catch (e) { setState('asked'); setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="d2-parse">
      <span><b>This match hasn't been parsed yet.</b> <span className="muted">Without it there's only the final scoreboard: no wards, deaths or coach.</span></span>
      {state === 'idle' ? <button className="cta primary" onClick={ask}>Ask OpenDota to parse it</button> : <button className="cta" onClick={again} disabled={state === 'waiting'}>{state === 'waiting' ? 'Checking…' : 'Check again'}</button>}
      {err && <span className="warn-text small">{err}</span>}
    </div>
  );
}

/**
 * A team's side of the gold lead over the match: the chart shows only the stretches this team was ahead, so the two sides
 * read as a tug of war. Same scale on both. Point at it for any minute; click goes there.
 */
function TeamGold({ match, team, time }: { match: D2Match; team: D2Team; time: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = match.goldAdv, sign = team === 0 ? 1 : -1;
  const span = match.duration - match.start || 1, W = 240, H = 34;
  const top = Math.max(1, ...series.map(Math.abs));
  const x = (t: number) => ((t - match.start) / span) * W, y = (v: number) => H - (Math.max(0, v * sign) / top) * (H - 2);
  const area = series.length ? `M${x(0)},${H} ${series.map((v, i) => `L${x(i * 60).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} L${x((series.length - 1) * 60).toFixed(1)},${H} Z` : '';
  const shown = hover ?? time, lead = series.length ? seriesAt(series, shown) * sign : 0;
  const worth = match.players.filter(p => p.team === team).reduce((a, p) => a + netWorthAt(match, p.slot, shown), 0);
  const at = (e: MouseEvent<SVGSVGElement>) => { const r = e.currentTarget.getBoundingClientRect(); return match.start + ((e.clientX - r.left) / r.width) * span; };
  const clip = `d2-gold-${team}`;
  return (
    <div className="d2-gold">
      <div className="d2-gold-read num">
        <span className="d2-gold-lead">{lead >= 1 ? <>+{Math.round(lead).toLocaleString()}<small> gold ahead</small></> : lead <= -1 ? <small>behind</small> : <small>even</small>}</span>
        <span className="muted small" title="The team's total net worth">{hover !== null ? `${mins(hover)} · ` : ''}{(worth / 1000).toFixed(1)}k</span>
      </div>
      {series.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${match.names[team]}'s gold lead over the match`}
          onMouseMove={e => setHover(at(e))} onMouseLeave={() => setHover(null)} onClick={e => useD2.getState().setTime(at(e))}>
          <clipPath id={clip}><rect x={0} y={0} width={Math.max(0, x(time))} height={H} /></clipPath>
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="d2-gold-base" vectorEffect="non-scaling-stroke" />
          <path d={area} fill={TEAM_COLOR[team]} opacity={0.18} />
          <path d={area} fill={TEAM_COLOR[team]} opacity={0.8} clipPath={`url(#${clip})`} />
          <line x1={x(shown)} x2={x(shown)} y1={0} y2={H} className="d2-gold-now" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}

function BoardMap({ match, time, selected, show, overlay, moment }: { match: D2Match; time: number; selected: number | null; show: Show; overlay: ReactNode; moment: D2Move | null }) {
  const replay = useD2(s => s.replay);
  const tracks = replay.status === 'ready' ? replay.tracks : null;
  const wards = match.wards.filter(w => time >= w.t && time < w.until);
  const fight = match.fights.find(f => f.at && time >= f.start && time <= f.end + 5);
  const icons = useImages(match.players.map(p => heroOf(p.hero).icon));
  const runeImages = useImages(RUNE_ICONS);
  const campImages = useImages(CAMP_ICONS);
  // with the replay: where each hero really is. Without: the last place the logs put them, fanned out at the same spot
  const real = tracks && match.players.map(p => heroAt(tracks, p.hero, time));
  const known = real && real.every(Boolean) ? [] : match.players.map(p => ({ p, ...lastKnown(match, p.slot, time) }));
  const spots = real && real.every(Boolean) ? match.players.map((p, i) => ({ p, at: real[i]!.at, hp: real[i]!.hp as number | null, dead: real[i]!.hp === 0, stale: false })) : known.map(s => {
    const same = known.filter(o => Math.hypot(o.at.x - s.at.x, o.at.y - s.at.y) < 0.035);
    const a = (same.indexOf(s) / same.length) * Math.PI * 2;
    const at = same.length < 2 ? s.at : { x: s.at.x + Math.cos(a) * 0.04, y: s.at.y + Math.sin(a) * 0.04 };
    return { p: s.p, at, hp: null, dead: s.dead, stale: s.age > STALE && !s.dead };
  });
  const trail = tracks && selected !== null ? heroTrail(tracks, match.players[selected].hero, time, TRAIL) : [];
  const units = tracks ? unitsAt(tracks, time) : [];
  // neutrals in a camp are counted on its mark; only those pulled away from it are drawn themselves
  const camps = campsNow(units);
  const small = [...units.filter(u => (u.kind === 'creep' || u.kind === 'siege') ? show.creeps : u.kind === 'courier' && show.couriers), ...(show.neutrals ? camps.strays : [])];
  const big = units.filter(u => u.kind === 'roshan' || u.kind === 'tormentor' || u.kind === 'rune');
  return (
    <D2Map up={uid => buildingUp(match, uid, time)} overlay={overlay} clickableAt={at => spots.some(s => Math.hypot(s.at.x - at.x, s.at.y - at.y) < PICK_RADIUS)} onBackground={at => {
      // a click on a hero looks at them; heroes aren't listening themselves, as hit-testing them every frame would be costly
      let near: number | null = null, best = PICK_RADIUS;
      for (const s of spots) { const d = Math.hypot(s.at.x - at.x, s.at.y - at.y); if (d < best) { best = d; near = s.p.slot; } }
      useD2.getState().select(near !== null && near === selected ? null : near);
    }}>
      {(S, k, style) => (
        <Layer listening={false}>
          {tracks && show.neutrals && <Shape sceneFunc={ctx => drawCamps(ctx, S, k, campImages, camps.counts)} />}
          {/* hundreds of them every frame: one shape draws them all */}
          {small.length > 0 && <Shape sceneFunc={ctx => {
            for (const u of small) {
              const x = u.at.x * S, y = u.at.y * S, team = u.team === 2 ? TEAM_COLOR[0] : u.team === 3 ? TEAM_COLOR[1] : NEUTRAL_COLOR;
              ctx.beginPath();
              if (u.kind === 'siege') ctx.rect(x - 3.6 * k, y - 3.6 * k, 7.2 * k, 7.2 * k);
              else ctx.arc(x, y, (u.kind === 'courier' ? 4 : u.kind === 'neutral' ? 2.2 : 3) * k, 0, Math.PI * 2);
              ctx.fillStyle = u.kind === 'courier' ? '#fff' : team;
              ctx.fill();
              ctx.lineWidth = (u.kind === 'courier' ? 1.6 : 0.8) * k;
              ctx.strokeStyle = u.kind === 'courier' ? team : '#0b0e12';
              ctx.stroke();
            }
          }} />}
          {big.map((u, i) => {
            const at = u.kind === 'roshan' ? roshanOnMap(style, u.at) : u.at;
            return (
            <Group key={`${u.kind}${i}`} x={at.x * S} y={at.y * S}>
              {u.kind === 'rune' ? (
                <>
                  <Circle radius={11 * k} fill="#0b0e12" opacity={0.6} stroke={RUNE_COLOR[u.rune ?? -1] ?? '#fff'} strokeWidth={1.2 * k} />
                  {runeImages[runeIcon(u.rune) ?? ''] && <KImage image={runeImages[runeIcon(u.rune)!]} x={-10 * k} y={-10 * k} width={20 * k} height={20 * k} />}
                  <Label text={RUNE_NAME[u.rune ?? -1] ?? 'Rune'} k={k} fill={RUNE_COLOR[u.rune ?? -1] ?? '#fff'} y={12.5 * k} />
                </>
              ) : (
                <>
                  <Circle radius={12 * k} fill="#0b0e12" />
                  <Arc innerRadius={9.6 * k} outerRadius={12 * k} angle={3.6 * (u.hp ?? 100)} rotation={-90} fill="#e8a33d" />
                  <Text text={u.kind === 'roshan' ? 'R' : 'T'} width={20 * k} x={-10 * k} y={-6 * k} align="center" fontSize={12 * k} fontStyle="bold" fill="#e8a33d" />
                  <Label text={u.kind === 'roshan' ? 'Roshan' : 'Tormentor'} k={k} fill="#e8a33d" y={13.5 * k} />
                </>
              )}
            </Group>
            );
          })}
          {wards.map((w, i) => {
            const dim = selected !== null && w.slot !== selected;
            return (
              <Group key={`${w.kind}${w.slot}${w.t}${i}`} x={w.at.x * S} y={w.at.y * S} opacity={dim ? 0.3 : 1}>
                {w.kind === 'obs' && <Line points={visionShape(w.at, OBS_VISION).points.flatMap((v, j) => [(v - (j % 2 ? w.at.y : w.at.x)) * S])} closed fill={TEAM_COLOR[w.team]} opacity={0.13} />}
                <Circle radius={6 * k} fill={WARD_RING[w.kind]} stroke={TEAM_COLOR[w.team]} strokeWidth={1.4 * k} />
                <Text text={w.kind === 'obs' ? 'O' : 'S'} width={12 * k} x={-6 * k} y={-3.8 * k} align="center" fontSize={8 * k} fontStyle="bold" fill="#0b0e12" />
              </Group>
            );
          })}
          {trail.length > 1 && <Line points={trail.flatMap(p => [p.x * S, p.y * S])} stroke="#fff" strokeWidth={1.6 * k} opacity={0.65} lineCap="round" lineJoin="round" />}
          {/* the dead underneath, so they never cover someone alive */}
          {[...spots].sort((a, b) => Number(b.dead) - Number(a.dead)).map(s => {
            const h = heroOf(s.p.hero);
            return (
              <Group key={s.p.slot} x={s.at.x * S} y={s.at.y * S} opacity={s.stale ? 0.75 : s.dead && tracks ? 0.7 : 1}>
                <HeroMark k={k} icon={h.icon ? icons[h.icon] : undefined} name={s.p.name ?? h.name} team={s.p.team} selected={selected === s.p.slot} hp={s.hp} dead={s.dead} />
              </Group>
            );
          })}
          {/* the moment the coach is talking about: rings going out from the hero, and its grade over them */}
          {moment && spots.filter(s => s.p.slot === moment.slot).map(s => {
            const info = NOTE_INFO[moment.note], beat = ((time * 1.2) % 1 + 1) % 1, badge = 13 * k;
            return (
              <Group key="moment" x={s.at.x * S} y={s.at.y * S}>
                <Circle radius={(17 + beat * 16) * k} stroke={info.color} strokeWidth={2.4 * k} opacity={1 - beat} />
                <Circle radius={16 * k} stroke={info.color} strokeWidth={2.6 * k} />
                <Group y={-29 * k}>
                  <Circle radius={badge} fill={info.color} stroke="#0b0e12" strokeWidth={1.6 * k} />
                  <Text text={info.mark} x={-badge} y={-badge} width={badge * 2} height={badge * 2} align="center" verticalAlign="middle" fontSize={13 * k} fontStyle="bold" fill="#0b0e12" />
                </Group>
              </Group>
            );
          })}
          {fight && (
            <Group x={fight.at!.x * S} y={fight.at!.y * S}>
              <Circle radius={34 * k} stroke="#fff" strokeWidth={1.2 * k} dash={[5 * k, 4 * k]} opacity={0.7} />
              <Label text={`Fight · ${fight.present[0].length}v${fight.present[1].length}`} k={k} fill="#fff" y={-47 * k} />
            </Group>
          )}
        </Layer>
      )}
    </D2Map>
  );
}

const WARD_RING = { obs: '#f2c94c', sen: '#56b4f2' };
const NEUTRAL_COLOR = '#c9b98f';
const RUNE_COLOR: Record<number, string> = { 0: '#5aa7ff', 1: '#ff5a4d', 2: '#f4c430', 3: '#b48cff', 4: '#59d36a', 5: '#ffcf3f', 6: '#ff7be0', 7: '#4fd8ff', 8: '#a8e05f', 9: '#ffb35a' };
const LABEL_W = 92;
/** How close to a hero a click on the map picks them, in map widths. */
const PICK_RADIUS = 0.03;
/** How much of a selected hero's way is drawn (s). */
const TRAIL = 20;
/** A place the logs gave longer ago than this (s) is drawn faded: the hero has probably moved on. */
const STALE = 45;

/** A hero on the map: their icon in a ring of team colour showing their health, their name under it; crossed out while dead. */
function HeroMark({ k, icon, name, team, selected, hp, dead }: { k: number; icon?: HTMLImageElement; name: string; team: D2Team; selected: boolean; hp: number | null; dead?: boolean }) {
  const R = 11 * k, X = R * 0.72, size = Math.max(9, 10.5 * k), c = TEAM_COLOR[team];
  return (
    <>
      {selected && <Circle radius={R + 5.5 * k} stroke="#fff" strokeWidth={1.4 * k} />}
      {hp === null || dead ? <Circle radius={R + 2.4 * k} fill={c} /> : (
        <>
          <Circle radius={R + 2.4 * k} fill="#0b0e12" />
          <Arc innerRadius={R} outerRadius={R + 2.4 * k} angle={360} fill={c} opacity={0.25} />
          <Arc innerRadius={R} outerRadius={R + 2.4 * k} angle={3.6 * hp} rotation={-90} fill={hp <= 30 ? '#ef4444' : c} />
        </>
      )}
      <Circle radius={R} fill="#0b0e12" />
      {icon && <KImage image={icon} x={-R} y={-R} width={2 * R} height={2 * R} opacity={dead ? 0.55 : 1} />}
      {dead && <Line points={[-X, -X, X, X]} stroke="#ef4444" strokeWidth={2.6 * k} lineCap="round" />}
      {dead && <Line points={[-X, X, X, -X]} stroke="#ef4444" strokeWidth={2.6 * k} lineCap="round" />}
      <Text text={name} x={-LABEL_W / 2} y={R + 3.5 * k} width={LABEL_W} align="center" wrap="none" ellipsis fontSize={size} fontStyle="bold"
        fill={c} stroke="#000" strokeWidth={2.4 * k} fillAfterStrokeEnabled />
    </>
  );
}

/** A small name under something on the map. */
function Label({ text, k, fill, y }: { text: string; k: number; fill: string; y: number }) {
  return <Text text={text} x={-LABEL_W / 2} y={y} width={LABEL_W} align="center" wrap="none" fontSize={Math.max(8.5, 9.5 * k)} fontStyle="bold" fill={fill} stroke="#000" strokeWidth={2.2 * k} fillAfterStrokeEnabled />;
}
function Playbar({ match, time, playing, speed, graded, slow, setSlow, canMine, children }: { match: D2Match; time: number; playing: boolean; speed: number; graded: D2Move[]; slow: boolean; setSlow: (on: boolean) => void; canMine: boolean; children: ReactNode }) {
  const s = useD2.getState();
  const scope = useD2(x => x.scope);
  const span = match.duration - match.start || 1;
  const left = (t: number) => `${((t - match.start) / span) * 100}%`;
  const marks = useMemo(() => [
    ...match.deaths.map(d => ({ t: d.t, color: TEAM_COLOR[match.players[d.slot].team === 0 ? 1 : 0], kind: 'kill' })),
    ...match.roshan.map(r => ({ t: r.t, color: '#d9c07a', kind: 'objective' })),
    ...graded.map(m => ({ t: m.t, color: NOTE_INFO[m.note].color, kind: 'graded' })),
  ], [match, graded]);
  return (
    <div className="dl-playbar">
      <button className="play-main" onClick={() => { if (!playing && time >= match.duration) s.setTime(match.start); s.setPlaying(!playing); }} title="Play / pause (Space)">
        <Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause' : 'Play'}
      </button>
      <select value={speed} onChange={e => s.setSpeed(Number(e.target.value))} aria-label="Speed">
        {SPEEDS.map(x => <option key={x} value={x}>{x}×</option>)}
      </select>
      <button className={`chip d2-slow ${slow ? 'on' : ''}`} aria-pressed={slow} onClick={e => { setSlow(!slow); e.currentTarget.blur(); }}
        title={slow ? 'Playback drops to 1× around each graded moment. Click to keep your speed.' : 'Playback keeps your speed. Click to drop to 1× around each graded moment.'}>
        <Icon name="slow" size={13} /> {playing && speedAt(graded, time, speed, slow) !== speed ? '1× now' : 'Slow'}
      </button>
      <div className="dl-step" role="group" aria-label="Graded moments">
        <button onClick={() => stepMoment(graded, -1)} disabled={!graded.length} title="Previous graded moment (←)" aria-label="Previous graded moment"><Icon name="prev" size={14} /></button>
        <span className="num muted small">{graded.filter(m => m.t <= time).length}/{graded.length}</span>
        <button onClick={() => stepMoment(graded, 1)} disabled={!graded.length} title="Next graded moment (→)" aria-label="Next graded moment"><Icon name="prev" size={14} className="flip-x" /></button>
      </div>
      {canMine && (
        <div className="seg-mini" role="group" aria-label="Whose moves">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => s.setScope('all')}>All</button>
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => s.setScope('mine')}>Mine</button>
        </div>
      )}
      <div className="dl-phases" role="group" aria-label="Jump to">
        {PHASES.filter(p => p.t < match.duration).map(p => <button key={p.label} className="chip" onClick={() => s.setTime(p.t)}>{p.label}</button>)}
      </div>
      <div className="dl-timeline">
        <input type="range" min={match.start} max={match.duration} step={1} value={Math.floor(time)} onChange={e => s.setTime(Number(e.target.value))} aria-label="Match time" />
        <div className="dl-marks" aria-hidden>
          {marks.map((m, i) => <i key={i} className={m.kind} style={{ left: left(m.t), background: m.color }} />)}
        </div>
      </div>
      <span className="num dl-time">{mins(time)} / {mins(match.duration)}</span>
      <PlanFromHere match={match} time={time} />
      {children}
    </div>
  );
}

/** Takes this moment to Tactical: every hero where they stand, to plan what should have happened next. */
function PlanFromHere({ match, time }: { match: D2Match; time: number }) {
  const replay = useD2(s => s.replay);
  if (replay.status !== 'ready') return null;
  const go = () => {
    if (useTac.getState().heroes.length && !confirm('Replace your current plan in Tactical with this moment?')) return;
    useTac.getState().loadMoment(time, match.players.flatMap(p => {
      const now = heroAt(replay.tracks, p.hero, time);
      return now ? [{ team: p.team, hero: p.hero, at: now.at }] : [];
    }));
    useD2.getState().setPlaying(false);
    try { localStorage.setItem('stratboard.d2.tab', 'fight'); } catch { /* private mode */ }
    navigate({ page: 'dota2', mode: 'tactical' });
  };
  return <button className="chip" onClick={go} title="Open this moment in Tactical, with every hero where they stand">Plan from here</button>;
}

function stepMoment(moves: D2Move[], dir: 1 | -1) {
  const s = useD2.getState();
  const at = s.time + LEAD;
  const next = dir > 0 ? moves.find(m => m.t > at + 0.5) : [...moves].reverse().find(m => m.t < at - 0.5);
  if (next) { s.setPlaying(false); s.setTime(next.t - LEAD); }
}

/** A cooldown over an icon: dark for the part still to run, and the seconds left. */
function CooldownMark({ cd }: { cd: Cooldown | null | undefined }) {
  if (!cd) return null;
  return <><i className="d2-cd-sweep" style={{ height: `${Math.min(100, (cd.left / cd.total) * 100)}%` }} /><b className="d2-cd-text num">{Math.ceil(cd.left)}</b></>;
}

/** A sun or a moon, and until when it lasts. */
export function DayNight({ t }: { t: number }) {
  const night = isNight(t);
  return (
    <svg className={`d2-daynight ${night ? 'night' : 'day'}`} width={15} height={15} viewBox="0 0 16 16" fill="currentColor" role="img" aria-label={night ? 'Night' : 'Day'}>
      <title>{`${night ? 'Night' : 'Day'} until ${mins(nextDawnOrDusk(t))}`}</title>
      {night
        ? <path d="M11.5 10.6A5.6 5.6 0 0 1 5.4 2.5a6.2 6.2 0 1 0 8.1 8.1 5.6 5.6 0 0 1-2 0z" />
        : <><circle cx="8" cy="8" r="3.3" /><path d="M8 .8v2.2M8 13v2.2M.8 8H3M13 8h2.2M2.9 2.9l1.6 1.6M11.5 11.5l1.6 1.6M2.9 13.1l1.6-1.6M11.5 4.5l1.6-1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>}
    </svg>
  );
}

function ItemCell({ slot, cooldown }: { slot: string | null | undefined; cooldown?: Cooldown | null }) {
  if (!slot) return <span className="d2-slot empty" />;
  const it = itemLook(slot);
  return (
    <span className="d2-slot" title={cooldown ? `${it.name}: ready in ${Math.ceil(cooldown.left)} s` : it.name}>
      <img src={it.icon} alt={it.name} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
      {it.charges > 0 && !it.key.startsWith('enhancement_') && <b className="d2-charges num">{it.charges}</b>}
      <CooldownMark cd={cooldown} />
    </span>
  );
}

function SkillCell({ skill, heroKey, large }: { skill: SkillNow; heroKey: string; large?: boolean }) {
  const look = skillLook(skill.name, heroKey);
  return (
    <span className={`d2-skill ${skill.level ? '' : 'unlearned'} ${large ? 'large' : ''}`} title={`${look.name}, level ${skill.level}${skill.cooldown ? `: ready in ${Math.ceil(skill.cooldown.left)} s` : ''}`}>
      <img src={look.icon} alt={look.name} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
      <CooldownMark cd={skill.cooldown} />
      {large && skill.level > 0 && <b className="d2-skill-level num">{skill.level}</b>}
    </span>
  );
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/** Items that cost this much are worth listing when all we have is what was bought. */
const BOUGHT_FROM = 500;

/** What the hero you're looking at carries at this moment of the match, or (without the replay) what they've bought so far. */
function D2Items({ match, slot, time }: { match: D2Match; slot: number; time: number }) {
  const replay = useD2(s => s.replay);
  const p = match.players[slot], h = heroOf(p.hero), m = match.minutes[slot];
  const slots = replay.status === 'ready' ? itemsAt(replay.tracks, p.hero, time) : null;
  const tracks = replay.status === 'ready' ? replay.tracks : null;
  const stash = slots?.slice(9, 15).filter(Boolean) ?? [];
  const vitals = tracks && vitalsAt(tracks, p.hero, time), skills = tracks ? skillsAt(tracks, p.hero, time) : [];
  const itemCd = (s: string | null | undefined) => (tracks && s ? itemCooldownAt(tracks, p.hero, s, time) : null);
  const bought = slots ? [] : match.buys.filter(b => b.slot === slot && b.t <= time && (itemByKey.get(b.item)?.cost ?? 0) >= BOUGHT_FROM);
  return (
    <section className="d2-items-panel" aria-label={`${h.name}'s items at ${mins(time)}`}>
      <header>
        {h.icon && <img src={h.icon} alt="" width={22} height={22} />}
        <b>{p.name ?? h.name}</b>
        <span className="num muted small">{mins(time)}</span>
        <button className="verdict-undo" onClick={() => useD2.getState().select(null)} aria-label="Stop looking at this hero"><Icon name="close" size={11} /></button>
      </header>
      {slots ? (
        <>
          <div className="d2-stats num small">
            <span><b>{Math.round(seriesAt(m.lh, time))}</b>/{Math.round(seriesAt(m.dn, time))} <i>LH/DN</i></span>
            <span><b>{Math.round(netWorthAt(match, slot, time)).toLocaleString()}</b> <i>net worth</i></span>
            {vitals && <span><b>{vitals.level}</b> <i>lvl</i></span>}
          </div>
          {skills.length > 0 && <div className="d2-panel-skills">{skills.map(s => <SkillCell key={s.name} skill={s} heroKey={h.key} large />)}</div>}
          <TalentTree hero={p.hero} upgrades={p.upgrades} level={vitals ? vitals.level : undefined} at={vitals ? time : undefined} />
          <div className="d2-slots">
            {range(6, 8).map(i => <span key={i} className="d2-back" title="Backpack"><ItemCell slot={slots[i]} /></span>)}
            <span title="Town Portal"><ItemCell slot={slots[15]} cooldown={itemCd(slots[15])} /></span>
            <span title="Neutral item"><ItemCell slot={slots[16]} cooldown={itemCd(slots[16])} /></span>
            <span title="Its enhancement"><ItemCell slot={slots[17]} /></span>
          </div>
          {stash.length > 0 && <div className="d2-stash"><span className="muted small">Stash</span>{stash.map((s, i) => <ItemCell key={i} slot={s} />)}</div>}
        </>
      ) : (
        <>
          <p className="muted small">Bought so far (the replay tells what they carry once it's read):</p>
          <div className="d2-stash">{bought.length ? bought.map((b, i) => <ItemCell key={i} slot={b.item} />) : <span className="muted small">Nothing big yet.</span>}</div>
        </>
      )}
    </section>
  );
}

