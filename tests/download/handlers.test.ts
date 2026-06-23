import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDownloadHandlers } from '../../src/handlers/download';
import type { DownloadService } from '../../src/download/service';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { SourceManager } from '../../src/music/source_manager';
import type { MusicSourceMeta } from '../../src/music/types';

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

function sourceMeta(overrides: Partial<MusicSourceMeta> = {}): MusicSourceMeta {
  return {
    id: 'download-source',
    name: 'Download Source',
    version: '',
    description: '',
    author: '',
    homepage: '',
    filename: 'download.js',
    importedAt: '2026-06-22T00:00:00.000Z',
    enabled: false,
    supportedPlatforms: [],
    ...overrides,
  };
}

function createHarness() {
  const router = createRouter();
  let sourcesList = [sourceMeta()];
  const sources = {
    listSources: vi.fn(() => sourcesList),
    importFromJS: vi.fn(async (filename: string) => {
      const imported = sourceMeta({ id: 'imported-download', filename, name: 'Imported Download' });
      sourcesList = [...sourcesList, imported];
      return imported;
    }),
    importManyFromJS: vi.fn(async (files: Array<{ filename: string; content: string }>) => {
      const imported = files.map((file, index) => sourceMeta({
        id: `imported-download-${index + 1}`,
        filename: file.filename,
        name: `Imported Download ${index + 1}`,
      }));
      sourcesList = [...sourcesList, ...imported];
      return { total: files.length, imported, skipped: [], failed: [] };
    }),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      sourcesList = sourcesList.map((source) => source.id === id ? { ...source, enabled } : source);
    }),
    deleteSource: vi.fn(async (id: string) => {
      sourcesList = sourcesList.filter((source) => source.id !== id);
    }),
  } as unknown as SourceManager;
  const runtimes = {
    loadEnabledSources: vi.fn(async () => {}),
  } as unknown as RuntimeManager;
  const downloads = {
    getSettings: vi.fn(async () => ({ path_template: 'downloads/{artist}/{title}', embed_metadata: true, download_interval: 0 })),
    saveSettings: vi.fn(async () => ({ path_template: 'custom/{title}', embed_metadata: false, download_interval: 3 })),
    downloadSong: vi.fn(async () => ({ song_id: 501, path: 'downloads/song.mp3', status: 'ok' })),
    startBatch: vi.fn(async () => ({ started: true, total: 1 })),
    getBatchProgress: vi.fn(() => ({ active: true, current: 1, total: 1, done: true, success: 1, failed: 0, results: [] })),
    clearBatch: vi.fn(() => ({ ok: true })),
  } as unknown as DownloadService;

  registerDownloadHandlers(router, sources, runtimes, downloads);
  return { router, sources, runtimes, downloads };
}

describe('registerDownloadHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('manages dedicated download sources without touching music source routes', async () => {
    const { router, sources, runtimes } = createHarness();

    const list = await router.handle(request('GET', '/api/download/sources'));
    expect(parseResponseBody(list).data).toEqual([sourceMeta()]);

    const imported = await router.handle(request('POST', '/api/download/sources/import', { filename: 'dl.js', content: 'lx.send("inited")' }));
    expect(imported.statusCode).toBe(201);
    expect(sources.importFromJS).toHaveBeenCalledWith('dl.js', 'lx.send("inited")');

    const batchImported = await router.handle(request('POST', '/api/download/sources/import', {
      files: [
        { filename: 'one.js', content: 'one' },
        { filename: 'two.js', content: 'two' },
      ],
    }));
    expect(batchImported.statusCode).toBe(201);
    expect(sources.importManyFromJS).toHaveBeenCalledWith([
      { filename: 'one.js', content: 'one' },
      { filename: 'two.js', content: 'two' },
    ]);

    const toggled = await router.handle(request('POST', '/api/download/sources/toggle', { id: 'download-source', enabled: true }));
    expect(toggled.statusCode).toBe(200);
    expect(sources.setEnabled).toHaveBeenCalledWith('download-source', true);
    expect(runtimes.loadEnabledSources).toHaveBeenCalledTimes(1);

    vi.mocked(runtimes.loadEnabledSources).mockClear();
    const batchToggled = await router.handle(request('POST', '/api/download/sources/batch-toggle', {
      ids: ['download-source', 'imported-download-1'],
      enabled: false,
    }));
    expect(batchToggled.statusCode).toBe(200);
    expect(sources.setEnabled).toHaveBeenCalledWith('download-source', false);
    expect(sources.setEnabled).toHaveBeenCalledWith('imported-download-1', false);
    expect(runtimes.loadEnabledSources).toHaveBeenCalledTimes(1);

    const deleted = await router.handle(request('DELETE', '/api/download/sources/download-source'));
    expect(deleted.statusCode).toBe(200);
    expect(sources.deleteSource).toHaveBeenCalledWith('download-source');
  });

  it('exposes download settings and starts single-song downloads in the background', async () => {
    const { router, downloads } = createHarness();
    const song = {
      title: 'Song',
      artist: 'Singer',
      album: '',
      duration: 1,
      cover_url: '',
      source_data: { platform: 'kw', quality: '320k', songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: '', duration: 1 } },
    };

    const settings = await router.handle(request('GET', '/api/download/settings'));
    expect(parseResponseBody(settings).data).toMatchObject({ path_template: 'downloads/{artist}/{title}' });

    const saved = await router.handle(request('POST', '/api/download/settings', { path_template: 'custom/{title}', embed_metadata: false, download_interval: 3 }));
    expect(saved.statusCode).toBe(200);
    expect(downloads.saveSettings).toHaveBeenCalledWith({ path_template: 'custom/{title}', embed_metadata: false, download_interval: 3 });

    const downloaded = await router.handle(request('POST', '/api/download/song', { song }));
    expect(downloaded.statusCode).toBe(200);
    expect(downloads.startBatch).toHaveBeenCalledWith([song]);
    expect(downloads.downloadSong).not.toHaveBeenCalled();
    expect(parseResponseBody(downloaded).data).toMatchObject({ started: true, total: 1 });
  });

  it('exposes batch download progress routes', async () => {
    const { router, downloads } = createHarness();
    const song = {
      title: 'Song',
      artist: 'Singer',
      album: '',
      duration: 1,
      cover_url: '',
      source_data: { platform: 'kw', quality: '320k', songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: '', duration: 1 } },
    };

    const started = await router.handle(request('POST', '/api/download/batch', { songs: [song] }));
    expect(started.statusCode).toBe(200);
    expect(downloads.startBatch).toHaveBeenCalledWith([song]);

    const progress = await router.handle(request('GET', '/api/download/batch/progress'));
    expect(parseResponseBody(progress).data).toMatchObject({ active: true, done: true, success: 1 });

    const cleared = await router.handle(request('POST', '/api/download/batch/clear'));
    expect(cleared.statusCode).toBe(200);
    expect(downloads.clearBatch).toHaveBeenCalledTimes(1);
  });
});
