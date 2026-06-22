import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadService } from '../../src/download/service';
import type { RuntimeManager } from '../../src/music/runtime_manager';
import type { SearchResultSong } from '../../src/music/types';

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

function createRuntime(url = 'https://download.test/song.flac') {
  return {
    getMusicUrl: vi.fn(async () => url),
  } as unknown as RuntimeManager;
}

function installRemoteImport(songId = 501) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: vi.fn(async () => ({ songs: [{ id: songId, type: 'remote', title: 'Song' }], count: 1 })),
  }) as unknown as Response);
  globalThis.fetch = fetchMock;
  return fetchMock;
}

describe('DownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('downloads a song by importing a current-plugin sourced remote song for fresh URL resolving', async () => {
    const runtime = createRuntime();
    const fetchMock = installRemoteImport(501);
    const downloadMock = vi.fn(async () => ({ path: 'downloads/Singer/Song.flac', status: 'ok' }));
    const songsApi = songloft.songs as typeof songloft.songs & { download: typeof downloadMock };
    songsApi.download = downloadMock;
    const service = new DownloadService(runtime);
    await service.saveSettings({ path_template: 'starlight/{artist}/{title}', embed_metadata: false });

    await expect(service.downloadSong(song)).resolves.toEqual({
      song_id: 501,
      path: 'downloads/Singer/Song.flac',
      status: 'ok',
    });

    expect(runtime.getMusicUrl).toHaveBeenCalledWith('kw', 'flac', song.source_data.songInfo);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const payload = JSON.parse(String(fetchCalls[0][1].body));
    const sourceData = JSON.parse(payload[0].source_data);
    expect(payload).toEqual([
      expect.objectContaining({
        title: 'Song',
        url: '',
        plugin_entry_path: 'starlight',
        dedup_key: '',
      }),
    ]);
    expect(sourceData).toEqual({
      ...song.source_data,
      starlight: { purpose: 'download' },
    });
    expect(downloadMock).toHaveBeenCalledWith(501, {
      path_template: 'starlight/{artist}/{title}',
      embed_metadata: false,
    });
  });

  it('rejects download when enabled download sources cannot resolve a URL', async () => {
    const runtime = createRuntime('');
    const service = new DownloadService(runtime);

    await expect(service.downloadSong(song)).rejects.toMatchObject({
      code: 'PLAY_URL_RESOLVE_FAILED',
    });
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
});
