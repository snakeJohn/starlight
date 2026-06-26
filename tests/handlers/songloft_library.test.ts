import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSongloftLibraryHandlers } from '../../src/handlers/songloft_library';

interface MainGlobals {
  onInit(): Promise<void>;
  onHTTPRequest(req: HTTPRequest): Promise<HTTPResponse>;
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

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function createHarness(options: Parameters<typeof registerSongloftLibraryHandlers>[1] = {}) {
  const router = createRouter();
  registerSongloftLibraryHandlers(router, options);
  return { router };
}

type SongloftSongsStub = {
  list: () => Promise<unknown>;
};

type SongloftPlaylistsStub = {
  list: () => Promise<unknown>;
  getSongs: (playlistId: number) => Promise<unknown>;
};

const searchSong = {
  title: 'Song',
  artist: 'Singer',
  album: 'Album',
  duration: 200,
  cover_url: 'https://img.test/song.jpg',
  source_data: {
    platform: 'kw',
    quality: '320k',
    songInfo: {
      source: 'kw',
      name: 'Song',
      singer: 'Singer',
      album: 'Album',
      duration: 200,
      musicId: '123',
    },
  },
};

describe('registerSongloftLibraryHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Songloft songs from songloft.songs.list and normalizes items/count responses', async () => {
    (songloft.songs as unknown as SongloftSongsStub).list = vi.fn(async () => ({
      items: [{ id: 'song-1', title: 'Song A' }],
      count: 8,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/songs'));

    expect(response.statusCode).toBe(200);
    expect(songloft.songs.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: {
        list: [{ id: 'song-1', title: 'Song A' }],
        total: 8,
      },
      error: null,
    });
  });

  it('returns Songloft playlists from songloft.playlists.list and normalizes playlists/total responses', async () => {
    (songloft.playlists as unknown as SongloftPlaylistsStub).list = vi.fn(async () => ({
      playlists: [{ id: 'playlist-1', name: 'Daily Mix' }],
      total: 3,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/playlists'));

    expect(response.statusCode).toBe(200);
    expect(songloft.playlists.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({
      list: [{ id: 'playlist-1', name: 'Daily Mix' }],
      total: 3,
    });
  });

  it('returns playlist songs from songloft.playlists.getSongs using numeric playlist ids', async () => {
    (songloft.playlists as unknown as SongloftPlaylistsStub).getSongs = vi.fn(async () => ({
      songs: [{ id: 'song-2', title: 'Playlist Song' }],
      count: 11,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/playlists/2/songs'));

    expect(response.statusCode).toBe(200);
    expect(songloft.playlists.getSongs).toHaveBeenCalledWith(2);
    expect(parseResponseBody(response).data).toEqual({
      list: [{ id: 'song-2', title: 'Playlist Song' }],
      total: 11,
    });
  });

  it('creates a Songloft playlist through the playlist service', async () => {
    const playlistService = {
      createPlaylist: vi.fn(async () => ({ id: 12, name: 'Road Trip' })),
    };
    const { router } = createHarness({ playlistService } as any);

    const response = await router.handle(request('POST', '/api/songloft/playlists', { name: 'Road Trip' }));

    expect(response.statusCode).toBe(201);
    expect(playlistService.createPlaylist).toHaveBeenCalledWith('Road Trip');
    expect(parseResponseBody(response).data).toEqual({ id: 12, name: 'Road Trip' });
  });

  it('imports search songs into an existing Songloft playlist through the playlist service', async () => {
    const playlistService = {
      importSongsToPlaylist: vi.fn(async () => ({
        playlist: { id: 12, name: 'Road Trip' },
        imported: 1,
        added: 1,
        skipped: 0,
        errors: [],
      })),
    };
    const { router } = createHarness({ playlistService } as any);

    const response = await router.handle(request('POST', '/api/songloft/playlists/import-songs', {
      playlist_id: 12,
      songs: [searchSong],
    }));

    expect(response.statusCode).toBe(200);
    expect(playlistService.importSongsToPlaylist).toHaveBeenCalledWith({
      playlist_id: 12,
      songs: [searchSong],
    });
    expect(parseResponseBody(response).data).toMatchObject({
      playlist: { id: 12, name: 'Road Trip' },
      imported: 1,
      added: 1,
    });
  });

  it('creates a Songloft playlist by name before importing search songs', async () => {
    const playlistService = {
      importSongsToPlaylist: vi.fn(async () => ({
        playlist: { id: 13, name: 'New Mix' },
        imported: 1,
        added: 1,
        skipped: 0,
        errors: [],
      })),
    };
    const { router } = createHarness({ playlistService } as any);

    const response = await router.handle(request('POST', '/api/songloft/playlists/import-songs', {
      playlist_name: 'New Mix',
      songs: [searchSong],
    }));

    expect(response.statusCode).toBe(200);
    expect(playlistService.importSongsToPlaylist).toHaveBeenCalledWith({
      playlist_name: 'New Mix',
      songs: [searchSong],
    });
    expect(parseResponseBody(response).data.playlist).toEqual({ id: 13, name: 'New Mix' });
  });

  it('starts a background Songloft playlist import job without waiting for slow remote imports', async () => {
    const playlistService = {
      importSongsToPlaylist: vi.fn(() => new Promise(() => {})),
    };
    const { router } = createHarness({ playlistService } as any);

    const response = await Promise.race([
      router.handle(request('POST', '/api/songloft/playlists/import-songs/jobs', {
        playlist_id: 12,
        songs: [searchSong],
      })),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ]);

    expect(response).not.toBe('timeout');
    expect((response as HTTPResponse).statusCode).toBe(202);
    expect(playlistService.importSongsToPlaylist).toHaveBeenCalledWith({
      playlist_id: 12,
      songs: [searchSong],
    });
    expect(parseResponseBody(response as HTTPResponse).data).toMatchObject({
      started: true,
      status: 'running',
      type: 'songs',
    });
    expect(parseResponseBody(response as HTTPResponse).data.job_id).toEqual(expect.any(String));
  });

  it('returns completed Songloft playlist import job results', async () => {
    const playlistService = {
      importSongsToPlaylist: vi.fn(async () => ({
        playlist: { id: 12 },
        imported: 1,
        added: 1,
        skipped: 0,
        errors: [],
      })),
    };
    const { router } = createHarness({ playlistService } as any);

    const start = await router.handle(request('POST', '/api/songloft/playlists/import-songs/jobs', {
      playlist_id: 12,
      songs: [searchSong],
    }));
    const jobId = parseResponseBody(start).data.job_id;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = await router.handle(request('GET', `/api/songloft/playlists/import-jobs/${jobId}`));

    expect(status.statusCode).toBe(200);
    expect(parseResponseBody(status).data).toMatchObject({
      id: jobId,
      status: 'done',
      result: {
        playlist: { id: 12 },
        added: 1,
      },
    });
  });

  it('imports a whole external songlist into a new Songloft playlist through the playlist service', async () => {
    const playlistService = {
      importSourceSonglist: vi.fn(async () => ({
        playlist: { id: 14, name: 'Network Mix' },
        source_total: 2,
        imported: 2,
        added: 2,
        skipped: 0,
        errors: [],
      })),
    };
    const { router } = createHarness({ playlistService } as any);

    const response = await router.handle(request('POST', '/api/songloft/playlists/import-source-songlist', {
      source_id: 'kw',
      id: '3360244412',
      quality: 'flac24bit',
      playlist_name: 'Network Mix',
    }));

    expect(response.statusCode).toBe(201);
    expect(playlistService.importSourceSonglist).toHaveBeenCalledWith({
      source_id: 'kw',
      id: '3360244412',
      quality: 'flac24bit',
      playlist_name: 'Network Mix',
    });
    expect(parseResponseBody(response).data).toMatchObject({
      playlist: { id: 14, name: 'Network Mix' },
      source_total: 2,
      added: 2,
    });
  });

  it('rejects non-numeric playlist ids before calling songloft.playlists.getSongs', async () => {
    (songloft.playlists as unknown as SongloftPlaylistsStub).getSongs = vi.fn(async () => ({
      songs: [],
      count: 0,
    }));
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/playlists/playlist-1/songs'));

    expect(response.statusCode).toBe(400);
    expect(songloft.playlists.getSongs).not.toHaveBeenCalled();
    expect(parseResponseBody(response)).toEqual({
      success: false,
      data: null,
      error: expect.objectContaining({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('playlist id'),
      }),
    });
  });

  it('returns only local songs using common type and local markers', async () => {
    (songloft.songs as unknown as SongloftSongsStub).list = vi.fn(async () => [
      { id: 'local-1', title: 'Local A', type: 'local' },
      { id: 'local-2', title: 'Local B', type: 'LOCAL' },
      { id: 'local-3', title: 'Local C', local: true },
      { id: 'remote-1', title: 'Remote A', type: 'remote' },
      { id: 'remote-2', title: 'Remote B', local: false },
    ]);
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/api/songloft/local-songs'));

    expect(response.statusCode).toBe(200);
    expect(songloft.songs.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({
      list: [
        { id: 'local-1', title: 'Local A', type: 'local' },
        { id: 'local-2', title: 'Local B', type: 'LOCAL' },
        { id: 'local-3', title: 'Local C', local: true },
      ],
      total: 3,
    });
  });

  it('pushes a Songloft library song to the selected speaker through the playlist manager', async () => {
    const playStandalone = vi.fn(async () => true);
    const getOrCreate = vi.fn(async () => ({ playStandalone }));
    const { router } = createHarness({
      playlistManagerMap: { getOrCreate } as any,
    });
    const body = JSON.stringify({
      account_id: 'acc-1',
      device_id: 'dev-1',
      song: {
        id: 501,
        type: 'local',
        title: '本地歌曲',
        artist: '歌手',
        album: '专辑',
        duration: 188,
        cover_url: 'https://img.test/local.jpg',
      },
    });

    const response = await router.handle({
      ...request('POST', '/api/songloft/player/song'),
      body,
    } as unknown as HTTPRequest);

    expect(response.statusCode).toBe(200);
    expect(getOrCreate).toHaveBeenCalledWith('acc-1', 'dev-1');
    expect(playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 501,
        type: 'local',
        title: '本地歌曲',
        artist: '歌手',
        album: '专辑',
        duration: 188,
        url: '/api/v1/songs/501/play',
        cover_url: 'https://img.test/local.jpg',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(parseResponseBody(response).data).toEqual({
      message: 'song started',
      current_song: expect.objectContaining({ title: '本地歌曲' }),
    });
  });

  it('rejects invalid play modes when pushing a Songloft library song to the speaker', async () => {
    const playStandalone = vi.fn(async () => true);
    const getOrCreate = vi.fn(async () => ({ playStandalone }));
    const { router } = createHarness({
      playlistManagerMap: { getOrCreate } as any,
    });

    const response = await router.handle({
      ...request('POST', '/api/songloft/player/song'),
      body: JSON.stringify({
        account_id: 'acc-1',
        device_id: 'dev-1',
        play_mode: 'shuffle_all',
        song: {
          id: 501,
          title: '本地歌曲',
        },
      }),
    } as unknown as HTTPRequest);

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).success).toBe(false);
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(playStandalone).not.toHaveBeenCalled();
  });

  it('registers Songloft library routes during plugin init', async () => {
    vi.resetModules();
    (songloft.songs as unknown as SongloftSongsStub).list = vi.fn(async () => [{ id: 'song-main', title: 'From Main' }]);
    songloft.playlists.list = vi.fn(async () => []);
    songloft.playlists.getSongs = vi.fn(async () => []);

    await import('../../src/main');
    await (globalThis as typeof globalThis & MainGlobals).onInit();

    const response = await (globalThis as typeof globalThis & MainGlobals).onHTTPRequest(
      request('GET', '/api/songloft/songs'),
    );

    expect(response.statusCode).toBe(200);
    expect(songloft.songs.list).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response).data).toEqual({
      list: [{ id: 'song-main', title: 'From Main' }],
      total: 1,
    });
  });

  it('registers Songloft playlist write routes during plugin init', async () => {
    vi.resetModules();
    (songloft.playlists as unknown as Record<string, unknown>).create = vi.fn(async (input) => ({
      id: 21,
      name: (input as { name: string }).name,
    }));

    await import('../../src/main');
    await (globalThis as typeof globalThis & MainGlobals).onInit();

    const response = await (globalThis as typeof globalThis & MainGlobals).onHTTPRequest(
      request('POST', '/api/songloft/playlists', { name: 'Runtime Playlist' }),
    );

    expect(response.statusCode).toBe(201);
    expect((songloft.playlists as unknown as Record<string, any>).create).toHaveBeenCalledWith({ name: 'Runtime Playlist' });
    expect(parseResponseBody(response).data).toEqual({
      id: 21,
      name: 'Runtime Playlist',
    });
  });
});
