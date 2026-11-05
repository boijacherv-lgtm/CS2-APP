import { describe, expect, it } from 'vitest';
import { cleanMoment, focusOf, fromShareCode, mistakeGroups, shareCode, type Moment } from '../moments';

const m = (o: Partial<Moment> = {}): Moment => ({
  id: 'de_mirage|24|1.0#R3 0:40', game: 'cs2', map: 'de_mirage', at: 1000, match: 'Mirage', when: 'R3 0:40',
  dots: [{ x: 0.5, y: 0.4, team: 1, me: true }, { x: 0.2, y: 0.3, team: 0 }], setup: 'Round 3', kind: 'Held instead of moving',
  options: [{ label: 'Move to Ninja', value: 0.6 }, { label: 'Held Stairs', value: 0.45 }], played: 1, cls: 'Mistake', cost: 0.15, ...o,
});

describe('moments', () => {
  it('a share link carries the whole moment and back', () => {
    const back = fromShareCode(shareCode(m({ setup: 'Ünïcode & "quotes"' })));
    expect(back?.setup).toBe('Ünïcode & "quotes"');
    expect(back?.options[0].label).toBe('Move to Ninja');
  });
  it('rejects bad links and bad fields', () => {
    expect(fromShareCode('not-base64!!')).toBeNull();
    expect(cleanMoment({ ...m(), map: '../../evil' })).toBeNull();
    expect(cleanMoment({ ...m(), played: 5 })).toBeNull();
    expect(cleanMoment({ ...m(), options: [{ label: 'only one', value: 0.5 }] })).toBeNull();
    expect(cleanMoment({ ...m(), dots: [{ x: 9, y: -3, team: 1 }] })?.dots[0]).toEqual({ x: 1, y: 0, team: 1 });
  });
  it('groups mistakes by kind, most frequent first, and leaves best calls out', () => {
    const g = mistakeGroups([m(), m({ id: 'a#1' }), m({ id: 'b#1', kind: 'Peeked instead of holding' }), m({ id: 'c#1', cls: 'Best', kind: 'x' })]);
    expect(g.map(x => [x.kind, x.moments.length])).toEqual([['Held instead of moving', 2], ['Peeked instead of holding', 1]]);
  });
  it('the focus streak counts newest matches with fewer of the mistake than before them', () => {
    // matches oldest → newest: 3, 3, 1, 0 of the same mistake
    const ms = [3, 3, 1, 0].flatMap((n, i) => [m({ id: `M${i}#x`, at: i * 10, cls: 'Best', kind: 'ok' }), ...Array.from({ length: n }, (_, k) => m({ id: `M${i}#${k}`, at: i * 10 }))]);
    const f = focusOf(ms, 'cs2');
    expect(f?.kind).toBe('Held instead of moving');
    expect(f?.matches).toBe(4);
    expect(f?.streak).toBe(2);
  });
});
