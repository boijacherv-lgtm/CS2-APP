import type { AnalystRound, DuelFact, RoundType } from './analyst';
import type { BuyType } from './recap';
import type { Side } from './types';

/**
 * The analyst's numbers over a set of rounds. benchmarks() measures level-10 demos (tools/learn-analyst.ts →
 * models/analyst.json); analystReport() measures one match for one player and their team with the same formulas,
 * so the comparison is like for like.
 */
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (n: number, d: number) => (d ? n / d : 0);
const SPACING = [[0, 300, 'under 8 m'], [300, 800, '8–20 m'], [800, 1500, '20–38 m'], [1500, Infinity, 'over 38 m']] as const;

export interface Bench {
  demos: number; rounds: number;
  trades: { deaths: number; tradedRate: number; avgTradeTime: number; chanceConversion: number; spacing: { bucket: string; n: number; tradedRate: number }[] };
  duels: {
    n: number; peekWin: number; firstHitWin: number; flashedShare: number; behindShare: number; avgTtk: number; ranges: Record<string, { n: number; avg: number }>;
    /** From the fight samples: median time to first shot after seeing the enemy, median crosshair distance (°) from their head when they appeared, share of first shots fired while moving, and how often whoever spotted first won. */
    react?: number; aim?: number; movingShots?: number; spottedFirstWin?: number;
  };
  openings: { n: number; tWinShare: number; winAfter: number; withFlash: number; places: Record<Side, { place: string; n: number; winRate: number }[]> };
  control: { tAreas20: number; tAreas40: number; keyAreas: { area: string; n: number; tWin: number }[] };
  rotations: { perRound: number; avgTime: number; lateRate: number; overRate: number; diedRate: number };
  plans: { types: { type: string; n: number; tWin: number }[]; setups: { setup: string; n: number; ctWin: number }[]; firstContact: number; plantTime: number };
  utility: Record<Side, { thrown: number; beforeContact: number; flashConv: number; teamFlashes: number }> & { executeAvg: number; winWithExecute: number; winWithout: number };
  economy: { pairs: { t: BuyType; ct: BuyType; n: number; tWin: number }[] };
  postPlant: { n: number; tWin: number; byNumbers: { key: string; n: number; tWin: number }[]; bySpread: { bucket: string; n: number; tWin: number }[]; byWatching: { watching: string; n: number; tWin: number }[] };
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
/**
 * Duel-detail numbers over a set of duels, for the killer's side, the victim's side or both (one player's view uses
 * 'killer' for their won duels and 'victim' for their lost ones).
 */
function duelDetailStats(xs: { d: DuelFact; as: 'killer' | 'victim' | 'both' }[]) {
  const react: number[] = [], aim: number[] = [], moving: boolean[] = [];
  let first = 0, firstWon = 0;
  for (const { d, as } of xs) {
    const x = d.detail;
    if (!x) continue;
    if (as !== 'victim') { if (x.kReact !== null) react.push(x.kReact); if (x.kAim !== null) aim.push(x.kAim); if (x.kMovingShot !== null) moving.push(x.kMovingShot); }
    if (as !== 'killer') { if (x.vReact !== null) react.push(x.vReact); if (x.vAim !== null) aim.push(x.vAim); if (x.vMovingShot !== null) moving.push(x.vMovingShot); }
    if (x.spottedFirst === 'killer' || x.spottedFirst === 'victim') {
      // as a player: did *they* spot first, and did they win it
      if (as === 'both') { first++; if (x.spottedFirst === 'killer') firstWon++; }
      else if ((as === 'killer') === (x.spottedFirst === 'killer')) { first++; if (as === 'killer') firstWon++; }
    }
  }
  if (!react.length && !aim.length) return {};
  return {
    react: +median(react).toFixed(3), aim: +median(aim).toFixed(1),
    movingShots: +rate(moving.filter(Boolean).length, moving.length).toFixed(3),
    spottedFirstWin: +rate(firstWon, first).toFixed(3),
  };
}

/** Peeking won / (peeking won + peeking lost), from a list of duels seen from both sides. */
const peekWin = (won: DuelFact[], lost: DuelFact[]) => rate(won.filter(d => d.style === 'peeked').length, won.filter(d => d.style === 'peeked').length + lost.filter(d => d.style === 'held').length);
const firstHitWin = (won: DuelFact[], lost: DuelFact[]) => rate(won.filter(d => d.firstHit === 'killer').length, won.filter(d => d.firstHit === 'killer').length + lost.filter(d => d.firstHit === 'victim').length);

export function benchmarks(rounds: AnalystRound[], demos: number): Bench {
  // older cached rounds called "no hit" (no site reached) a default
  for (const r of rounds) if (r.plan.tType === 'default' && !r.plan.target) r.plan.tType = 'no hit';
  const trades = rounds.flatMap(r => r.trades);
  const duels = rounds.flatMap(r => r.duels);
  const chances = trades.flatMap(t => t.chances.filter(c => c.sees));
  const openings = rounds.map(r => ({ r, d: r.duels.find(x => x.opening) })).filter(x => x.d) as { r: AnalystRound; d: DuelFact }[];
  const placeStats = (s: Side) => {
    const m = new Map<string, { n: number; w: number }>();
    for (const { r, d } of openings) if (d.side === s && d.place) { const x = m.get(d.place) ?? { n: 0, w: 0 }; x.n++; if (r.winner === s) x.w++; m.set(d.place, x); }
    return [...m].filter(([, x]) => x.n >= 5).map(([place, x]) => ({ place, n: x.n, winRate: +(x.w / x.n).toFixed(2) })).sort((a, b) => b.n - a.n).slice(0, 10);
  };
  const ranges: Bench['duels']['ranges'] = {};
  for (const w of ['rifle', 'awp', 'smg', 'pistol', 'shotgun']) { const xs = duels.filter(d => d.weapon === w).map(d => d.range); if (xs.length) ranges[w] = { n: xs.length, avg: +avg(xs).toFixed(1) }; }
  // map control: areas Ts held at 40 s, and how often T won those rounds
  const area = new Map<string, { n: number; w: number }>();
  for (const r of rounds) for (const a of r.control.find(c => c.at === 40)?.t ?? []) { const x = area.get(a) ?? { n: 0, w: 0 }; x.n++; if (r.winner === 'T') x.w++; area.set(a, x); }
  const tWinAll = rate(rounds.filter(r => r.winner === 'T').length, rounds.length);
  const rots = rounds.flatMap(r => r.rotations);
  const group = <K extends string>(key: (r: AnalystRound) => K | null, win: (r: AnalystRound) => boolean, min = 5) => {
    const m = new Map<K, { n: number; w: number }>();
    for (const r of rounds) { const k = key(r); if (k === null) continue; const x = m.get(k) ?? { n: 0, w: 0 }; x.n++; if (win(r)) x.w++; m.set(k, x); }
    return [...m].filter(([, x]) => x.n >= min).map(([k, x]) => ({ k, n: x.n, w: +(x.w / x.n).toFixed(2) })).sort((a, b) => b.n - a.n);
  };
  const util = (s: Side) => {
    const u = rounds.map(r => r.utility.find(x => x.side === s)!).filter(Boolean);
    return { thrown: +avg(u.map(x => x.thrown)).toFixed(1), beforeContact: +avg(u.map(x => x.beforeContact)).toFixed(1), flashConv: +rate(u.reduce((a, x) => a + x.flashKills, 0), u.reduce((a, x) => a + x.flashes, 0)).toFixed(3), teamFlashes: +avg(u.map(x => x.teamFlashes)).toFixed(2) };
  };
  const hits = rounds.filter(r => r.plan.target && !['eco', 'pistol'].includes(r.plan.tType));
  const execT = (r: AnalystRound) => r.utility.find(x => x.side === 'T')?.execute ?? 0;
  const pp = rounds.filter(r => r.postPlant);
  const spreadB = (v: number) => (v < 500 ? 'tight (<13 m)' : v < 1000 ? 'medium' : 'spread (>25 m)');
  return {
    demos, rounds: rounds.length,
    trades: {
      deaths: trades.length, tradedRate: +rate(trades.filter(t => t.traded).length, trades.length).toFixed(3),
      avgTradeTime: +avg(trades.filter(t => t.tradeTime !== null).map(t => t.tradeTime!)).toFixed(2),
      chanceConversion: +rate(chances.filter(c => c.traded).length, chances.length).toFixed(3),
      spacing: SPACING.map(([lo, hi, bucket]) => { const xs = trades.filter(t => t.nearestMate !== null && t.nearestMate >= lo && t.nearestMate < hi); return { bucket, n: xs.length, tradedRate: +rate(xs.filter(t => t.traded).length, xs.length).toFixed(2) }; }),
    },
    duels: {
      n: duels.length, peekWin: +peekWin(duels, duels).toFixed(3), firstHitWin: +firstHitWin(duels, duels).toFixed(3),
      flashedShare: +rate(duels.filter(d => d.flashed).length, duels.length).toFixed(3), behindShare: +rate(duels.filter(d => d.fromBehind).length, duels.length).toFixed(3),
      avgTtk: +avg(duels.filter(d => d.ttk !== null && d.ttk > 0).map(d => d.ttk!)).toFixed(2), ranges,
      ...duelDetailStats(duels.map(d => ({ d, as: 'both' as const }))),
    },
    openings: {
      n: openings.length, tWinShare: +rate(openings.filter(o => o.d.side === 'T').length, openings.length).toFixed(3),
      winAfter: +rate(openings.filter(o => o.r.winner === o.d.side).length, openings.length).toFixed(3),
      withFlash: +rate(openings.filter(o => o.d.withFlash).length, openings.length).toFixed(3),
      places: { CT: placeStats('CT'), T: placeStats('T') },
    },
    control: {
      tAreas20: +avg(rounds.map(r => r.control.find(c => c.at === 20)?.t.length ?? 0)).toFixed(1),
      tAreas40: +avg(rounds.filter(r => r.control.some(c => c.at === 40)).map(r => r.control.find(c => c.at === 40)!.t.length)).toFixed(1),
      keyAreas: [...area].filter(([, x]) => x.n >= 10).map(([a, x]) => ({ area: a, n: x.n, tWin: +(x.w / x.n).toFixed(2) }))
        .filter(x => Math.abs(x.tWin - tWinAll) >= 0.08).sort((a, b) => b.tWin - a.tWin).slice(0, 12),
    },
    rotations: {
      perRound: +rate(rots.length, rounds.length).toFixed(2), avgTime: +avg(rots.filter(x => x.arrive !== null).map(x => x.arrive! - x.start)).toFixed(1),
      lateRate: +rate(rots.filter(x => x.late).length, rots.length).toFixed(3), overRate: +rate(rots.filter(x => x.overRotated).length, rots.length).toFixed(3),
      diedRate: +rate(rots.filter(x => x.diedOnWay).length, rots.length).toFixed(3),
    },
    plans: {
      types: group(r => `${r.plan.tType}${r.plan.target && !['eco', 'pistol'].includes(r.plan.tType) ? ` ${r.plan.target}` : ''}` as string, r => r.winner === 'T').map(x => ({ type: x.k, n: x.n, tWin: x.w })),
      setups: group(r => (['eco', 'pistol'].includes(r.plan.tType) ? null : r.plan.ctSetup), r => r.winner === 'CT').map(x => ({ setup: x.k, n: x.n, ctWin: x.w })),
      firstContact: +avg(rounds.filter(r => r.plan.firstContact !== null).map(r => r.plan.firstContact!)).toFixed(1),
      plantTime: +avg(rounds.filter(r => r.plan.plant !== null).map(r => r.plan.plant!)).toFixed(1),
    },
    utility: {
      CT: util('CT'), T: util('T'),
      executeAvg: +avg(hits.map(execT)).toFixed(1),
      winWithExecute: +rate(hits.filter(r => execT(r) >= 3 && r.winner === 'T').length, hits.filter(r => execT(r) >= 3).length).toFixed(2),
      winWithout: +rate(hits.filter(r => execT(r) < 3 && r.winner === 'T').length, hits.filter(r => execT(r) < 3).length).toFixed(2),
    },
    economy: {
      pairs: group(r => { const t = r.economy.find(e => e.side === 'T')!, c = r.economy.find(e => e.side === 'CT')!; return `${t.buy}|${c.buy}`; }, r => r.winner === 'T')
        .map(x => { const [t, ct] = x.k.split('|') as [BuyType, BuyType]; return { t, ct, n: x.n, tWin: x.w }; }),
    },
    postPlant: {
      n: pp.length, tWin: +rate(pp.filter(r => r.winner === 'T').length, pp.length).toFixed(2),
      byNumbers: group(r => (r.postPlant ? `${r.postPlant.tAlive}v${r.postPlant.ctAlive}` : null), r => r.winner === 'T').map(x => ({ key: x.k, n: x.n, tWin: x.w })),
      bySpread: group(r => (r.postPlant && r.postPlant.tAlive >= 2 ? spreadB(r.postPlant.spread) : null), r => r.winner === 'T').map(x => ({ bucket: x.k, n: x.n, tWin: x.w })),
      byWatching: group(r => (r.postPlant ? (r.postPlant.watching >= 2 ? '2+' : String(r.postPlant.watching)) : null), r => r.winner === 'T').map(x => ({ watching: x.k, n: x.n, tWin: x.w })),
    },
  };
}

// ---- one match: a player and their team against the benchmark ---------------------------------------------

export interface Finding { topic: Topic; title: string; detail: string; rounds: number[]; good: boolean; weight: number }
export type Topic = 'Trades' | 'Duels' | 'Openings' | 'Map control' | 'Rotations' | 'Round plans' | 'Utility' | 'Economy' | 'Post-plant';
export interface Stat { label: string; you: string; pro: string; better: boolean | null }
export interface AnalystReport { stats: Record<Topic, Stat[]>; findings: Finding[] }

const pct = (v: number) => `${Math.round(v * 100)}%`;
const s1 = (v: number) => `${v.toFixed(1)}`;

/**
 * One player's match through the analyst's eyes: their trades, duels, openings and rotations, and their team's
 * round plans, setups, control, utility, economy and post-plants, each next to the level-10 benchmark (`bench`, the
 * map's when there is one), plus findings: what stands out, with the rounds to watch.
 * `sideOf(round)` = the player's side in that round (null = not in it).
 */
export function analystReport(rounds: (AnalystRound | null | undefined)[], player: string, sideOf: (i: number) => Side | null, bench: Bench): AnalystReport {
  const rs = rounds.map((r, i) => ({ r, i, side: sideOf(i) })).filter((x): x is { r: AnalystRound; i: number; side: Side } => !!x.r && !!x.side);
  const stats = {} as Record<Topic, Stat[]>;
  const findings: Finding[] = [];
  const cmp = (you: number, pro: number, higherBetter = true, eps = 0.05) => (Math.abs(you - pro) < eps ? null : higherBetter ? you > pro : you < pro);

  // trades
  const myDeaths = rs.flatMap(x => x.r.trades.filter(t => t.victim === player).map(t => ({ ...t, i: x.i })));
  const myChances = rs.flatMap(x => x.r.trades.flatMap(t => t.chances.filter(c => c.mate === player && c.sees).map(c => ({ ...c, t, i: x.i }))));
  const tradedMine = rate(myDeaths.filter(d => d.traded).length, myDeaths.length);
  const conv = rate(myChances.filter(c => c.traded).length, myChances.length);
  const myTradeTimes = rs.flatMap(x => x.r.trades.filter(t => t.tradedBy === player).map(t => t.tradeTime!));
  stats.Trades = [
    { label: 'Your deaths traded', you: pct(tradedMine), pro: pct(bench.trades.tradedRate), better: cmp(tradedMine, bench.trades.tradedRate) },
    { label: 'Trades taken when you could', you: `${pct(conv)} (${myChances.filter(c => c.traded).length}/${myChances.length})`, pro: pct(bench.trades.chanceConversion), better: cmp(conv, bench.trades.chanceConversion) },
    { label: 'Time to trade', you: myTradeTimes.length ? `${s1(avg(myTradeTimes))} s` : '–', pro: `${s1(bench.trades.avgTradeTime)} s`, better: myTradeTimes.length ? cmp(avg(myTradeTimes), bench.trades.avgTradeTime, false, 0.3) : null },
  ];
  const missed = myChances.filter(c => !c.traded && !c.diedAfter && c.dist < 1500);
  if (missed.length >= 2 && conv < bench.trades.chanceConversion - 0.05)
    findings.push({ topic: 'Trades', good: false, weight: 3 + missed.length, rounds: [...new Set(missed.map(c => c.i))],
      title: 'Trade your teammates', detail: `${missed.length} times a teammate died near you while you could see the killer, and you didn't trade. Level-10 players take ${pct(bench.trades.chanceConversion)} of those chances, you took ${pct(conv)}. Stay in sight of your entry and swing as soon as they fight.` });
  const lonely = myDeaths.filter(d => !d.traded && (d.nearestMate ?? Infinity) >= 1500);
  if (lonely.length >= 3) {
    const far = bench.trades.spacing.find(b => b.bucket === 'over 38 m'), mid = bench.trades.spacing.find(b => b.bucket === '8–20 m');
    findings.push({ topic: 'Trades', good: false, weight: 2 + lonely.length, rounds: [...new Set(lonely.map(d => d.i))],
      title: 'Too far from your team', detail: `${lonely.length} of your deaths came with no teammate within 38 m. Level-10 deaths are traded ${pct(mid?.tradedRate ?? 0)} of the time at 8–20 m from a teammate, ${pct(far?.tradedRate ?? 0)} beyond 38 m.` });
  }
  if (tradedMine >= bench.trades.tradedRate + 0.1 && myDeaths.length >= 6)
    findings.push({ topic: 'Trades', good: true, weight: 2, rounds: [], title: 'You die where you can be traded', detail: `${pct(tradedMine)} of your deaths were traded (level-10: ${pct(bench.trades.tradedRate)}).` });

  // duels
  const won = rs.flatMap(x => x.r.duels.filter(d => d.killer === player).map(d => ({ ...d, i: x.i })));
  const lost = rs.flatMap(x => x.r.duels.filter(d => d.victim === player).map(d => ({ ...d, i: x.i })));
  const pw = peekWin(won, lost), fh = firstHitWin(won, lost);
  const holdWin = rate(won.filter(d => d.style === 'held').length, won.filter(d => d.style === 'held').length + lost.filter(d => d.style === 'peeked').length);
  stats.Duels = [
    { label: 'Duels won', you: `${pct(rate(won.length, won.length + lost.length))} (${won.length}–${lost.length})`, pro: '50%', better: null },
    { label: 'Won when you peeked', you: pct(pw), pro: pct(bench.duels.peekWin), better: cmp(pw, bench.duels.peekWin) },
    { label: 'Won when you held', you: pct(holdWin), pro: pct(1 - bench.duels.peekWin), better: cmp(holdWin, 1 - bench.duels.peekWin) },
    { label: 'Won after hitting first', you: pct(fh), pro: pct(bench.duels.firstHitWin), better: cmp(fh, bench.duels.firstHitWin) },
  ];
  const mine = duelDetailStats([...won.map(d => ({ d, as: 'killer' as const })), ...lost.map(d => ({ d, as: 'victim' as const }))]);
  const b = bench.duels;
  if (mine.aim !== undefined && b.aim !== undefined) {
    stats.Duels.push(
      { label: 'Crosshair off the head when they appear', you: `${mine.aim}°`, pro: `${b.aim}°`, better: cmp(mine.aim, b.aim, false, 1) },
      { label: 'Time to first shot after seeing them', you: `${Math.round(mine.react! * 1000)} ms`, pro: `${Math.round(b.react! * 1000)} ms`, better: cmp(mine.react!, b.react!, false, 0.04) },
      { label: 'First shots fired while moving', you: pct(mine.movingShots!), pro: pct(b.movingShots!), better: cmp(mine.movingShots!, b.movingShots!, false) },
      { label: 'Won when you saw them first', you: pct(mine.spottedFirstWin!), pro: pct(b.spottedFirstWin!), better: cmp(mine.spottedFirstWin!, b.spottedFirstWin!) },
    );
    const lostDetail = lost.filter(d => d.detail);
    if (mine.aim >= b.aim + 3 && lostDetail.length >= 4)
      findings.push({ topic: 'Duels', good: false, weight: 3 + (mine.aim - b.aim) / 2, rounds: [...new Set(lostDetail.filter(d => (d.detail!.vAim ?? 0) > b.aim! + 3).map(d => d.i))],
        title: 'Crosshair placement', detail: `When an enemy appeared, your crosshair was a median ${mine.aim}° from their head; level-10 players are at ${b.aim}°. Keep it at head height on the angle they'll come from, so you only have to click, not flick.` });
    if (mine.movingShots! >= b.movingShots! + 0.12 && won.length + lost.length >= 8)
      findings.push({ topic: 'Duels', good: false, weight: 3, rounds: [...new Set(lost.filter(d => d.detail?.vMovingShot).map(d => d.i))],
        title: 'Stop before you shoot', detail: `${pct(mine.movingShots!)} of your first shots were fired while moving (level-10: ${pct(b.movingShots!)}). Moving shots are inaccurate: counter-strafe (tap the opposite key) and shoot when you've stopped.` });
    if (mine.react! >= b.react! + 0.1 && won.length + lost.length >= 8)
      findings.push({ topic: 'Duels', good: false, weight: 2, rounds: [],
        title: 'Shoot sooner', detail: `You take a median ${Math.round(mine.react! * 1000)} ms from seeing an enemy to shooting, level-10 players ${Math.round(b.react! * 1000)} ms. Pre-aim the spots they appear from so the first shot is ready.` });
    if (mine.aim <= b.aim - 2 && won.length + lost.length >= 8)
      findings.push({ topic: 'Duels', good: true, weight: 2, rounds: [], title: 'Great crosshair placement', detail: `Your crosshair was a median ${mine.aim}° off the enemy's head when they appeared (level-10: ${b.aim}°).` });
  }
  const peekLost = lost.filter(d => d.style === 'held');
  if (peekLost.length >= 3 && pw < bench.duels.peekWin - 0.08)
    findings.push({ topic: 'Duels', good: false, weight: 2 + peekLost.length, rounds: [...new Set(peekLost.map(d => d.i))],
      title: 'Stop peeking into held angles', detail: `You lost ${peekLost.length} fights swinging into a player who was holding still. Your peeks win ${pct(pw)}; level-10 peeks win ${pct(bench.duels.peekWin)} because they peek with a flash, a teammate or information. Hold more, or peek with utility.` });
  const hitFirstLost = lost.filter(d => d.firstHit === 'victim');
  if (hitFirstLost.length >= 3 && fh < bench.duels.firstHitWin - 0.08)
    findings.push({ topic: 'Duels', good: false, weight: 2 + hitFirstLost.length, rounds: [...new Set(hitFirstLost.map(d => d.i))],
      title: 'Finish the fights you start', detail: `${hitFirstLost.length} times you hit first and still died. Level-10 players win ${pct(bench.duels.firstHitWin)} of fights they open; you won ${pct(fh)}. Keep shooting the same target instead of moving or switching, and don't re-peek hurt.` });
  const holdLost = lost.filter(d => d.style === 'peeked');
  if (holdLost.length >= 3 && holdWin < 1 - bench.duels.peekWin - 0.12)
    findings.push({ topic: 'Duels', good: false, weight: 2 + holdLost.length, rounds: [...new Set(holdLost.map(d => d.i))],
      title: 'Win the fights that come to you', detail: `When the enemy peeked you, you won only ${pct(holdWin)} (level-10 holders win ${pct(1 - bench.duels.peekWin)}). Pre-aim where they'll appear, hold an off-angle or a spot they don't check first, and don't move while they swing.` });
  if (holdWin >= 1 - bench.duels.peekWin + 0.1 && won.length + lost.length >= 10)
    findings.push({ topic: 'Duels', good: true, weight: 2, rounds: [], title: 'Strong holding', detail: `You win ${pct(holdWin)} of fights when the enemy comes to you (level-10: ${pct(1 - bench.duels.peekWin)}).` });

  // openings
  const myOpen = rs.filter(x => x.r.duels[0] && (x.r.duels[0].killer === player || x.r.duels[0].victim === player));
  const openWon = myOpen.filter(x => x.r.duels[0].killer === player);
  const openLostT = myOpen.filter(x => x.r.duels[0].victim === player && x.side === 'T');
  stats.Openings = [
    { label: 'Opening duels', you: `${openWon.length}–${myOpen.length - openWon.length}`, pro: '–', better: null },
    { label: 'Round won after your opening kill', you: openWon.length ? pct(rate(openWon.filter(x => x.r.winner === x.side).length, openWon.length)) : '–', pro: pct(bench.openings.winAfter), better: null },
    { label: 'Openings with a flash', you: pct(rate(myOpen.filter(x => x.r.duels[0].withFlash && x.r.duels[0].killer === player).length, openWon.length || 1)), pro: pct(bench.openings.withFlash), better: null },
  ];
  if (myOpen.length - openWon.length >= 3 && openWon.length < (myOpen.length - openWon.length) / 2)
    findings.push({ topic: 'Openings', good: false, weight: 3 + myOpen.length - openWon.length, rounds: myOpen.filter(x => x.r.duels[0].victim === player).map(x => x.i),
      title: 'You give away the first kill', detail: `You lost ${myOpen.length - openWon.length} of ${myOpen.length} opening duels. ${openLostT.length ? 'As T, take the first fight with a flash or let the entry go; ' : ''}level-10 teams win ${pct(bench.openings.winAfter)} of rounds after the opening kill, so every one you lose is most of a round.` });
  else if (openWon.length >= 4 && openWon.length >= 2 * (myOpen.length - openWon.length))
    findings.push({ topic: 'Openings', good: true, weight: 3, rounds: openWon.map(x => x.i), title: 'You win the openings', detail: `${openWon.length} of your ${myOpen.length} opening duels won.` });

  // rotations (the player's own, as CT)
  const rots = rs.flatMap(x => x.r.rotations.filter(o => o.player === player).map(o => ({ ...o, i: x.i })));
  const rotT = rots.filter(o => o.arrive !== null).map(o => o.arrive! - o.start);
  stats.Rotations = [
    { label: 'Rotations', you: `${rots.length}`, pro: `${(bench.rotations.perRound / 5 * rs.filter(x => x.side === 'CT').length).toFixed(1)} expected`, better: null },
    { label: 'Time to rotate', you: rotT.length ? `${s1(avg(rotT))} s` : '–', pro: `${s1(bench.rotations.avgTime)} s`, better: rotT.length ? cmp(avg(rotT), bench.rotations.avgTime, false, 1) : null },
    { label: 'Over-rotations', you: `${rots.filter(o => o.overRotated).length}`, pro: pct(bench.rotations.overRate), better: null },
  ];
  const badRot = rots.filter(o => o.overRotated || o.late);
  if (badRot.length >= 2)
    findings.push({ topic: 'Rotations', good: false, weight: 2 + badRot.length, rounds: [...new Set(badRot.map(o => o.i))],
      title: 'Rotate on information, not on a feeling', detail: `${badRot.filter(o => o.overRotated).length} over-rotations (you left a site that then got hit), ${badRot.filter(o => o.late).length} late. Level-10 CTs rotate in ${s1(bench.rotations.avgTime)} s and over-rotate ${pct(bench.rotations.overRate)} of the time: wait for a second piece of info (two players seen, utility on the site) before leaving.` });

  // the team's round plans and setups
  const tRounds = rs.filter(x => x.side === 'T' && !['eco', 'pistol'].includes(x.r.plan.tType));
  const ctRounds = rs.filter(x => x.side === 'CT' && !['eco', 'pistol'].includes(x.r.plan.tType));
  const typeCount = (t: RoundType) => tRounds.filter(x => x.r.plan.tType === t).length;
  const proType = (t: string) => { const xs = bench.plans.types.filter(x => x.type.startsWith(t)); const n = xs.reduce((a, x) => a + x.n, 0); return { share: rate(n, bench.plans.types.filter(x => !/eco|pistol/.test(x.type)).reduce((a, x) => a + x.n, 0)), win: rate(xs.reduce((a, x) => a + x.n * x.tWin, 0), n) }; };
  stats['Round plans'] = (['default', 'rush', 'execute', 'split'] as RoundType[]).map(t => {
    const mine = tRounds.filter(x => x.r.plan.tType === t);
    const pro = proType(t);
    return { label: `T ${t === 'rush' ? 'rushes' : `${t}s`}`, you: `${mine.length}${mine.length ? ` (won ${mine.filter(x => x.r.winner === 'T').length})` : ''}`, pro: `${pct(pro.share)} of rounds, win ${pct(pro.win)}`, better: null };
  });
  const contact = tRounds.filter(x => x.r.plan.firstContact !== null).map(x => x.r.plan.firstContact!);
  stats['Round plans'].push({ label: 'First contact (as T)', you: contact.length ? `${Math.round(avg(contact))} s` : '–', pro: `${Math.round(bench.plans.firstContact)} s`, better: null });
  if (tRounds.length >= 6 && typeCount('rush') >= tRounds.length * 0.5 && proType('rush').share < 0.3)
    findings.push({ topic: 'Round plans', good: false, weight: 3, rounds: tRounds.filter(x => x.r.plan.tType === 'rush').map(x => x.i),
      title: 'Too many rushes', detail: `Your team rushed ${typeCount('rush')} of ${tRounds.length} T rounds. Level-10 teams rush ${pct(proType('rush').share)} of the time and win ${pct(proType('rush').win)} of those; they mostly default first and hit later (${pct(proType('default').win)} win).` });
  const setups = new Map<string, { n: number; w: number; is: number[] }>();
  for (const x of ctRounds) { const k = x.r.plan.ctSetup; const v = setups.get(k) ?? { n: 0, w: 0, is: [] }; v.n++; if (x.r.winner === 'CT') v.w++; v.is.push(x.i); setups.set(k, v); }
  stats['Round plans'].push({ label: 'Your CT setups', you: [...setups].sort((a, b) => b[1].n - a[1].n).slice(0, 2).map(([k, v]) => `${k} ×${v.n}`).join(', ') || '–', pro: bench.plans.setups.slice(0, 2).map(x => `${x.setup} (${pct(x.ctWin)})`).join(', ') || '–', better: null });
  for (const [k, v] of setups) {
    const pro = bench.plans.setups.find(x => x.setup === k);
    if (v.n >= 4 && pro && pro.n >= 10 && v.w / v.n < pro.ctWin - 0.2)
      findings.push({ topic: 'Round plans', good: false, weight: 2, rounds: v.is, title: `The ${k} setup isn't working`, detail: `Your team played ${k} ${v.n} times and won ${v.w}. Level-10 teams win ${pct(pro.ctWin)} with it; check the positions inside it (Positioning card).` });
  }

  // map control (team, as T): areas held at 40 s
  const tCtl = rs.filter(x => x.side === 'T' && x.r.control.some(c => c.at === 40));
  const ctl40 = avg(tCtl.map(x => x.r.control.find(c => c.at === 40)!.t.length));
  const ctCtl = rs.filter(x => x.side === 'CT' && x.r.control.some(c => c.at === 40));
  const ctl40ct = avg(ctCtl.map(x => x.r.control.find(c => c.at === 40)!.ct.length));
  stats['Map control'] = [
    { label: 'Areas held at 0:40 as T', you: tCtl.length ? s1(ctl40) : '–', pro: s1(bench.control.tAreas40), better: tCtl.length ? cmp(ctl40, bench.control.tAreas40, true, 0.5) : null },
    { label: 'Areas Ts held against you at 0:40', you: ctCtl.length ? s1(avg(ctCtl.map(x => x.r.control.find(c => c.at === 40)!.t.length))) : '–', pro: s1(bench.control.tAreas40), better: ctCtl.length ? cmp(avg(ctCtl.map(x => x.r.control.find(c => c.at === 40)!.t.length)), bench.control.tAreas40, false, 0.5) : null },
  ];
  void ctl40ct;
  const key = bench.control.keyAreas.filter(a => a.tWin > 0.55);
  const tWinTeam = rate(rs.filter(x => x.side === 'T' && x.r.winner === 'T').length, rs.filter(x => x.side === 'T').length);
  const tWinPro = rate(bench.plans.types.reduce((a, x) => a + x.n * x.tWin, 0), bench.plans.types.reduce((a, x) => a + x.n, 0));
  // only when the team is behind on control or on T rounds won (not a list of areas they could also have taken)
  if (tCtl.length >= 5 && key.length && (ctl40 < bench.control.tAreas40 - 0.5 || tWinTeam < tWinPro - 0.1)) {
    const missing = key.filter(a => tCtl.filter(x => x.r.control.find(c => c.at === 40)!.t.includes(a.area)).length <= tCtl.length * 0.25).slice(0, 2);
    if (missing.length)
      findings.push({ topic: 'Map control', good: false, weight: 2.5, rounds: tCtl.map(x => x.i).slice(0, 6),
        title: `Take ${missing.map(a => a.area).join(' and ')} as T`, detail: `${missing.map(a => `When level-10 Ts hold ${a.area} at 0:40 they win ${pct(a.tWin)} of rounds`).join('; ')}. Your team rarely had it by then.` });
  }

  // utility (team)
  const uOf = (s: Side) => rs.filter(x => x.side === s).map(x => ({ u: x.r.utility.find(u => u.side === s)!, x })).filter(y => y.u);
  const tu = uOf('T'), cu = uOf('CT');
  const myExec = tRounds.map(x => x.r.utility.find(u => u.side === 'T')?.execute ?? 0);
  stats.Utility = [
    { label: 'Grenades a round (T)', you: tu.length ? s1(avg(tu.map(y => y.u.thrown))) : '–', pro: s1(bench.utility.T.thrown), better: tu.length ? cmp(avg(tu.map(y => y.u.thrown)), bench.utility.T.thrown, true, 0.5) : null },
    { label: 'Grenades a round (CT)', you: cu.length ? s1(avg(cu.map(y => y.u.thrown))) : '–', pro: s1(bench.utility.CT.thrown), better: cu.length ? cmp(avg(cu.map(y => y.u.thrown)), bench.utility.CT.thrown, true, 0.5) : null },
    { label: 'Utility in the hit (T)', you: myExec.length ? s1(avg(myExec)) : '–', pro: s1(bench.utility.executeAvg), better: myExec.length ? cmp(avg(myExec), bench.utility.executeAvg, true, 0.5) : null },
    { label: 'Flashes that led to a kill', you: pct(rate([...tu, ...cu].reduce((a, y) => a + y.u.flashKills, 0), [...tu, ...cu].reduce((a, y) => a + y.u.flashes, 0))), pro: pct((bench.utility.T.flashConv + bench.utility.CT.flashConv) / 2), better: null },
  ];
  // hits with no grenade at all, when the team is clearly below level-10 in the hit
  const dry = tRounds.filter(x => (x.r.utility.find(u => u.side === 'T')?.execute ?? 0) === 0 && x.r.plan.target);
  if (dry.length >= 4 && myExec.length && avg(myExec) < bench.utility.executeAvg - 0.5 && bench.utility.winWithExecute > bench.utility.winWithout + 0.05)
    findings.push({ topic: 'Utility', good: false, weight: 2.5, rounds: dry.map(x => x.i),
      title: 'Hit the site with utility', detail: `${dry.length} T rounds went onto a site without a single grenade in the hit (your team: ${s1(avg(myExec))} a hit, level-10: ${s1(bench.utility.executeAvg)}). Level-10 teams win ${pct(bench.utility.winWithExecute)} of hits with 3+ grenades, ${pct(bench.utility.winWithout)} with fewer.` });

  // economy (team)
  const ecoRounds = rs.map(x => ({ x, mine: x.r.economy.find(e => e.side === x.side)!, theirs: x.r.economy.find(e => e.side !== x.side)! })).filter(y => y.mine && y.theirs && y.mine.buy !== 'Pistol round');
  const forces = ecoRounds.filter(y => y.mine.buy === 'Force buy');
  const proPair = (mine: BuyType, theirs: BuyType, s: Side) => { const p = bench.economy.pairs.find(q => (s === 'T' ? q.t === mine && q.ct === theirs : q.ct === mine && q.t === theirs)); return p ? (s === 'T' ? p.tWin : 1 - p.tWin) : null; };
  stats.Economy = [
    { label: 'Force buys', you: `${forces.length} (won ${forces.filter(y => y.x.r.winner === y.x.side).length})`, pro: (() => { const v = proPair('Force buy', 'Full buy', 'T'); return v === null ? '–' : `win ${pct(v)} vs a full buy`; })(), better: null },
    { label: 'Ecos', you: `${ecoRounds.filter(y => y.mine.buy === 'Eco').length}`, pro: '–', better: null },
    { label: 'Full buys won', you: (() => { const f = ecoRounds.filter(y => y.mine.buy === 'Full buy'); return f.length ? `${pct(rate(f.filter(y => y.x.r.winner === y.x.side).length, f.length))} (${f.length})` : '–'; })(), pro: (() => { const v = proPair('Full buy', 'Full buy', 'T'); return v === null ? '–' : `T ${pct(v)} / CT ${pct(1 - v)} in full vs full`; })(), better: null },
  ];
  const badForces = forces.filter(y => y.theirs.buy === 'Full buy' && y.x.r.winner !== y.x.side);
  const fv = proPair('Force buy', 'Full buy', 'T');
  if (badForces.length >= 3 && fv !== null && fv < 0.3)
    findings.push({ topic: 'Economy', good: false, weight: 2, rounds: badForces.map(y => y.x.i),
      title: 'Forcing into full buys', detail: `Your team forced ${badForces.length} times into a full buy and lost. A force against a full buy wins about ${pct(fv)} at level 10; saving for a full buy next round is usually worth more.` });

  // post-plant (team)
  const pp = rs.filter(x => x.r.postPlant);
  const ppT = pp.filter(x => x.side === 'T');
  stats['Post-plant'] = [
    { label: 'Post-plants won as T', you: ppT.length ? `${ppT.filter(x => x.r.winner === 'T').length}/${ppT.length}` : '–', pro: pct(bench.postPlant.tWin), better: ppT.length ? cmp(rate(ppT.filter(x => x.r.winner === 'T').length, ppT.length), bench.postPlant.tWin, true, 0.1) : null },
    { label: 'Retakes won as CT', you: (() => { const c = pp.filter(x => x.side === 'CT'); return c.length ? `${c.filter(x => x.r.winner === 'CT').length}/${c.length}` : '–'; })(), pro: pct(1 - bench.postPlant.tWin), better: null },
  ];
  const tight = ppT.filter(x => x.r.postPlant!.tAlive >= 3 && x.r.postPlant!.spread < 500 && x.r.winner !== 'T');
  const spreadPro = bench.postPlant.bySpread.find(b => b.bucket.startsWith('spread')), tightPro = bench.postPlant.bySpread.find(b => b.bucket.startsWith('tight'));
  if (tight.length >= 2 && spreadPro && tightPro && spreadPro.tWin > tightPro.tWin)
    findings.push({ topic: 'Post-plant', good: false, weight: 2, rounds: tight.map(x => x.i),
      title: 'Spread out after the plant', detail: `${tight.length} lost post-plants with your team stacked close together. Level-10 Ts win ${pct(spreadPro.tWin)} of post-plants when spread out, ${pct(tightPro.tWin)} when tight: one grenade or one spray shouldn't reach two of you.` });

  findings.sort((a, b) => Number(a.good) - Number(b.good) || b.weight - a.weight);
  return { stats, findings };
}
