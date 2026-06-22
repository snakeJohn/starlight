import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { registerMusicHandlers } from '../../src/handlers/music';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { SourceManager } from '../../src/music/source_manager';
import type { MusicSourceMeta, SearchResultSong } from '../../src/music/types';

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function request(method: string, path: string, body?: unknown, query = ''): HTTPRequest {
  return {
    method,
    path,
    query,
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as any;
}

function sourceMeta(overrides: Partial<MusicSourceMeta> = {}): MusicSourceMeta {
  return {
    id: 'star',
    name: 'Star Source',
    version: '1.0.0',
    description: '',
    author: '',
    homepage: '',
    filename: 'star.js',
    importedAt: '2026-06-21T00:00:00.000Z',
    enabled: false,
    supportedPlatforms: [],
    ...overrides,
  };
}

function createProvider(): MusicPlatformProvider {
  const song = {
    title: 'Song',
    artist: 'Artist',
    album: '',
    duration: 1,
    cover_url: '',
    source_data: {
      platform: 'kw',
      quality: '320k',
      songInfo: { source: 'kw', name: 'Song', singer: 'Artist', album: '', duration: 1 },
    },
  } satisfies SearchResultSong;

  return {
    id: 'kw',
    name: '酷我音乐',
    search: vi.fn(async () => ({ list: [song], total: 1 })),
    songListSearch: vi.fn(async () => ({ list: [{ id: 'pl1', name: 'Playlist', cover_url: '', play_count: 12, description: '' }], total: 1 })),
    songListDetail: vi.fn(async () => ({ songs: [], total: 0, name: 'Playlist' })),
    recommendedSongLists: vi.fn(async () => ({ list: [{ id: 'pl2', name: 'Recommended', cover_url: '', play_count: 34, description: '' }], total: 1 })),
    leaderboardBoards: vi.fn(async () => [{ id: 'kw__16', name: '热歌榜' }]),
    leaderboardList: vi.fn(async () => ({ songs: [], total: 0, name: '热歌榜' })),
  };
}

function createHarness() {
  const router = createRouter();
  const provider = createProvider();
  let sourcesList = [sourceMeta()];

  const sources = {
    listSources: vi.fn(() => sourcesList),
    importFromJS: vi.fn(async (filename: string) => {
      const imported = sourceMeta({ id: 'imported', name: 'Imported', filename });
      sourcesList = [...sourcesList, imported];
      return imported;
    }),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      sourcesList = sourcesList.map((source) => (source.id === id ? { ...source, enabled } : source));
    }),
    deleteSource: vi.fn(async (id: string) => {
      sourcesList = sourcesList.filter((source) => source.id !== id);
    }),
  } as unknown as SourceManager;

  const runtimes = {
    loadEnabledSources: vi.fn(async () => {}),
    getMusicUrl: vi.fn(async () => 'https://cdn.example/song.mp3'),
  } as unknown as RuntimeManager;

  const platforms = {
    all: vi.fn(() => [{ id: 'kw', name: '酷我音乐' }]),
    get: vi.fn((id: string) => (id === 'kw' ? provider : null)),
  } as unknown as PlatformRegistry;

  registerMusicHandlers(router, sources, runtimes, platforms);

  return { router, sources, runtimes, platforms, provider };
}

describe('registerMusicHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns built-in platform list', async () => {
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/music/platforms'));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: [{ id: 'kw', name: '酷我音乐' }],
      error: null,
    });
  });

  test('imports music source scripts', async () => {
    const { router, sources } = createHarness();

    const response = await router.handle(request('POST', '/api/music/sources/import', { filename: 'new.js', content: 'lx.send("inited")' }));

    expect(response.statusCode).toBe(201);
    expect(sources.importFromJS).toHaveBeenCalledWith('new.js', 'lx.send("inited")');
    expect(parseResponseBody(response).data).toMatchObject({ id: 'imported', filename: 'new.js' });
  });

  test('toggles source, reloads runtimes, and returns updated source data', async () => {
    const { router, sources, runtimes } = createHarness();

    const response = await router.handle(request('POST', '/api/music/sources/toggle', { id: 'star', enabled: true }));

    expect(response.statusCode).toBe(200);
    expect(sources.setEnabled).toHaveBeenCalledWith('star', true);
    expect(runtimes.loadEnabledSources).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toMatchObject({ id: 'star', enabled: true });
  });

  test('toggle source does not wait for slow runtime reloads', async () => {
    const { router, runtimes } = createHarness();
    vi.mocked(runtimes.loadEnabledSources).mockImplementation(async () => new Promise<void>(() => {}));

    const responsePromise = Promise.resolve(
      router.handle(request('POST', '/api/music/sources/toggle', { id: 'star', enabled: true })),
    );
    const outcome = await Promise.race([
      responsePromise.then((response: HTTPResponse) => response.statusCode),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);

    expect(outcome).toBe(200);
    expect(runtimes.loadEnabledSources).toHaveBeenCalledTimes(1);
  });

  test('deletes source and reloads runtimes', async () => {
    const { router, sources, runtimes } = createHarness();

    const response = await router.handle(request('DELETE', '/api/music/sources/star'));

    expect(response.statusCode).toBe(200);
    expect(sources.deleteSource).toHaveBeenCalledWith('star');
    expect(runtimes.loadEnabledSources).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({ id: 'star' });
  });

  test('search validates keyword and delegates to provider', async () => {
    const { router, provider } = createHarness();

    const response = await router.handle(request('POST', '/api/music/search', { keyword: 'hello', source_id: 'kw', page: 2, page_size: 5 }));

    expect(response.statusCode).toBe(200);
    expect(provider.search).toHaveBeenCalledWith('hello', 2, 5);
    expect(parseResponseBody(response).data).toMatchObject({ total: 1 });

    const missingKeyword = await router.handle(request('POST', '/api/music/search', { source_id: 'kw' }));
    expect(missingKeyword.statusCode).toBe(400);
    expect(parseResponseBody(missingKeyword).error.code).toBe('BAD_REQUEST');
  });

  test('search rejects invalid pagination values', async () => {
    const invalidBodies = [
      { keyword: 'hello', source_id: 'kw', page: 0 },
      { keyword: 'hello', source_id: 'kw', page: -1 },
      { keyword: 'hello', source_id: 'kw', page: 1.5 },
      { keyword: 'hello', source_id: 'kw', page: 'abc' },
      { keyword: 'hello', source_id: 'kw', page_size: 0 },
      { keyword: 'hello', source_id: 'kw', page_size: -1 },
      { keyword: 'hello', source_id: 'kw', page_size: 1.5 },
      { keyword: 'hello', source_id: 'kw', page_size: 'abc' },
      { keyword: 'hello', source_id: 'kw', page_size: 101 },
    ];

    for (const body of invalidBodies) {
      const { router, provider } = createHarness();

      const response = await router.handle(request('POST', '/api/music/search', body));

      expect(response.statusCode).toBe(400);
      expect(parseResponseBody(response)).toMatchObject({
        success: false,
        data: null,
        error: { code: 'BAD_REQUEST' },
      });
      expect(provider.search).not.toHaveBeenCalled();
    }
  });

  test('search uses pagination defaults and accepts maximum page size', async () => {
    const { router, provider } = createHarness();

    const defaults = await router.handle(request('POST', '/api/music/search', { keyword: 'hello', source_id: 'kw' }));
    expect(defaults.statusCode).toBe(200);
    expect(provider.search).toHaveBeenCalledWith('hello', 1, 30);

    const maxPageSize = await router.handle(request('POST', '/api/music/search', { keyword: 'hello', source_id: 'kw', page: 9, page_size: 100 }));
    expect(maxPageSize.statusCode).toBe(200);
    expect(provider.search).toHaveBeenLastCalledWith('hello', 9, 100);
  });

  test('URL route validates source_data and resolves through runtime', async () => {
    const { router, runtimes } = createHarness();
    const sourceData = {
      platform: 'kw',
      quality: '320k',
      songInfo: { source: 'kw', name: 'Song', singer: 'Artist', album: '', duration: 1 },
    };

    const response = await router.handle(request('POST', '/api/music/url', { source_data: sourceData }));

    expect(response.statusCode).toBe(200);
    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', sourceData.songInfo);
    expect(parseResponseBody(response).data).toEqual({ url: 'https://cdn.example/song.mp3' });

    const invalid = await router.handle(request('POST', '/api/music/url', {}));
    expect(invalid.statusCode).toBe(400);
    expect(parseResponseBody(invalid).error.code).toBe('BAD_REQUEST');
  });

  test('URL route rejects unsupported platforms before resolving through runtime', async () => {
    const { router, runtimes } = createHarness();
    const sourceData = {
      platform: 'missing',
      quality: '320k',
      songInfo: { source: 'missing', name: 'Song', singer: 'Artist', album: '', duration: 1 },
    };

    const response = await router.handle(request('POST', '/api/music/url', { source_data: sourceData }));

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).error.code).toBe('MUSIC_PLATFORM_UNSUPPORTED');
    expect(runtimes.getMusicUrl).not.toHaveBeenCalled();
  });

  test('songlist and leaderboard routes delegate to provider methods', async () => {
    const { router, provider } = createHarness();

    await router.handle(request('GET', '/api/music/songlist/list', undefined, 'source_id=kw&page=3&page_size=7'));
    expect(provider.recommendedSongLists).toHaveBeenCalledWith(3, 7);

    await router.handle(request('POST', '/api/music/songlist/search', { keyword: 'mix', source_id: 'kw', page: 4, page_size: 8 }));
    expect(provider.songListSearch).toHaveBeenCalledWith('mix', 4, 8);

    await router.handle(request('GET', '/api/music/songlist/detail', undefined, 'source_id=kw&id=pl1&page=5&page_size=9'));
    expect(provider.songListDetail).toHaveBeenCalledWith('pl1', 5, 9);

    await router.handle(request('GET', '/api/music/leaderboard/boards', undefined, 'source_id=kw'));
    expect(provider.leaderboardBoards).toHaveBeenCalledTimes(1);

    await router.handle(request('GET', '/api/music/leaderboard/list', undefined, 'source_id=kw&id=kw__16&page=6&page_size=10'));
    expect(provider.leaderboardList).toHaveBeenCalledWith('kw__16', 6, 10);
  });

  test('query pagination routes reject invalid page size', async () => {
    const { router, provider } = createHarness();

    const response = await router.handle(request('GET', '/api/music/songlist/list', undefined, 'source_id=kw&page=1&page_size=101'));

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).error.code).toBe('BAD_REQUEST');
    expect(provider.recommendedSongLists).not.toHaveBeenCalled();
  });

  test('unsupported providers return a structured platform error', async () => {
    const { router } = createHarness();

    const response = await router.handle(request('POST', '/api/music/search', { keyword: 'hello', source_id: 'missing' }));

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).error).toMatchObject({
      code: 'MUSIC_PLATFORM_UNSUPPORTED',
      message: '不支持的音乐平台',
    });
  });
});
