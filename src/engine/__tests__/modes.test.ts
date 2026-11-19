import { describe, expect, it } from 'vitest';
import { useStore } from '../../store';

// Review shows a demo on the board; Tactical must always get the user's own board back.
describe('switching between Tactical and Review', () => {
  const replayBoard = () => ({ ...useStore.getState().board, players: [], utility: [{ id: 'u0', type: 'smoke' as const, pos: { x: 1, y: 1 }, throwAt: 3, path: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] });

  it('never parks or restores a replay board as the tactical board', () => {
    const st = useStore.getState;
    const mine = st().board;
    st().setMode('review');
    useStore.setState({ board: replayBoard(), boardFromReplay: true }); // App puts the demo on the board
    st().setMode('tactical');
    expect(st().board).toBe(mine);
    // the report/home route: the board view remounts and would load the demo again mid-switch
    st().setMode('review');
    useStore.setState({ board: replayBoard(), boardFromReplay: true });
    st().setMode('tactical');
    useStore.setState({ boardFromReplay: false });
    st().setMode('review'); // board is the user's again → parked correctly
    useStore.setState({ board: replayBoard(), boardFromReplay: true });
    st().setMode('review');
    st().setMode('tactical');
    expect(st().board).toBe(mine);
    expect(st().board.utility.some(u => u.path)).toBe(false);
  });

  it("changing the map while a demo is on screen doesn't save the demo as that map's board", () => {
    const st = useStore.getState;
    st().setMode('review');
    useStore.setState({ board: replayBoard(), boardFromReplay: true });
    const map = st().mapId;
    st().setMap(map === 'de_inferno' ? 'de_mirage' : 'de_inferno');
    expect(st().saved[`${map}:0`]?.utility.some(u => u.path) ?? false).toBe(false);
    expect(st().boardFromReplay).toBe(false);
    st().setMode('tactical');
  });
});

describe('older parses without bomb events', () => {
  it('withPlants gives the plant a planter (the stillest living T) and a spot, and leaves complete rounds alone', async () => {
    const { withPlants } = await import('../demoFix');
    const t = Array.from({ length: 41 }, (_, i) => i * 0.25);
    const track = (side: 'CT' | 'T', x0: number, step: number) => ({
      side, x: t.map((_, i) => x0 + i * step), y: t.map(() => 100), z: t.map(() => 0), yaw: t.map(() => 0), hp: t.map(() => 100), alive: t.map(() => 1),
    });
    const round: any = {
      n: 1, winner: 'T', reason: 'bomb_exploded', duration: 10, plant: 8, kills: [], util: [], frames: { t, players: { runner: track('T', 0, 5), planter: track('T', 50, 0), ct: track('CT', 0, 0) } },
    };
    const out = withPlants({ map: 'de_dust2', tickrate: 64, names: {}, rounds: [round] } as any);
    const plant = out.rounds[0].bomb!.find(b => b.kind === 'plant')!;
    expect(plant.id).toBe('planter');
    expect(plant.t).toBe(8);
    expect(plant.x).toBe(50);
    expect(out.rounds[0].bomb!.some(b => b.kind === 'explode')).toBe(true);
    expect(withPlants(out)).toBe(out); // already has the events
  });
});

describe('a round that ends in an explosion', () => {
  it('plays on for the blast, once', async () => {
    const { withBlastTail, BLAST_TAIL_SECONDS } = await import('../demoFix');
    const r: any = { n: 1, duration: 93.69, plant: 52, reason: 'bomb_exploded', bomb: [{ t: 93.69, kind: 'explode', id: 'a', x: 0, y: 0 }] };
    const other: any = { n: 2, duration: 50, plant: null, reason: 't_killed', bomb: [] };
    const once = withBlastTail({ map: 'de_dust2', tickrate: 64, names: {}, rounds: [r, other] } as any);
    expect(once.rounds[0].duration).toBeCloseTo(93.69 + BLAST_TAIL_SECONDS);
    expect(once.rounds[1].duration).toBe(50);
    expect(withBlastTail(once)).toBe(once);
  });
});
