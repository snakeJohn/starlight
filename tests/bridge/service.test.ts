import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeService } from '../../src/bridge/service';
import { registerBridgeHandlers } from '../../src/handlers/bridge';
import { OnlineSearcher } from '../../src/voicecmd/online_searcher';
import type { ConfigManager } from '../../src/config/manager';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { SearchResultSong } from '../../src/music/types';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';

const song = {
  title: 'Song',
  artist: 'Singer',
  album: 'Album',
  duration: 200,
  cover_url: 'https://img.test/a.jpg',
  source_data: {
    platform: 'kw',
    quality: '320k',
    songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, musicId: '123', songmid: '123' },
  },
} satisfies SearchResultSong;

const secondSong = {
  ...song,
  title: 'Second Song',
  source_data: {
    ...song.source_data,
    songInfo: {
      ...song.source_data.songInfo,
      musicId: '456',
      songmid: '456',
    },
  },
} satisfies SearchResultSong;

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

function createService(options: {
  url?: string | null;
  playResult?: boolean;
  playResults?: boolean[];
  usePlaylistManager?: boolean;
  providers?: MusicPlatformProvider[];
} = {}) {
  const runtimes = {
    getMusicUrl: vi.fn(async () => ('url' in options ? options.url : 'https://audio.test/song.mp3')),
  } as unknown as RuntimeManager;
  const playResults = [...(options.playResults ?? [])];
  const nextPlayResult = () => playResults.length > 0 ? playResults.shift()! : (options.playResult ?? true);
  const minaService = {
    playURL: vi.fn(async () => nextPlayResult()),
  } as unknown as MinaService;
  const playlistManager = {
    playStandalone: vi.fn(async () => nextPlayResult()),
  };
  const playlistManagerMap = {
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const providers = options.providers ?? [];
  const platforms = {
    all: vi.fn(() => providers.map((provider) => ({ id: provider.id, name: provider.name }))),
    get: vi.fn((id: string) => providers.find((provider) => provider.id === id) ?? null),
  } as unknown as PlatformRegistry;

  return {
    service: new BridgeService(
      platforms,
      runtimes,
      minaService,
      options.usePlaylistManager ? playlistManagerMap : undefined,
    ),
    runtimes,
    minaService,
    playlistManager,
    playlistManagerMap,
    platforms,
  };
}

function createProvider(id: MusicPlatformProvider['id'], list: SearchResultSong[]): MusicPlatformProvider {
  return {
    id,
    name: id,
    search: vi.fn(async () => ({ list, total: list.length })),
    songListSearch: vi.fn(),
    songListDetail: vi.fn(),
    recommendedSongLists: vi.fn(),
    leaderboardBoards: vi.fn(),
    leaderboardList: vi.fn(),
  } as unknown as MusicPlatformProvider;
}

describe('BridgeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves preview URLs through the runtime manager', async () => {
    const { service, runtimes } = createService();

    await expect(service.previewUrl(song)).resolves.toBe('https://audio.test/song.mp3');

    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', song.source_data.songInfo, {
      operation: 'playback',
      title: 'Song',
      artist: 'Singer',
    });
  });

  it('throws PLAY_URL_RESOLVE_FAILED when the runtime cannot resolve a URL', async () => {
    const { service } = createService({ url: null });

    await expect(service.previewUrl(song)).rejects.toMatchObject({
      code: 'PLAY_URL_RESOLVE_FAILED',
    });
  });

  it('includes the last runtime failure when preview URL resolution fails', async () => {
    const runtimes = {
      getMusicUrl: vi.fn(async () => null),
      getLastMusicUrlAttempt: vi.fn(() => ({
        attemptedSources: 2,
        lastFailure: '音乐下载器 v6 请求了空歌曲 ID',
      })),
    } as unknown as RuntimeManager;
    const platforms = {
      all: vi.fn(() => []),
      get: vi.fn(() => null),
    } as unknown as PlatformRegistry;
    const service = new BridgeService(platforms, runtimes, {} as MinaService);

    await expect(service.previewUrl(song)).rejects.toMatchObject({
      code: 'PLAY_URL_RESOLVE_FAILED',
      message: expect.stringContaining('已尝试 2 个播放音源'),
      details: {
        attempts: 2,
        lastFailure: '音乐下载器 v6 请求了空歌曲 ID',
      },
    });
  });

  it('imports songs best-effort and skips songs whose URLs cannot be resolved', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/songs/remote')) {
        return responseJson({ songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }], count: 1 }, 201);
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return responseJson({
          data: {
            songinfo: { songName: 'Song', artist: 'Singer', album: 'Album' },
            lrclist: [
              { time: 0, lineLyric: 'Song' },
              { time: 0, lineLyric: 'Wind rises' },
            ],
          },
        });
      }
      if (url.includes('/api/v1/songs/101/lyrics')) {
        return responseJson({ message: 'ok', file_write_status: 'unchanged' });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock;
    const runtimes = {
      getMusicUrl: vi.fn(async (_platform: string, _quality: string, songInfo: { musicId?: string }) =>
        songInfo.musicId === '123' ? 'https://audio.test/song.mp3' : null),
    } as unknown as RuntimeManager;
    const platforms = {
      all: vi.fn(() => []),
      get: vi.fn(() => null),
    } as unknown as PlatformRegistry;
    const service = new BridgeService(platforms, runtimes, {} as MinaService);

    await expect(service.importSongsBestEffort([song, secondSong])).resolves.toMatchObject({
      total: 1,
      skipped: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body?: string }]>;
    const importBody = calls[0]?.[1]?.body;
    const lyricBody = calls[2]?.[1]?.body;
    expect(typeof importBody).toBe('string');
    expect(typeof lyricBody).toBe('string');
    expect(JSON.parse(importBody || '')).toEqual([
      expect.objectContaining({
        title: 'Song',
        url: 'https://audio.test/song.mp3',
      }),
    ]);
    expect(JSON.parse(lyricBody || '')).toMatchObject({
      lyric_source: 'scraped',
      lyric: expect.stringContaining('[00:00.00]Song'),
      tlyric: expect.stringContaining('[00:00.00]Wind rises'),
    });
  });

  it('syncs lyrics into Songloft after importing a remote song', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/songs/remote')) {
        return responseJson({ songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }], count: 1 }, 201);
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return responseJson({
          data: {
            songinfo: { songName: 'Song', artist: 'Singer', album: 'Album' },
            lrclist: [
              { time: 0, lineLyric: 'Song' },
              { time: 0, lineLyric: 'Wind rises' },
            ],
          },
        });
      }
      if (url.includes('/api/v1/songs/101/lyrics')) {
        expect(init?.method).toBe('PUT');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          lyric_source: 'scraped',
          lyric: expect.stringContaining('[00:00.00]Song'),
          tlyric: expect.stringContaining('[00:00.00]Wind rises'),
        });
        return responseJson({ message: '歌词已更新', file_write_status: 'unchanged' });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock;
    const { service } = createService();

    await expect(service.importSongs([song])).resolves.toMatchObject({
      total: 1,
      songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18191/api/v1/songs/remote', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18191/api/v1/songs/101/lyrics', expect.any(Object));
  });

  it('keeps imported songs when lyric fetching fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/songs/remote')) {
        return responseJson({ songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }], count: 1 }, 201);
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return responseJson({ message: 'upstream failed' }, 500);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock;
    const { service } = createService();

    await expect(service.importSongs([song])).resolves.toMatchObject({
      total: 1,
      songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }],
    });
  });

  it('keeps imported songs when lyric update fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/songs/remote')) {
        return responseJson({ songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }], count: 1 }, 201);
      }
      if (url.includes('m.kuwo.cn/newh5/singles/songinfoandlrc')) {
        return responseJson({
          data: {
            songinfo: { songName: 'Song', artist: 'Singer', album: 'Album' },
            lrclist: [
              { time: 0, lineLyric: 'Song' },
              { time: 0, lineLyric: 'Wind rises' },
            ],
          },
        });
      }
      if (url.includes('/api/v1/songs/101/lyrics')) {
        expect(init?.method).toBe('PUT');
        return responseJson({ message: 'write failed' }, 500);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock;
    const { service } = createService();

    await expect(service.importSongs([song])).resolves.toMatchObject({
      total: 1,
      songs: [{ id: 101, type: 'remote', title: 'Song', artist: 'Singer' }],
    });
  });

  it('imports resolved remote songs into Songloft and returns native song records', async () => {
    const nativeSong = { id: 101, type: 'remote', title: 'Song', artist: 'Singer' };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: vi.fn(async () => ({ songs: [nativeSong], count: 1 })),
    }) as unknown as Response);
    globalThis.fetch = fetchMock;
    const { service } = createService();

    await expect(service.importSongs([song])).resolves.toMatchObject({
      total: 1,
      songs: [nativeSong],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18191/api/v1/songs/remote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-plugin-token' },
      body: expect.any(String),
    });
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const [, init] = calls[0];
    expect(JSON.parse(init.body)).toEqual([
      expect.objectContaining({
        title: 'Song',
        url: 'https://audio.test/song.mp3',
        plugin_entry_path: '',
        source_data: '',
        dedup_key: '',
      }),
    ]);
  });

  it('normalizes Songloft host before posting remote songs', async () => {
    const nativeSong = { id: 101, type: 'remote', title: 'Song', artist: 'Singer' };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: vi.fn(async () => ({ songs: [nativeSong], count: 1 })),
    }) as unknown as Response);
    globalThis.fetch = fetchMock;
    (globalThis as typeof globalThis & {
      songloft: { plugin: { getHostUrl: () => Promise<string> } };
    }).songloft.plugin.getHostUrl = vi.fn(async () => 'http://127.0.0.1:18191/api/v1/jsplugin/starlight');
    const { service } = createService();

    await service.importSongs([song]);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:18191/api/v1/songs/remote', expect.any(Object));
  });

  it('throws INTERNAL_ERROR when Songloft remote import fails', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const { service } = createService();

    await expect(service.importSongs([song])).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '导入 Songloft 歌曲失败: 503',
    });
  });

  it('includes upstream response text when Songloft remote import fails', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: vi.fn(async () => '{"error":"plugin call failed"}'),
    }) as unknown as Response);
    const { service } = createService();

    await expect(service.importSongs([song])).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '导入 Songloft 歌曲失败: 500 {"error":"plugin call failed"}',
      details: {
        upstream: 'songloft_remote_import',
        status: 500,
        body: '{"error":"plugin call failed"}',
      },
    });
  });

  it('retries duplicate-conflicting remote imports one by one and treats existing songs as imported', async () => {
    const duplicateBody = '{"detail":"constraint failed: UNIQUE constraint failed: songs.plugin_entry_path, songs.dedup_key (2067)"}';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn(async () => duplicateBody),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn(async () => duplicateBody),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);
    globalThis.fetch = fetchMock;
    const { service } = createService();

    await expect(service.importSongs([song, secondSong])).resolves.toMatchObject({ total: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    expect(JSON.parse(calls[0][1].body)).toHaveLength(2);
    expect(JSON.parse(calls[1][1].body)).toHaveLength(1);
    expect(JSON.parse(calls[2][1].body)).toHaveLength(1);
  });

  it('returns an empty import result without fetching Songloft for an explicit empty song list', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    globalThis.fetch = fetchMock;
    const { service, runtimes } = createService();

    await expect(service.importSongs([])).resolves.toEqual({ total: 0, payloads: [], songs: [] });

    expect(runtimes.getMusicUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('plays resolved URLs on a MIoT speaker', async () => {
    const { service, minaService } = createService();

    await expect(service.playOnSpeaker('acc-1', 'dev-1', song)).resolves.toEqual({
      url: 'https://audio.test/song.mp3',
    });

    expect(minaService.playURL).toHaveBeenCalledWith('acc-1', 'dev-1', 'https://audio.test/song.mp3');
  });

  it('loads speaker songs into a temporary single-song playlist when a playlist manager is available', async () => {
    const { service, minaService, playlistManager, playlistManagerMap } = createService({ usePlaylistManager: true });

    await expect(service.playOnSpeaker('acc-1', 'dev-1', song)).resolves.toEqual({
      url: 'https://audio.test/song.mp3',
    });

    expect(playlistManagerMap.getOrCreate).toHaveBeenCalledWith('acc-1', 'dev-1');
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Song',
        artist: 'Singer',
        duration: 200,
        url: 'https://audio.test/song.mp3',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(minaService.playURL).not.toHaveBeenCalled();
  });

  it('loads speaker songlists into a temporary multi-song playlist when a playlist manager is available', async () => {
    const { service, minaService, playlistManager, playlistManagerMap, runtimes } = createService({ usePlaylistManager: true });

    await expect(service.playSonglistOnSpeaker('acc-1', 'dev-1', [song, secondSong])).resolves.toEqual({
      urls: ['https://audio.test/song.mp3', 'https://audio.test/song.mp3'],
    });

    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', song.source_data.songInfo, {
      operation: 'playback',
      title: 'Song',
      artist: 'Singer',
    });
    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', secondSong.source_data.songInfo, {
      operation: 'playback',
      title: 'Second Song',
      artist: 'Singer',
    });
    expect(playlistManagerMap.getOrCreate).toHaveBeenCalledWith('acc-1', 'dev-1');
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Song', url: 'https://audio.test/song.mp3' }),
      expect.objectContaining({ title: 'Second Song', url: 'https://audio.test/song.mp3' }),
    ], 0, 'order');
    expect(minaService.playURL).not.toHaveBeenCalled();
  });

  it('throws DEVICE_OFFLINE when MIoT speaker playback fails', async () => {
    const { service } = createService({ playResult: false });

    await expect(service.playOnSpeaker('acc-1', 'dev-1', song)).rejects.toMatchObject({
      code: 'DEVICE_OFFLINE',
    });
  });

  it('falls back to playback platform search when the current song URL cannot be resolved for speaker playback', async () => {
    const fallbackSong = {
      ...song,
      source_data: {
        platform: 'kg',
        quality: '320k',
        songInfo: { source: 'kg', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, hash: 'fallback' },
      },
    } satisfies SearchResultSong;
    const provider = createProvider('kg', [fallbackSong]);
    const runtimes = {
      getMusicUrl: vi.fn(async (_platform: string, _quality: string, songInfo: { musicId?: string; hash?: string }) =>
        songInfo.hash === 'fallback' ? 'https://audio.test/fallback.mp3' : null),
    } as unknown as RuntimeManager;
    const platforms = {
      all: vi.fn(() => [{ id: provider.id, name: provider.name }]),
      get: vi.fn((id: string) => id === provider.id ? provider : null),
    } as unknown as PlatformRegistry;
    const minaService = {
      playURL: vi.fn(async () => true),
    } as unknown as MinaService;
    const service = new BridgeService(platforms, runtimes, minaService);

    await expect(service.playOnSpeaker('acc-1', 'dev-1', song)).resolves.toEqual({
      url: 'https://audio.test/fallback.mp3',
    });

    expect(provider.search).toHaveBeenCalledWith('Song Singer', 1, 5);
    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', song.source_data.songInfo, {
      operation: 'playback',
      title: 'Song',
      artist: 'Singer',
    });
    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kg', '320k', fallbackSong.source_data.songInfo, {
      operation: 'playback',
      title: 'Song',
      artist: 'Singer',
    });
    expect(minaService.playURL).toHaveBeenCalledWith('acc-1', 'dev-1', 'https://audio.test/fallback.mp3');
  });

  it('tries the next resolved playback candidate when speaker playback rejects the first one', async () => {
    const rejectedSong = {
      ...song,
      source_data: {
        platform: 'kw',
        quality: '320k',
        songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, musicId: 'rejected' },
      },
    } satisfies SearchResultSong;
    const acceptedSong = {
      ...song,
      source_data: {
        platform: 'kg',
        quality: '320k',
        songInfo: { source: 'kg', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, hash: 'accepted' },
      },
    } satisfies SearchResultSong;
    const provider = createProvider('kw', [rejectedSong, acceptedSong]);
    const runtimes = {
      getMusicUrl: vi.fn(async (_platform: string, _quality: string, songInfo: { musicId?: string }) =>
        songInfo.musicId === 'rejected' ? 'https://audio.test/rejected.mp3' : 'https://audio.test/accepted.mp3'),
    } as unknown as RuntimeManager;
    const platforms = {
      all: vi.fn(() => [{ id: provider.id, name: provider.name }]),
      get: vi.fn((id: string) => id === provider.id ? provider : null),
    } as unknown as PlatformRegistry;
    const playResults = [false, true];
    const minaService = {
      playURL: vi.fn(async () => playResults.shift() ?? true),
    } as unknown as MinaService;
    const service = new BridgeService(platforms, runtimes, minaService);

    await expect(service.playResolvedOnSpeaker('acc-1', 'dev-1', 'Song', 'Singer')).resolves.toEqual({
      url: 'https://audio.test/accepted.mp3',
    });

    expect(provider.search).toHaveBeenCalledWith('Song Singer', 1, 5);
    expect(minaService.playURL).toHaveBeenNthCalledWith(1, 'acc-1', 'dev-1', 'https://audio.test/rejected.mp3');
    expect(minaService.playURL).toHaveBeenNthCalledWith(2, 'acc-1', 'dev-1', 'https://audio.test/accepted.mp3');
  });

  it('tries platforms in order and returns the first external search hit', async () => {
    const emptyProvider = createProvider('kw', []);
    const hitProvider = createProvider('kg', [song]);
    const { service } = createService({ providers: [emptyProvider, hitProvider] });

    await expect(service.externalSearch('Song')).resolves.toBe(song);

    expect(emptyProvider.search).toHaveBeenCalledWith('Song', 1, 5);
    expect(hitProvider.search).toHaveBeenCalledWith('Song', 1, 5);
  });

  it('resolves a playable search song by title and artist across providers', async () => {
    const emptyProvider = createProvider('kw', []);
    const hitProvider = createProvider('kg', [secondSong]);
    const { service, runtimes } = createService({ providers: [emptyProvider, hitProvider] });

    await expect(service.resolveSearchSong('Second Song', 'Singer')).resolves.toBe(secondSong);

    expect(emptyProvider.search).toHaveBeenCalledWith('Second Song Singer', 1, 5);
    expect(hitProvider.search).toHaveBeenCalledWith('Second Song Singer', 1, 5);
    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', secondSong.source_data.songInfo, {
      operation: 'playback',
      title: 'Second Song',
      artist: 'Singer',
    });
  });

  it('skips provider search hits whose playback URL cannot be resolved', async () => {
    const brokenSong = {
      ...song,
      title: 'Broken Song',
      source_data: {
        ...song.source_data,
        songInfo: { ...song.source_data.songInfo, musicId: 'broken' },
      },
    } satisfies SearchResultSong;
    const workingSong = {
      ...secondSong,
      title: 'Broken Song',
    } satisfies SearchResultSong;
    const runtimes = {
      getMusicUrl: vi.fn(async (_platform: string, _quality: string, songInfo: { musicId?: string }) =>
        songInfo.musicId === 'broken' ? null : 'https://audio.test/fallback.mp3'),
    } as unknown as RuntimeManager;
    const providers = [createProvider('kw', [brokenSong]), createProvider('kg', [workingSong])];
    const platforms = {
      all: vi.fn(() => providers.map((provider) => ({ id: provider.id, name: provider.name }))),
      get: vi.fn((id: string) => providers.find((provider) => provider.id === id) ?? null),
    } as unknown as PlatformRegistry;
    const service = new BridgeService(platforms, runtimes, {} as MinaService);

    await expect(service.resolvePlayableSong('Broken Song', 'Singer')).resolves.toMatchObject({
      title: 'Broken Song',
      url: 'https://audio.test/fallback.mp3',
    });
  });

  it('continues external search when one provider throws', async () => {
    const throwingProvider = createProvider('kw', []);
    throwingProvider.search = vi.fn(async () => {
      throw new Error('provider unavailable');
    });
    const hitProvider = createProvider('kg', [song]);
    const warnSpy = vi.spyOn(songloft.log, 'warn');
    const { service } = createService({ providers: [throwingProvider, hitProvider] });

    await expect(service.externalSearch('Song')).resolves.toBe(song);

    expect(throwingProvider.search).toHaveBeenCalledWith('Song', 1, 5);
    expect(hitProvider.search).toHaveBeenCalledWith('Song', 1, 5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('kw'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('provider unavailable'));
  });
});

describe('registerBridgeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRouteHarness(options: Parameters<typeof createService>[0] = {}) {
    const router = createRouter();
    const harness = createService(options);
    registerBridgeHandlers(router, harness.service);
    return { router, ...harness };
  }

  it('rejects malformed preview songs before calling the service', async () => {
    const bridge = {
      previewUrl: vi.fn(async () => 'https://audio.test/song.mp3'),
      importSongs: vi.fn(),
      playOnSpeaker: vi.fn(),
      externalSearch: vi.fn(),
    } as unknown as BridgeService;
    const router = createRouter();
    registerBridgeHandlers(router, bridge);

    const response = await router.handle(request('POST', '/api/bridge/preview-url', {
      song: { title: 'Song', source_data: { platform: '', quality: '320k', songInfo: {} } },
    }));

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).error.code).toBe('BAD_REQUEST');
    expect(bridge.previewUrl).not.toHaveBeenCalled();
  });

  it('maps preview URL resolution failures to 404', async () => {
    const { router } = createRouteHarness({ url: null });

    const response = await router.handle(request('POST', '/api/bridge/preview-url', { song }));

    expect(response.statusCode).toBe(404);
    expect(parseResponseBody(response).error).toMatchObject({
      code: 'PLAY_URL_RESOLVE_FAILED',
      retryable: true,
    });
  });

  it('maps speaker playback failures to 503', async () => {
    const { router } = createRouteHarness({ playResult: false });

    const response = await router.handle(request('POST', '/api/bridge/play-url', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      song,
    }));

    expect(response.statusCode).toBe(503);
    expect(parseResponseBody(response).error.code).toBe('DEVICE_OFFLINE');
  });

  it('routes speaker songlist playback to the queue service', async () => {
    const bridge = {
      previewUrl: vi.fn(),
      importSongs: vi.fn(),
      playOnSpeaker: vi.fn(),
      playSonglistOnSpeaker: vi.fn(async () => ({ urls: ['https://audio.test/1.mp3', 'https://audio.test/2.mp3'] })),
      externalSearch: vi.fn(),
    } as unknown as BridgeService;
    const router = createRouter();
    registerBridgeHandlers(router, bridge);

    const response = await router.handle(request('POST', '/api/bridge/play-songlist', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      songs: [song, secondSong],
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response).data).toEqual({ urls: ['https://audio.test/1.mp3', 'https://audio.test/2.mp3'] });
    expect(bridge.playSonglistOnSpeaker).toHaveBeenCalledWith('acc-1', 'dev-1', [song, secondSong]);
    expect(bridge.playOnSpeaker).not.toHaveBeenCalled();
  });

  it('rejects missing or non-array import songs without calling the service', async () => {
    const bridge = {
      previewUrl: vi.fn(),
      importSongs: vi.fn(async () => ({ total: 0, payloads: [] })),
      playOnSpeaker: vi.fn(),
      externalSearch: vi.fn(),
    } as unknown as BridgeService;
    const router = createRouter();
    registerBridgeHandlers(router, bridge);

    for (const body of [{}, { songs: null }, { songs: song }]) {
      const response = await router.handle(request('POST', '/api/bridge/songs/import', body));

      expect(response.statusCode).toBe(400);
      expect(parseResponseBody(response).error.code).toBe('BAD_REQUEST');
    }
    expect(bridge.importSongs).not.toHaveBeenCalled();
  });

  it('returns an empty import result for an explicit empty song list', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    globalThis.fetch = fetchMock;
    const { router, runtimes } = createRouteHarness();

    const response = await router.handle(request('POST', '/api/bridge/songs/import', { songs: [] }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response).data).toEqual({ total: 0, payloads: [], songs: [] });
    expect(runtimes.getMusicUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates every import song before calling the service', async () => {
    const bridge = {
      previewUrl: vi.fn(),
      importSongs: vi.fn(async () => ({ total: 1, payloads: [] })),
      playOnSpeaker: vi.fn(),
      externalSearch: vi.fn(),
    } as unknown as BridgeService;
    const router = createRouter();
    registerBridgeHandlers(router, bridge);

    const response = await router.handle(request('POST', '/api/bridge/songs/import', {
      songs: [song, { title: 'Broken', source_data: { platform: 'kw', quality: '', songInfo: {} } }],
    }));

    expect(response.statusCode).toBe(400);
    expect(parseResponseBody(response).error.code).toBe('BAD_REQUEST');
    expect(bridge.importSongs).not.toHaveBeenCalled();
  });

  it('maps upstream import failures to 502', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const { router } = createRouteHarness();

    const response = await router.handle(request('POST', '/api/bridge/songs/import', { songs: [song] }));

    expect(response.statusCode).toBe(502);
    expect(parseResponseBody(response).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      retryable: true,
    });
  });
});

describe('OnlineSearcher bridge integration', () => {
  function configManager(enabled: boolean, url = ''): ConfigManager {
    return {
      getConfig: vi.fn(async () => ({
        external_search_enabled: enabled,
        external_search_url: url,
        external_search_token: '',
      })),
    } as unknown as ConfigManager;
  }

  it('treats enabled bridge search as configured without a legacy URL', async () => {
    const bridge = {
      externalSearch: vi.fn(),
      playOnSpeaker: vi.fn(),
    } as unknown as BridgeService;
    const searcher = new OnlineSearcher(configManager(true), bridge);

    await expect(searcher.isExternalSearchConfigured()).resolves.toBe(true);
  });

  it('uses bridge search and playback instead of legacy fetch when bridge service is present', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('legacy fetch should not be called');
    });
    globalThis.fetch = fetchMock;
    const bridge = {
      externalSearch: vi.fn(async () => song),
      playOnSpeaker: vi.fn(async () => ({ url: 'https://audio.test/song.mp3' })),
    } as unknown as BridgeService;
    const searcher = new OnlineSearcher(configManager(true), bridge);

    await expect(searcher.searchAndPlay('Song', { title: 'Song' }, 'acc-1', 'dev-1', {} as MinaService)).resolves.toBe(true);

    expect(bridge.externalSearch).toHaveBeenCalledWith('Song');
    expect(bridge.playOnSpeaker).toHaveBeenCalledWith('acc-1', 'dev-1', song);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not use bridge search or playback when external search is disabled', async () => {
    const bridge = {
      externalSearch: vi.fn(async () => song),
      playOnSpeaker: vi.fn(async () => ({ url: 'https://audio.test/song.mp3' })),
    } as unknown as BridgeService;
    const searcher = new OnlineSearcher(configManager(false), bridge);

    await expect(searcher.searchAndPlay('Song', { title: 'Song' }, 'acc-1', 'dev-1', {} as MinaService)).resolves.toBe(false);

    expect(bridge.externalSearch).not.toHaveBeenCalled();
    expect(bridge.playOnSpeaker).not.toHaveBeenCalled();
  });
});
