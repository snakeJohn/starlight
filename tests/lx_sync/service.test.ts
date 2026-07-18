import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomPlaylistStore } from '../../src/custom_playlists/store';
import { LxSyncService } from '../../src/lx_sync/service';
import { LX_SYNC_CONFIG_KEY } from '../../src/lx_sync/types';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

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

describe('LxSyncService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns public config without token and never stores password', async () => {
    const service = new LxSyncService();
    const config = await service.getConfig();
    expect(config).toEqual({
      baseUrl: '',
      username: '',
      connected: false,
      importDefaultList: true,
      conflict: 'replace',
    });
    expect(config).not.toHaveProperty('token');
    expect(config).not.toHaveProperty('password');

    const stored = await songloft.storage.get(LX_SYNC_CONFIG_KEY);
    expect(stored).toBeNull();
  });

  it('connects, stores token, and exposes connected config', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/user/login')) {
        return jsonResponse({ success: true, token: 'secret-token' });
      }
      throw new Error(`unexpected ${url}`);
    });

    const service = new LxSyncService({ fetchImpl: fetchMock as unknown as typeof fetch });
    const config = await service.connect({
      baseUrl: 'http://lx.test/',
      username: 'bob',
      password: 'hunter2',
    });

    expect(config).toMatchObject({
      baseUrl: 'http://lx.test',
      username: 'bob',
      connected: true,
    });
    expect(config).not.toHaveProperty('token');
    expect(config).not.toHaveProperty('password');

    const raw = await songloft.storage.get(LX_SYNC_CONFIG_KEY);
    const parsed = JSON.parse(String(raw));
    expect(parsed.token).toBe('secret-token');
    expect(parsed.password).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('hunter2');
  });

  it('rejects password on updateConfig path via service fields only', async () => {
    const service = new LxSyncService();
    const updated = await service.updateConfig({
      baseUrl: 'http://lx.test',
      username: 'u',
      importDefaultList: false,
      conflict: 'merge',
    });
    expect(updated).toMatchObject({
      baseUrl: 'http://lx.test',
      username: 'u',
      importDefaultList: false,
      conflict: 'merge',
      connected: false,
    });
  });

  it('previews list without writing playlists', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/login')) return jsonResponse({ token: 't1' });
      if (String(url).endsWith('/list')) return jsonResponse(sampleList);
      throw new Error(String(url));
    });
    const service = new LxSyncService({
      playlistStore: new CustomPlaylistStore(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await service.connect({ baseUrl: 'http://lx.test', username: 'u', password: 'p' });
    const preview = await service.preview();
    expect(preview.playlists.length).toBeGreaterThanOrEqual(2);
    expect(preview.totalSongs).toBeGreaterThan(0);

    const store = new CustomPlaylistStore();
    await expect(store.loadAll()).resolves.toEqual([]);
  });

  it('pulls and upserts custom playlists by LX sourceListId without Songloft native id', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/login')) return jsonResponse({ token: 't1' });
      if (String(url).endsWith('/list')) return jsonResponse(sampleList);
      throw new Error(String(url));
    });
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({
      playlistStore: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await service.connect({ baseUrl: 'http://lx.test', username: 'u', password: 'p' });

    const first = await service.pull();
    expect(first.playlistsCreated).toBe(3);
    expect(first.songsImported).toBe(3);

    let playlists = await store.loadAll();
    expect(playlists.map((p) => p.name).sort()).toEqual(['古风精选', '我喜欢', '默认列表'].sort());
    const love = playlists.find((p) => p.name === '我喜欢');
    expect(love?.source_name).toBe('洛雪同步');
    expect(love?.sourceListId).toBe('lx:love');
    expect(love?.native_playlist_id).toBeUndefined();
    expect(love?.songs[0]?.source_data?.platform).toBe('kw');
    expect(playlists.find((p) => p.name === '古风精选')?.sourceListId).toBe('lx:user:ul1');

    const second = await service.pull();
    expect(second.playlistsCreated).toBe(0);
    expect(second.playlistsUpdated).toBe(3);
    playlists = await store.loadAll();
    expect(playlists).toHaveLength(3);
  });

  it('disconnect clears token only', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ token: 't1' }));
    const service = new LxSyncService({ fetchImpl: fetchMock as unknown as typeof fetch });
    await service.connect({ baseUrl: 'http://lx.test', username: 'u', password: 'p' });
    const disconnected = await service.disconnect();
    expect(disconnected.connected).toBe(false);
    expect(disconnected.username).toBe('u');
    const raw = JSON.parse(String(await songloft.storage.get(LX_SYNC_CONFIG_KEY)));
    expect(raw.token).toBeUndefined();
    expect(raw.username).toBe('u');
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
    const result = await service.importToSongloft(['pl1', 'pl2']);
    expect(syncToSongloftPlaylist).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ id: 'pl1', total: 2, skipped: 1 });
  });

  it('does not log password or token', async () => {
    const logs: string[] = [];
    const original = { ...songloft.log };
    songloft.log.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    songloft.log.warn = original.warn;
    songloft.log.error = original.error;

    const fetchMock = vi.fn(async () => jsonResponse({ token: 'super-secret-token' }));
    const service = new LxSyncService({ fetchImpl: fetchMock as unknown as typeof fetch });
    await service.connect({ baseUrl: 'http://lx.test', username: 'u', password: 'super-secret-password' });

    expect(logs.join('\n')).not.toContain('super-secret-password');
    expect(logs.join('\n')).not.toContain('super-secret-token');
  });
});
