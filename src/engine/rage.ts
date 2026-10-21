import type { FeatureId } from './coach';
import type { Move, Tag } from './recap';

/**
 * Rage mode: the coach losing it at your plays, the way a teammate would on voice ("why the fuck did you go there?").
 * Opt-in (Settings / the Rage switch in Review), 18+. It swears at the play, never at who the player is: no insults
 * about identity, nothing about the person outside the game. The grade and the reasons don't change; this is one
 * extra line on the card, picked from the move's tags, and the same move always gets the same line.
 */
const LINES: { when: (m: Move) => boolean; say: string[] }[] = [
  // the worst first: the first match wins
  { when: m => m.tags.includes('TEAM KILL'), say: ['You killed your own teammate. Who are you even playing for?', 'Wrong team, genius. That was YOUR teammate.'] },
  { when: m => m.tags.includes('TEAM FLASH') && m.note === '??', say: ['You flashed your teammate and they died. Great flash. For the enemy.', 'Blinded your own teammate straight into a death. Incredible support.'] },
  { when: m => m.tags.includes('TEAM FLASH'), say: ['You flashed your own team. Whose side are you on?', 'Call your fucking flashes. Your teammate saw nothing but white.', 'That flash hit more of us than them.'] },
  { when: m => m.tags.includes('ECO DEATH'), say: ['Full buy, died to an eco. Embarrassing.', 'They had pistols. You had everything. And you still died.'] },
  { when: m => m.tags.includes('NO TRADE'), say: ['Your mate died right in front of you and you just watched. Swing, for fuck\'s sake.', 'They died two seconds away from you. Two seconds. Trade them!', 'Were you spectating? That was your trade.'] },
  { when: m => m.tags.includes('KNIFE OUT') && !m.tags.includes('OUTGUNNED'), say: ['Knife out in a gunfight. Bold. Stupid, but bold.', 'Who pulls out a knife there? Seriously, who?'] },
  { when: m => m.tags.includes('WHIFF'), say: ['A whole spray and nothing hit. Did you even look at the screen?', 'You emptied the mag into the wall. The wall is fine, thanks.', 'How do you miss that? HOW?'] },
  { when: m => m.tags.includes('AWP LOST'), say: ['$4,750 gift-wrapped for the enemy. Merry Christmas.', 'You just handed them the AWP. Again.'] },
  { when: m => m.tags.includes('UNUSED UTIL'), say: ['Died with your grenades still in your pocket. Saving them for the next match?', 'You paid for that utility. Throw it, you hoarder.', 'All those nades and you threw none. What were they for, decoration?'] },
  { when: m => m.tags.includes('DRY PEEK') || m.tags.includes('BAD PEEK'), say: ['Dry peeking into a held angle. What did you think would happen?', 'No flash, no info, no plan. Just vibes. And now you\'re dead.', 'You swung into them like they owed you money.'] },
  { when: m => m.kind === 'death' && m.tags.includes('LOW HP'), say: ['Taking that fight on low HP? Sit the fuck down.', 'You were one tap from dead and you still peeked.'] },
  { when: m => m.kind === 'death' && m.tags.includes('LOUD'), say: ['Running in like a herd of cows. They heard you from spawn.', 'Shift exists. Use it. They heard every step.'] },
  { when: m => m.kind === 'death' && m.tags.includes('MOVING SHOT'), say: ['Shooting while running. This isn\'t Call of Duty.', 'Stop. Then shoot. It\'s not that hard.'] },
  { when: m => m.kind === 'death' && m.tags.includes('NO AMMO'), say: ['Three bullets left and you took the fight. Reload, damn it.', 'Empty mag, full confidence. Great combo.'] },
  { when: m => m.kind === 'death' && m.tags.includes('OPENING') && m.note !== 'book', say: ['First blood, and it\'s yours. Again.', 'Five seconds in and you\'re already dead. Great start.', 'Opening duel lost. Your team is 4v5 because of you.'] },
  { when: m => m.kind === 'death' && m.tags.includes('ISOLATED') && m.note !== 'book', say: ['Why the fuck did you go there alone? Nobody could trade you.', 'Where was your team? Not there. Why were you?', 'You went solo and died solo. Shocking.'] },
  { when: m => m.tags.includes('WASTED'), say: ['Nice grenade. It hit absolutely nothing.', 'You threw that into the void. The void says thanks.', 'Great utility. For nobody.'] },
  { when: m => m.tags.includes('LATE ROTATION'), say: ['You got there after it was over. Nice jog.', 'The round was lost by the time you showed up.'] },
  { when: m => m.tags.includes('OVER-ROTATION'), say: ['You left your site wide open to go help nobody.', 'Everyone rotated. Including you. Why?'] },
  { when: m => m.kind === 'position' && (m.note === '??' || m.note === '?'), say: ['Why the fuck did you go there?', 'Literally anywhere else was better. The engine checked.', 'What was the plan there? Because there wasn\'t one.'] },
  { when: m => m.kind === 'position' && m.note === '?!', say: ['Not terrible. Not good either. Why there?', 'A level-10 player wouldn\'t have. Just saying.'] },
  // the good ones: grudging
  { when: m => m.note === '!!', say: ['Okay. That was actually filthy.', 'Who are you and what did you do with the player from the last round?', 'Fine. That was insane. Don\'t let it go to your head.'] },
  { when: m => m.note === '!', say: ['Fine. That one was good. Don\'t get used to it.', 'Look at you doing something right for once.', 'Good. Now do that every round.'] },
  // anything else that cost the team
  { when: m => m.note === '??', say: ['What the fuck was that?', 'That lost the round. Just so you know.'] },
  { when: m => m.note === '?', say: ['What was that supposed to be?', 'Bad. Just bad. Watch it again.'] },
];

/** Same move, same line (a stable pick from the move's time and player). */
function pick(lines: string[], m: Move) {
  let h = 0;
  for (const c of `${m.t}|${m.player}|${m.kind}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  return lines[Math.abs(h) % lines.length];
}

/** The coach's rant about one move, or null for a plain, expected move. */
export function rageLine(m: Move): string | null {
  if (m.note === 'book' && !m.tags.some(t => (['NO TRADE', 'WASTED', 'TEAM FLASH'] as Tag[]).includes(t))) return null;
  const rule = LINES.find(r => r.when(m));
  return rule ? pick(rule.say, m) : null;
}

/** The match coach's main point, shouted: one line per thing to work on. */
const SUMMARY: Partial<Record<FeatureId | 'side', string>> = {
  untradedDeaths: 'You keep dying where nobody can trade you. Play WITH your team, for fuck\'s sake.',
  isolatedDeaths: 'Stop running off alone. Every time you go solo, you die solo.',
  openingDeaths: 'You give away the first kill every other round. Stop being the free opening.',
  whiffs: 'You miss sprays you should hit. Stop, aim, then shoot.',
  unusedUtil: 'You die with your grenades every round. THROW THEM.',
  wastedFlashes: 'Your flashes blind nobody. Learn one good flash per spot.',
  teamHarm: 'You hurt your own team more than the enemy does. Call your utility.',
  awpLost: 'You keep losing the AWP. That\'s $4,750 a pop. Play it safer.',
  lowHpFights: 'You take fights on low HP like you\'re immortal. You\'re not.',
  adr: 'Your damage is a joke. Get into fights that matter.',
  kast: 'Half the rounds you did nothing. Be useful.',
  hs: 'Aim at the head. That round thing on top.',
  trades: 'Your teammates die and you don\'t trade. Swing!',
  impact: 'You barely change rounds. Kills that matter, please.',
  side: 'One side you play fine, the other you throw. Fix it.',
};
export function rageSummary(feature: FeatureId | null, side = false): string {
  return (side ? SUMMARY.side : feature ? SUMMARY[feature] : null) ?? 'Honestly? Not bad. Don\'t make me say it twice.';
}
