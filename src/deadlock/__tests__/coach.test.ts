import { describe, expect, it } from 'vitest';
import { coachMatch } from '../coach';
import { matchFromMetadata } from '../match';
import slice from './match-124566656-slice.json';
import { patternOf } from '../disputes';

describe('Deadlock coach', () => {
  const m = matchFromMetadata(slice);
  it('grades every death and kill, with reasons', () => {
    const moves = coachMatch(m);
    const deaths = moves.filter(x => x.kind === 'death');
    expect(deaths.length).toBe(m.deaths.length);
    // each says why: a line, a tag (ALONE, HOT SPOT…) or the win chance it cost
    for (const d of deaths) expect(d.why.length + d.tags.length + (d.win ? 1 : 0)).toBeGreaterThan(0);
  });
  it('calls a death with nobody around isolated (only two heroes in this slice: never a teammate near)', () => {
    const d = coachMatch(m).find(x => x.kind === 'death')!;
    expect(d.tags).toContain('ISOLATED');
    expect(['?!', '?', '??']).toContain(d.note);
  });
  it('grades laning against the average player on the hero when there is a benchmark', () => {
    const p = m.players[0];
    const s = m.stats[p.slot].find(x => x.t === 360)!;
    const moves = coachMatch({ ...m, duration: 900, stats: { ...m.stats, [p.slot]: [{ ...s, t: 720, netWorth: 12000 }] } }, { [p.hero]: [{ t: 720, avg: 8000, std: 1500 }] });
    const lane = moves.find(x => x.kind === 'laning' && x.slot === p.slot)!;
    expect(lane.note).toBe('!!');
    expect(lane.tags).toContain('LANE WON');
  });
  it('moves a mark the way the owner\'s rulings went for moments of that kind', () => {
    const before = coachMatch(m).find(x => x.kind === 'death')!;
    const corr = { [patternOf(before.kind, before.tags)]: { better: 3, worse: 0, coach: 1 } };
    const after = coachMatch(m, {}, {}, null, corr).find(x => x.kind === 'death' && x.t === before.t)!;
    const order = ['??', '?', '?!', 'book', '!', '!!'];
    expect(order.indexOf(after.note)).toBe(Math.min(order.length - 1, order.indexOf(before.note) + 1));
    expect(after.why.at(-1)).toMatch(/rulings/);
    // too few rulings, or the coach right as often: no change
    expect(coachMatch(m, {}, {}, null, { [patternOf(before.kind, before.tags)]: { better: 2, worse: 0, coach: 2 } }).find(x => x.t === before.t && x.kind === 'death')!.note).toBe(before.note);
  });
});

describe('Deadlock coach: the grade never fights the number', () => {
  it('no praise for a kill after which the team lost win chance, no mistake for a death after which it gained', () => {
    const moves = coachMatch(matchFromMetadata(slice));
    for (const x of moves) {
      if (!x.win) continue;
      if (x.kind === 'kill' && x.win.swing <= -0.03) expect(['!', '!!']).not.toContain(x.note);
      if (x.kind === 'death' && x.win.swing >= 0.03 && !x.tags.includes('ULT UNUSED')) expect(['?!', '?', '??']).not.toContain(x.note);
    }
  });
});
