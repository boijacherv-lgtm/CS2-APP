/**
 * One player's report card for Dota 2's recap, as Deadlock's: an overall score out of 100 and five parts of the match,
 * each from the grades of its moments (grades.ts) and the coach's marks (coach.ts). 50 is a typical game: a B.
 */
import type { Annotation, Letter } from '../engine/recap';
import type { D2Move } from './coach';
import type { ChapterKind, MatchGrades } from './grades';
import type { D2Match } from './match';

export type PartKey = 'fights' | 'lane' | 'vision' | 'team' | 'survival';
export interface CardLine { text: string; t?: number; tone?: 'up' | 'down' | 'flat' }
export interface CardPart { key: PartKey; label: string; score: number | null; note: Annotation; summary: string; lines: CardLine[] }
export interface D2Card { slot: number; overall: number | null; note: Annotation; parts: CardPart[] }

/** A letter as a score out of 100: the middle of its band on the 0–100 scale the other games use (B is 50–61). */
export const LETTER_SCORE: Record<Letter, number> = { 'S+': 90, S: 80, A: 68, B: 56, C: 45, D: 35, F: 18 };
/** The match grade's own scale (grades.ts: C from 3, B from 3.6 …) set onto 0–100, band for band. */
const STEPS: [number, number][] = [[0, 0], [2.4, 30], [3, 40], [3.6, 50], [4.2, 62], [4.8, 75], [5.4, 85], [7, 100]];
export function scoreOf(matchScore: number): number {
  for (let i = 1; i < STEPS.length; i++) {
    const [a, x] = STEPS[i - 1], [b, y] = STEPS[i];
    if (matchScore <= b) return Math.round(x + ((Math.max(a, matchScore) - a) / (b - a)) * (y - x));
  }
  return 100;
}
/** How a score reads as the coach's mark: the ring's colour. */
export const noteOf = (score: number | null): Annotation =>
  score === null ? 'book' : score >= 75 ? '!!' : score >= 62 ? '!' : score >= 45 ? 'book' : score >= 35 ? '?!' : score >= 25 ? '?' : '??';
/** A coach's mark as a score, for the deaths the survival part is made of. */
const MARK_SCORE: Record<string, number> = { '!!': 90, '!': 75, book: 56, '?!': 42, '?': 28, '??': 12 };

const PARTS: { key: PartKey; label: string; kinds: ChapterKind[]; summary: string }[] = [
  { key: 'fights', label: 'Fights', kinds: ['fight', 'pick'], summary: 'Kills, deaths and damage in each fight and pick-off, against your share of your team.' },
  { key: 'lane', label: 'Laning', kinds: ['lane'], summary: 'Gold at 10:00 against your lane opponent.' },
  { key: 'vision', label: 'Vision', kinds: ['vision'], summary: 'Wards placed, how long they stood, how many were on the spots pros use, and enemy wards killed (supports).' },
  { key: 'team', label: 'Team play', kinds: ['team'], summary: 'Stuns, skills and items used on teammates, stacks and ganks on other lanes (supports).' },
  { key: 'survival', label: 'Survival', kinds: [], summary: 'Your deaths, each marked by the coach: alone, outnumbered, holding a saving item, or worth it.' },
];

/** The report card of one player: their grades and the coach's marks on them. */
export function reportCard(match: D2Match, grades: MatchGrades, moves: D2Move[], slot: number): D2Card {
  const parts = PARTS.map((p): CardPart => {
    if (p.key === 'survival') {
      const deaths = moves.filter(m => m.slot === slot && m.kind === 'death');
      const score = deaths.length ? Math.round(deaths.reduce((a, m) => a + MARK_SCORE[m.note], 0) / deaths.length) : match.players[slot].deaths === 0 ? 85 : null;
      return {
        key: p.key, label: p.label, score, note: noteOf(score), summary: p.summary,
        lines: [
          { text: `${match.players[slot].deaths} deaths in ${Math.round(match.duration / 60)} minutes`, tone: match.players[slot].deaths <= 4 ? 'up' : match.players[slot].deaths >= 9 ? 'down' : 'flat' },
          ...deaths.map(m => ({ text: `${m.title}${m.why[0] ? `: ${m.why[0]}` : ''}`, t: m.t, tone: (m.note.startsWith('!') || m.note === 'book' ? 'flat' : 'down') as CardLine['tone'] })),
        ],
      };
    }
    const mine = grades.chapters.filter(c => p.kinds.includes(c.kind) && c.grades[slot]);
    const score = mine.length ? Math.round(mine.reduce((a, c) => a + LETTER_SCORE[c.grades[slot]!.letter], 0) / mine.length) : null;
    return {
      key: p.key, label: p.label, score, note: noteOf(score), summary: p.summary,
      lines: mine.map(c => {
        const g = c.grades[slot]!;
        return {
          text: `${g.letter} · ${c.title}${g.why ? `: ${g.why}` : ''}`,
          // vision and team play are the whole match; the lane is judged at 10:00
          t: c.kind === 'vision' || c.kind === 'team' ? undefined : c.kind === 'lane' ? 600 : c.t,
          tone: LETTER_SCORE[g.letter] >= 62 ? 'up' : LETTER_SCORE[g.letter] < 45 ? 'down' : 'flat',
        };
      }),
    };
  });
  const own = grades.players.find(g => g.slot === slot);
  const overall = own && own.graded ? scoreOf(own.score) : null;
  return { slot, overall, note: noteOf(overall), parts };
}
