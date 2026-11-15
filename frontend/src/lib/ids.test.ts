// Tests for ids.ts — new row ids. Under Jest, expo-crypto is mocked with Node's crypto (jest.setup.js).
import { describe, expect, it } from '@jest/globals';

import { newUuid } from './ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newUuid', () => {
  it('returns a lower-case version 4 UUID', () => {
    expect(newUuid()).toMatch(V4);
  });

  it('returns a different id every call', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newUuid()));
    expect(ids.size).toBe(1000);
  });
});
