import { describe, expect, test } from 'vitest';
import type { MusicSourceMeta } from '../../src/music/types';
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

const rollbackScript = String.raw`/*!
 * @name Rollback Source
 * @version 1.0.0
 * @author Test Author
 */
lx.send('inited', { status: true });
`;

const chineseNameScript = String.raw`/*!
 * @name 星海音乐源
 * @version 1.0.0
 * @author Test Author
 */
lx.send('inited', { status: true });
`;

class FailingSaveIndexStore extends SourceStore {
  shouldFailSaveIndex = false;
  readonly deletedScriptIds: string[] = [];

  override async saveIndex(sources: MusicSourceMeta[]): Promise<void> {
    if (this.shouldFailSaveIndex) {
      throw new Error('saveIndex failed');
    }

    await super.saveIndex(sources);
  }

  override async deleteScript(id: string): Promise<void> {
    this.deletedScriptIds.push(id);
    await super.deleteScript(id);
  }
}

class FailingDeleteScriptStore extends SourceStore {
  shouldFailDeleteScript = false;

  override async deleteScript(id: string): Promise<void> {
    if (this.shouldFailDeleteScript) {
      throw new Error(`deleteScript failed: ${id}`);
    }

    await super.deleteScript(id);
  }
}

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

  test('serializes parallel imports so every source is retained', async () => {
    const manager = await createInitializedManager();
    const scripts = [
      {
        filename: 'a.js',
        content: '/*!\n * @name Parallel A\n * @version 1.0.0\n */\nlx.send("inited",{status:true});',
      },
      {
        filename: 'b.js',
        content: '/*!\n * @name Parallel B\n * @version 1.0.0\n */\nlx.send("inited",{status:true});',
      },
      {
        filename: 'c.js',
        content: '/*!\n * @name Parallel C\n * @version 1.0.0\n */\nlx.send("inited",{status:true});',
      },
    ];

    await Promise.all(scripts.map((s) => manager.importFromJS(s.filename, s.content)));

    const names = manager.listSources().map((s) => s.name).sort();
    expect(names).toEqual(['Parallel A', 'Parallel B', 'Parallel C']);
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

  test('batch import skips duplicate source names and keeps processing later files', async () => {
    const manager = await createInitializedManager();
    await manager.importFromJS('existing.js', sourceScript);

    const result = await manager.importManyFromJS([
      { filename: 'duplicate-name.js', content: sourceScript },
      { filename: 'new-source.js', content: repositoryScript },
      { filename: 'empty.js', content: '   ' },
    ]);

    expect(result).toMatchObject({
      total: 3,
      imported: [
        expect.objectContaining({ name: 'Repository Source', filename: 'new-source.js' }),
      ],
      skipped: [
        expect.objectContaining({
          filename: 'duplicate-name.js',
          name: 'Test Source',
          existingName: 'Test Source',
          reason: 'duplicate',
        }),
      ],
      failed: [
        expect.objectContaining({
          filename: 'empty.js',
          message: 'Music source script is empty',
        }),
      ],
    });
    expect(manager.listSources().map((source) => source.name)).toEqual(['Test Source', 'Repository Source']);
  });

  test('Chinese source names produce readable unique IDs', async () => {
    const manager = await createInitializedManager();

    const first = await manager.importFromJS('star-sea.js', chineseNameScript);
    const second = await manager.importFromJS('star-sea-copy.js', chineseNameScript);

    expect(first.id).toContain('星海音乐源');
    expect(second.id).toContain('星海音乐源');
    expect(second.id).not.toBe(first.id);
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

  test('normalizes stored metadata and strips unknown fields after init', async () => {
    await songloft.storage.set(
      'starlight:music:sources',
      JSON.stringify([
        {
          id: 'legacy-source',
          name: 'Legacy Source',
          script: 'secret',
          enabled: true,
        },
      ]),
    );
    const manager = await createInitializedManager();

    const [source] = manager.listSources();

    expect(source).toEqual({
      id: 'legacy-source',
      name: 'Legacy Source',
      version: '',
      description: '',
      author: '',
      homepage: '',
      filename: '',
      importedAt: '',
      enabled: true,
      supportedPlatforms: [],
    });
    expect(source).not.toHaveProperty('script');
  });

  test('failed import keeps in-memory sources unchanged and rolls back saved script', async () => {
    const store = new FailingSaveIndexStore();
    const manager = await createInitializedManager(store);
    const existing = await manager.importFromJS('test-source.js', sourceScript);
    store.shouldFailSaveIndex = true;

    await expect(manager.importFromJS('rollback.js', rollbackScript)).rejects.toThrow('saveIndex failed');

    expect(manager.listSources()).toEqual([existing]);
    await expect(store.loadScript('rollback-source')).resolves.toBeNull();
    expect(store.deletedScriptIds).toContain('rollback-source');
  });

  test('failed enabled toggle leaves in-memory source state unchanged', async () => {
    const store = new FailingSaveIndexStore();
    const manager = await createInitializedManager(store);
    const meta = await manager.importFromJS('test-source.js', sourceScript);
    await manager.setEnabled(meta.id, true);
    store.shouldFailSaveIndex = true;

    await expect(manager.setEnabled(meta.id, false)).rejects.toThrow('saveIndex failed');

    expect(manager.listSources()).toEqual([
      expect.objectContaining({ id: meta.id, enabled: true }),
    ]);
  });

  test('failed delete leaves in-memory source and script unchanged', async () => {
    const store = new FailingSaveIndexStore();
    const manager = await createInitializedManager(store);
    const meta = await manager.importFromJS('test-source.js', sourceScript);
    store.shouldFailSaveIndex = true;

    await expect(manager.deleteSource(meta.id)).rejects.toThrow('saveIndex failed');

    expect(manager.listSources()).toEqual([meta]);
    await expect(store.loadScript(meta.id)).resolves.toBe(sourceScript);
    expect(store.deletedScriptIds).not.toContain(meta.id);
  });

  test('failed script delete rolls persisted index back and leaves source listed', async () => {
    const store = new FailingDeleteScriptStore();
    const manager = await createInitializedManager(store);
    const meta = await manager.importFromJS('test-source.js', sourceScript);
    store.shouldFailDeleteScript = true;

    await expect(manager.deleteSource(meta.id)).rejects.toThrow(`deleteScript failed: ${meta.id}`);

    expect(manager.listSources()).toEqual([meta]);
    await expect(store.loadIndex()).resolves.toEqual([meta]);
    await expect(store.loadScript(meta.id)).resolves.toBe(sourceScript);
  });

  test('upserts an online source by normalized sourceUrl and keeps id on update', async () => {
    const manager = await createInitializedManager();
    const first = await manager.upsertOnlineSource({
      stableId: 'online-1',
      filename: 'source.js',
      script: sourceScript,
      sourceUrl: 'https://example.test/source.js',
      resolvedUrl: 'https://cdn.test/source.js',
      contentHash: 'hash-1',
      enabled: true,
    });
    const second = await manager.upsertOnlineSource({
      stableId: 'online-2',
      filename: 'source-v2.js',
      script: `${sourceScript}\n//v2`,
      sourceUrl: 'https://example.test/source.js',
      resolvedUrl: 'https://cdn.test/source-v2.js',
      contentHash: 'hash-2',
      enabled: false,
    });
    expect(first.operation).toBe('imported');
    expect(second).toMatchObject({ operation: 'updated', contentChanged: true });
    expect(second.source.id).toBe(first.source.id);
    expect(second.source.enabled).toBe(false);
    expect(await manager.getScript(first.source.id)).toContain('//v2');
  });

  test('keeps same-name online sources separate when sourceUrl differs', async () => {
    const manager = await createInitializedManager();
    await manager.upsertOnlineSource({
      stableId: 'a',
      filename: 'a.js',
      script: sourceScript,
      sourceUrl: 'https://a.test/a.js',
      resolvedUrl: 'https://a.test/a.js',
      contentHash: 'a',
      enabled: false,
    });
    await manager.upsertOnlineSource({
      stableId: 'b',
      filename: 'b.js',
      script: sourceScript,
      sourceUrl: 'https://b.test/b.js',
      resolvedUrl: 'https://b.test/b.js',
      contentHash: 'b',
      enabled: false,
    });
    expect(manager.listSources()).toHaveLength(2);
  });

  test('skips script rewrite when contentHash is unchanged but still updates enabled state', async () => {
    const store = new SourceStore();
    const manager = await createInitializedManager(store);
    const first = await manager.upsertOnlineSource({
      stableId: 'online-same',
      filename: 'source.js',
      script: sourceScript,
      sourceUrl: 'https://example.test/same.js',
      resolvedUrl: 'https://example.test/same.js',
      contentHash: 'same-hash',
      enabled: false,
    });
    const originalScript = await store.loadScript(first.source.id);

    const second = await manager.upsertOnlineSource({
      stableId: 'online-same-other',
      filename: 'source-renamed.js',
      script: `${sourceScript}\n//should-not-write`,
      sourceUrl: 'https://example.test/same.js',
      resolvedUrl: 'https://cdn.test/same.js',
      contentHash: 'same-hash',
      enabled: true,
    });

    expect(second).toMatchObject({ operation: 'updated', contentChanged: false });
    expect(second.source.enabled).toBe(true);
    expect(second.source.filename).toBe('source-renamed.js');
    expect(await store.loadScript(first.source.id)).toBe(originalScript);
  });

  test('captureSnapshot and restoreSnapshot recover index and script after mutation', async () => {
    const manager = await createInitializedManager();
    const first = await manager.upsertOnlineSource({
      stableId: 'snap-1',
      filename: 'source.js',
      script: sourceScript,
      sourceUrl: 'https://example.test/snap.js',
      resolvedUrl: 'https://example.test/snap.js',
      contentHash: 'snap-1',
      enabled: false,
    });
    const snapshot = await manager.captureSnapshot();

    await manager.upsertOnlineSource({
      stableId: 'snap-2',
      filename: 'source-v2.js',
      script: `${sourceScript}\n//changed`,
      sourceUrl: 'https://example.test/snap.js',
      resolvedUrl: 'https://example.test/snap-v2.js',
      contentHash: 'snap-2',
      enabled: true,
    });
    await manager.restoreSnapshot(snapshot);

    expect(manager.listSources()).toEqual([first.source]);
    expect(await manager.getScript(first.source.id)).toBe(sourceScript);
  });

  test('restoreOnlineEntry rolls back one URL without wiping unrelated sources', async () => {
    const manager = await createInitializedManager();
    const unrelated = await manager.importFromJS('local.js', sourceScript);
    const entrySnap = await manager.captureOnlineEntryBySourceUrl('https://example.test/online.js');
    expect(entrySnap).toEqual({ present: false });

    await manager.upsertOnlineSource({
      stableId: 'online-abc',
      filename: 'online.js',
      script: sourceScript,
      sourceUrl: 'https://example.test/online.js',
      resolvedUrl: 'https://example.test/online.js',
      contentHash: 'online-1',
      enabled: true,
    });

    await manager.restoreOnlineEntry('https://example.test/online.js', 'online-abc', entrySnap);

    const list = manager.listSources();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(unrelated.id);
    expect(list.some((source) => source.sourceUrl === 'https://example.test/online.js')).toBe(false);
    expect(await manager.getScript(unrelated.id)).toBe(sourceScript);
  });

  test('upsertOnlineSource rejects stableId collision with a different source', async () => {
    const manager = await createInitializedManager();
    const local = await manager.importFromJS('local.js', sourceScript);

    await expect(
      manager.upsertOnlineSource({
        stableId: local.id,
        filename: 'online.js',
        script: sourceScript,
        sourceUrl: 'https://example.test/collide.js',
        resolvedUrl: 'https://example.test/collide.js',
        contentHash: 'c1',
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_IMPORT_INVALID' });
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

  test('custom storage keys isolate playback and download source sets', async () => {
    const playbackStore = new SourceStore();
    const downloadStore = new SourceStore({
      indexKey: 'starlight:music:download_sources',
      scriptPrefix: 'starlight:music:download_source_script:',
    });

    await playbackStore.saveIndex([sourceMeta('playback-source', 'Playback Source')]);
    await playbackStore.saveScript('playback-source', 'playback-script');
    await downloadStore.saveIndex([sourceMeta('download-source', 'Download Source')]);
    await downloadStore.saveScript('download-source', 'download-script');

    await expect(playbackStore.loadIndex()).resolves.toEqual([
      expect.objectContaining({ id: 'playback-source', name: 'Playback Source' }),
    ]);
    await expect(downloadStore.loadIndex()).resolves.toEqual([
      expect.objectContaining({ id: 'download-source', name: 'Download Source' }),
    ]);
    await expect(playbackStore.loadScript('download-source')).resolves.toBeNull();
    await expect(downloadStore.loadScript('playback-source')).resolves.toBeNull();
    await expect(songloft.storage.keys()).resolves.toEqual(expect.arrayContaining([
      'starlight:music:sources',
      'starlight:music:download_sources',
      'starlight:music:source_script:playback-source',
      'starlight:music:download_source_script:download-source',
    ]));
  });
});

function sourceMeta(id: string, name: string): MusicSourceMeta {
  return {
    id,
    name,
    version: '',
    description: '',
    author: '',
    homepage: '',
    filename: `${id}.js`,
    importedAt: '2026-06-22T00:00:00.000Z',
    enabled: false,
    supportedPlatforms: [],
  };
}
