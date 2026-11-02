import { describe, expect, it } from 'vitest';
import { direction, parseChanges, tally, textLines, verdict } from '../patches';
import { DL_HEROES } from '../data';

const id = (name: string) => DL_HEROES.find(h => h.name === name)!.id;

describe('reading patch notes', () => {
  it('tells buffs from nerfs by the numbers and the wording', () => {
    expect(direction('Damage reduced from 140 to 125')).toBe(-1);
    expect(direction('Cooldown reduced from 27s to 25s')).toBe(1);
    expect(direction('T3 increased from +60 Damage to +90')).toBe(1);
    expect(direction('Deploy time increased from 0.6s to 0.8s')).toBe(-1);
    expect(direction('Move speed reduced from 7 to 6.7')).toBe(-1);
    expect(direction('Fixed bug causing it to not deal damage')).toBe(0);
    expect(direction('T2 no longer has -0.3s Time To Spawn')).toBe(-1);
    expect(direction('T3 now also provides -0.3s Time To Spawn')).toBe(1);
    expect(direction('Base gun damage increased by 3%')).toBe(1);
  });
  it('splits lines into heroes (with abilities), items and the rest', () => {
    const lines = textLines('<p>Heroes:</p><p>- Celeste: Shining Wonder - Damage reduced from 140 to 125<br>- Doorman: Luggage Cart - T2 increased from +75 Damage on Wall Impact to +90<br>- Graves: Move speed reduced from 7 to 6.7<br>- Haunts HP and Damage output increased by 10%</p>');
    const cs = parseChanges(lines);
    expect(cs.map(c => [c.kind, c.id, c.ability, c.dir])).toEqual([
      ['hero', id('Celeste'), 'Shining Wonder', -1], ['hero', id('The Doorman'), 'Luggage Cart', 1], ['hero', id('Graves'), null, -1], ['general', null, null, 1],
    ]);
    const t = tally(cs, 'hero');
    expect(verdict(t.get(id('Celeste'))!)).toBe('nerfed');
    expect(verdict(t.get(id('The Doorman'))!)).toBe('buffed');
  });
});
