import { describe, expect, it } from 'vitest';
import { demoProblem } from '../readDemo';

const file = (name: string, head: string) => new File([new Uint8Array([...head].map(c => c.charCodeAt(0)))], name);

describe('demoProblem', () => {
  it('passes CS2 demos and saved reads', async () => {
    expect(await demoProblem(file('a.dem', 'PBDEMS2\0rest'))).toBeNull();
    expect(await demoProblem(file('a.json', '{}'))).toBeNull();
  });
  it('names what is wrong', async () => {
    expect(await demoProblem(file('a.dem.zst', 'x'))).toMatch(/zipped/);
    expect(await demoProblem(file('a.dem', 'PK\x03\x04....'))).toMatch(/zipped/);
    expect(await demoProblem(file('a.dem', 'HL2DEMO\0'))).toMatch(/CS:GO/);
    expect(await demoProblem(file('a.dem', 'hello wo'))).toMatch(/not a CS2 demo/);
  });
});
