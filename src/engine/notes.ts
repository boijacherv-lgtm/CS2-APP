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
/**
 * Letter colours, good → neutral → bad, checked for red-green colour blindness on the dark surface (worst ΔE 11; the
 * old S and A were ΔE 1.7, the same colour to many players). S+ is S with a gold rim and a star (letterStyle).
 */
export const LETTER_COLOR: Record<Letter, string> = {
  'S+': '#0FB5A0', S: '#0FB5A0', A: '#9BD653', B: '#8B95A7', C: '#F5C451', D: '#F3873A', F: '#E5484D',
};
/** Dark ink on the light letter fills (contrast 4.5+). */
export const LETTER_INK = '#0A0C10';
export const LETTER_RIM = '#F5C451';
/** A letter badge's colours: its fill, dark ink, and for S+ the gold rim. */
export const letterStyle = (l: Letter) => ({ background: LETTER_COLOR[l], color: LETTER_INK, ...(l === 'S+' ? { boxShadow: `0 0 0 2px ${LETTER_RIM}`, '--star': '"★"' } : {}) }) as { background: string; color: string; boxShadow?: string };
/** A move mark's symbol on its round badge (Book is a tick). */
export const NOTE_SYMBOL: Record<Annotation, string> = { '!!': '!!', '!': '!', book: '✓', '?!': '?!', '?': '?', '??': '??' };
export const LETTERS: Letter[] = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'];

/** The change in win chance next to a mark, never fighting it: a bad mark never shows a gain, a good one never a loss, and a
 * change under half a point shows no number (never "+0.0" or "−0.0"). */
export function swingNote(note: string, swing: number): { text: string; tone: 'up' | 'down' | 'muted' } | null {
  const pts = Math.round(swing * 1000) / 10;
  if (Math.abs(pts) < 0.5) return null;
  const bad = note === '?!' || note === '?' || note === '??', good = note === '!' || note === '!!';
  if (bad && pts > 0) return { text: 'Your team still won the fight', tone: 'muted' };
  if (good && pts < 0) return { text: 'Your team still lost the fight', tone: 'muted' };
  return { text: `(${pts > 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)} pts)`, tone: pts > 0 ? 'up' : 'down' };
}
