import { describe, expect, it } from 'vitest';
import { matchLinks, type Found } from '../DlSteamFolder';

describe("Steam's cache", () => {
  it('finds Deadlock match links: the data key, the replay key and the cluster', () => {
    const into = new Map<number, Found>();
    matchLinks('\0\0http://replay404.valve.net/1422450/37959196_937530290.meta.bz2\0junk', 100, into);
    matchLinks(' replay404.valve.net/1422450/37959196_428480166.dem.bz2\n cdn.valve.net/1422450/1_2.meta.bz2 replay9.valve.net/730/5_6.dem.bz2', 200, into);
    expect([...into.values()]).toEqual([{ match_id: 37959196, cluster_id: 404, metadata_salt: 937530290, replay_salt: 428480166, seen: 200 }]);
  });
});
