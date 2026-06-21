import { expect, test } from 'vitest';

interface TestSongloftGlobal {
  storage: {
    get(key: string): Promise<unknown | null>;
  };
  plugin: {
    getToken(): Promise<string>;
  };
  jsenv: {
    executeWait(...args: unknown[]): Promise<{ error: string; events: unknown[] }>;
  };
}

const getSongloft = (): TestSongloftGlobal => (globalThis as typeof globalThis & { songloft: TestSongloftGlobal }).songloft;

const collectionFetchResult = globalThis.fetch('data:text/plain,collection').then(
  () => 'resolved',
  (error: unknown) => (error instanceof Error ? error.message : String(error)),
);

test('installs the Songloft global test token', async () => {
  const songloft = getSongloft();

  await expect(songloft.plugin.getToken()).resolves.toBe('test-plugin-token');
});

test('blocks fetch during test collection', async () => {
  await expect(collectionFetchResult).resolves.toBe('Unexpected fetch call. Mock globalThis.fetch in this test.');
});

test('returns null for missing storage keys', async () => {
  const songloft = getSongloft();

  await expect(songloft.storage.get('missing')).resolves.toBeNull();
});

test('blocks unexpected fetch calls by default', async () => {
  await expect(globalThis.fetch('http://127.0.0.1:18191')).rejects.toThrow(
    'Unexpected fetch call. Mock globalThis.fetch in this test.',
  );
});

test('returns safe jsenv executeWait defaults', async () => {
  const songloft = getSongloft();

  await expect(songloft.jsenv.executeWait()).resolves.toEqual({ error: '', events: [] });
});
