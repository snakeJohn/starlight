import { afterEach, describe, expect, it } from 'vitest';
import { randomHex } from '../../src/utils/crypto';

describe('randomHex CSPRNG', () => {
  afterEach(() => {
    // Node always has getRandomValues; nothing to restore unless a test stubs it.
  });

  it('returns hex of the requested byte length when CSPRNG is available', () => {
    const hex = randomHex(16);
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
  });

  it('throws when neither polyfill.randomBytes nor getRandomValues is available', async () => {
    const original = globalThis.crypto;
    // Remove Web Crypto so randomBytesPure cannot use getRandomValues.
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });
    try {
      expect(() => randomHex(8)).toThrow(/CSPRNG unavailable/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: original,
      });
    }
  });
});
