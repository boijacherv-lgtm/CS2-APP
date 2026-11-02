/**
 * The coach's suggested build: twelve items in three phases (early, mid, late) for one hero, picked for what the
 * player needs. Each item is scored on what players on this patch do (how often it's bought, how much more it wins
 * than the hero's average, trusting it more with more games), plus the player's needs (weapon / spirit focus, staying
 * alive, helping the team), plus how it does against the enemy heroes when they're given. Phases follow when each item
 * is usually bought. Every pick says why.
 */
import type { CounterItem, ItemMeta } from './meta';

export interface Item { id: number; name: string; tier: number; cost: number; slot: string }
export type Focus = 'weapon' | 'spirit' | 'mixed';
export interface Needs { focus: Focus; survive: boolean; support: boolean }
export interface Pick { item: Item; why: string[]; score: number; buyAt: number }
export interface SuggestedBuild { phases: { name: string; picks: Pick[]; cost: number }[] }

/** Items that help teammates (heals, barriers, saves, auras), by name. */
const SUPPORT = /heal|rescue|barrier|veil|aura|guardian|divine|restorative|kinetic|shield|healbane|cleanse|debuff remover|knockdown|slowing hex|suppressor/i;
const PHASES = [
  { name: 'Early', to: 600, n: 4 },
  { name: 'Mid', to: 1380, n: 4 },
  { name: 'Late', to: Infinity, n: 4 },
];

export function suggestBuild(stats: { all: ItemMeta[]; base: number; games: number }, items: Map<number, Item>, needs: Needs, counters: CounterItem[] = [],
  heroName = (id: number) => String(id)): SuggestedBuild {
  const counter = new Map(counters.map(c => [c.item, c]));
  const scored: Pick[] = [];
  for (const s of stats.all) {
    const it = items.get(s.item);
    if (!it || it.tier > 4 || !it.slot) continue;
    // fits something the player asked for: then a less common item is still worth a look
    const fits = (needs.focus !== 'mixed' && it.slot === needs.focus) || (needs.survive && it.slot === 'vitality') || (needs.support && SUPPORT.test(it.name)) || counter.has(s.item);
    if (s.share < (fits ? 0.015 : 0.04)) continue;
    const why: string[] = [];
    const trust = s.matches / (s.matches + 2000);
    // items bought late look better than they are (they're mostly bought in long games already being won): trusted less
    const late = Math.max(0.3, Math.min(1, 1 - (s.buyAt - 1200) / 1800));
    const lift = (s.winRate - stats.base) * trust * late;
    let score = s.share * 1.2 + lift * 25;
    if (s.share >= 0.35) why.push(`core: ${Math.round(s.share * 100)}% buy it`);
    else if (s.share >= 0.15) why.push(`${Math.round(s.share * 100)}% buy it`);
    if (lift >= 0.01) why.push(`wins ${(lift * 100).toFixed(1)} pts more`);
    if (needs.focus !== 'mixed') {
      if (it.slot === needs.focus) { score += 0.45; why.push(needs.focus === 'weapon' ? 'gun damage' : 'spirit power'); }
      else if (it.slot !== 'vitality') score -= 0.3;
    }
    if (needs.survive && it.slot === 'vitality') { score += 0.5; why.push('keeps you alive'); }
    if (needs.support && SUPPORT.test(it.name)) { score += 0.6; why.push('helps your team'); }
    const c = counter.get(s.item);
    if (c && c.lift > 0) { score += c.lift * 30; why.push(`vs ${c.vs.slice(0, 2).map(v => heroName(v.hero)).join(', ') || 'their team'}`); }
    scored.push({ item: it, why, score, buyAt: s.buyAt });
  }
  scored.sort((a, b) => b.score - a.score);
  const used = new Set<number>(), phases: SuggestedBuild['phases'] = [];
  let from = 0;
  for (const ph of PHASES) {
    // the best items usually bought in this stretch; a phase never fills up with one slot only (mixed focus)
    const picks: Pick[] = [];
    // what was asked for gets at least one place in every phase: a vitality item to survive, a team item to support
    for (const want of [needs.survive ? (p: Pick) => p.item.slot === 'vitality' : null, needs.support ? (p: Pick) => SUPPORT.test(p.item.name) : null]) {
      if (!want) continue;
      const p = scored.find(x => !used.has(x.item.id) && want(x) && x.buyAt >= from && x.buyAt < ph.to);
      if (p) { picks.push(p); used.add(p.item.id); }
    }
    for (const p of scored) {
      if (picks.length >= ph.n) break;
      if (used.has(p.item.id) || p.buyAt < from || p.buyAt >= ph.to) continue;
      if (needs.focus === 'mixed' && picks.filter(x => x.item.slot === p.item.slot).length >= 2) continue;
      picks.push(p); used.add(p.item.id);
    }
    // a stretch short of picks: the next best of any time that fits its price range
    for (const p of scored) {
      if (picks.length >= ph.n) break;
      const tierOk = ph.name === 'Early' ? p.item.tier <= 2 : ph.name === 'Mid' ? p.item.tier >= 2 && p.item.tier <= 3 : p.item.tier >= 3;
      if (!used.has(p.item.id) && tierOk) { picks.push(p); used.add(p.item.id); }
    }
    picks.sort((a, b) => a.buyAt - b.buyAt);
    phases.push({ name: ph.name, picks, cost: picks.reduce((a, p) => a + p.item.cost, 0) });
    from = ph.to;
  }
  return { phases };
}
