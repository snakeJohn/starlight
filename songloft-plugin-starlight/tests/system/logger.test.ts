import { describe, expect, test } from 'vitest';
import { maskRecord, maskSecret } from '../../src/system/logger';

describe('logger masking helpers', () => {
  test('maskSecret keeps the first and last four characters', () => {
    expect(maskSecret('abcdef1234567890')).toBe('abcd********7890');
  });

  test('maskRecord masks secret keys and leaves ordinary keys unchanged', () => {
    expect(maskRecord({ api_key: 'sk-1234567890', username: 'admin' })).toEqual({
      api_key: 'sk-1******7890',
      username: 'admin',
    });
  });
});
