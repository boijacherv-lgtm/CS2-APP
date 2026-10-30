/**
 * The compressions a Dota 2 replay uses: around the whole file Zstandard (Valve's newer replays, still named .bz2) or
 * bzip2, and Snappy around most messages inside it.
 */
import { unzstd } from './zstd';


/** A replay as downloaded to the .dem inside, whichever compression it has (the file name doesn't tell). */
export function unpackReplay(file: Uint8Array, progress?: (share: number) => void): Uint8Array {
  if (file[0] === 0x28 && file[1] === 0xb5) return unzstd(file, progress);
  if (file[0] === 0x42 && file[1] === 0x5a) return bunzip2(file, progress);
  return file;
}

/** Grows as needed: how much a replay unpacks to isn't known up front. */
class Output {
  buf: Uint8Array;
  len = 0;
  constructor(size: number) { this.buf = new Uint8Array(size); }
  room(n: number) {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
}

export function snappy(src: Uint8Array): Uint8Array {
  let i = 0, size = 0, shift = 0;
  for (;;) { const b = src[i++]; size += (b & 0x7f) * 2 ** shift; shift += 7; if (b < 0x80) break; }
  const out = new Uint8Array(size);
  let o = 0;
  while (i < src.length) {
    const tag = src[i++], kind = tag & 3;
    if (kind === 0) {
      let len = tag >> 2;
      if (len >= 60) { const n = len - 59; len = 0; for (let k = 0; k < n; k++) len |= src[i++] << (8 * k); len >>>= 0; }
      len += 1;
      out.set(src.subarray(i, i + len), o);
      i += len; o += len;
    } else {
      let len: number, off: number;
      if (kind === 1) { len = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[i++]; }
      else if (kind === 2) { len = (tag >> 2) + 1; off = src[i] | (src[i + 1] << 8); i += 2; }
      else { len = (tag >> 2) + 1; off = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0; i += 4; }
      if (off >= len) { out.copyWithin(o, o - off, o - off + len); o += len; }
      else for (let k = 0; k < len; k++, o++) out[o] = out[o - off];
    }
  }
  return out;
}

const MAX_CODE = 20, GROUP = 50;

/** Unpacks a .bz2 file. `progress` gets the share of the input read (0–1). */
export function bunzip2(src: Uint8Array, progress?: (share: number) => void): Uint8Array {
  let pos = 0, bitBuf = 0, bitCount = 0;
  const bits = (n: number): number => {
    let r = 0;
    while (n > 0) {
      if (bitCount === 0) { bitBuf = src[pos++]; bitCount = 8; }
      const take = Math.min(n, bitCount);
      r = r * 2 ** take + ((bitBuf >> (bitCount - take)) & ((1 << take) - 1));
      bitCount -= take; n -= take;
    }
    return r;
  };
  if (bits(24) !== 0x425a68) throw new Error('Not a bzip2 file.');
  const blockMax = (bits(8) - 48) * 100000;
  const tt = new Uint32Array(blockMax);
  const out = new Output(Math.max(src.length * 4, 1 << 24));

  for (;;) {
    const hi = bits(24), lo = bits(24);
    if (hi === 0x177245 && lo === 0x385090) break;
    if (hi !== 0x314159 || lo !== 0x265359) throw new Error('Damaged bzip2 file.');
    bits(32); // block checksum
    if (bits(1)) throw new Error('Unsupported bzip2 file (randomised block).');
    const origPtr = bits(24);

    // the symbols in use
    const used16 = bits(16), seq: number[] = [];
    for (let i = 0; i < 16; i++) if (used16 & (0x8000 >> i)) {
      const used = bits(16);
      for (let j = 0; j < 16; j++) if (used & (0x8000 >> j)) seq.push(i * 16 + j);
    }
    const alpha = seq.length + 2;

    // which code table each run of 50 symbols uses
    const groups = bits(3), selCount = bits(15);
    const selMtf = Array.from({ length: groups }, (_, i) => i), selectors = new Uint8Array(selCount);
    for (let i = 0; i < selCount; i++) {
      let j = 0;
      while (bits(1)) j++;
      const v = selMtf[j];
      selMtf.copyWithin(1, 0, j);
      selMtf[0] = v;
      selectors[i] = v;
    }

    // the code tables
    const limits: Int32Array[] = [], bases: Int32Array[] = [], perms: Uint16Array[] = [], minLens: number[] = [];
    for (let g = 0; g < groups; g++) {
      const lens = new Uint8Array(alpha);
      let len = bits(5);
      for (let s = 0; s < alpha; s++) {
        while (bits(1)) len += bits(1) ? -1 : 1;
        lens[s] = len;
      }
      let min = MAX_CODE, max = 0;
      for (const l of lens) { if (l < min) min = l; if (l > max) max = l; }
      const perm = new Uint16Array(alpha), count = new Int32Array(MAX_CODE + 2), limit = new Int32Array(MAX_CODE + 2), base = new Int32Array(MAX_CODE + 2);
      let p = 0;
      for (let l = min; l <= max; l++) for (let s = 0; s < alpha; s++) if (lens[s] === l) perm[p++] = s;
      for (const l of lens) count[l]++;
      let code = 0, sum = 0;
      for (let l = min; l <= max; l++) {
        base[l] = sum - code;
        code += count[l]; sum += count[l];
        limit[l] = code - 1;
        code <<= 1;
      }
      limit[max + 1] = 0x7fffffff;
      limits.push(limit); bases.push(base); perms.push(perm); minLens.push(min);
    }

    // the symbols: move-to-front with runs of zeros
    const mtf = Uint8Array.from(seq), freq = new Int32Array(256), eob = alpha - 1;
    let n = 0, sel = 0, left = 0, limit = limits[0], base = bases[0], perm = perms[0], min = minLens[0];
    let runLen = 0, runBit = 1;
    for (;;) {
      if (left === 0) {
        const g = selectors[sel++];
        limit = limits[g]; base = bases[g]; perm = perms[g]; min = minLens[g];
        left = GROUP;
      }
      left--;
      let l = min, code = bits(l);
      while (code > limit[l]) { code = code * 2 + bits(1); l++; }
      const sym = perm[code + base[l]];
      if (sym < 2) { runLen += runBit << sym; runBit <<= 1; continue; }
      if (runLen) {
        const b = mtf[0];
        freq[b] += runLen;
        tt.fill(b, n, n + runLen);
        n += runLen; runLen = 0; runBit = 1;
      }
      if (sym === eob) break;
      const idx = sym - 1, b = mtf[idx];
      mtf.copyWithin(1, 0, idx);
      mtf[0] = b;
      freq[b]++;
      tt[n++] = b;
    }

    // undo the Burrows-Wheeler transform
    const cum = new Int32Array(256);
    for (let i = 1; i < 256; i++) cum[i] = cum[i - 1] + freq[i - 1];
    for (let i = 0; i < n; i++) tt[cum[tt[i] & 0xff]++] |= i << 8;

    // undo the first run-length step: four equal bytes are followed by a repeat count
    out.room(n * 2);
    let t = tt[origPtr] >>> 8, run = 0, last = -1;
    for (let i = 0; i < n; i++) {
      const e = tt[t];
      const b = e & 0xff;
      t = e >>> 8;
      if (run === 4) {
        out.room(b);
        out.buf.fill(last, out.len, out.len + b);
        out.len += b;
        run = 0; last = -1;
        continue;
      }
      if (b === last) run++; else { run = 1; last = b; }
      if (out.len >= out.buf.length) out.room(1 << 20);
      out.buf[out.len++] = b;
    }
    progress?.(pos / src.length);
  }
  return out.buf.subarray(0, out.len);
}
