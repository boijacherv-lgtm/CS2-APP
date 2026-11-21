import { describe, expect, it } from 'vitest';
import { NOTES } from '../notes';
import { eyeColors, eyeSvg, hueOf } from '../../ui/eyes';
import { GAME_THEME } from '../../ui/tokens';

const GAMES = ['cs2', 'deadlock', 'dota2'] as const;
const lightness = (hsl: string) => Number(hsl.match(/ (\d+(?:\.\d+)?)%\)$/)![1]);

describe('eye marks', () => {
  it('colour every mark in its game\'s own hue: worse marks are duller, never another hue', () => {
    for (const g of GAMES) {
      const hue = hueOf(GAME_THEME[g].accent);
      const irises = NOTES.map(n => eyeColors(n, g));
      for (const c of irises) expect(c.hue).toBe(hue);
      for (const c of irises) expect(c.iris).toMatch(new RegExp(`^hsl\\(${hue} `));
      // best to worst, the ring only gets darker
      const rings = irises.map(c => lightness(c.ring));
      for (let i = 1; i < rings.length; i++) expect(rings[i]).toBeLessThanOrEqual(rings[i - 1]);
    }
  });

  it('draws a different eye for each mark, and keeps ids unique per instance', () => {
    const svgs = NOTES.map(n => eyeSvg(n, 'cs2', 'x'));
    expect(new Set(svgs).size).toBe(NOTES.length);
    const a = eyeSvg('??', 'cs2', 'a1'), b = eyeSvg('??', 'cs2', 'b2');
    expect(a).toContain('id="cpa1"');
    expect(b).not.toContain('a1');
  });

  it('adds the reveal parts (lid, neutral pupil) only when animated', () => {
    for (const n of NOTES) {
      expect(eyeSvg(n, 'deadlock', 'x')).not.toContain('eye-lid');
      const anim = eyeSvg(n, 'deadlock', 'x', true);
      expect(anim).toContain('class="eye-anim"');
      expect(anim).toContain('eye-lid');
      expect(anim).toContain('eye-neutral');
    }
  });
});
