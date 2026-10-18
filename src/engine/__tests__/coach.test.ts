import { describe, expect, it } from 'vitest';
import { coach, coachFeatures, DEFAULT_MODEL, MIN_ROLE_GAMES, modelFor, trainCoach, trainCoachSet } from '../coach';
import type { PlayerReport, RoundLine } from '../match';
import type { Tag } from '../recap';

const line = (o: Partial<RoundLine> & { tags?: Tag[] } = {}): RoundLine => ({
  side: 'CT', letter: 'C', points: 0, impact: 0, role: 'Rifler', kills: 0, deaths: 0, headshots: 0, damage: 70, utilDamage: 0,
  kast: true, tags: [], duels: [], ...o,
});

const player = (rounds: RoundLine[], o: Partial<PlayerReport> = {}): PlayerReport => ({
  id: 'me', name: 'me', team: 0, rank: null, rounds, played: rounds.length,
  kills: 0, deaths: 0, adr: 75, kast: 70, hs: 45, openingKills: 0, openingDeaths: 0, clutches: 0, multiKills: 0,
  utilDamage: rounds.length * 6, flashAssists: 0, whiffs: 0, upsets: 0, impactPerRound: 0, pointsPerRound: 0, engineAccuracy: null, engineMoments: 0, letter: 'C', lobbyZ: 0, lvl10: null, pro: null, level: null, roundsLetter: 'C',
  duelsWon: 0, duelsLost: 0, avgOpponent: null, duelRating: null, gameRating: null, roles: [{ role: 'Rifler', rounds: rounds.length }], ...o,
});

describe('coach', () => {
  it('tells a player who keeps dying untraded to play near a teammate, with the rounds to watch', () => {
    const rounds = Array.from({ length: 20 }, (_, i) => line({ deaths: i < 14 ? 1 : 0 }));
    const c = coach(player(rounds));
    const note = c.improve.find(n => n.feature === 'untradedDeaths');
    expect(note).toBeTruthy();
    expect(note!.rounds).toHaveLength(14);
    expect(c.summary).toMatch(/work on/);
  });

  it('praises what is clearly better than normal', () => {
    const rounds = Array.from({ length: 20 }, () => line({ deaths: 0 }));
    const c = coach(player(rounds, { adr: 120, kast: 90 }));
    expect(c.strengths.map(n => n.feature)).toContain('adr');
    expect(c.improve).toHaveLength(0);
  });

  it('training moves what is normal toward the games it sees', () => {
    const rounds = Array.from({ length: 20 }, () => line({ deaths: 1 }));
    const f = coachFeatures(player(rounds));
    const m = trainCoach(Array(30).fill(f));
    expect(m.trainedOn).toBe(30);
    expect(m.features.untradedDeaths.baseline).toBeGreaterThan(DEFAULT_MODEL.features.untradedDeaths.baseline);
    expect(m.features.untradedDeaths.baseline).toBeLessThan(1);
  });

  it('training on a set learns per role, and judges a player against their role', () => {
    const riflers = Array.from({ length: 30 }, () => ({ features: coachFeatures(player(Array.from({ length: 20 }, () => line({ deaths: 0 })))), role: 'Rifler' as const }));
    // AWPers in this set lose the AWP a lot; a few lurkers (too few for their own numbers)
    const awpRounds = Array.from({ length: 20 }, (_, i) => line({ deaths: 1, tags: i < 6 ? ['AWP LOST', 'TRADED'] : ['TRADED'] }));
    const awpers = Array.from({ length: MIN_ROLE_GAMES + 5 }, () => ({ features: coachFeatures(player(awpRounds)), role: 'AWPer' as const }));
    const lurks = Array.from({ length: 3 }, () => ({ features: coachFeatures(player(awpRounds)), role: 'Lurk' as const }));
    const m = trainCoachSet([...riflers, ...awpers, ...lurks], 'Test', { demos: 5, trainedAt: '2026-10-17', maps: { de_mirage: 5 } });
    expect(m.trainedOn).toBe(30 + MIN_ROLE_GAMES + 5 + 3);
    expect(m.name).toBe('Test');
    expect(m.roles?.AWPer?.games).toBe(MIN_ROLE_GAMES + 5);
    expect(m.roles?.Lurk).toBeUndefined();
    expect(modelFor(m, 'AWPer').byRole).toBe(true);
    expect(modelFor(m, 'Lurk').byRole).toBe(false);
    // the same AWPer: an "AWP lost" problem against everyone, normal against other AWPers
    const awper = player(awpRounds, { roles: [{ role: 'AWPer', rounds: 20 }] });
    expect(coach(awper, { ...m, roles: undefined }).improve.map(n => n.feature)).toContain('awpLost');
    expect(coach(awper, m).improve.map(n => n.feature)).not.toContain('awpLost');
  });
});

describe('damage for ADR', () => {
  it('counts each hit only up to the health the victim had left', async () => {
    const { cappedDamage } = await import('../match');
    const r = {
      hits: [
        { t: 1, attacker: 'a', victim: 'v', dmg: 27, head: false },
        { t: 2, attacker: 'b', victim: 'v', dmg: 138, head: true }, // headshot on a 73 hp player
        { t: 3, attacker: 'a', victim: 'w', dmg: 40, head: false },
      ],
      nadeDamage: [{ t: 2.5, attacker: 'c', victim: 'v', dmg: 20, weapon: 'he' as const }], // already dead
    } as unknown as import('../recap').DemoRound;
    const d = cappedDamage(r);
    expect(d.guns.map(h => h.dmg)).toEqual([27, 73, 40]);
    expect(d.util.map(h => h.dmg)).toEqual([0]);
  });
});
