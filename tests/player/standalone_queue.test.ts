import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import { sourceDiagnostics } from '../../src/diagnostics/source_logs';
import { setHostBaseUrl } from '../../src/utils/http';

const song: PlayerSong = {
  id: 0,
  type: 'remote',
  title: '单曲',
  artist: '歌手',
  album: '',
  duration: 0,
  file_path: '',
  url: 'https://audio.test/song.mp3',
  cover_path: '',
  cover_url: '',
  lyric_url: '',
  file_size: 0,
  format: 'mp3',
  bit_rate: 0,
  sample_rate: 0,
  is_live: false,
  cache_hash: '',
};

function createManager(options: {
  dynamicPlaylistLoader?: (playlistId: number) => Promise<PlayerSong[] | null>;
  dynamicSongResolver?: (song: PlayerSong) => Promise<PlayerSong | null>;
  serverHost?: string;
} = {}) {
  const minaService = {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const configManager = {
    getConfig: vi.fn(async () => ({ force_mp3: false, server_host: options.serverHost ?? 'http://songloft.test:18191' })),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;
  const manager = new PlaylistManager('acc-1', 'dev-1', minaService, configManager, options);
  return { manager, minaService };
}

describe('PlaylistManager standalone queue', () => {
  beforeEach(() => {
    sourceDiagnostics.clear();
    setHostBaseUrl('');
  });

  it('records speaker playback diagnostics when an external URL is accepted by the speaker API', async () => {
    const { manager } = createManager();

    await expect(manager.playStandalone([song], 0, 'single')).resolves.toBe(true);

    expect(sourceDiagnostics.list({ operation: 'playback' })).toContainEqual(expect.objectContaining({
      stage: 'speaker-play',
      status: 'success',
      sourceName: '小爱音箱',
      title: '单曲',
      artist: '歌手',
      message: expect.stringContaining('音箱接口已接受'),
    }));
  });

  it('requires a configured Songloft access host before sending relative playback URLs to the speaker', async () => {
    const localSong = {
      ...song,
      id: 42,
      type: 'remote',
      url: '/api/v1/songs/42/play',
    };
    const { manager, minaService } = createManager({ serverHost: '' });

    await expect(manager.playStandalone([localSong], 0, 'single')).resolves.toBe(false);

    expect(minaService.playURL).not.toHaveBeenCalled();
    expect(sourceDiagnostics.list({ operation: 'playback' })).toContainEqual(expect.objectContaining({
      stage: 'speaker-play',
      status: 'failed',
      sourceName: '小爱音箱',
      title: '单曲',
      message: expect.stringContaining('Songloft 访问地址未配置'),
    }));
  });

  it('plays a single temporary song queue and keeps previous/next available', async () => {
    const { manager, minaService } = createManager();

    await expect(manager.playStandalone([song], 0, 'single')).resolves.toBe(true);
    await expect(manager.previous()).resolves.toBe(true);
    await expect(manager.next()).resolves.toBe(true);

    expect(minaService.playURL).toHaveBeenCalledTimes(3);
    expect(minaService.playURL).toHaveBeenCalledWith('acc-1', 'dev-1', 'https://audio.test/song.mp3');
    expect(manager.hasPlaylist()).toBe(true);
    expect(manager.getStatus()).toMatchObject({
      state: 'playing',
      play_mode: 'single',
      playlist_id: 0,
      current_index: 0,
      can_seek: false,
      seek_strategy: 'unsupported',
    });
  });

  it('does not simulate seek by replaying the current URL and shifting local position', async () => {
    const seekableSong = { ...song, duration: 180 };
    const { manager, minaService } = createManager();

    await expect(manager.playStandalone([seekableSong], 0, 'single')).resolves.toBe(true);

    expect(minaService.playURL).toHaveBeenCalledTimes(1);

    await expect(manager.seekToPosition(60)).resolves.toBe(false);

    expect(minaService.playURL).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toMatchObject({
      state: 'playing',
      can_seek: false,
      seek_strategy: 'unsupported',
    });
    expect(manager.getStatus().position).toBeLessThan(5);
  });

  it('does not automatically replay one-off standalone songs when auto advance is disabled', async () => {
    vi.useFakeTimers();
    const shortSong = { ...song, duration: 4 };
    const { manager, minaService } = createManager();

    try {
      await expect(manager.playStandalone([shortSong], 0, 'single', { autoAdvance: false })).resolves.toBe(true);

      expect(minaService.playURL).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000);

      expect(minaService.playURL).toHaveBeenCalledTimes(1);
      expect(manager.getStatus()).toMatchObject({
        state: 'playing',
        play_mode: 'single',
        current_index: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads synthetic custom playlists and resolves dynamic song URLs at playback time', async () => {
    const dynamicSong = { ...song, id: -100000000, type: 'dynamic', title: '为龙', artist: '河图', url: '' };
    const dynamicPlaylistLoader = vi.fn(async () => [dynamicSong]);
    const dynamicSongResolver = vi.fn(async (item: PlayerSong) => ({
      ...item,
      url: 'https://audio.test/weilong.mp3',
    }));
    const { manager, minaService } = createManager({ dynamicPlaylistLoader, dynamicSongResolver });

    await expect(manager.play(-100000, 0, 'order')).resolves.toBe(true);

    expect(dynamicPlaylistLoader).toHaveBeenCalledWith(-100000);
    expect(dynamicSongResolver).toHaveBeenCalledWith(expect.objectContaining({ title: '为龙', artist: '河图' }));
    expect(minaService.playURL).toHaveBeenCalledWith('acc-1', 'dev-1', 'https://audio.test/weilong.mp3');
    expect(manager.getStatus()).toMatchObject({
      playlist_id: -100000,
      current_index: 0,
      current_song: expect.objectContaining({ title: '为龙', artist: '河图' }),
    });
  });

  it('loads Songloft playlist wrapper results and keeps native playlist controls available', async () => {
    const songloft = (globalThis as typeof globalThis & { songloft: any }).songloft;
    songloft.playlists.getSongs = vi.fn(async () => ({
      list: [
        { id: 3011, type: 'remote', title: '第一首', artist: '歌手', duration: 180, url: 'https://audio.test/first.mp3' },
        { id: 3012, type: 'remote', title: '第二首', artist: '歌手', duration: 181, url: 'https://audio.test/second.mp3' },
      ],
      total: 2,
    }));
    const { manager, minaService } = createManager();

    await expect(manager.play(301, 0, 'loop')).resolves.toBe(true);
    await expect(manager.next()).resolves.toBe(true);
    await expect(manager.previous()).resolves.toBe(true);

    expect(songloft.playlists.getSongs).toHaveBeenCalledWith(301, { limit: 100000 });
    expect(minaService.playURL).toHaveBeenNthCalledWith(1, 'acc-1', 'dev-1', 'https://audio.test/first.mp3');
    expect(minaService.playURL).toHaveBeenNthCalledWith(2, 'acc-1', 'dev-1', 'https://audio.test/second.mp3');
    expect(manager.getStatus()).toMatchObject({
      playlist_id: 301,
      current_index: 0,
      current_song: expect.objectContaining({ title: '第一首' }),
    });
  });

  it('skips unresolved dynamic playlist songs and plays the next available song', async () => {
    const brokenSong = { ...song, id: -100000000, type: 'dynamic', title: '失效歌曲', artist: '歌手', url: '' };
    const workingSong = { ...song, id: -100000001, type: 'dynamic', title: '可播歌曲', artist: '歌手', url: '' };
    const dynamicPlaylistLoader = vi.fn(async () => [brokenSong, workingSong]);
    const dynamicSongResolver = vi.fn(async (item: PlayerSong) =>
      item.title === '可播歌曲' ? { ...item, url: 'https://audio.test/working.mp3' } : null);
    const { manager, minaService } = createManager({ dynamicPlaylistLoader, dynamicSongResolver });

    await expect(manager.play(-100000, 0, 'order')).resolves.toBe(true);

    expect(dynamicSongResolver).toHaveBeenCalledTimes(2);
    expect(minaService.playURL).toHaveBeenCalledWith('acc-1', 'dev-1', 'https://audio.test/working.mp3');
    expect(manager.getStatus()).toMatchObject({
      current_index: 1,
      current_song: expect.objectContaining({ title: '可播歌曲' }),
    });
  });
});
