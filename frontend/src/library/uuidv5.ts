/**
 * Deterministic ids for library exercises — UUID version 5 (RFC 4122).
 *
 * Why this exists: a library exercise must have the SAME database id on the
 * phone and on the server without the two ever talking — the phone has to
 * reference "Bench Press" in a workout logged in airplane mode. The contract:
 * `id = uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug)`. Feed in the same namespace
 * and the same slug and you always get the same id, everywhere.
 *
 * This is the ONE implementation in the repo. The seed generator
 * (`automation/scripts/generate-library-seed.ts`) imports it to write the ids
 * the server stores; the app imports it to seed its own copy of the library.
 * A second copy would let the two drift apart — exactly the bug the one-home
 * rule exists to prevent.
 *
 * It is written in plain TypeScript (no `Buffer`, no `node:crypto`) because the
 * phone's JavaScript engine has neither, and a pure function runs identically
 * in the app, in Jest, and in the Node-based generator.
 *
 * SHA-1 here is only a way of turning a name into an id, as the RFC requires —
 * it guards nothing and is not used for security.
 */
import { LIBRARY_EXERCISE_NAMESPACE } from './catalog';

/**
 * Encodes text as UTF-8 bytes (what the RFC hashes). Hand-written so it needs
 * no `TextEncoder`; handles characters outside the basic plane (emoji etc.)
 * by joining their surrogate pairs first.
 */
function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one character.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Rotates a 32-bit number's bits left by `n` places (a SHA-1 building block). */
function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/**
 * The SHA-1 hash of some bytes, as 20 bytes (FIPS 180-4, textbook form).
 * Exported only so Jest can check it against published test vectors.
 */
export function sha1(message: Uint8Array): Uint8Array {
  // Pad: a 1 bit, zeros, then the message length in bits as 64 bits, so the
  // total is a multiple of 64 bytes.
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message);
  buffer[message.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => out.setUint32(i * 4, h >>> 0));
  return digest;
}

/** Bytes → lowercase hex text. */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * RFC 4122 UUID version 5: hash the namespace's 16 bytes followed by the
 * name's UTF-8 bytes with SHA-1, keep the first 16 bytes, and stamp the
 * version (5) and variant bits.
 *
 * Inputs: a namespace UUID (with or without dashes) and any name.
 * Output: the UUID in the usual 8-4-4-4-12 lowercase form.
 * Throws if the namespace isn't a UUID — a typo there would silently mint a
 * whole different id space.
 */
export function uuidv5(namespace: string, name: string): string {
  const ns = namespace.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(ns)) throw new Error(`Bad namespace uuid: ${namespace}`);
  const nsBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) nsBytes[i] = parseInt(ns.slice(i * 2, i * 2 + 2), 16);
  const nameBytes = utf8Bytes(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(nsBytes);
  input.set(nameBytes, 16);

  const bytes = sha1(input).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The database id of a library exercise, from its slug
 * (`libraryExerciseId('bench_press')`). Same answer on the phone and in the
 * server's seed — that agreement is the whole point.
 */
export function libraryExerciseId(slug: string): string {
  return uuidv5(LIBRARY_EXERCISE_NAMESPACE, slug);
}
