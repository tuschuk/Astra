/**
 * Tests for the repo's one UUIDv5 implementation: it must match the RFC and
 * Node's own SHA-1, and give library exercises exactly the ids the server's
 * committed seed migration stores.
 */
/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import { ALL_EXERCISES } from './catalog';
import { libraryExerciseId, sha1, uuidv5 } from './uuidv5';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('sha1', () => {
  it('matches the FIPS 180 test vectors', () => {
    expect(hex(sha1(utf8('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hex(sha1(utf8('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });

  it('agrees with node:crypto across padding boundaries and multi-byte text', () => {
    const inputs = ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'b'.repeat(1000), 'Ünïcødé 💪 lift'];
    for (const input of inputs) {
      const expected = createHash('sha1').update(input, 'utf8').digest('hex');
      expect(hex(sha1(utf8(input)))).toBe(expected);
    }
  });
});

describe('uuidv5', () => {
  it('reproduces the RFC 4122 known answer', () => {
    expect(uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('hashes non-ASCII names as UTF-8 like the reference implementation', () => {
    const ns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const name = 'café 💪';
    const bytes = createHash('sha1')
      .update(Buffer.from(ns.replace(/-/g, ''), 'hex'))
      .update(name, 'utf8')
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = bytes.toString('hex');
    expect(uuidv5(ns, name)).toBe(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`);
  });

  it('refuses a malformed namespace', () => {
    expect(() => uuidv5('not-a-uuid', 'x')).toThrow('Bad namespace uuid');
  });
});

describe('libraryExerciseId', () => {
  it('equals the id committed in the server seed migration', () => {
    expect(libraryExerciseId('bench_press')).toBe('3163d468-ee66-5125-8555-62e842c1aa66');
    expect(libraryExerciseId('squat')).toBe('6a4a0958-a2a0-5b64-9345-8a5df75f788f');
  });

  it('matches every row of the committed seed migration', () => {
    const sql = readFileSync(
      join(__dirname, '../../../backend/supabase/migrations/20261114120100_library_seed.sql'),
      'utf8',
    );
    const seeded = new Map([...sql.matchAll(/\('([0-9a-f-]{36})', '([a-z0-9_]+)'/g)].map((m) => [m[2], m[1]]));
    expect(seeded.size).toBe(ALL_EXERCISES.length);
    for (const exercise of ALL_EXERCISES) {
      expect(libraryExerciseId(exercise.id)).toBe(seeded.get(exercise.id));
    }
  });
});
