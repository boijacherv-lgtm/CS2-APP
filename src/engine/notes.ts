/** The move marks (!!, !, book, ?!, ?, ??): kept apart from recap.ts so the site's pages can show them without the engine. */
export type Annotation = '!!' | '!' | 'book' | '?!' | '?' | '??';
export const NOTES: Annotation[] = ['!!', '!', 'book', '?!', '?', '??'];
export const NOTE_INFO: Record<Annotation, { mark: string; label: string; color: string; tip: string }> = {
  '!!': { mark: '!!', label: 'Brilliant', color: '#1baca6', tip: 'Exceptional, statistically unlikely: a 1v3 clutch, a ninja defuse, a solo anchor, a pistol beating full gear' },
  '!': { mark: '!', label: 'Great', color: '#5c9ced', tip: 'Swung the round: a quick trade, a multi-kill, the opening kill, a flash or HE that won fights' },
  book: { mark: '', label: 'Book', color: '#a88865', tip: 'The expected, sound play: a standard smoke, an ordinary kill or grenade' },
  '?!': { mark: '?!', label: 'Inaccuracy', color: '#f7c045', tip: 'Not the best: a level-10 player would have played it a little better' },
  '?': { mark: '?', label: 'Mistake', color: '#e58f2a', tip: 'Cost the team: an untraded opening or isolated death, a team flash, dying with utility' },
  '??': { mark: '??', label: 'Blunder', color: '#ca3431', tip: 'A round-losing error: a team kill, a team flash that got a teammate killed, dying to an eco with full gear and grenades unused' },
};

/** Grade letters and their colours. */
export type Letter = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export const LETTER_COLOR: Record<Letter, string> = {
  'S+': '#f5c542', S: '#22c55e', A: '#7fbf4d', B: '#5c8bd6', C: '#a39b8f', D: '#e5a52a', F: '#e5483a',
};
export const LETTERS: Letter[] = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'];
