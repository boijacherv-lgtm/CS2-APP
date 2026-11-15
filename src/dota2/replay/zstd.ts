/** A Zstandard decoder (RFC 8878), for replays: no dictionaries, and the checksum isn't verified. */

const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [...Array.from({ length: 32 }, (_, i) => i + 3), 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539];
const ML_BITS = [...new Array(32).fill(0), 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LL_NORM = [4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1];
const ML_NORM = [1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1];
const OF_NORM = [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1];

const hiBit = (x: number) => 31 - Math.clz32(x);

/** Reads a stream written backwards: from its end towards its start; past the start come zeros. */
class Back {
  p: number;
  constructor(readonly b: Uint8Array, readonly from: number, size: number) {
    const last = b[from + size - 1];
    if (!last) throw new Error('Damaged Zstandard stream.');
    this.p = (size - 1) * 8 + hiBit(last);
  }
  /** The n (up to 24) bits below position p, leaving p where it is. */
  peek(n: number) {
    const at = this.p - n;
    if (at >= 0) {
      const i = this.from + (at >>> 3), off = at & 7, b = this.b;
      return (((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> off) & ((1 << n) - 1));
    }
    if (this.p <= 0) return 0;
    const b = this.b, i = this.from;
    return ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) & ((1 << this.p) - 1)) << -at;
  }
  read(n: number) {
    if (n === 0) return 0;
    if (n <= 24) { const v = this.peek(n); this.p -= n; return v; }
    const hi = this.peek(n - 16); this.p -= n - 16;
    const lo = this.peek(16); this.p -= 16;
    return hi * 65536 + lo;
  }
}

interface Fse { log: number; sym: Uint8Array; nb: Uint8Array; base: Uint16Array }

function fseTable(norm: ArrayLike<number>, count: number, log: number): Fse {
  const size = 1 << log, sym = new Uint8Array(size), nb = new Uint8Array(size), base = new Uint16Array(size);
  const next = new Uint32Array(count);
  let high = size;
  for (let s = 0; s < count; s++) {
    if (norm[s] === -1) { sym[--high] = s; next[s] = 1; } else next[s] = norm[s];
  }
  const step = (size >> 1) + (size >> 3) + 3, mask = size - 1;
  let pos = 0;
  for (let s = 0; s < count; s++) {
    for (let i = 0; i < norm[s]; i++) {
      sym[pos] = s;
      do pos = (pos + step) & mask; while (pos >= high);
    }
  }
  for (let i = 0; i < size; i++) {
    const x = next[sym[i]]++;
    nb[i] = log - hiBit(x);
    base[i] = (x << nb[i]) - size;
  }
  return { log, sym, nb, base };
}

/** An FSE table header at `at`. Returns the table and the first byte after the header. */
function readFse(b: Uint8Array, at: number, maxLog: number): { t: Fse; next: number } {
  let bit = at * 8;
  const read = (n: number) => {
    let r = 0;
    for (let i = 0; i < n; i++, bit++) r |= ((b[bit >>> 3] >> (bit & 7)) & 1) << i;
    return r;
  };
  const log = 5 + read(4);
  if (log > maxLog) throw new Error('Damaged Zstandard table.');
  const norm: number[] = [];
  let left = 1 << log;
  while (left > 0) {
    const bits = hiBit(left + 1) + 1, lowMask = (1 << (bits - 1)) - 1, threshold = (1 << bits) - 1 - (left + 1);
    let val = read(bits);
    if ((val & lowMask) < threshold) { bit--; val &= lowMask; } else if (val > lowMask) val -= threshold;
    const p = val - 1;
    norm.push(p);
    left -= Math.abs(p);
    if (p === 0) {
      for (;;) {
        const rep = read(2);
        for (let i = 0; i < rep; i++) norm.push(0);
        if (rep !== 3) break;
      }
    }
  }
  return { t: fseTable(norm, norm.length, log), next: (bit + 7) >>> 3 };
}

interface Huff { max: number; sym: Uint8Array; bits: Uint8Array }

function huffFromWeights(w: number[]): Huff {
  let sum = 0;
  for (const x of w) if (x) sum += 1 << (x - 1);
  const max = hiBit(sum) + 1, left = (1 << max) - sum;
  w.push(hiBit(left) + 1);
  const size = 1 << max, sym = new Uint8Array(size), bits = new Uint8Array(size);
  const counts = new Uint32Array(max + 2), rank = new Uint32Array(max + 2);
  for (const x of w) if (x) counts[max + 1 - x]++;
  rank[max] = 0;
  for (let i = max; i >= 1; i--) {
    rank[i - 1] = rank[i] + counts[i] * (1 << (max - i));
    bits.fill(i, rank[i], rank[i - 1]);
  }
  w.forEach((x, s) => {
    if (!x) return;
    const nb = max + 1 - x, len = 1 << (max - nb);
    sym.fill(s, rank[nb], rank[nb] + len);
    rank[nb] += len;
  });
  return { max, sym, bits };
}

function readHuff(b: Uint8Array, at: number): { h: Huff; next: number } {
  const head = b[at++], w: number[] = [];
  if (head >= 128) {
    const n = head - 127;
    for (let i = 0; i < n; i++) w.push(i & 1 ? b[at + (i >> 1)] & 15 : b[at + (i >> 1)] >> 4);
    return { h: huffFromWeights(w), next: at + ((n + 1) >> 1) };
  }
  const { t, next } = readFse(b, at, 6);
  const end = at + head, r = new Back(b, next, end - next);
  let s1 = r.read(t.log), s2 = r.read(t.log);
  for (;;) {
    w.push(t.sym[s1]);
    s1 = t.base[s1] + r.read(t.nb[s1]);
    if (r.p < 0) { w.push(t.sym[s2]); break; }
    w.push(t.sym[s2]);
    s2 = t.base[s2] + r.read(t.nb[s2]);
    if (r.p < 0) { w.push(t.sym[s1]); break; }
  }
  return { h: huffFromWeights(w), next: end };
}

function huffStream(h: Huff, b: Uint8Array, from: number, size: number, out: Uint8Array, start: number, end: number) {
  const r = new Back(b, from, size), { max, sym, bits } = h;
  for (let o = start; o < end; o++) {
    const v = r.peek(max);
    out[o] = sym[v];
    r.p -= bits[v];
  }
}

/** Unpacks a .zst file. `progress` gets the share of the input read (0–1). */
export function unzstd(src: Uint8Array, progress?: (share: number) => void): Uint8Array {
  let pos = 0;
  let out = new Uint8Array(Math.max(src.length * 3, 1 << 20)), o = 0;
  const room = (n: number) => {
    if (o + n <= out.length) return;
    const next = new Uint8Array(Math.max(out.length * 2, o + n));
    next.set(out.subarray(0, o));
    out = next;
  };
  const le = (at: number, n: number) => { let r = 0; for (let i = n - 1; i >= 0; i--) r = r * 256 + src[at + i]; return r; };

  while (pos < src.length) {
    const magic = le(pos, 4);
    pos += 4;
    if ((magic & 0xfffffff0) >>> 0 === 0x184d2a50) { pos += 4 + le(pos, 4); continue; }
    if (magic !== 0xfd2fb528) throw new Error('Not a Zstandard file.');
    const desc = src[pos++], fcsFlag = desc >> 6, single = (desc >> 5) & 1, checksum = (desc >> 2) & 1, dict = desc & 3;
    if (dict) throw new Error('Zstandard dictionaries are not supported.');
    if (!single) pos++;
    const fcsSize = fcsFlag === 0 ? single : 1 << fcsFlag;
    if (fcsSize) { room(le(pos, fcsSize) + (fcsSize === 2 ? 256 : 0)); pos += fcsSize; }

    let huff: Huff | null = null, ll: Fse | null = null, of: Fse | null = null, ml: Fse | null = null;
    let rep1 = 1, rep2 = 4, rep3 = 8;
    let lits = new Uint8Array(1 << 17);

    for (;;) {
      const head = le(pos, 3), last = head & 1, type = (head >> 1) & 3, size = head >>> 3;
      pos += 3;
      if (type === 0) { room(size); out.set(src.subarray(pos, pos + size), o); o += size; pos += size; }
      else if (type === 1) { room(size); out.fill(src[pos], o, o + size); o += size; pos += 1; }
      else if (type === 3) throw new Error('Damaged Zstandard block.');
      else {
        const blockEnd = pos + size;
        // ---- literals
        const b0 = src[pos], lType = b0 & 3, sf = (b0 >> 2) & 3;
        let regen: number, comp = 0, streams = 1, hs: number;
        if (lType < 2) {
          if (!(sf & 1)) { regen = b0 >> 3; hs = 1; }
          else if (sf === 1) { regen = le(pos, 2) >> 4; hs = 2; }
          else { regen = le(pos, 3) >> 4; hs = 3; }
        } else if (sf < 2) {
          const v = le(pos, 3);
          regen = (v >> 4) & 0x3ff; comp = v >> 14; hs = 3; streams = sf === 0 ? 1 : 4;
        } else if (sf === 2) {
          const v = le(pos, 4);
          regen = (v / 16) & 0x3fff; comp = Math.floor(v / 2 ** 18); hs = 4; streams = 4;
        } else {
          const v = le(pos, 5);
          regen = Math.floor(v / 16) & 0x3ffff; comp = Math.floor(v / 2 ** 22); hs = 5; streams = 4;
        }
        pos += hs;
        if (regen > lits.length) lits = new Uint8Array(regen);
        if (lType === 0) { lits.set(src.subarray(pos, pos + regen)); pos += regen; }
        else if (lType === 1) { lits.fill(src[pos], 0, regen); pos += 1; }
        else {
          let at = pos;
          const litsEnd = pos + comp;
          if (lType === 2) { const r = readHuff(src, at); huff = r.h; at = r.next; }
          if (!huff) throw new Error('Damaged Zstandard literals.');
          if (streams === 1) huffStream(huff, src, at, litsEnd - at, lits, 0, regen);
          else {
            const s1 = le(at, 2), s2 = le(at + 2, 2), s3 = le(at + 4, 2);
            at += 6;
            const part = (regen + 3) >> 2;
            huffStream(huff, src, at, s1, lits, 0, part);
            huffStream(huff, src, at + s1, s2, lits, part, part * 2);
            huffStream(huff, src, at + s1 + s2, s3, lits, part * 2, part * 3);
            huffStream(huff, src, at + s1 + s2 + s3, litsEnd - (at + s1 + s2 + s3), lits, part * 3, regen);
          }
          pos = litsEnd;
        }

        // ---- sequences
        let n = src[pos++];
        if (n >= 255) { n = src[pos] + (src[pos + 1] << 8) + 0x7f00; pos += 2; }
        else if (n >= 128) { n = ((n - 128) << 8) + src[pos++]; }
        let litAt = 0;
        if (n > 0) {
          const modes = src[pos++];
          const table = (mode: number, norm: number[], defLog: number, maxLog: number, prev: Fse | null): Fse => {
            if (mode === 0) return fseTable(norm, norm.length, defLog);
            if (mode === 1) { const s = src[pos++]; return { log: 0, sym: Uint8Array.of(s), nb: Uint8Array.of(0), base: Uint16Array.of(0) }; }
            if (mode === 2) { const r = readFse(src, pos, maxLog); pos = r.next; return r.t; }
            if (!prev) throw new Error('Damaged Zstandard sequences.');
            return prev;
          };
          ll = table(modes >> 6, LL_NORM, 6, 9, ll);
          of = table((modes >> 4) & 3, OF_NORM, 5, 8, of);
          ml = table((modes >> 2) & 3, ML_NORM, 6, 9, ml);
          const r = new Back(src, pos, blockEnd - pos);
          let sl = r.read(ll.log), so = r.read(of.log), sm = r.read(ml.log);
          for (let i = 0; i < n; i++) {
            const ofCode = of.sym[so], mlCode = ml.sym[sm], llCode = ll.sym[sl];
            const ofVal = 2 ** ofCode + r.read(ofCode);
            const matchLen = ML_BASE[mlCode] + r.read(ML_BITS[mlCode]);
            const litLen = LL_BASE[llCode] + r.read(LL_BITS[llCode]);
            let offset: number;
            if (ofVal > 3) { offset = ofVal - 3; rep3 = rep2; rep2 = rep1; rep1 = offset; }
            else {
              const idx = ofVal - 1 + (litLen === 0 ? 1 : 0);
              if (idx === 0) offset = rep1;
              else {
                offset = idx === 1 ? rep2 : idx === 2 ? rep3 : rep1 - 1;
                if (idx > 1) rep3 = rep2;
                rep2 = rep1; rep1 = offset;
              }
            }
            room(litLen + matchLen);
            out.set(lits.subarray(litAt, litAt + litLen), o);
            o += litLen; litAt += litLen;
            if (offset >= matchLen) { out.copyWithin(o, o - offset, o - offset + matchLen); o += matchLen; }
            else for (let k = 0; k < matchLen; k++, o++) out[o] = out[o - offset];
            if (i < n - 1) {
              sl = ll.base[sl] + r.read(ll.nb[sl]);
              sm = ml.base[sm] + r.read(ml.nb[sm]);
              so = of.base[so] + r.read(of.nb[so]);
            }
          }
        }
        const rest = regen - litAt;
        room(rest);
        out.set(lits.subarray(litAt, regen), o);
        o += rest;
        pos = blockEnd;
      }
      if (last) break;
      progress?.(pos / src.length);
    }
    if (checksum) pos += 4;
  }
  return out.subarray(0, o);
}
