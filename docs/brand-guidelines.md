# RageView brand guide

## Name and promise
- **Name:** RageView (one word, capital R and V).
- **Main line (use everywhere: home H1, share title, llms.txt):** *Every move you make, graded.*
- **Game lines (game pages and their share cards only):** *Every CS2 round, graded.* · *Every Deadlock fight, graded.*
- Campaign lines (posts, never the site's main line): "Was it your fault?", "Who lost the fight?", "Prove you were right."
- **What we say first:** every move marked, the better play shown, nothing uploaded, CS2 and Deadlock in one place, free.
  Never "the only …" unless every competitor has been checked.

## Voice
- **The coach:** calm and specific. One fact a line, numbers last, "you" voice. "Died alone. Nobody could trade." Never a
  lecture in the first line ("a level-10 player would …").
- **Rage mode (opt-in, 18+):** loud, at the play, never at the person. No slurs, no sexual insults, no countries or
  races, no real people. Lines live in `src/engine/coach-remarks.json` (or Dev → Content → Rage lines).
- Sentence case everywhere. No ALL-CAPS labels. No emoji in the UI.
- Only real numbers and real screenshots. No invented player counts, quotes or testimonials.

## Words (use these, everywhere)
| Use | Not |
|---|---|
| Coach | engine, analyst, AI (in user-facing text) |
| Mark (one move: Brilliant … Blunder) | rating, score |
| Grade (a letter, S+ … F) | rank, tier |
| Review (watch a match with the coach) | replay viewer |
| Recap (the match report) | report, summary |
| Tactical (CS2's 4th tab) · Meta (Deadlock's) | board, builds page |
| "FACEIT level 10" on first mention, "level 10" after | lvl10, L10 |
| Rage mode | roast mode |

## Colours
Tokens live in `src/ui/tokens.ts` (dark default, light theme in `LIGHT`). Brand red `rage` #FF4D3D: logo and Rage mode
only. One accent a screen: the current game's (CS2 amber #F2A23A, Deadlock jade #3FC9A3). Team colours: CT #5B9BFF,
T #F2B13C; Deadlock Amber Hand #E8A33D, Sapphire Flame #5B8DEF. Grades: S #0FB5A0 · A #9BD653 · B #8B95A7 · C #F5C451 ·
D #F3873A · F #E5484D, dark ink #0A0C10, S+ = S with a gold rim #F5C451 and a star. Status colours always come with an
icon and a word.

## Type
- **Unbounded** (700): page headlines 28px and up, and the grade letters. Nothing else.
- **Onest** (400 body · 500 labels · 600 buttons, card titles, team names · 700 numbers): everything in the app.
  Numbers tabular. Scale 12 · 14 · 16 · 20 · 24 · 32 · 48 · 64. Body 16 on marketing pages, 14 in the app.

## Logo
- The eye mark (`public/images/logo.svg`) + the wordmark "RageView" in Unbounded 700.
- Clear space: the height of the eye's pupil on every side. Minimum: 16px for the mark alone (favicon), 96px wide for
  mark + wordmark.
- Never stretch, outline, recolour (except the light theme's dark version) or put it on a busy image.
- Favicon set: `logo.svg` (any size), `logo-512.png` (apple-touch, social). Still to do: 16/32 PNGs and a dedicated
  16px version of the eye.
