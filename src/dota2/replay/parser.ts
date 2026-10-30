/**
 * Reads a Dota 2 replay (.dem, Source 2) in the browser: hero positions over the whole match. Written after
 * Rupas1k/source2-demo and dotabuff/manta (the same format), but only what's needed here, in plain TypeScript.
 *
 * A replay is a list of messages; entity updates are a bit stream where each field's width depends on its type, so every
 * field of every entity has to be read to find the next one, even though only a few are kept. If a type is read wrongly
 * everything after it is garbage: `read` checks that each packet ends exactly where it should and throws otherwise.
 */
import { snappy } from './unpack';

type Bytes = Uint8Array;
const f32Buf = new DataView(new ArrayBuffer(4));
const decoder = new TextDecoder();

// ---- bits ------------------------------------------------------------------------------------------------------------

const UBIT_VAR = [0, 4, 8, 28], UBIT_VAR_FP = [2, 4, 10, 17, 31];

class Bits {
  p = 0;
  readonly end: number;
  constructor(readonly b: Bytes) { this.end = b.length * 8; }
  bit() { const v = (this.b[this.p >>> 3] >> (this.p & 7)) & 1; this.p++; return v; }
  bits(n: number) {
    let r = 0, got = 0;
    while (got < n) {
      const off = this.p & 7, take = Math.min(8 - off, n - got);
      r += ((this.b[this.p >>> 3] >> off) & ((1 << take) - 1)) * 2 ** got;
      this.p += take; got += take;
    }
    return r;
  }
  u32() {
    let x = 0, shift = 0;
    for (;;) {
      const v = this.bits(8);
      x += (v & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(v & 0x80) || shift === 35) return x;
    }
  }
  i32() { const u = this.u32() >>> 0; return u & 1 ? ~(u >>> 1) : u >>> 1; }
  skipU64() { while (this.bits(8) & 0x80); }
  ubit() {
    const a = this.bits(6), b = a >> 4;
    if (a === 0) return 0;
    return (a & 15) + this.bits(UBIT_VAR[b]) * 16;
  }
  ubitFp() {
    let i = 0;
    while (i < 4 && !this.bit()) i++;
    return this.bits(UBIT_VAR_FP[i]);
  }
  f32() { f32Buf.setUint32(0, this.bits(32)); return f32Buf.getFloat32(0); }
  cstring() { while (this.bits(8)); return 0; }
  coord() {
    let int = this.bit(), fract = this.bit();
    if (!int && !fract) return 0;
    const neg = this.bit();
    if (int) int = this.bits(14) + 1;
    if (fract) fract = this.bits(5);
    const v = int + fract / 32;
    return neg ? -v : v;
  }
  normalVec() {
    const x = this.bit(), y = this.bit();
    if (x) this.bits(12);
    if (y) this.bits(12);
    this.bit();
    return 0;
  }
  bytes(n: number) {
    const out = new Uint8Array(n);
    if (!(this.p & 7)) { out.set(this.b.subarray(this.p >>> 3, (this.p >>> 3) + n)); this.p += n * 8; return out; }
    for (let i = 0; i < n; i++) out[i] = this.bits(8);
    return out;
  }
  str() {
    const out: number[] = [];
    for (;;) { const c = this.bits(8); if (!c) return decoder.decode(new Uint8Array(out)); out.push(c); }
  }
}

// ---- protobuf: just the fields used here -----------------------------------------------------------------------------

type PbValue = number | Bytes;
function pb(buf: Bytes, each: (field: number, v: PbValue) => void) {
  let i = 0;
  const varint = () => {
    let x = 0, mul = 1;
    for (;;) { const b = buf[i++]; x += (b & 0x7f) * mul; if (b < 0x80) return x; mul *= 128; }
  };
  while (i < buf.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) each(field, varint());
    else if (wire === 2) { const n = varint(); each(field, buf.subarray(i, i + n)); i += n; }
    else if (wire === 5) { each(field, new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true)); i += 4; }
    else if (wire === 1) i += 8;
    else throw new Error(`Unknown protobuf wire type ${wire}.`);
  }
}
/** A repeated integer, whichever way it was written (packed or one by one). */
function ints(v: PbValue, into: number[]) {
  if (typeof v === 'number') { into.push(v); return; }
  let i = 0;
  while (i < v.length) { let x = 0, mul = 1; for (;;) { const b = v[i++]; x += (b & 0x7f) * mul; if (b < 0x80) break; mul *= 128; } into.push(x); }
}
const text = (v: PbValue) => decoder.decode(v as Bytes);

// ---- field types and how to read them --------------------------------------------------------------------------------

interface FieldType { base: string; generic: FieldType | null; pointer: boolean; count: number }
const POINTER_TYPES = new Set(['CBodyComponent', 'CLightComponent', 'CPhysicsComponent', 'CRenderComponent', 'CPlayerLocalData']);
const NAMED_COUNTS: Record<string, number> = { MAX_ITEM_STOCKS: 8, MAX_ABILITY_DRAFT_ABILITIES: 48, DOTA_ABILITY_DRAFT_HEROES_PER_GAME: 10 };

function fieldType(name: string): FieldType {
  let end = name.length, pointer = false, count = 0, generic: FieldType | null = null;
  if (name.endsWith('*')) { pointer = true; end--; }
  else if (POINTER_TYPES.has(name)) pointer = true;
  const open = name.indexOf('[');
  if (open >= 0) {
    const inner = name.slice(open + 1, name.indexOf(']'));
    count = NAMED_COUNTS[inner] ?? (parseInt(inner, 10) || 0);
    end = open;
  }
  const angle = name.indexOf('<');
  if (angle >= 0) { generic = fieldType(name.slice(angle + 1, name.lastIndexOf('>')).trim()); end = angle; }
  let base = name.slice(0, end).trim();
  if (base === 'char' && count === 0) base = 'uint8';
  return { base, generic, pointer, count };
}

interface Props { encoder: string; flags: number; bits: number; low: number; high: number }
type Decode = (r: Bits) => number;

const ROUND_DOWN = 1, ROUND_UP = 2, ENCODE_ZERO = 4, ENCODE_INT = 8;
const fr = Math.fround;

function quantized(props: Props): Decode {
  let { bits: bitCount, low, high, flags } = props;
  if (flags) {
    if ((low === 0 && flags & ROUND_DOWN) || (high === 0 && flags & ROUND_UP)) flags &= ~ENCODE_ZERO;
    if (low === 0 && flags & ENCODE_ZERO) { flags |= ROUND_UP; flags &= ~ENCODE_ZERO; }
    if (high === 0 && flags & ENCODE_ZERO) { flags |= ROUND_DOWN; flags &= ~ENCODE_ZERO; }
    if (low > 0 || high < 0) flags &= ~ENCODE_ZERO;
    if (flags & ENCODE_INT) flags &= ~(ROUND_UP | ROUND_DOWN | ENCODE_ZERO);
  }
  let steps = 2 ** (bitCount & 31);
  let offset = 0;
  if (flags & ROUND_DOWN) { offset = fr((high - low) / steps); high = fr(high - offset); }
  else if (flags & ROUND_UP) { offset = fr((high - low) / steps); low = fr(low + offset); }
  if (flags & ENCODE_INT) {
    const delta = Math.ceil(Math.log2(Math.max(1, high + low))), range2 = 2 ** delta;
    let bc = bitCount;
    while (2 ** bc <= range2) bc++;
    if (bc > bitCount) { bitCount = bc; steps = 2 ** bc; }
    offset = fr(range2 / steps);
    high = fr(low + range2 - offset);
  }
  const range = fr(high - low), top = bitCount === 32 ? 0xfffffffe : 2 ** bitCount - 1;
  let mul = Math.abs(range) <= 0 ? fr(top) : fr(fr(top) / range);
  if (fr(mul * range) > fr(top) || fr(mul * range) > top) {
    for (const m of [0.9999, 0.99, 0.9, 0.8, 0.7]) {
      mul = fr(fr(fr(top) / range) * fr(m));
      if (fr(mul * range) <= fr(top) && fr(mul * range) <= top) break;
    }
  }
  const dec = fr(1 / (steps - 1));
  const quantize = (v: number) => {
    if (v < low) return low;
    if (v > high) return high;
    const i = Math.trunc(fr(fr(v - low) * mul));
    return fr(low + fr(fr(fr(high - low) * i) * dec));
  };
  if (flags & ROUND_DOWN && quantize(low) === low) flags &= ~ROUND_DOWN;
  if (flags & ROUND_UP && quantize(high) === high) flags &= ~ROUND_UP;
  if (flags & ENCODE_ZERO && quantize(0) === 0) flags &= ~ENCODE_ZERO;
  return r => {
    if (bitCount === 32) return r.f32();
    if (flags & ROUND_DOWN && r.bit()) return low;
    if (flags & ROUND_UP && r.bit()) return high;
    if (flags & ENCODE_ZERO && r.bit()) return 0;
    return low + (high - low) * r.bits(bitCount) * dec;
  };
}

function float32(p: Props): Decode {
  if (p.encoder === 'coord') return r => r.coord();
  if (p.encoder === 'simtime') return r => r.u32() / 30;
  if (p.encoder === 'runetime') return r => { r.bits(p.bits); return 0; };
  if (p.bits === 32 || p.bits === 0) return r => r.f32();
  return quantized(p);
}

function vector(p: Props, dims: number): Decode {
  if (dims === 3 && p.encoder === 'normal') return r => r.normalVec();
  const one = float32(p);
  return r => { for (let i = 0; i < dims; i++) one(r); return 0; };
}

function qangle(p: Props): Decode {
  if (p.encoder === 'qangle_pitch_yaw') return r => { r.bits(p.bits); r.bits(p.bits); return 0; };
  if (p.bits === 32) return r => { r.bits(32); r.bits(32); r.bits(32); return 0; };
  if (p.encoder === 'qangle_precise') return r => { const x = r.bit(), y = r.bit(), z = r.bit(); if (x) r.bits(20); if (y) r.bits(20); if (z) r.bits(20); return 0; };
  if (p.bits !== 0) return r => { r.bits(p.bits); r.bits(p.bits); r.bits(p.bits); return 0; };
  return r => { const x = r.bit(), y = r.bit(), z = r.bit(); if (x) r.coord(); if (y) r.coord(); if (z) r.coord(); return 0; };
}

const dBool: Decode = r => r.bit();
const dU32: Decode = r => r.u32();
const dI32: Decode = r => r.i32();
const dString: Decode = r => r.cstring();
const dBlock: Decode = r => { const n = r.u32(); r.p += n * 8; return 0; };
const dFixed8: Decode = r => r.bits(8);

function decoderFor(t: FieldType, p: Props): Decode {
  switch (t.base) {
    case 'bool': case 'CBodyComponent': case 'CPhysicsComponent': case 'CRenderComponent': return dBool;
    case 'char': case 'CUtlString': case 'CUtlSymbolLarge': case 'CGlobalSymbol': return dString;
    case 'CUtlBinaryBlock': return dBlock;
    case 'Vector': case 'VectorWS': return vector(p, 3);
    case 'Vector2D': return vector(p, 2);
    case 'Vector4D': case 'Quaternion': return vector(p, 4);
    case 'QAngle': return qangle(p);
    case 'CNetworkedQuantizedFloat': return quantized(p);
    case 'float32': case 'GameTime_t': return float32(p);
    case 'int8': return p.encoder === 'fixed8' ? dFixed8 : dI32;
    case 'int16': case 'int32': case 'HeroID_t': return dI32;
    case 'uint8': case 'BloodType': return p.encoder === 'fixed8' ? dFixed8 : dU32;
    case 'uint16': return dU32;
    case 'uint64': case 'CStrongHandle': case 'HeroFacetKey_t': case 'ResourceId_t':
      return p.encoder === 'fixed64' ? r => { r.p += 64; return 0; } : r => { r.skipU64(); return 0; };
    default: return p.encoder === 'fixed8' ? dFixed8 : dU32;
  }
}

const VALUE = 0, ARRAY = 1, VALUE_VECTOR = 2, VECTOR = 3, POINTER = 4;
interface Field { name: string; model: number; decode: Decode; element: Decode | null; sub: Serializer | null }
interface Serializer { fields: Field[] }
interface Class { id: number; name: string; ser: Serializer; keep: Set<string> | null; names: Map<number, string | null> }

function readSerializers(data: Bytes): Map<string, Serializer> {
  const head = new Bits(data), size = head.u32();
  const body = data.subarray(head.p >>> 3, (head.p >>> 3) + size);
  const symbols: string[] = [], rawSers: { name: number; fields: number[] }[] = [], rawFields: Bytes[] = [];
  pb(body, (f, v) => {
    if (f === 2) symbols.push(text(v));
    else if (f === 1) { const s = { name: 0, fields: [] as number[] }; pb(v as Bytes, (g, w) => { if (g === 1) s.name = w as number; else if (g === 3) ints(w, s.fields); }); rawSers.push(s); }
    else if (f === 3) rawFields.push(v as Bytes);
  });
  const sers = new Map<string, Serializer>(), fields: Field[] = [], types = new Map<string, FieldType>();
  const make = (raw: Bytes): Field => {
    let type = '', name = '', subName = '', send = '', enc = '';
    const p: Props = { encoder: '', flags: 0, bits: 0, low: 0, high: 0 };
    pb(raw, (f, v) => {
      if (f === 1) type = symbols[v as number];
      else if (f === 2) name = symbols[v as number];
      else if (f === 3) p.bits = v as number;
      else if (f === 4) p.low = v as number;
      else if (f === 5) p.high = v as number;
      else if (f === 6) p.flags = v as number;
      else if (f === 7) subName = symbols[v as number];
      else if (f === 9) send = symbols[v as number];
      else if (f === 10) enc = symbols[v as number];
    });
    p.encoder = name === 'm_flSimulationTime' || name === 'm_flAnimTime' ? 'simtime' : name === 'm_flRuneTime' ? 'runetime' : enc;
    let t = types.get(type);
    if (!t) { t = fieldType(type); types.set(type, t); }
    const sub = sers.get(subName) ?? null;
    let model = VALUE;
    if (sub) model = t.pointer ? POINTER : VECTOR;
    else if (t.base === 'CUtlVector' || t.base === 'CNetworkUtlVectorBase' || t.base === 'CUtlVectorEmbeddedNetworkVar') model = VALUE_VECTOR;
    else if (t.count > 0 && t.base !== 'char') model = ARRAY;
    const decode = model === VALUE || model === ARRAY ? decoderFor(t, p) : model === POINTER ? dBool : dU32;
    return { name: send && send !== '(root)' ? `${send}.${name}` : name, model, decode, element: model === VALUE_VECTOR ? decoderFor(t.generic!, p) : null, sub };
  };
  for (const s of rawSers) {
    const ser: Serializer = { fields: [] };
    for (const i of s.fields) {
      if (!fields[i]) fields[i] = make(rawFields[i]);
      ser.fields.push(fields[i]);
    }
    sers.set(symbols[s.name], ser);
  }
  return sers;
}

// ---- field paths -----------------------------------------------------------------------------------------------------

/** The Huffman weights of the 40 field path operations; the order is the ops' numbering in `step`. */
const OP_WEIGHTS = [36271, 10334, 1375, 646, 4128, 35, 3, 521, 2942, 560, 471, 10530, 251, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 310, 2, 0, 1837, 149, 300, 634, 0, 0, 1, 76, 271, 99, 25474];
const OP_FINISH = 39;
interface Node { w: number; v: number; l?: Node; r?: Node }
function opTree(): Node {
  const nodes: Node[] = OP_WEIGHTS.map((w, v) => ({ w: w || 1, v }));
  let next = 40;
  // the next to take is the lightest; among equals the highest number
  const take = () => {
    let best = 0;
    for (let i = 1; i < nodes.length; i++) if (nodes[i].w < nodes[best].w || (nodes[i].w === nodes[best].w && nodes[i].v > nodes[best].v)) best = i;
    return nodes.splice(best, 1)[0];
  };
  while (nodes.length > 1) {
    const a = take(), b = take();
    nodes.push({ w: a.w + b.w, v: next++, l: a, r: b });
  }
  return nodes[0];
}
const TREE = opTree();
const TABLE_BITS = 8;
/** The next 8 bits to the op they start with and its length (0: longer than that, walk the tree). */
const OP_OF = new Uint8Array(1 << TABLE_BITS), OP_LEN = new Uint8Array(1 << TABLE_BITS);
(function fill(n: Node, code: number, len: number) {
  if (n.l) { fill(n.l, code, len + 1); fill(n.r!, code | (1 << len), len + 1); return; }
  if (len > TABLE_BITS) return;
  for (let i = code; i < 1 << TABLE_BITS; i += 1 << len) { OP_OF[i] = n.v; OP_LEN[i] = len; }
})(TREE, 0, 0);

function readOp(r: Bits): number {
  const i = r.p >>> 3, off = r.p & 7, peek = ((r.b[i] | (r.b[i + 1] << 8)) >> off) & 255, len = OP_LEN[peek];
  if (len) { r.p += len; return OP_OF[peek]; }
  let n = TREE;
  while (n.l) n = r.bit() ? n.r! : n.l;
  return n.v;
}

const MAX_PATHS = 8192, DEPTH = 7;
const fp = new Uint16Array(DEPTH);
let fpLast = 0;
const push = (v: number) => { fp[++fpLast] = v; };
const inc = (n: number, v: number) => { fp[n] += v; };

function step(op: number, r: Bits) {
  switch (op) {
    case 0: inc(fpLast, 1); break;
    case 1: inc(fpLast, 2); break;
    case 2: inc(fpLast, 3); break;
    case 3: inc(fpLast, 4); break;
    case 4: inc(fpLast, r.ubitFp() + 5); break;
    case 5: push(0); break;
    case 6: push(r.ubitFp()); break;
    case 7: inc(fpLast, 1); push(0); break;
    case 8: inc(fpLast, 1); push(r.ubitFp()); break;
    case 9: inc(fpLast, r.ubitFp()); push(0); break;
    case 10: inc(fpLast, r.ubitFp() + 2); push(r.ubitFp() + 1); break;
    case 11: inc(fpLast, r.bits(3) + 2); push(r.bits(3) + 1); break;
    case 12: inc(fpLast, r.bits(4) + 2); push(r.bits(4) + 1); break;
    case 13: push(r.ubitFp()); push(r.ubitFp()); break;
    case 14: push(r.bits(5)); push(r.bits(5)); break;
    case 15: push(r.ubitFp()); push(r.ubitFp()); push(r.ubitFp()); break;
    case 16: push(r.bits(5)); push(r.bits(5)); push(r.bits(5)); break;
    case 17: inc(fpLast, 1); push(r.ubitFp()); push(r.ubitFp()); break;
    case 18: inc(fpLast, 1); push(r.bits(5)); push(r.bits(5)); break;
    case 19: inc(fpLast, 1); push(r.ubitFp()); push(r.ubitFp()); push(r.ubitFp()); break;
    case 20: inc(fpLast, 1); push(r.bits(5)); push(r.bits(5)); push(r.bits(5)); break;
    case 21: inc(fpLast, r.ubit() + 2); push(r.ubitFp()); push(r.ubitFp()); break;
    case 22: inc(fpLast, r.ubit() + 2); push(r.bits(5)); push(r.bits(5)); break;
    case 23: inc(fpLast, r.ubit() + 2); push(r.ubitFp()); push(r.ubitFp()); push(r.ubitFp()); break;
    case 24: inc(fpLast, r.ubit() + 2); push(r.bits(5)); push(r.bits(5)); push(r.bits(5)); break;
    case 25: { const n = r.ubit(); inc(fpLast, r.ubit()); for (let i = 0; i < n; i++) push(r.ubitFp()); break; }
    case 26: {
      for (let i = 0; i <= fpLast; i++) if (r.bit()) inc(i, r.i32() + 1);
      const n = r.ubit();
      for (let i = 0; i < n; i++) push(r.ubitFp());
      break;
    }
    case 27: fpLast -= 1; inc(fpLast, 1); break;
    case 28: fpLast -= 1; inc(fpLast, r.ubitFp() + 1); break;
    case 29: fpLast = 0; inc(0, 1); break;
    case 30: fpLast = 0; inc(0, r.ubitFp() + 1); break;
    case 31: fpLast = 0; inc(0, r.bits(3) + 1); break;
    case 32: fpLast = 0; inc(0, r.bits(6) + 1); break;
    case 33: fpLast -= r.ubitFp(); inc(fpLast, 1); break;
    case 34: fpLast -= r.ubitFp(); inc(fpLast, r.i32()); break;
    case 35: fpLast -= r.ubitFp(); for (let i = 0; i <= fpLast; i++) if (r.bit()) inc(i, r.i32()); break;
    case 36: for (let i = 0; i <= fpLast; i++) if (r.bit()) inc(i, r.i32()); break;
    case 37: inc(fpLast - 1, 1); break;
    case 38: for (let i = 0; i <= fpLast; i++) if (r.bit()) inc(i, r.bits(4) - 7); break;
    default: throw new Error(`Unknown field path op ${op}.`);
  }
}

const paths = new Uint16Array(MAX_PATHS * DEPTH), pathLast = new Uint8Array(MAX_PATHS);

function decoderAt(ser: Serializer, at: number, last: number): Decode {
  let i = 0, s = ser, f = s.fields[paths[at]];
  for (;;) {
    i++;
    switch (f.model) {
      case VALUE: case ARRAY: return f.decode;
      case VALUE_VECTOR: return i === last ? f.element! : f.decode;
      case VECTOR:
        if (i >= last) return f.decode;
        i++;
        s = f.sub!;
        break;
      default: // pointer
        if (i > last) return f.decode;
        s = f.sub!;
    }
    f = s.fields[paths[at + i]];
  }
}

const pad = (n: number) => String(n).padStart(4, '0');
function nameAt(ser: Serializer, at: number, last: number): string {
  let i = 0, s = ser, f = s.fields[paths[at]], name = '';
  for (;;) {
    name += f.name;
    i++;
    if (f.model === ARRAY || f.model === VALUE_VECTOR) return i > last ? name : `${name}.${pad(paths[at + i])}`;
    if (f.model === VALUE) return name;
    if (i > last) return name;
    if (f.model === VECTOR) { name += `.${pad(paths[at + i])}.`; i++; if (i > last) return name; }
    else name += '.';
    s = f.sub!;
    f = s.fields[paths[at + i]];
  }
}

/** One entity's update: first which fields, then their values; only the ones this class keeps are remembered. */
function readFields(r: Bits, cls: Class, into: Map<string, number> | null) {
  let n = 0;
  fp[0] = 65535; fpLast = 0;
  for (;;) {
    const op = readOp(r);
    if (op === OP_FINISH) break;
    step(op, r);
    const at = n * DEPTH;
    for (let i = 0; i <= fpLast; i++) paths[at + i] = fp[i];
    pathLast[n++] = fpLast;
  }
  const ser = cls.ser;
  for (let k = 0; k < n; k++) {
    const at = k * DEPTH, last = pathLast[k], v = decoderAt(ser, at, last)(r);
    if (!into) continue;
    let key = 0;
    for (let i = 0; i <= last && i < 4; i++) key = key * 8192 + paths[at + i] + 1;
    if (last >= 4) continue; // nothing kept lies this deep
    let name = cls.names.get(key);
    if (name === undefined) {
      const full = nameAt(ser, at, last);
      name =cls.keep!.has(full) || KEEP_PATTERNS.some(p => p.test(full)) ? full : null;
      cls.names.set(key, name);
    }
    if (name) into.set(name, v);
  }
}

// ---- the replay ------------------------------------------------------------------------------------------------------

const ORIGIN = 'CBodyComponent.m_skeletonInstance.m_vecOrigin';
const HERO_FIELDS = [`${ORIGIN}.m_cellX`, `${ORIGIN}.m_cellY`, `${ORIGIN}.m_vecX`, `${ORIGIN}.m_vecY`, 'm_lifeState', 'm_iHealth', 'm_iMaxHealth', 'm_iPlayerID', 'm_iTeamNum', 'm_hReplicatingOtherHeroModel'];
const RULES_FIELDS = ['m_pGameRules.m_flGameStartTime', 'm_pGameRules.m_flPreGameStartTime', 'm_pGameRules.m_nTotalPausedTicks', 'm_pGameRules.m_nPauseStartTick', 'm_pGameRules.m_nGameState', 'm_pGameRules.m_bGamePaused'];
const KEEP_PATTERNS = [/^m_vecPlayerTeamData\.\d+\.m_nSelectedHeroID$/];
/** What else walks the map, by its class in the replay. */
export type UnitKind = 'creep' | 'siege' | 'neutral' | 'roshan' | 'tormentor' | 'rune' | 'courier';
const UNIT_CLASSES: Record<string, UnitKind> = {
  CDOTA_BaseNPC_Creep_Lane: 'creep', CDOTA_BaseNPC_Creep_Siege: 'siege', CDOTA_BaseNPC_Creep_Neutral: 'neutral',
  CDOTA_Unit_Roshan: 'roshan', CDOTA_Unit_Miniboss: 'tormentor', CDOTA_Item_Rune: 'rune', CDOTA_Unit_Courier: 'courier',
};
const UNIT_FIELDS = [...HERO_FIELDS.slice(0, 7), 'm_iTeamNum', 'm_iRuneType'];
const keepFor = (name: string) => (name.startsWith('CDOTA_Unit_Hero_') ? new Set(HERO_FIELDS)
  : name === 'CDOTAGamerulesProxy' ? new Set(RULES_FIELDS)
    : name === 'CDOTA_PlayerResource' ? new Set<string>()
      : UNIT_CLASSES[name] ? new Set(UNIT_FIELDS) : null);

/** One hero's way over the match, at the times in `ReplayTracks.times` (in OpenDota's map cells; hp in %, 0: dead). */
export interface ReplayHero { heroId: number; team: number; x: number[]; y: number[]; hp: number[] }
/**
 * One creep, Roshan, rune, courier…: its way from row `from` of `ReplayTracks.unitTimes`, one point every `every` rows, for
 * as long as it lasts, in tenths of a map cell to keep it small; 0 while it's dead (a courier comes back). `hp` for Roshan
 * and Tormentors only.
 */
export interface ReplayUnit { kind: UnitKind; team: number; from: number; every: number; x: number[]; y: number[]; hp?: number[]; rune?: number }
export interface ReplayTracks { times: number[]; heroes: ReplayHero[]; unitTimes: number[]; units: ReplayUnit[] }

/** How often positions are kept: every 5 ticks, six times a second. */
const SAMPLE_TICKS = 5;
/** Everything else, once a second: there are hundreds of them, and they walk straight along lanes. */
const UNIT_SAMPLE_TICKS = 30;
/** Game units in a map cell: a position is its cell and the offset inside it. */
const CELL = 128;
const GAME_STATE_PREGAME = 4, GAME_STATE_PLAYING = 5;

interface Entity { cls: Class; values: Map<string, number> | null; unit?: ReplayUnit }

export function readReplay(file: Bytes, progress?: (share: number) => void): ReplayTracks {
  if (decoder.decode(file.subarray(0, 7)) !== 'PBDEMS2') throw new Error('Not a Source 2 replay.');
  let pos = 16;
  const varint = () => {
    let x = 0, mul = 1;
    for (;;) { const b = file[pos++]; x += (b & 0x7f) * mul; if (b < 0x80) return x; mul *= 128; }
  };

  let serializers = new Map<string, Serializer>();
  const classes: Class[] = [];
  let classBits = 0;
  const entities: (Entity | null)[] = new Array(8192).fill(null);
  const baselineBytes = new Map<number, Bytes>(), baselineValues = new Map<number, Map<string, number>>();
  const tables: { name: string; fixed: boolean; size: number; flags: number; varBits: boolean; keys: string[] }[] = [];
  let seenFull = false, nextSample = 0;

  // ---- string tables: only the entity baselines matter here
  const readTable = (t: (typeof tables)[number], buf: Bytes, count: number) => {
    if (t.name !== 'instancebaseline') return;
    const r = new Bits(buf);
    let index = -1, delta = 0;
    const rows = t.keys;
    const recent: string[] = new Array(32).fill('');
    for (let u = 0; u < count; u++) {
      index++;
      if (!r.bit()) index += r.u32() + 1;
      let key: string | null = null;
      if (r.bit()) {
        const zero = delta > 32 ? delta & 31 : 0;
        if (r.bit()) {
          const at = (zero + r.bits(5)) & 31, size = r.bits(5), rest = r.str();
          key = delta < at || recent[at].length < size ? rest : recent[at].slice(0, size) + rest;
        } else key = r.str();
        recent[delta & 31] = key;
        delta++;
      }
      if (key !== null) rows[index] = key;
      if (r.bit()) {
        let compressed = false, size: number;
        if (t.fixed) size = t.size;
        else {
          if (t.flags & 1) compressed = !!r.bit();
          size = (t.varBits ? r.ubit() : r.bits(17)) * 8;
        }
        const raw = r.bytes(size >>> 3);
        const value = compressed ? snappy(raw) : raw;
        const id = parseInt(rows[index] ?? '', 10);
        if (!Number.isNaN(id)) { baselineBytes.set(id, value); baselineValues.delete(id); }
      }
    }
  };
  const baselineOf = (cls: Class) => {
    let v = baselineValues.get(cls.id);
    if (!v) {
      v = new Map();
      const bytes = baselineBytes.get(cls.id);
      if (bytes) readFields(new Bits(bytes), cls, v);
      baselineValues.set(cls.id, v);
    }
    return v;
  };

  // ---- entities
  const readEntities = (data: Bytes, updated: number) => {
    const r = new Bits(data);
    let index = -1;
    for (let u = 0; u < updated; u++) {
      index += r.ubit() + 1;
      const cmd = r.bits(2);
      if (cmd === 1) continue;
      if (cmd === 2) {
        const id = r.bits(classBits);
        r.bits(17);
        r.u32();
        const cls = classes[id];
        if (!cls) throw new Error(`Replay reader lost its place: class ${id} doesn't exist.`);
        const values = cls.keep ? new Map(baselineOf(cls)) : null;
        readFields(r, cls, values);
        entities[index] = { cls, values };
      } else if (cmd === 0) {
        const e = entities[index];
        if (!e) throw new Error(`Replay reader lost its place: entity ${index} doesn't exist.`);
        readFields(r, e.cls, e.values);
      } else entities[index] = null;
    }
    // the bit stream is padded to a whole number of bytes: anything else means a field was read at the wrong width
    if (r.p > r.end || r.end - r.p >= 8) throw new Error(`Replay reader lost its place: ${r.end - r.p} bits left over in an entity packet.`);
  };

  const readPacket = (data: Bytes) => {
    const r = new Bits(data);
    while (r.end - r.p >= 8) {
      const kind = r.ubit(), size = r.u32(), msg = r.bytes(size);
      if (kind === 55) {
        let updated = 0, body: Bytes | null = null;
        pb(msg, (f, v) => { if (f === 2) updated = v as number; else if (f === 7) body = v as Bytes; });
        if (body) readEntities(body, updated);
      } else if (kind === 40) {
        pb(msg, (f, v) => { if (f === 11) classBits = Math.floor(Math.log2(v as number)) + 1; });
      } else if (kind === 44) {
        const t = { name: '', fixed: false, size: 0, flags: 0, varBits: false, keys: [] as string[] };
        let entries = 0, compressed = false, data2: Bytes = new Uint8Array();
        pb(msg, (f, v) => {
          if (f === 1) t.name = text(v);
          else if (f === 2) entries = v as number;
          else if (f === 3) t.fixed = !!v;
          else if (f === 4) t.size = v as number;
          else if (f === 6) t.flags = v as number;
          else if (f === 7) data2 = v as Bytes;
          else if (f === 9) compressed = !!v;
          else if (f === 10) t.varBits = !!v;
        });
        tables.push(t);
        readTable(t, compressed ? snappy(data2) : data2, entries);
      } else if (kind === 45) {
        let id = 0, count = 0, data2: Bytes = new Uint8Array();
        pb(msg, (f, v) => { if (f === 1) id = v as number; else if (f === 2) count = v as number; else if (f === 3) data2 = v as Bytes; });
        const t = tables[id];
        if (t) readTable(t, data2, count);
      }
    }
  };

  const packetData = (buf: Bytes) => { let d: Bytes | null = null; pb(buf, (f, v) => { if (f === 3) d = v as Bytes; }); return d as Bytes | null; };

  // ---- taking the positions down
  const times: number[] = [];
  let start = 0;
  const heroes = new Map<number, ReplayHero>();
  const unitTimes: number[] = [], allUnits: ReplayUnit[] = [];
  let nextUnits = 0;
  const cell = (v: Map<string, number>, axis: 'X' | 'Y') => (v.get(`${ORIGIN}.m_cell${axis}`) ?? 0) + (v.get(`${ORIGIN}.m_vec${axis}`) ?? 0) / CELL;
  const sampleUnits = (list: Entity[], clock: number) => {
    const row = unitTimes.length;
    unitTimes.push(clock);
    for (const e of list) {
      const v = e.values!, kind = UNIT_CLASSES[e.cls.name], alive = (v.get('m_lifeState') ?? 0) === 0;
      if (!alive && !e.unit) continue;
      if (!e.unit) {
        // neutrals mostly stand in their camp, and there are many of them: every third row is plenty
        e.unit = { kind, team: v.get('m_iTeamNum') ?? 0, from: row, every: kind === 'neutral' ? 3 : 1, x: [], y: [] };
        if (kind === 'roshan' || kind === 'tormentor') e.unit.hp = [];
        if (kind === 'rune') e.unit.rune = v.get('m_iRuneType') ?? -1;
        allUnits.push(e.unit);
      }
      // a creep that fell is gone for good; only a courier returns
      if (!alive && kind !== 'courier') continue;
      const u = e.unit;
      if (u.from + u.x.length * u.every !== row) continue; // not its row, or it fell a while ago and this is what's left of it
      u.x.push(alive ? Math.round(cell(v, 'X') * 10) : 0);
      u.y.push(alive ? Math.round(cell(v, 'Y') * 10) : 0);
      u.hp?.push(Math.round(((v.get('m_iHealth') ?? 0) / (v.get('m_iMaxHealth') || 1)) * 100));
    }
  };
  const sample = (tick: number) => {
    let rules: Entity | null = null, players: Entity | null = null;
    const units: Entity[] = [], others: Entity[] = [];
    for (const e of entities) {
      if (!e?.values) continue;
      if (e.cls.name === 'CDOTAGamerulesProxy') rules = e;
      else if (e.cls.name === 'CDOTA_PlayerResource') players = e;
      else if (UNIT_CLASSES[e.cls.name]) others.push(e);
      else units.push(e);
    }
    if (!rules || !players) return;
    const gr = (rules as Entity).values!;
    const state = gr.get('m_pGameRules.m_nGameState') ?? 0;
    start = gr.get('m_pGameRules.m_flGameStartTime') || start;
    // the strategy phase and what follows the Ancient falling aren't part of the match
    if (state !== GAME_STATE_PREGAME && state !== GAME_STATE_PLAYING) return;
    // the game's clock stands still during a pause, the ticks don't
    const paused = (gr.get('m_pGameRules.m_nTotalPausedTicks') ?? 0)
      + (gr.get('m_pGameRules.m_bGamePaused') ? tick - (gr.get('m_pGameRules.m_nPauseStartTick') ?? tick) : 0);
    const row = times.length;
    times.push((tick - paused) / 30);
    if (tick >= nextUnits) { sampleUnits(others, (tick - paused) / 30); nextUnits = tick + UNIT_SAMPLE_TICKS; }
    const seen = new Set<number>();
    for (const e of units) {
      const v = e.values!;
      // an illusion copies its hero's model: this handle is only set on them
      const copy = v.get('m_hReplicatingOtherHeroModel');
      if (copy !== undefined && copy !== 0xffffff && copy !== 0xffffffff) continue;
      const player = v.get('m_iPlayerID');
      if (player === undefined || player < 0) continue;
      // player IDs count in twos; the list of players doesn't
      const heroId = (players as Entity).values!.get(`m_vecPlayerTeamData.${pad(player >> 1)}.m_nSelectedHeroID`);
      if (!heroId || seen.has(heroId)) continue; // a second one is a Meepo clone or similar
      seen.add(heroId);
      let h = heroes.get(heroId);
      if (!h) {
        h = { heroId, team: v.get('m_iTeamNum') ?? 0, x: [], y: [], hp: [] };
        heroes.set(heroId, h);
      }
      // a hero first seen late gets their first position for the time before
      const fill = (a: number[], val: number) => { while (a.length < row) a.push(val); a.push(val); };
      const max = v.get('m_iMaxHealth') || 1, alive = (v.get('m_lifeState') ?? 0) === 0;
      fill(h.x, Math.round(((v.get(`${ORIGIN}.m_cellX`) ?? 0) + (v.get(`${ORIGIN}.m_vecX`) ?? 0) / CELL) * 100) / 100);
      fill(h.y, Math.round(((v.get(`${ORIGIN}.m_cellY`) ?? 0) + (v.get(`${ORIGIN}.m_vecY`) ?? 0) / CELL) * 100) / 100);
      fill(h.hp, alive ? Math.max(1, Math.round(((v.get('m_iHealth') ?? 0) / max) * 100)) : 0);
    }
    for (const h of heroes.values()) if (h.x.length <= row) {
      // not in this update (it can't be seen on an entity list for a moment): stays where it was
      h.x.push(h.x[row - 1] ?? 0); h.y.push(h.y[row - 1] ?? 0); h.hp.push(h.hp[row - 1] ?? 0);
    }
  };

  // ---- every message
  let lastTick = -1, count = 0;
  while (pos < file.length) {
    const cmd = varint(), tick = varint(), size = varint();
    const kind = cmd & ~64;
    const raw = file.subarray(pos, pos + size);
    pos += size;
    if (kind === 0) break;
    if (tick !== lastTick && lastTick >= 0 && lastTick < 0x7fffffff && lastTick >= nextSample) {
      sample(lastTick);
      nextSample = lastTick + SAMPLE_TICKS;
    }
    lastTick = tick;
    if (kind !== 4 && kind !== 5 && kind !== 7 && kind !== 8 && kind !== 13) continue;
    const buf = cmd & 64 ? snappy(raw) : raw;
    if (kind === 4) {
      let d: Bytes | null = null;
      pb(buf, (f, v) => { if (f === 1) d = v as Bytes; });
      if (d) serializers = readSerializers(d);
    } else if (kind === 5) {
      pb(buf, (f, v) => {
        if (f !== 1) return;
        let id = 0, name = '';
        pb(v as Bytes, (g, w) => { if (g === 1) id = w as number; else if (g === 2) name = text(w); });
        const ser = serializers.get(name);
        if (ser) classes[id] = { id, name, ser, keep: keepFor(name), names: new Map() };
      });
    } else if (kind === 7 || kind === 8) {
      const d = packetData(buf);
      if (d) readPacket(d);
    } else if (!seenFull) {
      // the first full packet sets things up; later ones repeat what the deltas already gave
      seenFull = true;
      pb(buf, (f, v) => {
        if (f === 1) {
          pb(v as Bytes, (g, w) => {
            if (g !== 1) return;
            let name = '';
            const items: { key: string; data: Bytes | null }[] = [];
            pb(w as Bytes, (h, x) => {
              if (h === 1) name = text(x);
              else if (h === 2) { const it = { key: '', data: null as Bytes | null }; pb(x as Bytes, (i, y) => { if (i === 1) it.key = text(y); else if (i === 2) it.data = y as Bytes; }); items.push(it); }
            });
            if (name === 'instancebaseline') for (const it of items) {
              const id = parseInt(it.key, 10);
              if (it.data && !Number.isNaN(id)) { baselineBytes.set(id, it.data.slice()); baselineValues.delete(id); }
            }
          });
        } else if (f === 2) { const d = packetData(v as Bytes); if (d) readPacket(d); }
      });
    }
    if (++count % 2000 === 0) progress?.(pos / file.length);
  }
  // around a pause the paused ticks are counted a moment late, so the clock spikes ahead for a sample: time only goes forward
  for (const list of [times, unitTimes]) for (let i = list.length - 2; i >= 0; i--) if (list[i] > list[i + 1]) list[i] = list[i + 1];
  // A replay's ticks run some seconds behind the match clock (10 on the replays checked). Runes only ever appear on the
  // minute, so they tell by how much: half a sample is added as a rune is seen up to one sample after it appears.
  const late = allUnits.filter(u => u.kind === 'rune').map(u => unitTimes[u.from] - start).filter(t => t > -40)
    .map(t => Math.round(t / 60) * 60 - t).sort((a, b) => a - b);
  const behind = late.length ? late[late.length >> 1] + UNIT_SAMPLE_TICKS / 60 : 0;
  const clock = (t: number) => Math.round((t - start + behind) * 100) / 100;
  return { times: times.map(clock), heroes: [...heroes.values()], unitTimes: unitTimes.map(clock), units: allUnits };
}
