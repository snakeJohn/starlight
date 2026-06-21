import { expect, test } from 'vitest';

test('installs the Songloft global test token', async () => {
  const songloft = (globalThis as any).songloft;

  await expect(songloft.plugin.getToken()).resolves.toBe('test-plugin-token');
});
