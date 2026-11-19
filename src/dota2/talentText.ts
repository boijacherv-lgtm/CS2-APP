/** What Valve's hero data says about a talent, and how to write it with its real numbers in. */
export type ValveValue = { name: string; values_float: number[]; bonuses?: { name: string; value: number }[] };
export type ValveTalent = { name: string; name_loc: string; special_values: ValveValue[] };

/** A hero's skills say what each talent adds to them: `talent|field` → how much. Found wherever skills are listed, facets too. */
export function bonusesIn(node: unknown, into = new Map<string, number>()): Map<string, number> {
  if (Array.isArray(node)) for (const x of node) bonusesIn(x, into);
  else if (node && typeof node === 'object') {
    const o = node as { special_values?: ValveValue[] };
    for (const v of o.special_values ?? []) for (const b of v.bonuses ?? []) into.set(`${b.name}|${v.name}`, Math.abs(b.value));
    for (const x of Object.values(node)) if (typeof x === 'object') bonusesIn(x, into);
  }
  return into;
}

const number = (v: number) => String(Math.round(v * 100) / 100);
/** "+{s:value} Health Regen" with its number in; a number nobody gives is left out rather than shown as a code. */
export function talentWords(t: ValveTalent, bonuses: Map<string, number>): string {
  let unknown = false;
  const text = t.name_loc.replace(/\{s:([^}]+)\}/g, (_, key: string) => {
    const field = key.replace(/^bonus_/, ''), own = t.special_values.find(v => v.name === key || v.name === field);
    if (own?.values_float.length) return number(own.values_float[0]);
    const from = bonuses.get(`${t.name}|${field}`) ?? bonuses.get(`${t.name}|${key}`);
    if (from !== undefined) return number(from);
    // a single number for this talent can only be this one
    const all = [...bonuses].filter(([k]) => k.startsWith(`${t.name}|`));
    if (all.length === 1) return number(all[0][1]);
    unknown = true;
    return 'X';
  });
  return (unknown ? text.replace(/[+-]?X%?s? ?/g, '') : text).replace(/\s+/g, ' ').trim();
}
