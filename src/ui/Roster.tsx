import { gearAt, isGrenade, type DemoRound } from '../engine/recap';
import { CS2_ICONS, type Cs2Icon } from './cs2Icons';
import { GameIcon, Icon } from './Icon';

/**
 * Review: each team's five players down the side of the map, like a broadcast HUD, at the current moment of the
 * round: avatar, name, health, armour and helmet, the gun in hand (and what else they carry), grenades, kit or bomb,
 * and money. Reads the gear log of the demo (newer parses), else the buy minus the grenades thrown since.
 */
export interface RosterPlayer { id: string; name: string; alive: boolean; hp: number; avatar?: string }

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

export function TeamRoster({ side, players, round, time }: { side: 'CT' | 'T'; players: RosterPlayer[]; round: DemoRound; time: number }) {
  const ft = round.frames.t;
  let k = 0; while (k < ft.length - 1 && ft[k + 1] <= time) k++;
  return (
    <div className={`roster ${side.toLowerCase()}`}>
      {players.map(p => {
        const g = p.alive ? gearAt(round, p.id, time) : null;
        const inHand = norm(round.frames.players[p.id]?.w?.[k] ?? '');
        const inv = g?.inv ?? [];
        const primary = inv.find(w => PRIMARY.test(norm(w)));
        const pistol = inv.find(w => !PRIMARY.test(norm(w)) && !isGrenade(w) && !KNIFE.test(norm(w)) && !/c4|zeus|taser/i.test(w));
        const nades = inv.filter(isGrenade).sort((a, b) => NADE_ORDER.findIndex(x => norm(a).startsWith(x)) - NADE_ORDER.findIndex(x => norm(b).startsWith(x)));
        const bomb = inv.some(w => /c4/i.test(w));
        const gun = (w: string | undefined, main: boolean) => {
          if (!w) return null;
          const src = iconOf(w), held = norm(w) === inHand || (inHand && norm(w).startsWith(inHand));
          return src ? <GameIcon src={src} size={main ? 13 : 11} title={`${w}${held ? ' (in hand)' : ''}`} className={`ro-gun ${held ? 'held' : ''}`} /> : <span className="ro-gun-txt">{w}</span>;
        };
        const hp = Math.max(0, Math.min(100, Math.round(p.hp)));
        return (
          <div key={p.id} className={`ro-card ${p.alive ? '' : 'dead'}`} title={p.name}>
            <div className="ro-top">
              <span className="ro-pic">{p.avatar ? <img src={p.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <b>{p.name.slice(0, 2)}</b>}</span>
              <span className="ro-name">{p.name}</span>
              {g && g.money !== null && <span className="ro-money num" title="Money">${g.money}</span>}
              {p.alive ? <span className={`ro-hp num ${hp <= 30 ? 'low' : ''}`}>{hp}</span> : <Icon name="skull" size={13} title="Dead" className="ro-dead" />}
            </div>
            <i className={`ro-bar ${hp <= 30 ? 'low' : ''}`} style={{ '--hp': `${p.alive ? hp : 0}%` } as React.CSSProperties} />
            {p.alive && g && (
              <div className="ro-gear">
                {g.armor > 0 ? <Icon name={g.helmet ? 'helmet' : 'vest'} size={12} title={`${g.helmet ? 'Armour and helmet' : 'Armour'} (${g.armor})`} className="ro-armor" /> : <span className="ro-noarmor" title="No armour">–</span>}
                <span className="ro-guns">{gun(primary, true)}{gun(pistol, !primary)}</span>
                {KNIFE.test(inHand) && <GameIcon src="equipment/knife" size={11} title="Knife (in hand)" className="ro-gun held" />}
                <span className="ro-nades">{nades.map((w, i) => { const src = iconOf(w); const held = norm(w) === inHand || (inHand.length > 3 && norm(w).startsWith(inHand)); return src ? <GameIcon key={i} src={src} size={12} title={`${w}${held ? ' (in hand)' : ''}`} className={held ? 'ro-nade held' : 'ro-nade'} /> : null; })}</span>
                {bomb && <Icon name="bomb" size={12} title="Carrying the bomb" className="ro-bomb" />}
                {g.kit && <Icon name="scissors" size={12} title="Defuse kit" className="ro-kit" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
