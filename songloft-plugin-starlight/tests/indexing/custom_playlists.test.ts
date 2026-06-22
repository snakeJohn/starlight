import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexingManager } from '../../src/indexing/manager';
import type { CustomPlaylistService } from '../../src/custom_playlists/service';
import type { CustomPlaylist } from '../../src/custom_playlists/types';

const customPlaylist = {
  id: 'custom_1',
  name: '古风',
  cover_url: '',
  imported_at: '2026-06-22T00:00:00.000Z',
  updated_at: '2026-06-22T00:00:00.000Z',
  songs: [
    {
      title: '为龙',
      artist: '河图',
      album: '为龙',
      duration: 260,
      cover_url: '',
      source_name: '酷狗',
      stable_key: 'kg:hash-1',
      source_data: {
        platform: 'kg',
        quality: '320k',
        songInfo: { source: 'kg', name: '为龙', singer: '河图', album: '为龙', duration: 260, hash: 'hash-1' },
      },
    },
  ],
} satisfies CustomPlaylist;

describe('IndexingManager custom playlist fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    songloft.playlists.list = vi.fn(async () => []);
    songloft.playlists.getSongs = vi.fn(async () => []);
    songloft.songs.list = vi.fn(async () => []);
  });

  it('indexes fallback custom playlists and their songs', async () => {
    const customPlaylists = {
      list: vi.fn(async () => [customPlaylist]),
    } as unknown as CustomPlaylistService;
    const manager = new IndexingManager(customPlaylists);

    await expect(manager.refresh()).resolves.toMatchObject({
      success: true,
      playlistCount: 1,
      songCount: 1,
    });

    expect(manager.findPlaylistByName('古风')).toMatchObject({
      name: '古风',
      songCount: 1,
    });
    await expect(manager.findSongByName('为龙')).resolves.toMatchObject({
      playlistName: '古风',
      songIndex: 0,
      songTitle: '为龙',
      artist: '河图',
    });
  });
});
