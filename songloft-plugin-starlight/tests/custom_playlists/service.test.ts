import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomPlaylistService } from '../../src/custom_playlists/service';
import { CustomPlaylistStore } from '../../src/custom_playlists/store';
import type { BridgeService } from '../../src/bridge/service';
import type { SearchResultSong } from '../../src/music/types';

const kwSong = {
  title: '稻花香',
  artist: '周杰伦',
  album: '魔杰座',
  duration: 223,
  cover_url: 'https://img.test/daohuaxiang.jpg',
  source_data: {
    platform: 'kw',
    quality: '320k',
    songInfo: {
      source: 'kw',
      name: '稻花香',
      singer: '周杰伦',
      album: '魔杰座',
      duration: 223,
      musicId: 'kw-1',
    },
  },
} satisfies SearchResultSong;

const kgSong = {
  title: '为龙',
  artist: '河图',
  album: '为龙',
  duration: 260,
  cover_url: 'https://img.test/weilong.jpg',
  source_data: {
    platform: 'kg',
    quality: '320k',
    songInfo: {
      source: 'kg',
      name: '为龙',
      singer: '河图',
      album: '为龙',
      duration: 260,
      hash: 'kg-hash-1',
    },
  },
} satisfies SearchResultSong;

function createService() {
  const bridge = {
    importSongs: vi.fn(async (songs: SearchResultSong[]) => ({
      total: songs.length,
      payloads: songs.map((song) => ({ title: song.title, source_data: JSON.stringify(song.source_data) })),
    })),
  } as unknown as BridgeService;

  return {
    bridge,
    service: new CustomPlaylistService(new CustomPlaylistStore(), bridge),
  };
}

describe('CustomPlaylistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an existing playlist when creating the same name twice', async () => {
    const { service } = createService();

    const first = await service.create('古风');
    const second = await service.create(' 古风 ');

    expect(second.id).toBe(first.id);
    await expect(service.list()).resolves.toHaveLength(1);
  });

  it('stores source name and full LX source_data when adding a song', async () => {
    const { bridge, service } = createService();

    const playlist = await service.addSong('我的收藏', kwSong);

    expect(playlist.songs).toHaveLength(1);
    expect(playlist.songs[0]).toMatchObject({
      title: '稻花香',
      artist: '周杰伦',
      source_name: '酷我',
    });
    expect(playlist.songs[0]?.source_data).toEqual(kwSong.source_data);
    expect(bridge.importSongs).toHaveBeenCalledWith([kwSong]);
  });

  it('dedupes songs by platform and stable provider song id', async () => {
    const { service } = createService();

    await service.addSong('我的收藏', kwSong);
    const playlist = await service.addSong('我的收藏', { ...kwSong, cover_url: 'https://img.test/another.jpg' });

    expect(playlist.songs).toHaveLength(1);
  });

  it('still persists through fallback storage when native playlist writes fail', async () => {
    (songloft.playlists as Record<string, unknown>).create = vi.fn(async () => {
      throw new Error('native create failed');
    });
    (songloft.playlists as Record<string, unknown>).addSongs = vi.fn(async () => {
      throw new Error('native add failed');
    });
    const { service } = createService();

    const playlist = await service.addSong('失败也保存', kgSong);

    expect(playlist.songs).toHaveLength(1);
    await expect(service.list()).resolves.toEqual([playlist]);
  });

  it('imports network playlists with source metadata and full song source_data', async () => {
    const { service } = createService();

    const imported = await service.importNetworkPlaylist({
      source: 'kg',
      sourceListId: 'kg_8888',
      detail: {
        name: '酷狗热歌',
        cover_url: 'https://img.test/list.jpg',
        songs: [kgSong],
        total: 1,
      },
    });

    expect(imported).toMatchObject({
      name: '酷狗热歌',
      cover_url: 'https://img.test/list.jpg',
      source: 'kg',
      source_name: '酷狗',
      sourceListId: 'kg_8888',
    });
    expect(imported.songs[0]?.source_data).toEqual(kgSong.source_data);
  });

  it('returns the existing playlist when importing the same source and upstream id twice', async () => {
    const { service } = createService();

    const first = await service.importNetworkPlaylist({
      source: 'kw',
      sourceListId: '3360244412',
      detail: { name: '酷我歌单', cover_url: '', songs: [kwSong], total: 1 },
    });
    const second = await service.importNetworkPlaylist({
      source: 'kw',
      sourceListId: '3360244412',
      detail: { name: '新名字', cover_url: '', songs: [kgSong], total: 1 },
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('酷我歌单');
    await expect(service.list()).resolves.toHaveLength(1);
  });

  it('refreshes imported playlists and rolls back when the detail loader fails', async () => {
    const { service } = createService();
    const imported = await service.importNetworkPlaylist({
      source: 'kw',
      sourceListId: '3360244412',
      detail: { name: '旧歌单', cover_url: '', songs: [kwSong], total: 1 },
    });

    const refreshed = await service.refreshNetworkPlaylist(imported.id, vi.fn(async () => ({
      name: '新歌单',
      cover_url: 'https://img.test/new.jpg',
      songs: [kgSong],
      total: 1,
    })));

    expect(refreshed.name).toBe('新歌单');
    expect(refreshed.songs.map((song) => song.title)).toEqual(['为龙']);

    await expect(service.refreshNetworkPlaylist(imported.id, async () => {
      throw new Error('upstream down');
    })).rejects.toThrow('upstream down');
    const afterFailure = (await service.list()).find((playlist) => playlist.id === imported.id);
    expect(afterFailure?.songs.map((song) => song.title)).toEqual(['为龙']);
  });
});
