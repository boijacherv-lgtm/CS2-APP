import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { GameMark } from './gameMarks';
import { GAMES, STATUS_LABEL } from './games';

/**
 * A game's page (/cs2, /deadlock …), the same structure for every game (spec §2): the hero with Review and a sample,
 * what the coach grades, one real moment, a teaser of the game's Meta, how it works, questions. Each game fills it in.
 */
export interface GamePageKit {
  game: string;
  h1: string; lead: string;
  review: string; reviewLabel: string;
  sample: () => Promise<void>;
  shot: { src: string; alt: string };
  grades: { icon: IconName; title: string; text: string }[];
  moment: { src: string; alt: string; caption: string };
  meta: { title: string; href: string; cta: string; load: () => Promise<{ title: string; sub: string; img?: string | null }[]> };
  steps: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  footer: string;
}

export function GamePage({ kit }: { kit: GamePageKit }) {
  const g = GAMES.find(x => x.id === kit.game)!;
  const [opening, setOpening] = useState<'idle' | 'opening' | 'failed'>('idle');
  const watch = async () => { setOpening('opening'); try { await kit.sample(); } catch { setOpening('failed'); } };
  const [meta, setMeta] = useState<{ title: string; sub: string; img?: string | null }[] | null>(null);
  useEffect(() => { let on = true; kit.meta.load().then(m => { if (on) setMeta(m); }).catch(() => { if (on) setMeta([]); }); return () => { on = false; }; }, [kit]);
  return (
    <div className="page dl game-page" style={{ '--game': g.color } as React.CSSProperties}>
      <section className="dl-hero">
        <div className="dl-hero-text">
          <span className="eyebrow"><GameMark game={g} size={14} /> {g.name} <span className={`games-status ${g.status}`}>{STATUS_LABEL[g.status]}</span></span>
          <h1>{kit.h1}</h1>
          <p className="lead">{kit.lead}</p>
          <div className="hero-cta">
            <a className="cta primary" href={kit.review}>{kit.reviewLabel} <Icon name="arrowRight" size={14} /></a>
            <button className="cta" onClick={watch} disabled={opening === 'opening'}><Icon name="play" size={12} /> {opening === 'opening' ? 'Opening…' : 'Watch a sample'}</button>
          </div>
          {opening === 'failed' && <p className="warn-text">Couldn't open the sample, try again.</p>}
        </div>
        <img className="dl-hero-shot" src={kit.shot.src} alt={kit.shot.alt} width={800} height={562} />
      </section>

      <section className="site-section">
        <h2 className="section-title">What the coach grades</h2>
        <div className="feature-grid">
          {kit.grades.map(f => (
            <div key={f.title} className="feature">
              <span className="feature-ico"><Icon name={f.icon} size={18} /></span>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section gp-moment">
        <h2 className="section-title">One real moment</h2>
        <figure>
          <img src={kit.moment.src} alt={kit.moment.alt} width={800} height={562} loading="lazy" />
          <figcaption><span>{kit.moment.caption}</span><button className="cta primary" onClick={watch} disabled={opening === 'opening'}><Icon name="play" size={12} /> Watch</button></figcaption>
        </figure>
      </section>

      <section className="site-section">
        <div className="gp-meta-head"><h2 className="section-title">{kit.meta.title}</h2><a className="cta" href={kit.meta.href}>{kit.meta.cta} <Icon name="arrowRight" size={14} /></a></div>
        {meta === null ? <p className="muted">Loading…</p> : meta.length ? (
          <ol className="gp-meta">
            {meta.map((m, i) => <li key={m.title}><span className="gp-meta-n">{i + 1}</span>{m.img && <img src={m.img} alt="" width={44} height={44} />}<span><b>{m.title}</b><span className="muted small">{m.sub}</span></span></li>)}
          </ol>
        ) : <p className="muted">Open <a href={kit.meta.href}>{kit.meta.cta}</a> to see it.</p>}
      </section>

      <section className="site-section">
        <h2 className="section-title">How it works</h2>
        <ol className="steps">{kit.steps.map(s => <li key={s.title}><b>{s.title}</b><span>{s.text}</span></li>)}</ol>
      </section>

      <section className="site-section">
        <h2 className="section-title">Questions</h2>
        <div className="faq">{kit.faq.map(q => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}</div>
      </section>

      <footer className="site-footer">
        <nav><a href="/guides">Guides</a><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/changelog">What's new</a></nav>
        <span className="muted">{kit.footer}</span>
      </footer>
    </div>
  );
}
