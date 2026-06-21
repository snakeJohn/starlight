import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeService } from '../../src/bridge/service';
import { OnlineSearcher } from '../../src/voicecmd/online_searcher';
import type { ConfigManager } from '../../src/config/manager';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { SearchResultSong } from '../../src/music/types';
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
    songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 200, musicId: '123' },
  },
} satisfies SearchResultSong;

function createService(options: {
  url?: string | null;
  playResult?: boolean;
  providers?: MusicPlatformProvider[];
} = {}) {
  const runtimes = {
    getMusicUrl: vi.fn(async () => ('url' in options ? options.url : 'https://audio.test/song.mp3')),
  } as unknown as RuntimeManager;
  const minaService = {
    playURL: vi.fn(async () => options.playResult ?? true),
  } as unknown as MinaService;
  const providers = options.providers ?? [];
  const platforms = {
    all: vi.fn(() => providers.map((provider) => ({ id: provider.id, name: provider.name }))),
    get: vi.fn((id: string) => providers.find((provider) => provider.id === id) ?? null),
  } as unknown as PlatformRegistry;

  return {
    service: new BridgeService(platforms, runtimes, minaService),
    runtimes,
    minaService,
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

    expect(runtimes.getMusicUrl).toHaveBeenCalledWith('kw', '320k', song.source_data.songInfo);
  });

  it('throws PLAY_URL_RESOLVE_FAILED when the runtime cannot resolve a URL', async () => {
    const { service } = createService({ url: null });

    await expect(service.previewUrl(song)).rejects.toMatchObject({
      code: 'PLAY_URL_RESOLVE_FAILED',
    });
  });

  it('imports resolved remote songs into Songloft', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    globalThis.fetch = fetchMock;
    const { service } = createService();

    await expect(service.importSongs([song])).resolves.toMatchObject({ total: 1 });

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
        dedup_key: 'kw:123',
      }),
    ]);
  });

  it('throws INTERNAL_ERROR when Songloft remote import fails', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const { service } = createService();

    await expect(service.importSongs([song])).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '导入 Songloft 歌曲失败: 503',
    });
  });

  it('plays resolved URLs on a MIoT speaker', async () => {
    const { service, minaService } = createService();

    await expect(service.playOnSpeaker('acc-1', 'dev-1', song)).resolves.toEqual({
      url: 'https://audio.test/song.mp3',
    });

    expect(minaService.playURL).toHaveBeenCalledWith('acc-1', 'dev-1', 'https://audio.test/song.mp3');
  });

  it('throws DEVICE_OFFLINE when MIoT speaker playback fails', async () => {
    const { service } = createService({ playResult: false });

    await expect(service.playOnSpeaker('acc-1', 'dev-1', song)).rejects.toMatchObject({
      code: 'DEVICE_OFFLINE',
    });
  });

  it('tries platforms in order and returns the first external search hit', async () => {
    const emptyProvider = createProvider('kw', []);
    const hitProvider = createProvider('kg', [song]);
    const { service } = createService({ providers: [emptyProvider, hitProvider] });

    await expect(service.externalSearch('Song')).resolves.toBe(song);

    expect(emptyProvider.search).toHaveBeenCalledWith('Song', 1, 5);
    expect(hitProvider.search).toHaveBeenCalledWith('Song', 1, 5);
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
});
