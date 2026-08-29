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

  it('loads native playlist index entries with brief song data', async () => {
    const getSongs = vi.fn(async () => [{ id: 7, title: '晚风', artist: '伍佰' }]);
    (songloft.playlists as unknown as Record<string, unknown>).list = vi.fn(async () => [{
      id: 12, name: '夜间歌单', song_count: 1, songCount: 1, type: 'normal',
    }]);
    (songloft.playlists as unknown as Record<string, unknown>).getSongs = getSongs;
    const customPlaylists = {
      list: vi.fn(async () => []),
    } as unknown as CustomPlaylistService;
    const manager = new IndexingManager(customPlaylists);

    await manager.refresh();

    expect(getSongs).toHaveBeenCalledWith(12, { limit: 100000, brief: true });
  });

  it('loads native playlist index entries with the host playlist sort preference', async () => {
    const getSongs = vi.fn(async () => [{ id: 7, title: '晚风', artist: '伍佰' }]);
    (songloft.playlists as unknown as Record<string, unknown>).list = vi.fn(async () => [{
      id: 12, name: '夜间歌单', song_count: 1, songCount: 1, type: 'normal',
    }]);
    (songloft.playlists as unknown as Record<string, unknown>).getById = vi.fn(async () => ({
      id: 12, sort_by: 'title', sort_order: 'desc',
    }));
    (songloft.playlists as unknown as Record<string, unknown>).getSongs = getSongs;
    const customPlaylists = {
      list: vi.fn(async () => []),
    } as unknown as CustomPlaylistService;
    const manager = new IndexingManager(customPlaylists);

    await manager.refresh();

    expect(getSongs).toHaveBeenCalledWith(12, { limit: 100000, brief: true, sort: 'title', order: 'desc' });
    await expect(manager.findSongIndexInPlaylistById(12, 7)).resolves.toEqual({ index: 0, found: true });
    await expect(manager.findSongInPlaylist(12, '晚风')).resolves.toEqual({ index: 0, found: true, songId: 7 });
  });

  it('refreshes once when a playlist name is missing from the index', async () => {
    const list = vi.fn(async () => [{ id: 21, name: '新歌单', song_count: 1 }]);
    (songloft.playlists as unknown as Record<string, unknown>).list = list;
    (songloft.playlists as unknown as Record<string, unknown>).getSongs = vi.fn(async () => [
      { id: 7, title: '晚风', artist: '伍佰' },
    ]);
    const manager = new IndexingManager();

    await expect(manager.findPlaylistByNameWithRefresh('新歌单')).resolves.toMatchObject({ id: 21, name: '新歌单' });
    expect(list).toHaveBeenCalledTimes(1);

    // 同一冷却窗口内的再次 miss 不应反复重建索引。
    await expect(manager.findPlaylistByNameWithRefresh('不存在')).resolves.toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('refreshes once when a playlist id is missing from the index', async () => {
    const list = vi.fn(async () => [{ id: 31, name: '按 ID 歌单', song_count: 0 }]);
    (songloft.playlists as unknown as Record<string, unknown>).list = list;
    const manager = new IndexingManager();

    await expect(manager.getPlaylistByIdWithRefresh(31)).resolves.toMatchObject({ id: 31, name: '按 ID 歌单' });
    expect(list).toHaveBeenCalledTimes(1);
  });
});
