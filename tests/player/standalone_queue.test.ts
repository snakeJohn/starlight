import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import { sourceDiagnostics } from '../../src/diagnostics/source_logs';

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
} = {}) {
  const minaService = {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const configManager = {
    getConfig: vi.fn(async () => ({ force_mp3: false, server_host: '' })),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;
  const manager = new PlaylistManager('acc-1', 'dev-1', minaService, configManager, options);
  return { manager, minaService };
}

describe('PlaylistManager standalone queue', () => {
  beforeEach(() => {
    sourceDiagnostics.clear();
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

  it('rejects loopback Songloft playback URLs before sending them to the speaker', async () => {
    const localSong = {
      ...song,
      id: 42,
      type: 'remote',
      url: '/api/v1/songs/42/play',
    };
    const { manager, minaService } = createManager();

    await expect(manager.playStandalone([localSong], 0, 'single')).resolves.toBe(false);

    expect(minaService.playURL).not.toHaveBeenCalled();
    expect(sourceDiagnostics.list({ operation: 'playback' })).toContainEqual(expect.objectContaining({
      stage: 'speaker-play',
      status: 'failed',
      sourceName: '小爱音箱',
      title: '单曲',
      message: expect.stringContaining('本地回环地址'),
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
    });
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
