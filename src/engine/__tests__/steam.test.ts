import { describe, expect, it } from 'vitest';
import { decodeShareCode, downloadLink, outcomeFromFileName } from '../../../tools/steam.mjs';

describe('steam match codes', () => {
  it('decodes a share code to the ids in the demo file name', () => {
    // the Ancient demo match730_003847732607018074171_0422097200_274.dem came from this share code
    expect(decodeShareCode('CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND')).toEqual({ matchId: '3847727115902386227', outcomeId: '3847732607018074171', token: 45360 });
    expect(outcomeFromFileName('match730_003847732607018074171_0422097200_274.dem')).toBe('3847732607018074171');
    expect(outcomeFromFileName('faceit-demo.dem')).toBeNull();
    expect(() => decodeShareCode('CSGO-xxxxx')).toThrow();
  });
  it("builds Valve's own CS2 download link", () => {
    expect(downloadLink('CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND')).toBe('steam://rungame/730/76561202255233023/+csgo_download_match%20CSGO-xeFV2-JUoTt-7CeOk-jsBv5-KzBND');
  });
});
