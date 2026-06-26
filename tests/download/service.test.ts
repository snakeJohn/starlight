import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadService } from '../../src/download/service';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import { RuntimeManager as MusicRuntimeManager } from '../../src/music/runtime_manager';
import type { SourceRuntime } from '../../src/music/runtime';
import type { SourceManager } from '../../src/music/source_manager';
import type { SearchResultSong } from '../../src/music/types';
import { sourceDiagnostics } from '../../src/diagnostics/source_logs';

const song = {
  title: 'Song',
  artist: 'Singer',
  album: 'Album',
  duration: 180,
  cover_url: 'https://img.test/song.jpg',
  source_data: {
    platform: 'kw',
    quality: 'flac',
    songInfo: { source: 'kw', name: 'Song', singer: 'Singer', album: 'Album', duration: 180, musicId: '123' },
  },
} satisfies SearchResultSong;

const fallbackSong = {
  ...song,
  source_data: {
    platform: 'kg',
    quality: 'flac',
    songInfo: { source: 'kg', name: 'Song', singer: 'Singer', album: 'Album', duration: 180, hash: 'fallback' },
  },
} satisfies SearchResultSong;

const secondSong = {
  ...song,
  title: 'Second Song',
  source_data: {
    ...song.source_data,
    songInfo: { ...song.source_data.songInfo, name: 'Second Song', musicId: '456' },
  },
} satisfies SearchResultSong;

function createRuntime(url = 'https://download.test/song.flac') {
  return {
    getMusicUrl: vi.fn(async () => url),
  } as unknown as RuntimeManager;
}

function installRemoteImport(songId = 501) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (isDownloadProbeRequest(input)) {
      return audioProbeResponse();
    }

    return {
      ok: true,
      status: 201,
      json: vi.fn(async () => ({ songs: [{ id: songId, type: 'remote', title: 'Song' }], count: 1 })),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function installRemoteImports(songIds: number[]) {
  let index = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (isDownloadProbeRequest(input)) {
      return audioProbeResponse();
    }

    const songId = songIds[Math.min(index, songIds.length - 1)];
    index += 1;
    return {
      ok: true,
      status: 201,
      json: vi.fn(async () => ({ songs: [{ id: songId, type: 'remote', title: 'Song' }], count: 1 })),
    } as unknown as Response;
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function isDownloadProbeRequest(input: RequestInfo | URL): boolean {
  return String(input).startsWith('https://download.test/');
}

function audioProbeResponse(): Response {
  return {
    ok: true,
    status: 206,
    headers: { get: () => 'audio/flac' },
  } as unknown as Response;
}

function createProvider(id: MusicPlatformProvider['id'], search: MusicPlatformProvider['search']): MusicPlatformProvider {
  return {
    id,
    name: id,
    search,
    songListSearch: vi.fn(),
    songListDetail: vi.fn(),
    recommendedSongLists: vi.fn(),
    leaderboardBoards: vi.fn(),
    leaderboardList: vi.fn(),
  } as unknown as MusicPlatformProvider;
}

function createPlatforms(providers: MusicPlatformProvider[]): PlatformRegistry {
  return {
    all: vi.fn(() => providers.map((provider) => ({ id: provider.id, name: provider.name }))),
    get: vi.fn((id: string) => providers.find((provider) => provider.id === id) ?? null),
  } as unknown as PlatformRegistry;
}

function emptySourceManager(): SourceManager {
  return {
    listSources: () => [],
    getScript: vi.fn(async () => null),
  } as unknown as SourceManager;
}

describe('DownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceDiagnostics.clear();
  });

  it('loads and saves download settings with downloader defaults', async () => {
    const service = new DownloadService(createRuntime());

    await expect(service.getSettings()).resolves.toEqual({
      path_template: 'downloads/{artist}-{album}/{title}',
      embed_metadata: true,
      download_interval: 0,
    });

    await service.saveSettings({ path_template: 'starlight/{artist}/{title}', embed_metadata: false, download_interval: 2 });

    await expect(service.getSettings()).resolves.toEqual({
      path_template: 'starlight/{artist}/{title}',
      embed_metadata: false,
      download_interval: 2,
    });
  });

  it('downloads a song by importing the already resolved download URL without resolving again', async () => {
    const runtime = createRuntime();
    const provider = createProvider('kg', vi.fn(async () => ({ list: [fallbackSong], total: 1 })));
    const fetchMock = installRemoteImport(501);
    const downloadMock = vi.fn(async () => ({ path: 'downloads/Singer/Song.flac', status: 'ok' }));
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(runtime, createPlatforms([provider]));
    await service.saveSettings({ path_template: 'starlight/{artist}/{title}', embed_metadata: false });

    await expect(service.downloadSong(song)).resolves.toEqual({
      song_id: 501,
      path: 'downloads/Singer/Song.flac',
      status: 'ok',
    });

    expect(runtime.getMusicUrl).toHaveBeenCalledWith('kw', 'flac', song.source_data.songInfo, {
      operation: 'download',
      title: 'Song',
      artist: 'Singer',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const payload = JSON.parse(String(fetchCalls[0][1].body));
    expect(payload).toEqual([
      expect.objectContaining({
        title: 'Song',
        duration: 0,
        url: 'https://download.test/song.flac',
        plugin_entry_path: '',
        source_data: '',
        dedup_key: '',
      }),
    ]);
    expect(downloadMock).toHaveBeenCalledWith(501, {
      path_template: 'starlight/{artist}/{title}',
      embed_metadata: false,
    });
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('rejects download when enabled download sources cannot resolve a URL', async () => {
    const runtime = createRuntime('');
    const service = new DownloadService(runtime, createPlatforms([]));

    await expect(service.downloadSong(song)).rejects.toMatchObject({
      code: 'PLAY_URL_RESOLVE_FAILED',
    });
  });

  it('falls back to download platform candidates when the current download source cannot resolve a URL', async () => {
    const runtime = {
      getMusicUrl: vi.fn(async (_platform: string, _quality: string, songInfo: { hash?: string }) =>
        songInfo.hash === 'fallback' ? 'https://download.test/fallback.flac' : null),
    } as unknown as RuntimeManager;
    const provider = createProvider('kg', vi.fn(async () => ({ list: [fallbackSong], total: 1 })));
    const fetchMock = installRemoteImport(701);
    const downloadMock = vi.fn(async () => ({ path: 'downloads/fallback.flac', status: 'ok' }));
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(runtime, createPlatforms([provider]));

    await expect(service.downloadSong(song)).resolves.toEqual({
      song_id: 701,
      path: 'downloads/fallback.flac',
      status: 'ok',
    });

    expect(provider.search).toHaveBeenCalledWith('Song Singer', 1, 5);
    expect(runtime.getMusicUrl).toHaveBeenCalledWith('kw', 'flac', song.source_data.songInfo, {
      operation: 'download',
      title: 'Song',
      artist: 'Singer',
    });
    expect(runtime.getMusicUrl).toHaveBeenCalledWith('kg', 'flac', fallbackSong.source_data.songInfo, {
      operation: 'download',
      title: 'Song',
      artist: 'Singer',
    });
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const payload = JSON.parse(String(fetchCalls[0][1].body));
    expect(payload).toEqual([
      expect.objectContaining({
        title: 'Song',
        url: 'https://download.test/fallback.flac',
        plugin_entry_path: '',
        source_data: '',
      }),
    ]);
  });

  it('retries enabled download sources without using playback runtimes when one download source throws', async () => {
    const downloadRuntimes = new MusicRuntimeManager(emptySourceManager());
    const throwingDownloadSource = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => {
        throw new Error('download resolver exploded');
      }),
      destroy: vi.fn(),
    };
    const workingDownloadSource = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => 'https://download.test/working.flac'),
      destroy: vi.fn(),
    };
    (downloadRuntimes as unknown as { runtimes: SourceRuntime[] }).runtimes = [
      throwingDownloadSource as unknown as SourceRuntime,
      workingDownloadSource as unknown as SourceRuntime,
    ];
    const playbackRuntimes = {
      getMusicUrl: vi.fn(async () => {
        throw new Error('playback runtime should not be used');
      }),
    };
    const fetchMock = installRemoteImport(1001);
    const downloadMock = vi.fn(async () => ({ path: 'downloads/working.flac', status: 'ok' }));
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(downloadRuntimes, createPlatforms([]));

    await expect(service.downloadSong(song)).resolves.toEqual({
      song_id: 1001,
      path: 'downloads/working.flac',
      status: 'ok',
    });

    expect(throwingDownloadSource.getMusicUrl).toHaveBeenCalledWith('kw', 'flac', expect.objectContaining({
      ...song.source_data.songInfo,
      songmid: '123',
    }));
    expect(workingDownloadSource.getMusicUrl).toHaveBeenCalledWith('kw', 'flac', expect.objectContaining({
      ...song.source_data.songInfo,
      songmid: '123',
    }));
    expect(playbackRuntimes.getMusicUrl).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://download.test/working.flac');
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  it('reports attempted download source count and the last source failure when no download source resolves', async () => {
    const downloadRuntimes = new MusicRuntimeManager(emptySourceManager());
    const throwingDownloadSource = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => {
        throw new Error('first source failed');
      }),
      destroy: vi.fn(),
    };
    const emptyDownloadSource = {
      supportsPlatform: vi.fn(() => true),
      getMusicUrl: vi.fn(async () => null),
      destroy: vi.fn(),
    };
    (downloadRuntimes as unknown as { runtimes: SourceRuntime[] }).runtimes = [
      throwingDownloadSource as unknown as SourceRuntime,
      emptyDownloadSource as unknown as SourceRuntime,
    ];
    const service = new DownloadService(downloadRuntimes, createPlatforms([]));

    await expect(service.downloadSong(song)).rejects.toMatchObject({
      message: expect.stringMatching(/已尝试 2 个下载音源.*最后失败原因：音源未返回 URL/),
      details: {
        attempts: 2,
        lastFailure: '音源未返回 URL',
      },
    });
  });

  it('tries another download candidate when the Songloft download call fails for the current source', async () => {
    const runtime = {
      getMusicUrl: vi.fn(async () => 'https://download.test/candidate.flac'),
    } as unknown as RuntimeManager;
    const provider = createProvider('kg', vi.fn(async () => ({ list: [fallbackSong], total: 1 })));
    installRemoteImports([801, 802]);
    const downloadMock = vi.fn()
      .mockRejectedValueOnce(new Error('native download failed'))
      .mockResolvedValueOnce({ path: 'downloads/retried.flac', status: 'ok' });
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(runtime, createPlatforms([provider]));

    await expect(service.downloadSong(song)).resolves.toEqual({
      song_id: 802,
      path: 'downloads/retried.flac',
      status: 'ok',
    });

    expect(provider.search).toHaveBeenCalledWith('Song Singer', 1, 5);
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });

  it('records Songloft native download failures separately from URL source failures', async () => {
    const runtime = createRuntime('https://download.test/song.flac');
    installRemoteImport(811);
    const downloadMock = vi.fn(async () => {
      throw new Error('handleSongs: download: acquire audio: http status 410');
    });
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(runtime, createPlatforms([]));

    await expect(service.downloadSong(song)).rejects.toMatchObject({
      message: expect.stringContaining('http status 410'),
    });

    expect(sourceDiagnostics.list()).toContainEqual(expect.objectContaining({
      operation: 'download',
      stage: 'native-download',
      status: 'failed',
      platform: 'kw',
      quality: 'flac',
      title: 'Song',
      artist: 'Singer',
      message: 'handleSongs: download: acquire audio: http status 410',
    }));
  });

  it('tracks batch progress and keeps processing after item failures', async () => {
    installRemoteImport(601);
    let calls = 0;
    const batchDownloadMock = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('download failed');
      return { path: `downloads/${calls}.flac`, status: 'ok' };
    });
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof batchDownloadMock };
    songsApi.download = batchDownloadMock;
    const service = new DownloadService(createRuntime());

    await expect(service.startBatch([song, { ...song, title: 'Second Song' }])).resolves.toEqual({ started: true, total: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.getBatchProgress()).toMatchObject({
      active: true,
      current: 2,
      total: 2,
      done: true,
      success: 1,
      failed: 1,
    });
  });

  it('records the last failed candidate reason for a batch item and continues with the next song', async () => {
    installRemoteImport(901);
    const runtime = {
      getMusicUrl: vi.fn(async (_platform: string, _quality: string, songInfo: { musicId?: string; hash?: string }) =>
        songInfo.musicId === '456' ? 'https://download.test/second.flac' : null),
    } as unknown as RuntimeManager;
    const provider = createProvider('kg', vi.fn(async (keyword: string) => ({
      list: keyword.includes('Song') && !keyword.includes('Second') ? [fallbackSong] : [],
      total: keyword.includes('Song') && !keyword.includes('Second') ? 1 : 0,
    })));
    const downloadMock = vi.fn(async () => ({ path: 'downloads/second.flac', status: 'ok' }));
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(runtime, createPlatforms([provider]));

    await expect(service.startBatch([song, secondSong])).resolves.toEqual({ started: true, total: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const progress = service.getBatchProgress();
    expect(progress).toMatchObject({
      active: true,
      current: 2,
      total: 2,
      done: true,
      success: 1,
      failed: 1,
    });
    expect(progress.results[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('最后失败原因'),
    });
    expect(progress.results[0].error).toContain('未找到可用下载源');
    expect(progress.results[1]).toMatchObject({
      song_id: 901,
      status: 'ok',
    });
  });
});
