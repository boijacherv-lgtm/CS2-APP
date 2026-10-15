import { describe, expect, it } from 'vitest';
import { coach, coachFeatures, DEFAULT_MODEL, trainCoach } from '../coach';
import type { PlayerReport, RoundLine } from '../match';
import type { Tag } from '../recap';

const line = (o: Partial<RoundLine> & { tags?: Tag[] } = {}): RoundLine => ({
  side: 'CT', letter: 'C', points: 0, impact: 0, role: 'Rifler', kills: 0, deaths: 0, headshots: 0, damage: 70, utilDamage: 0,
  kast: true, tags: [], duels: [], ...o,
});

const player = (rounds: RoundLine[], o: Partial<PlayerReport> = {}): PlayerReport => ({
  id: 'me', name: 'me', team: 0, rank: null, rounds, played: rounds.length,
  kills: 0, deaths: 0, adr: 75, kast: 70, hs: 45, openingKills: 0, openingDeaths: 0, clutches: 0, multiKills: 0,
  utilDamage: rounds.length * 6, flashAssists: 0, whiffs: 0, upsets: 0, impactPerRound: 0, pointsPerRound: 0, letter: 'C',
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
});
