import { describe, expect, test } from 'vitest';
import { SourceManager } from '../../src/music/source_manager';
import { SourceStore } from '../../src/music/source_store';
import { StarlightError } from '../../src/system/errors';

const sourceScript = String.raw`/*!
 * @name Test Source
 * @version 1.2.3
 * @description Synthetic source for unit tests.
 * @author Test Author
 * @homepage https://example.invalid/source
 */
lx.send('inited', { status: true });
`;

const repositoryScript = String.raw`/**
 * @name Repository Source
 * @version 0.1.0
 * @author Repo Author
 * @repository https://example.invalid/repo
 */
lx.send('inited', { status: true });
`;

async function createInitializedManager(store = new SourceStore()): Promise<SourceManager> {
  const manager = new SourceManager(store);
  await manager.init();
  return manager;
}

describe('SourceManager', () => {
  test('starts with no default sources after init', async () => {
    const manager = await createInitializedManager();

    expect(manager.listSources()).toEqual([]);
  });

  test('imports JS source disabled by default and extracts metadata', async () => {
    const store = new SourceStore();
    const manager = await createInitializedManager(store);

    const meta = await manager.importFromJS('test-source.js', sourceScript);

    expect(meta).toMatchObject({
      id: 'test-source',
      name: 'Test Source',
      version: '1.2.3',
      description: 'Synthetic source for unit tests.',
      author: 'Test Author',
      homepage: 'https://example.invalid/source',
      filename: 'test-source.js',
      enabled: false,
      supportedPlatforms: [],
    });
    expect(meta.importedAt).toEqual(expect.any(String));
    expect(manager.listSources()).toEqual([meta]);
    await expect(store.loadScript(meta.id)).resolves.toBe(sourceScript);
  });

  test('uses repository metadata as homepage fallback', async () => {
    const manager = await createInitializedManager();

    const meta = await manager.importFromJS('repo.js', repositoryScript);

    expect(meta.homepage).toBe('https://example.invalid/repo');
  });

  test('toggles enabled state and persists it', async () => {
    const store = new SourceStore();
    const manager = await createInitializedManager(store);
    const meta = await manager.importFromJS('test-source.js', sourceScript);

    await manager.setEnabled(meta.id, true);

    expect(manager.listSources()[0]).toMatchObject({ id: meta.id, enabled: true });
    await expect(store.loadIndex()).resolves.toEqual([
      expect.objectContaining({ id: meta.id, enabled: true }),
    ]);
  });

  test('delete removes metadata and script', async () => {
    const store = new SourceStore();
    const manager = await createInitializedManager(store);
    const meta = await manager.importFromJS('test-source.js', sourceScript);

    await manager.deleteSource(meta.id);

    expect(manager.listSources()).toEqual([]);
    await expect(store.loadIndex()).resolves.toEqual([]);
    await expect(store.loadScript(meta.id)).resolves.toBeNull();
  });

  test('duplicate names get unique IDs without replacing by default', async () => {
    const manager = await createInitializedManager();

    const first = await manager.importFromJS('first.js', sourceScript);
    const second = await manager.importFromJS('second.js', sourceScript);

    expect(first.id).toBe('test-source');
    expect(second.id).toBe('test-source-2');
    expect(manager.listSources()).toHaveLength(2);
  });

  test('empty script throws source import invalid error', async () => {
    const manager = await createInitializedManager();

    await expect(manager.importFromJS('empty.js', '   ')).rejects.toThrow(StarlightError);
    await expect(manager.importFromJS('empty.js', '   ')).rejects.toThrow(
      expect.objectContaining({
        code: 'SOURCE_IMPORT_INVALID',
      }),
    );
  });

  test('missing source operations throw source not enabled errors', async () => {
    const manager = await createInitializedManager();

    await expect(manager.setEnabled('missing', true)).rejects.toThrow(
      expect.objectContaining({ code: 'SOURCE_NOT_ENABLED' }),
    );
    await expect(manager.deleteSource('missing')).rejects.toThrow(
      expect.objectContaining({ code: 'SOURCE_NOT_ENABLED' }),
    );
  });

  test('reloading a new SourceManager with same SourceStore sees persisted index', async () => {
    const store = new SourceStore();
    const manager = await createInitializedManager(store);
    const meta = await manager.importFromJS('test-source.js', sourceScript);

    const reloaded = await createInitializedManager(store);

    expect(reloaded.listSources()).toEqual([meta]);
  });
});

describe('SourceStore', () => {
  test('loadIndex tolerates missing, JSON string, array object, and invalid JSON', async () => {
    const store = new SourceStore();
    const meta = {
      id: 'stored-source',
      name: 'Stored Source',
      version: '1.0.0',
      description: '',
      author: '',
      homepage: '',
      filename: 'stored.js',
      importedAt: '2026-06-21T00:00:00.000Z',
      enabled: false,
      supportedPlatforms: [],
    };

    expect(await store.loadIndex()).toEqual([]);

    await songloft.storage.set('starlight:music:sources', JSON.stringify([meta]));
    expect(await store.loadIndex()).toEqual([meta]);

    await songloft.storage.set('starlight:music:sources', [meta]);
    expect(await store.loadIndex()).toEqual([meta]);

    await songloft.storage.set('starlight:music:sources', '{');
    expect(await store.loadIndex()).toEqual([]);
  });

  test('stores, loads, and deletes scripts by source ID', async () => {
    const store = new SourceStore();

    await expect(store.loadScript('test-source')).resolves.toBeNull();

    await store.saveScript('test-source', sourceScript);
    await expect(store.loadScript('test-source')).resolves.toBe(sourceScript);

    await store.deleteScript('test-source');
    await expect(store.loadScript('test-source')).resolves.toBeNull();
  });
});
