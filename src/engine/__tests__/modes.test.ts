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
