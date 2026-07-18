import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomPlaylistStore } from '../../src/custom_playlists/store';
import { LxSyncService } from '../../src/lx_sync/service';
import { LX_SYNC_CONFIG_KEY } from '../../src/lx_sync/types';

const sampleList = {
  defaultList: [
    {
      id: 'd1',
      name: '默认曲',
      singer: '歌手A',
      source: 'wy',
      interval: '02:00',
      meta: { songId: 'wy-1', albumName: '专', picUrl: '' },
    },
  ],
  loveList: [
    {
      id: 'l1',
      name: '喜欢曲',
      singer: '歌手B',
      source: 'kw',
      interval: '03:00',
      meta: { songId: 'kw-9', albumName: '专2', picUrl: 'https://img/x.jpg' },
    },
  ],
  userList: [
    {
      id: 'ul1',
      name: '古风精选',
      list: [
        {
          id: 'u-song-1',
          name: '为龙',
          singer: '河图',
          source: 'kg',
          interval: '04:00',
          meta: { hash: 'h1', songId: 's1' },
        },
      ],
    },
  ],
};

describe('LxSyncService (local JSON import/export)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns public config without server credentials', async () => {
    const service = new LxSyncService();
    const config = await service.getConfig();
    expect(config).toEqual({
      importDefaultList: true,
      conflict: 'replace',
    });
    expect(config).not.toHaveProperty('token');
    expect(config).not.toHaveProperty('baseUrl');
    expect(config).not.toHaveProperty('password');
  });

  it('previews list JSON without writing', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    const preview = await service.preview(sampleList);
    expect(preview.playlists).toHaveLength(3);
    expect(preview.totalSongs).toBe(3);
    expect(await store.loadAll()).toEqual([]);
  });

  it('imports list JSON into custom playlists by sourceListId', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });

    const first = await service.importList(sampleList);
    expect(first.playlistsCreated).toBe(3);
    expect(first.songsImported).toBe(3);

    let playlists = await store.loadAll();
    expect(playlists.map((p) => p.name).sort()).toEqual(['古风精选', '我喜欢', '默认列表'].sort());
    const love = playlists.find((p) => p.name === '我喜欢');
    expect(love?.sourceListId).toBe('lx:love');
    expect(love?.native_playlist_id).toBeUndefined();
    expect(love?.songs[0]?.source_data?.platform).toBe('kw');

    const second = await service.importList(sampleList);
    expect(second.playlistsCreated).toBe(0);
    expect(second.playlistsUpdated).toBe(3);
    playlists = await store.loadAll();
    expect(playlists).toHaveLength(3);
  });

  it('exports custom playlists as LX ListData', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    await service.importList(sampleList);
    const { listData, lastExportAt } = await service.exportList();
    expect(lastExportAt).toBeTruthy();
    expect(listData.loveList.length).toBe(1);
    expect(listData.userList.some((u) => u.name === '古风精选')).toBe(true);
  });

  it('rejects invalid payload', async () => {
    const service = new LxSyncService();
    await expect(service.importList({ foo: 1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('importToSongloft delegates to custom playlist service', async () => {
    const syncToSongloftPlaylist = vi.fn(async (id: string) => ({
      playlist: { id, name: 'x', cover_url: '', imported_at: '', updated_at: '', songs: [] },
      total: 2,
      skipped: 1,
      errors: [{ title: 'a', message: 'fail' }],
    }));
    const service = new LxSyncService({
      customPlaylists: { syncToSongloftPlaylist },
    });
    const result = await service.importToSongloft(['p1']);
    expect(syncToSongloftPlaylist).toHaveBeenCalledWith('p1');
    expect(result.results[0].total).toBe(2);
  });

  it('persists only local preferences', async () => {
    const service = new LxSyncService();
    await service.updateConfig({ conflict: 'merge', importDefaultList: false });
    const raw = JSON.parse(String(await songloft.storage.get(LX_SYNC_CONFIG_KEY)));
    expect(raw).toEqual({ conflict: 'merge', importDefaultList: false });
    expect(raw.token).toBeUndefined();
    expect(raw.baseUrl).toBeUndefined();
  });
});
