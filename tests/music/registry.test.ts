import { describe, expect, test } from 'vitest';
import { PlatformRegistry } from '../../src/music/platforms/registry';

describe('PlatformRegistry', () => {
  test('registers all built-in music platforms', () => {
    const registry = new PlatformRegistry();

    expect(registry.all().map((item) => item.id).sort()).toEqual(['kg', 'kw', 'mg', 'tx', 'wy']);
  });
});
