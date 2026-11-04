/**
 * What every Deadlock hero's other three abilities do (the ultimates are in ultBook.ts), written out by hand from the
 * game's own ability text (deadlock-api's ability data, read 4 Nov 2026): who it hits, its effects, a short line, what
 * it does in plain words and how to play against it (only from what the text says). The numbers and the three upgrade
 * tiers come from the game data (tools/dl-abilities.ts → generated/abilities.json). `unsure`: the game data had no text
 * for it, so it's written from its name and numbers only: check it against the in-game tooltip.
 */
import type { UltEffect, UltTarget } from './ultBook';

export type AbilityEffect = UltEffect | 'immobilize' | 'knockback' | 'barrier' | 'invisible' | 'disarm' | 'mobility' | 'lifesteal' | 'debuff';
export interface AbilityEntry {
  target: UltTarget | 'passive'; effects: AbilityEffect[];
  short: string; does: string; against: string; unsure?: boolean;
}
type Three = [AbilityEntry, AbilityEntry, AbilityEntry];

export const ABILITY_BOOK: Record<string, Three> = {
  Abrams: [
    { target: 'around', effects: ['damage', 'lifesteal'], short: 'drains health from enemies near him', does: 'Drains every enemy near him for a few seconds, healing himself from the damage.', against: 'Step out of his range: it only drains enemies close to him.' },
    { target: 'ahead', effects: ['pull', 'stun', 'mobility'], short: 'charges, dragging enemies; stuns into walls', does: 'Charges forward, dragging enemies he hits; slamming a hero into a wall stuns them.', against: 'Keep walls away from your back near him.' },
    { target: 'passive', effects: ['resist', 'heal'], short: 'tougher, and regenerates damage taken', does: 'Always on: extra defence, and part of the damage he takes comes back as regeneration.', against: 'Burst him down: damage over time gives him time to regenerate.' },
  ],
  Apollo: [
    { target: 'ahead', effects: ['damage', 'slow', 'mobility'], short: 'an exploding sigil, then a leap back', does: 'Draws a sigil in front of him that explodes, damaging and slowing enemies, as he leaps backwards.', against: 'Don\'t chase into the sigil.' },
    { target: 'one', effects: ['invulnerable', 'immobilize', 'mobility'], short: 'deflects the next hit, then dashes in', does: 'Deflects the next attack on him; if it works he is briefly invulnerable and dashes to an enemy hero, immobilizing them.', against: 'Hold your attack for a moment when he readies it.' },
    { target: 'ahead', effects: ['damage', 'mobility'], short: 'a series of lunging stabs', does: 'Lunges in any direction with piercing stabs, harder the better he times them.', against: 'Keep moving sideways: the stabs go straight ahead.' },
  ],
  Baba: [
    { target: 'ahead', effects: ['damage', 'debuff'], short: 'a thread that steals Spirit', does: 'A thread follows her aim then bursts, damaging and stealing enemies\' Spirit; while she holds it her bullets deal extra spirit damage.', against: 'Avoid the thread\'s path, or fight her after the stolen Spirit wears off.' },
    { target: 'self', effects: ['mobility', 'resist', 'knockup', 'slow', 'damage'], short: 'long legs: faster, tougher, stomps', does: 'Her bench grows legs: faster, higher jumps, more resistance; her melee kicks enemies back and her heavy melee stomps, knocking up and slowing.', against: 'Keep out of melee range while her legs are out.' },
    { target: 'spot', effects: ['barrier', 'silence', 'damage', 'debuff'], short: 'tea that shields, silences or burns', does: 'Throws a pot of tea whose effect cycles: a barrier for allies, a silence, or a burn that also lowers spirit resist.', against: 'Leave the area it lands in.' },
  ],
  Bebop: [
    { target: 'around', effects: ['damage', 'knockback', 'debuff'], short: 'an uppercut that knocks enemies flying', does: 'Knocks enemies near him away; where they land, enemies around take damage and shoot slower. Works on allies too.', against: 'Don\'t stand close to each other near him.' },
    { target: 'one', effects: ['damage'], short: 'a sticky bomb that blows up after a delay', does: 'Sticks a bomb on someone that explodes a few seconds later, damaging everyone near; it grows stronger every time it hits heroes.', against: 'Run away from your team when it\'s on you.' },
    { target: 'one', effects: ['pull'], short: 'a hook that pulls the first hero it hits', does: 'Launches a mechanical hand that pulls the first character it hits back to him; works on allies too.', against: 'Keep troopers or cover between you and him.' },
  ],
  Billy: [
    { target: 'around', effects: ['pull', 'damage', 'knockup'], short: 'a slam that pulls down and knocks up', does: 'Slams his bat, pulling enemies down and damaging them, then a shockwave knocks them up.', against: 'Back off when he winds up close to you.' },
    { target: 'one', effects: ['knockup', 'mobility'], short: 'charges an enemy and launches them', does: 'Charges head-first into an enemy and sends both of them into the air; faster to use again if it hits.', against: 'Side-step his charge.' },
    { target: 'passive', effects: ['debuff'], short: 'melee hits restore ammo and wreck', does: 'His melee hits restore his ammo and leave the victim wrecked for a few seconds.', against: 'Don\'t fight him in melee range.' },
  ],
  Calico: [
    { target: 'spot', effects: ['damage'], short: 'a cluster of bombs', does: 'Throws a cluster of bombs that explode after a moment; being hit by several deals less each.', against: 'Move off the spot when the bombs land.' },
    { target: 'ahead', effects: ['damage', 'heal', 'mobility'], short: 'dashes and slashes in a circle', does: 'Dashes forward then slashes everything around her; heals a little if it hits a hero.', against: 'Spread out against her.' },
    { target: 'self', effects: ['mobility', 'invisible'], short: 'turns into a fast shadow off the minimap', does: 'Turns to shadow: faster and faster, hidden on the minimap; damage from a hero breaks it.', against: 'Shoot her when she appears: any hit from a hero stops it.' },
  ],
  Celeste: [
    { target: 'ahead', effects: ['damage', 'lifesteal'], short: 'a flare that marks enemies', does: 'A flare blasts enemies in front of her; while marked, her attacks deal them extra spirit damage and heal her.', against: 'Keep out of her cone, or back off while marked.' },
    { target: 'self', effects: ['barrier', 'silence', 'damage'], short: 'a prism barrier that silences when broken', does: 'A protective barrier around her; if it\'s broken, it silences and damages enemies around her.', against: 'Don\'t stand close when you break her barrier.' },
    { target: 'spot', effects: ['damage'], short: 'a beam from the sky that explodes', does: 'Calls a beam of light down on a spot that explodes after a moment; each hero hit makes her spirit damage stronger.', against: 'Leave the beam before it forms.' },
  ],
  'Deadman Danny': [
    { target: 'ahead', effects: ['damage', 'slow'], short: 'missiles laid in a line', does: 'Lays missiles along a line that explode on enemies, marking them; his charged shots on a marked enemy deal extra damage and slow.', against: 'Don\'t walk along his missile line.' },
    { target: 'self', effects: ['mobility', 'damage', 'knockup'], short: 'jetpack flight, then a crash dive', does: 'Flies with a jetpack until it overheats, then dives and explodes, launching enemies near; if he hits no hero he stuns himself.', against: 'Dodge the dive: missing stuns him.' },
    { target: 'ahead', effects: ['damage', 'debuff', 'knockback'], short: 'sprays fuel that shreds bullet resist', does: 'Sprays fuel that damages and lowers bullet resist, ending in a backblast that damages and knocks him back.', against: 'Stay out of his short spray.' },
  ],
  Drifter: [
    { target: 'ahead', effects: ['damage'], short: 'a swipe, stronger up close', does: 'Swipes in a cone ahead; up close it deals extra melee damage.', against: 'Keep your distance from him.' },
    { target: 'one', effects: ['damage', 'mobility'], short: 'a bleeding mark he can teleport to', does: 'A mark makes the first enemy hit bleed; while they bleed, he can appear behind them.', against: 'Expect him behind you while you bleed.' },
    { target: 'passive', effects: ['damage', 'vision'], short: 'hunts heroes who are alone or hurt', does: 'Always on: he deals more damage to enemies who are alone, and tracks hurt enemies by their blood trail.', against: 'Don\'t walk around alone, especially when hurt.', unsure: true },
  ],
  Dynamo: [
    { target: 'ahead', effects: ['damage', 'knockup'], short: 'a ground pulse that knocks up', does: 'A pulse travels along the ground, damaging and knocking up enemies.', against: 'Jump or step aside from the pulse.' },
    { target: 'ally', effects: ['untargetable', 'mobility'], short: 'teleports himself and allies near', does: 'Becomes untargetable and teleports to a spot, taking nearby allies with him.', against: 'Expect his team to appear with him.' },
    { target: 'around', effects: ['heal'], short: 'heals himself and allies near', does: 'Channels a heal on himself and allies near him; he can still dash and melee.', against: 'Interrupt or burst during it.' },
  ],
  Graves: [
    { target: 'spot', effects: ['damage'], short: 'a jar of the dead that attack', does: 'Collects death nearby, then throws a jar that summons Deadheads that keep damaging enemies.', against: 'Move away from the Deadheads.' },
    { target: 'spot', effects: ['damage', 'immobilize'], short: 'a wall of hands that immobilizes', does: 'Raises a line of grasping hands; enemies who cross it are damaged and immobilized.', against: 'Don\'t walk through the hands.' },
    { target: 'passive', effects: ['debuff'], short: 'shots that steal damage and resist', does: 'Always on: each shot steals weapon damage and spirit resist over time.', against: 'Short fights: the longer the shooting goes on, the more it steals.' },
  ],
  'Grey Talon': [
    { target: 'ahead', effects: ['damage'], short: 'a charged shot that pierces', does: 'Charges a powerful shot that pierces through enemies.', against: 'Keep cover between you while he charges.' },
    { target: 'self', effects: ['mobility', 'buff'], short: 'glides high with multishot', does: 'Launches high and glides; in the air his gun deals more damage and fires several arrows.', against: 'Get under cover when he takes off.' },
    { target: 'spot', effects: ['damage', 'slow', 'silence', 'disarm'], short: 'a trap that silences and disarms', does: 'Sets a trap that springs on the first enemy in range: curse and slow, silenced, disarmed, no items.', against: 'Watch for the trap and walk around it.' },
  ],
  Haze: [
    { target: 'one', effects: ['damage', 'sleep'], short: 'a dagger that puts to sleep', does: 'Throws a dagger that damages and puts the target to sleep (damage wakes them); doesn\'t break her invisibility.', against: 'Teammates: hit a sleeping ally to wake them.' },
    { target: 'self', effects: ['invisible', 'mobility'], short: 'turns invisible and sprints', does: 'Fades out of sight and sprints; attacking reveals her, enemies close to her can see her.', against: 'Stay close to each other: nearby enemies see through it.' },
    { target: 'passive', effects: ['buff'], short: 'each hit on a target hits harder', does: 'Always on: every bullet on the same target adds damage, headshots more.', against: 'Break line of sight to reset her stacks.' },
  ],
  Holliday: [
    { target: 'spot', effects: ['damage', 'knockup'], short: 'a powder keg that explodes', does: 'Throws a barrel that explodes after a moment (or when shot), damaging, burning and knocking up; burns stack.', against: 'Leave the barrel\'s area or shoot it early.' },
    { target: 'spot', effects: ['mobility', 'damage'], short: 'a bounce pad that launches heroes', does: 'Places a pad that launches any hero; she explodes on landing, damaging enemies near.', against: 'Expect her to drop in from above.' },
    { target: 'passive', effects: ['damage', 'slow'], short: 'headshots deal bonus damage and slow', does: 'Her headshots deal bonus damage and a fading slow, on a short cooldown.', against: 'Don\'t give her a still head to aim at.' },
  ],
  Infernus: [
    { target: 'ahead', effects: ['damage', 'slow', 'debuff'], short: 'napalm that makes enemies take more', does: 'Spews napalm: damage, slow, and enemies coated take more damage from him for a while.', against: 'Stay out of his short cone.' },
    { target: 'self', effects: ['mobility', 'damage'], short: 'a dash leaving a burning trail', does: 'Dashes forward, resisting slows, leaving a trail of fire that damages.', against: 'Don\'t follow through his fire trail.' },
    { target: 'passive', effects: ['damage'], short: 'his shots set enemies burning', does: 'Always on: his bullets build up a burn that deals damage over time.', against: 'Get out of his fire before the burn stacks.' },
  ],
  Ivy: [
    { target: 'spot', effects: ['damage', 'slow'], short: 'a patch of thorns that slows', does: 'Summons thorns that damage and slow enemies standing in them.', against: 'Leave the thorns.' },
    { target: 'ally', effects: ['buff', 'heal', 'lifesteal'], short: 'tethers to an ally for bonuses', does: 'Connects to an ally: both get faster shooting, lifesteal and shared healing.', against: 'Break the line of sight between them.' },
    { target: 'self', effects: ['invulnerable', 'stun', 'damage', 'heal'], short: 'turns to stone and smashes down', does: 'Turns to impervious stone and smashes down, stunning and damaging enemies near, healing herself.', against: 'Back off from her landing spot.' },
  ],
  Kelvin: [
    { target: 'spot', effects: ['heal', 'damage', 'slow'], short: 'an ice grenade: heals allies, slows enemies', does: 'An ice cloud that heals allies and damages and slows enemies.', against: 'Leave the cloud.' },
    { target: 'self', effects: ['mobility', 'resist'], short: 'an ice path to travel on', does: 'Lays a floating ice trail that speeds him and his allies (enemies can use it too).', against: 'Use his ice path yourself.' },
    { target: 'ahead', effects: ['damage', 'slow', 'debuff'], short: 'a freezing beam that slows more and more', does: 'A beam that damages and slows movement and shooting more the longer it stays on you.', against: 'Get out of the beam early.' },
  ],
  'Lady Geist': [
    { target: 'spot', effects: ['damage'], short: 'pays health for a delayed bomb', does: 'Spends some of her health to launch a bomb that explodes after a short delay.', against: 'Step off the spot it lands on.' },
    { target: 'one', effects: ['damage', 'heal'], short: 'a tether that drains health', does: 'Tethers an enemy and drains their health to heal herself (she can give health to allies instead).', against: 'Break line of sight or get out of range.' },
    { target: 'one', effects: ['damage', 'slow', 'debuff'], short: 'blood shards that stack up', does: 'Spends health to fire blood shards; each stack slows and makes the victim take more damage from her.', against: 'Don\'t let her stack you: break line of sight.' },
  ],
  Lash: [
    { target: 'ahead', effects: ['damage', 'mobility'], short: 'a ground stomp, harder from high up', does: 'Stomps, damaging enemies in front of him; in the air he dives down first, hitting harder from higher up.', against: 'Watch the sky: a dive from high up hurts more.' },
    { target: 'self', effects: ['mobility'], short: 'grapples through the air', does: 'Pulls himself through the air toward a target and resets his air jumps and dashes.', against: 'Expect him to come in fast from range.' },
    { target: 'ahead', effects: ['damage', 'lifesteal'], short: 'a whip that heals him', does: 'Whips enemies in front of him, healing from the damage.', against: 'Keep out of the whip\'s cone.' },
  ],
  McGinnis: [
    { target: 'spot', effects: ['damage'], short: 'a turret that shoots enemies', does: 'Builds a turret that shoots enemies for a while.', against: 'Destroy the turret first.' },
    { target: 'spot', effects: ['heal'], short: 'a spirit that heals allies', does: 'Places a spirit that heals allies near it.', against: 'Pull the fight away from it.' },
    { target: 'spot', effects: ['slow', 'damage'], short: 'a wall that splits the area', does: 'A wall that slows enemies passing through; erupting it splits the area in two and damages enemies near. Melee can break it.', against: 'Melee the wall, or go round it.' },
  ],
  Mina: [
    { target: 'ahead', effects: ['damage'], short: 'a rake that hurts more against the hurt', does: 'Rakes enemies in a cone ahead, with extra damage from their missing health.', against: 'Keep your distance when hurt.', unsure: true },
    { target: 'self', effects: ['untargetable', 'mobility'], short: 'disperses and flies to a spot', does: 'Disperses, untargetable, and flies to a spot; can do it twice in a row.', against: 'Expect her to slip away; save your burst.' },
    { target: 'passive', effects: ['damage'], short: 'her bullets and abilities build to a bite', does: 'Always on: her bullets deal extra spirit damage, and her abilities build up to a burst bite.', against: 'Short trades: it builds over time.' },
  ],
  Mirage: [
    { target: 'one', effects: ['lifesteal', 'debuff'], short: 'scarabs that steal life and weaken', does: 'Infests an enemy with scarabs that steal their health and make them deal less damage.', against: 'Back off while infested.' },
    { target: 'ahead', effects: ['damage', 'slow', 'knockup', 'mobility'], short: 'becomes a whirlwind that lifts enemies', does: 'Becomes a tornado that travels forward, damaging, slowing and lifting enemies; he dodges bullets afterwards.', against: 'Step out of its path.' },
    { target: 'passive', effects: ['damage'], short: 'marks that he cashes in', does: 'His hits leave Djinn marks; he can consume them all to deal their damage at once.', against: 'Avoid long trades: the marks add up.' },
  ],
  'Mo & Krill': [
    { target: 'around', effects: ['damage', 'heal'], short: 'hurts enemies near and heals', does: 'Damages enemies near him and heals from it, more against heroes.', against: 'Don\'t stand in his range.' },
    { target: 'self', effects: ['mobility', 'resist', 'damage', 'knockup', 'slow'], short: 'burrows, then bursts out', does: 'Burrows underground, faster and tougher; jumping out damages, slows and knocks up enemies.', against: 'Damage him while he burrows: it slows him.' },
    { target: 'ahead', effects: ['disarm', 'damage'], short: 'sand that disarms', does: 'Sprays sand that disarms enemies in front of him.', against: 'Use abilities, not your gun, while disarmed.' },
  ],
  'Nurse Harrow': [
    { target: 'spot', effects: ['damage', 'debuff'], short: 'leeches that eat enemy buffs', does: 'Throws leeches that damage over time and shorten enemies\' buffs.', against: 'Move away from the jar.' },
    { target: 'ally', effects: ['buff', 'resist'], short: 'a rush, then a crash', does: 'A vapor on herself or an ally: everything faster and incoming damage held back, then a crash where it\'s slower and the damage lands.', against: 'Hold your damage for the crash.' },
    { target: 'ally', effects: ['heal'], short: 'healing needles for allies', does: 'Loads syringes that heal allies she shoots.', against: 'Focus her first in a fight.' },
  ],
  Paige: [
    { target: 'spot', effects: ['damage', 'slow'], short: 'a dragon leaving a burning path', does: 'A dragon appears and flies forward, damaging and leaving a burning trail.', against: 'Get off its path.' },
    { target: 'ally', effects: ['barrier', 'buff'], short: 'a barrier and damage for an ally', does: 'Gives an ally a barrier and, while it holds, more weapon damage.', against: 'Break the barrier before you trade.' },
    { target: 'spot', effects: ['slow', 'damage', 'immobilize'], short: 'delayed magic that immobilizes', does: 'Marks an area that slows, then detonates, damaging and immobilizing.', against: 'Leave the area before it detonates.' },
  ],
  Paradox: [
    { target: 'spot', effects: ['damage', 'slow', 'debuff'], short: 'a pulsing grenade that slows time', does: 'A grenade pulses wider and wider, damaging, slowing time and making victims take more from her.', against: 'Leave its growing radius early.' },
    { target: 'spot', effects: ['slow', 'buff'], short: 'a wall that stops bullets', does: 'A wall that freezes enemy bullets and speeds up her team\'s; enemies touching it are slowed.', against: 'Don\'t shoot into the wall; go round it.' },
    { target: 'ahead', effects: ['damage', 'stun'], short: 'a charged shot that stops time', does: 'Charges a shot that damages and freezes enemies in time.', against: 'Keep cover while she charges.' },
  ],
  Pocket: [
    { target: 'spot', effects: ['damage', 'slow'], short: 'a barrage of projectiles', does: 'Channels a barrage that damages and slows around each impact.', against: 'Move away from the impacts.' },
    { target: 'ahead', effects: ['damage', 'teleport'], short: 'a cloak he can teleport to', does: 'Sends a cloak forward that damages; he can teleport to it.', against: 'Expect him where the cloak is.' },
    { target: 'self', effects: ['untargetable', 'damage'], short: 'hides in his suitcase, then explodes', does: 'Hides in his suitcase briefly, then damages enemies near when he comes out.', against: 'Back off when he hides.' },
  ],
  'Rat King': [
    { target: 'spot', effects: ['damage', 'slow'], short: 'a grenade of scrap that slows', does: 'A grenade that explodes several times, damaging and slowing.', against: 'Leave the spot or melee the grenade away.' },
    { target: 'bounce', effects: ['damage', 'debuff'], short: 'rats that bite and shred resist', does: 'Rats leap onto enemies, biting and lowering bullet resist; dashing shakes one off.', against: 'Dash to shake the rats off.' },
    { target: 'self', effects: ['barrier'], short: 'armor that bounces bullets back', does: 'Scrap armor gives a barrier; while it holds, some bullets bounce back at the shooter.', against: 'Use abilities, not bullets, on the armor.' },
  ],
  Rem: [
    { target: 'ahead', effects: ['damage', 'knockback'], short: 'a pillow that knocks back', does: 'Throws a pillow that damages and knocks back; hits make his other abilities ready sooner.', against: 'Keep away from ledges near him.' },
    { target: 'ally', effects: ['heal', 'mobility'], short: 'jumps onto an ally to heal', does: 'Jumps onto an ally and naps with them: both get a burst heal and regeneration; he can hop between allies.', against: 'An ultimate\'s stun knocks him off.' },
    { target: 'passive', effects: ['buff'], short: 'little helpers that support', does: 'Sends helpers to collect boxes, do Sinner\'s Sacrifice, or support allies and troopers.', against: 'Watch for helpers taking your camps.' },
  ],
  Seven: [
    { target: 'ahead', effects: ['damage'], short: 'a lightning ball that rolls ahead', does: 'A ball of lightning that rolls in a line, damaging everything in its radius.', against: 'Step out of its line.' },
    { target: 'one', effects: ['stun', 'damage'], short: 'a charge that stuns after a delay', does: 'Charges an enemy hero; after a few seconds, it stuns and damages everyone near them.', against: 'When charged, move away from your team.' },
    { target: 'self', effects: ['buff', 'damage'], short: 'shock bullets that bounce', does: 'His bullets shock their target and the shock jumps to enemies near.', against: 'Spread out while it\'s on.' },
  ],
  Shiv: [
    { target: 'one', effects: ['damage', 'slow'], short: 'knives that stack a bleed', does: 'Throws knives that make an enemy bleed and slow; more knives, more bleed.', against: 'Break line of sight to let the bleed run out.' },
    { target: 'ahead', effects: ['damage', 'debuff', 'mobility'], short: 'a dash that shreds spirit resist', does: 'Dashes forward, damaging and lowering the spirit resist of enemies he passes.', against: 'Side-step his dash.' },
    { target: 'self', effects: ['resist'], short: 'puts off part of the damage he takes', does: 'Takes part of incoming damage later, over time; he can clear some of it.', against: 'Keep the pressure on: the damage still lands.' },
  ],
  Silver: [
    { target: 'self', effects: ['buff', 'damage'], short: 'reload and a burst of strong shots', does: 'Instantly reloads; her next shots fire faster and hit harder (based on the target\'s health), but less accurately.', against: 'Back off for those few shots.' },
    { target: 'one', effects: ['damage', 'slow'], short: 'a kick', does: 'A kick that damages and briefly slows.', against: 'Keep out of kicking range.', unsure: true },
    { target: 'one', effects: ['damage', 'slow', 'debuff'], short: 'a bola: no dashes, no stamina', does: 'A bola that damages, slows and stops movement abilities and stamina.', against: 'Dodge it before you commit to a fight.' },
  ],
  Sinclair: [
    { target: 'ahead', effects: ['damage'], short: 'a bolt stronger the further it flies', does: 'A magic bolt that hits harder the further it travels; he can steer it.', against: 'Fight him close.' },
    { target: 'spot', effects: ['damage', 'mobility'], short: 'an assistant he can swap with', does: 'Summons an assistant that shoots with him; he can swap places with it.', against: 'Expect him to swap away.' },
    { target: 'spot', effects: ['disable', 'debuff'], short: 'turns enemies into rabbits', does: 'Hexes an area: enemies inside become rabbits, unable to do most things and taking more damage.', against: 'Leave the area before it goes off.' },
  ],
  Solomon: [
    { target: 'spot', effects: ['damage', 'slow'], short: 'a bishop that slows and damages', does: 'A bishop he can move, slowing and damaging enemies it passes; its diagonal squares damage when stepped on.', against: 'Don\'t step on its squares.' },
    { target: 'ally', effects: ['barrier', 'mobility', 'invulnerable'], short: 'a knight: barrier and a jump', does: 'Makes an ally a knight with a barrier and extra stamina (himself a king, double barrier); the piece can leap, invulnerable meanwhile.', against: 'Break the barrier first.' },
    { target: 'ahead', effects: ['damage', 'immobilize'], short: 'rooks that immobilize', does: 'Two rooks travel forward, damaging and immobilizing; they bounce off walls and can split.', against: 'Watch the walls: they bounce back.' },
  ],
  'The Doorman': [
    { target: 'spot', effects: ['damage', 'slow', 'debuff'], short: 'a bell that explodes', does: 'A bell that damages on impact then explodes, slowing and spoiling enemies\' aim.', against: 'Shoot it early or leave.' },
    { target: 'spot', effects: ['teleport', 'mobility'], short: 'two linked doors', does: 'Places two linked doors: anyone (and most shots) going in one comes out the other.', against: 'Use his doors yourself, or guard the exit.' },
    { target: 'ahead', effects: ['damage', 'pull'], short: 'a luggage cart that drags heroes', does: 'Sends a cart that damages and drags enemy heroes along its path.', against: 'Get off its path.' },
  ],
  Venator: [
    { target: 'spot', effects: ['damage', 'debuff'], short: 'a grenade that burns and cuts healing', does: 'A bouncing grenade that sets enemies on fire, hurting those near them and cutting their healing.', against: 'Spread out and heal after it ends.' },
    { target: 'ahead', effects: ['damage', 'knockback', 'stun'], short: 'a shotgun blast; stuns against walls', does: 'A shotgun blast that pushes enemies back; near a wall it stuns and hits harder.', against: 'Keep walls away from your back.' },
    { target: 'spot', effects: ['damage', 'immobilize', 'vision'], short: 'a snap trap that reveals', does: 'A trap that snaps on the first enemy: damage, immobilize, and reveals enemies afterwards.', against: 'Watch the ground near him.' },
  ],
  Victor: [
    { target: 'bounce', effects: ['damage'], short: 'bolts charged by damage he takes', does: 'Taking damage charges a battery; when full, he fires bolts at several enemies.', against: 'Damaging him charges it: kill him fast.' },
    { target: 'self', effects: ['heal', 'mobility'], short: 'hurts himself to regenerate fast', does: 'Damages himself, then regenerates and runs faster.', against: 'Burst him before the regeneration does its work.' },
    { target: 'around', effects: ['damage'], short: 'pain around him that grows', does: 'Damages everyone near him (and himself), more the longer he channels.', against: 'Step out of his range.' },
  ],
  Vindicta: [
    { target: 'spot', effects: ['damage', 'immobilize'], short: 'a stake that tethers enemies', does: 'A stake tethers enemies near where it lands: they can\'t move far from it.', against: 'Leave the area before it lands.' },
    { target: 'self', effects: ['mobility', 'buff'], short: 'flies with stronger shots', does: 'Flies; while flying her gun deals extra spirit damage and her items reach further.', against: 'Find cover from above.' },
    { target: 'one', effects: ['damage', 'debuff'], short: 'a crow that bleeds and shreds resist', does: 'Her crow hits an enemy, lowering their resists and making them bleed.', against: 'Heal or fight back while it bleeds.' },
  ],
  Violet: [
    { target: 'spot', effects: ['damage'], short: 'ink that damages', does: 'Places ink that damages enemies (two charges).', against: 'Avoid the ink.', unsure: true },
    { target: 'ahead', effects: ['slow', 'damage', 'mobility'], short: 'a brush trail', does: 'Drags a brush forward: a trail that helps allies slide and slows and damages enemies; she can flick it for a bigger hit.', against: 'Cross the trail quickly, or not at all.' },
    { target: 'one', effects: ['damage', 'stun'], short: 'a sketch of one hero that stuns', does: 'Sketches one hero while looking at them, damaging; finishing it stuns them and she gains a permanent bonus.', against: 'Break line of sight before the sketch completes.' },
  ],
  Viscous: [
    { target: 'spot', effects: ['damage', 'slow'], short: 'goo puddles that slow', does: 'Throws goo that damages and leaves slowing puddles.', against: 'Stay off the puddles.' },
    { target: 'ally', effects: ['invulnerable', 'heal'], short: 'a cube that protects and heals', does: 'Encases a hero (or himself) in a cube that blocks damage and heals; they can\'t act inside.', against: 'Wait for the cube to end, then strike.' },
    { target: 'spot', effects: ['damage', 'knockup', 'slow'], short: 'a fist that punches up', does: 'A fist punches everyone in an area into the air, damaging and slowing; it can be parried.', against: 'Parry it, or leave the area.' },
  ],
  Vyper: [
    { target: 'one', effects: ['damage', 'slow'], short: 'daggers that stack', does: 'Daggers that damage and slow, more with each hit on the same target.', against: 'Break line of sight to reset the stacks.' },
    { target: 'one', effects: ['damage', 'execute'], short: 'venom that hits harder when you\'re hurt', does: 'Injects venom that bursts after a moment, more damage the more health is missing.', against: 'Heal up or back off when injected.' },
    { target: 'passive', effects: ['mobility'], short: 'slides far and uphill', does: 'Always on: she slides further, even uphill, and turns faster sliding.', against: 'Expect her to slide out of reach.' },
  ],
  Warden: [
    { target: 'spot', effects: ['damage', 'slow', 'debuff'], short: 'a flask that weakens and slows', does: 'A flask that damages, lowers weapon damage and slows enemies hit.', against: 'Dodge it before trading shots.' },
    { target: 'self', effects: ['barrier', 'mobility'], short: 'a barrier and a burst of speed', does: 'Gives himself a barrier and extra speed.', against: 'Expect him to chase or escape.' },
    { target: 'one', effects: ['damage', 'immobilize'], short: 'a curse: move away or be stuck', does: 'Curses an enemy: if they don\'t get far enough away in time, they\'re damaged and immobilized.', against: 'Move away from where you were cursed at once.' },
  ],
  Wraith: [
    { target: 'one', effects: ['damage', 'debuff'], short: 'cards with random effects', does: 'Her shots summon cards she can throw, each suit with a different effect.', against: 'Fight her from cover.' },
    { target: 'self', effects: ['teleport'], short: 'teleports to a spot', does: 'Teleports to a spot after a short wait.', against: 'Expect her to arrive or escape.' },
    { target: 'self', effects: ['buff', 'damage'], short: 'shoots faster with spirit damage', does: 'Briefly shoots faster with extra spirit damage.', against: 'Back off while it lasts.' },
  ],
  Yamato: [
    { target: 'ahead', effects: ['damage', 'resist'], short: 'a charged sword strike', does: 'Charges a long sword strike (tougher while charging), harder the longer it charges.', against: 'Step out of its line.' },
    { target: 'one', effects: ['damage', 'slow', 'mobility'], short: 'a hook that pulls her to an enemy', does: 'Hooks an enemy and reels herself in, damaging and slowing them.', against: 'Keep distance and cover.' },
    { target: 'ahead', effects: ['damage', 'debuff', 'heal'], short: 'a slash that slows shooting', does: 'Slashes enemies in front of her, slowing their shooting; she heals if a hero is hit.', against: 'Stay out of her reach.' },
  ],
};
