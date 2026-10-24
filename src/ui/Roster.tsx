import { gearAt, isGrenade, type DemoRound } from '../engine/recap';
import { CS2_ICONS, type Cs2Icon } from './cs2Icons';
import { GameIcon, Icon } from './Icon';

/**
 * Review: each team's five players along the bottom of the map, like a tournament broadcast (CT bottom left, T bottom
 * right, mirrored): the row fills with the team's colour as far as their health goes, then the name, kills this round,
 * the match's kills / deaths so far, the gun in hand (and what else they carry), grenades, armour, kit or bomb, and
 * money. Reads the gear log of the demo (newer parses), else the buy minus the grenades thrown since.
 */
export interface RosterPlayer { id: string; name: string; alive: boolean; hp: number; avatar?: string; kills: number; deaths: number; roundKills: number }

/** Inventory names ("AK-47", "Smoke Grenade") and weapon-in-hand names ("ak47") → CS2's pictogram. */
const ICON_OF: Record<string, string> = {
  ak47: 'ak47', m4a4: 'm4a1', m4a1s: 'm4a1_silencer', galilar: 'galilar', famas: 'famas', sg553: 'sg556', aug: 'aug', awp: 'awp',
  ssg08: 'ssg08', g3sg1: 'g3sg1', scar20: 'scar20', mp9: 'mp9', mac10: 'mac10', mp7: 'mp7', mp5sd: 'mp5sd', ump45: 'ump45', p90: 'p90',
  ppbizon: 'bizon', nova: 'nova', xm1014: 'xm1014', mag7: 'mag7', sawedoff: 'sawedoff', m249: 'm249', negev: 'negev',
  glock18: 'glock', usps: 'usp_silencer', p2000: 'p2000', p250: 'p250', deserteagle: 'deagle', fiveseven: 'fiveseven', tec9: 'tec9',
  cz75auto: 'cz75a', dualberettas: 'elite', r8revolver: 'revolver', zeusx27: 'taser',
  smokegrenade: 'smokegrenade', flashbang: 'flashbang', highexplosivegrenade: 'hegrenade', molotov: 'molotov',
  incendiarygrenade: 'incgrenade', decoygrenade: 'decoy', c4explosive: 'c4', c4: 'c4',
};
const norm = (w: string) => w.toLowerCase().replace(/^weapon_/, '').replace(/[^a-z0-9]/g, '');
const KNIFE = /knife|bayonet|karambit|dagger|talon|butterfly|huntsman|falchion|bowie|navaja|stiletto|ursus|kukri|daggers/;
function iconOf(w: string): Cs2Icon | null {
  const n = norm(w);
  if (KNIFE.test(n)) return 'equipment/knife';
  const k = `equipment/${ICON_OF[n] ?? n}` as Cs2Icon;
  return k in CS2_ICONS ? k : null;
}
const PRIMARY = /awp|ak47|m4a|galil|famas|sg553|aug|ssg08|g3sg1|scar20|mp9|mac10|mp7|mp5|ump45|p90|bizon|nova|xm1014|mag7|sawedoff|m249|negev/;
const NADE_ORDER = ['smoke', 'flash', 'high', 'molotov', 'incendiary', 'decoy'];
const dollars = (v: number) => `$${v.toLocaleString('en-US')}`;

export function TeamRoster({ side, players, round, time }: { side: 'CT' | 'T'; players: RosterPlayer[]; round: DemoRound; time: number }) {
  const ft = round.frames.t;
  let k = 0; while (k < ft.length - 1 && ft[k + 1] <= time) k++;
  const gears = players.map(p => (p.alive ? gearAt(round, p.id, time) : null));
  const bank = players.reduce((a, p) => a + (gearAt(round, p.id, time)?.money ?? 0), 0);
  const alive = players.filter(p => p.alive).length;
  return (
    <div className={`teambar ${side.toLowerCase()}`}>
      <div className="tb-head">
        <b><span className="tb-long">{side === 'CT' ? 'Counter-Terrorists' : 'Terrorists'}</span><span className="tb-short">{side}</span></b>
        <span className="tb-alive" title={`${alive} of ${players.length} alive`}>
          {players.map((p, i) => <i key={i} className={p.alive ? 'on' : ''} />)}
        </span>
        {bank > 0 && <span className="tb-bank num" title="The team's money">{dollars(bank)}</span>}
      </div>
      {players.map((p, i) => {
        const g = gears[i];
        const inHand = norm(round.frames.players[p.id]?.w?.[k] ?? '');
        const inv = g?.inv ?? [];
        const primary = inv.find(w => PRIMARY.test(norm(w)));
        const pistol = inv.find(w => !PRIMARY.test(norm(w)) && !isGrenade(w) && !KNIFE.test(norm(w)) && !/c4|zeus|taser/i.test(w));
        const nades = inv.filter(isGrenade).sort((a, b) => NADE_ORDER.findIndex(x => norm(a).startsWith(x)) - NADE_ORDER.findIndex(x => norm(b).startsWith(x)));
        const bomb = inv.some(w => /c4/i.test(w));
        const held = (w: string) => norm(w) === inHand || (inHand.length > 3 && norm(w).startsWith(inHand));
        // the gun they hold, big; else their best one
        const main = [primary, pistol].find(w => w && held(w)) ?? primary ?? pistol;
        const other = main === primary ? pistol : primary;
        const gun = (w: string | undefined, big: boolean) => {
          if (!w) return null;
          const src = iconOf(w);
          return src ? <GameIcon src={src} size={big ? 19 : 13} title={`${w}${held(w) ? ' (in hand)' : ''}`} className={`tb-gun ${big ? 'main' : ''} ${held(w) ? 'held' : ''}`} />
            : <span className="tb-gun-txt">{w}</span>;
        };
        const hp = Math.max(0, Math.min(100, Math.round(p.hp)));
        return (
          <div key={p.id} className={`tb-row ${p.alive ? '' : 'dead'} ${p.alive && hp <= 30 ? 'low' : ''}`} style={{ '--hp': `${p.alive ? hp : 0}%` } as React.CSSProperties}>
            <span className="tb-pic">{p.avatar ? <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <b>{p.name.slice(0, 2)}</b>}</span>
            <div className="tb-main">
              <div className="tb-line">
                {p.alive ? <span className="tb-hp num" title="Health">{hp}</span> : <Icon name="skull" size={13} title="Dead" className="tb-dead" />}
                <span className="tb-name" title={p.name}>{p.name}</span>
                {p.roundKills > 0 && (
                  <span className="tb-rk" title={`${p.roundKills} kill${p.roundKills > 1 ? 's' : ''} this round`}>
                    {Array.from({ length: Math.min(5, p.roundKills) }, (_, j) => <Icon key={j} name="skull" size={10} />)}
                  </span>
                )}
                <span className="tb-kd num" title="Kills / deaths in the match so far">{p.kills}<em>/</em>{p.deaths}</span>
              </div>
              <div className="tb-line gear">
                {p.alive && g && (
                  <>
                    {gun(main, true)}
                    {gun(other, false)}
                    {KNIFE.test(inHand) && <GameIcon src="equipment/knife" size={12} title="Knife (in hand)" className="tb-gun held" />}
                    <span className="tb-nades">{nades.map((w, j) => { const src = iconOf(w); return src ? <GameIcon key={j} src={src} size={13} title={`${w}${held(w) ? ' (in hand)' : ''}`} className={held(w) ? 'tb-nade held' : 'tb-nade'} /> : null; })}</span>
                    <span className="tb-spacer" />
                    {g.armor > 0 && <Icon name={g.helmet ? 'helmet' : 'vest'} size={12} title={`${g.helmet ? 'Armour and helmet' : 'Armour'} (${g.armor})`} className="tb-armor" />}
                    {bomb && <Icon name="bomb" size={12} title="Carrying the bomb" className="tb-bomb" />}
                    {g.kit && <Icon name="scissors" size={12} title="Defuse kit" className="tb-kit" />}
                  </>
                )}
                {!p.alive && <span className="tb-spacer" />}
                {(g ?? gearAt(round, p.id, time))?.money != null && <span className="tb-money num" title="Money">{dollars((g ?? gearAt(round, p.id, time))!.money!)}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
