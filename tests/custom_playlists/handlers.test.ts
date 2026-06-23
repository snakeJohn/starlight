import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCustomPlaylistHandlers } from '../../src/handlers/custom_playlists';
import type { CustomPlaylistService } from '../../src/custom_playlists/service';
import type { CustomPlaylist } from '../../src/custom_playlists/types';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { SearchResultSong } from '../../src/music/types';

const song = {
  title: '为龙',
  artist: '河图',
  album: '为龙',
  duration: 260,
  cover_url: 'https://img.test/song.jpg',
  source_data: {
    platform: 'kg',
    quality: '320k',
    songInfo: { source: 'kg', name: '为龙', singer: '河图', album: '为龙', duration: 260, hash: 'kg-hash-1' },
  },
} satisfies SearchResultSong;

const playlist = {
  id: 'custom_1',
  name: '古风',
  cover_url: '',
  imported_at: '2026-06-22T00:00:00.000Z',
  updated_at: '2026-06-22T00:00:00.000Z',
  songs: [],
} satisfies CustomPlaylist;

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

function createHarness() {
  const router = createRouter();
  const service = {
    list: vi.fn(async () => [playlist]),
    create: vi.fn(async (name: string) => ({ ...playlist, name })),
    rename: vi.fn(async (id: string, name: string) => ({ ...playlist, id, name })),
    delete: vi.fn(async (id: string) => ({ id })),
    addSong: vi.fn(async () => ({ ...playlist, songs: [] })),
    importNetworkPlaylist: vi.fn(async () => ({ ...playlist, source: 'kw', sourceListId: '3360244412' })),
    syncToSongloftPlaylist: vi.fn(async (id: string) => ({ playlist: { ...playlist, id, native_playlist_id: 77 }, total: 1, skipped: 0, errors: [] })),
    refreshNetworkPlaylist: vi.fn(async (_id: string, loader: (source: 'kw', sourceListId: string) => Promise<unknown>) => {
      await loader('kw', '3360244412');
      return { ...playlist, source: 'kw', sourceListId: '3360244412' };
    }),
  } as unknown as CustomPlaylistService;
  const provider = {
    id: 'kw',
    name: '酷我',
    songListDetail: vi.fn(async () => ({
      name: '酷我歌单',
      cover_url: 'https://img.test/list.jpg',
      songs: [song],
      total: 1,
    })),
  } as unknown as MusicPlatformProvider;
  const platforms = {
    get: vi.fn((id: string) => (id === 'kw' ? provider : null)),
  } as unknown as PlatformRegistry;

  registerCustomPlaylistHandlers(router, service, platforms);
  return { router, service, provider, platforms };
}

describe('registerCustomPlaylistHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists and creates custom playlists', async () => {
    const { router, service } = createHarness();

    const listResponse = await router.handle(request('GET', '/api/custom-playlists'));
    expect(listResponse.statusCode).toBe(200);
    expect(parseResponseBody(listResponse).data).toEqual([playlist]);

    const createResponse = await router.handle(request('POST', '/api/custom-playlists', { name: '测试' }));
    expect(createResponse.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith('测试');
  });

  it('validates playlist names before creating', async () => {
    const { router, service } = createHarness();

    const response = await router.handle(request('POST', '/api/custom-playlists', { name: '   ' }));

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).error.code).toBe('BAD_REQUEST');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('adds songs to a selected custom playlist by id', async () => {
    const { router, service } = createHarness();

    const response = await router.handle(request('POST', '/api/custom-playlists/custom_1/songs', { song }));

    expect(response.statusCode).toBe(200);
    expect(service.addSong).toHaveBeenCalledWith('古风', song);
  });

  it('accepts portable imported playlist songs without source_data when adding to a custom playlist', async () => {
    const { router, service } = createHarness();
    const portableSong = {
      title: '父亲',
      artist: '筷子兄弟',
      album: '',
      duration: 300,
      cover_url: 'https://img.test/fuqin.jpg',
    };

    const response = await router.handle(request('POST', '/api/custom-playlists/custom_1/songs', { song: portableSong }));

    expect(response.statusCode).toBe(200);
    expect(service.addSong).toHaveBeenCalledWith('古风', expect.objectContaining({
      ...portableSong,
      stable_key: 'query:父亲:筷子兄弟',
    }));
  });

  it('imports an LX Server-style network playlist by source and playlist id', async () => {
    const { router, service, provider } = createHarness();

    const response = await router.handle(request('POST', '/api/custom-playlists/import', {
      source_id: 'kw',
      id: '3360244412',
    }));

    expect(response.statusCode).toBe(201);
    expect(provider.songListDetail).toHaveBeenCalledWith('3360244412', 1, 100);
    expect(service.importNetworkPlaylist).toHaveBeenCalledWith({
      source: 'kw',
      sourceListId: '3360244412',
      detail: {
        name: '酷我歌单',
        cover_url: 'https://img.test/list.jpg',
        songs: [song],
        total: 1,
      },
    });
  });

  it('loads every songlist page when importing a large network playlist', async () => {
    const { router, service, provider } = createHarness();
    const songs = Array.from({ length: 323 }, (_, index) => ({
      ...song,
      title: `歌曲 ${index + 1}`,
      source_data: {
        ...song.source_data,
        songInfo: {
          ...song.source_data.songInfo,
          musicId: `kw-${index + 1}`,
          songmid: `kw-${index + 1}`,
        },
      },
    }));
    provider.songListDetail = vi.fn(async (_id: string, page: number, pageSize: number) => {
      const start = (page - 1) * pageSize;
      return {
        name: '323 首歌单',
        cover_url: 'https://img.test/list.jpg',
        songs: songs.slice(start, start + pageSize),
        total: songs.length,
      };
    });

    const response = await router.handle(request('POST', '/api/custom-playlists/import', {
      source_id: 'kw',
      id: '3360244412',
    }));

    expect(response.statusCode).toBe(201);
    expect(provider.songListDetail).toHaveBeenCalledTimes(4);
    expect(provider.songListDetail).toHaveBeenNthCalledWith(1, '3360244412', 1, 100);
    expect(provider.songListDetail).toHaveBeenNthCalledWith(4, '3360244412', 4, 100);
    expect(service.importNetworkPlaylist).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        songs,
        total: 323,
      }),
    }));
  });

  it('validates import source and link/id before loading details', async () => {
    const { router, provider, service } = createHarness();

    const response = await router.handle(request('POST', '/api/custom-playlists/import', {
      source_id: 'kw',
      id: '',
    }));

    expect(response.statusCode).toBe(400);
    expect(provider.songListDetail).not.toHaveBeenCalled();
    expect(service.importNetworkPlaylist).not.toHaveBeenCalled();
  });

  it('refreshes imported playlists through the saved upstream detail loader', async () => {
    const { router, service, provider } = createHarness();

    const response = await router.handle(request('POST', '/api/custom-playlists/custom_1/refresh'));

    expect(response.statusCode).toBe(200);
    expect(service.refreshNetworkPlaylist).toHaveBeenCalledWith('custom_1', expect.any(Function));
    expect(provider.songListDetail).toHaveBeenCalledWith('3360244412', 1, 100);
  });

  it('syncs imported playlists into Songloft playlists on demand', async () => {
    const { router, service } = createHarness();

    const response = await router.handle(request('POST', '/api/custom-playlists/imported_1/sync-songloft'));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response).data).toMatchObject({
      playlist: { native_playlist_id: 77 },
      total: 1,
      skipped: 0,
    });
    expect(service.syncToSongloftPlaylist).toHaveBeenCalledWith('imported_1');
  });
});
