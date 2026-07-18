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
          name: '为你',
          singer: '图图',
          source: 'kg',
          interval: '04:00',
          meta: { hash: 'h1', songId: 's1' },
        },
      ],
    },
  ],
};

describe('LxSyncService (protocol server)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns public server config with address and password', async () => {
    const service = new LxSyncService({ hostBaseUrl: 'http://192.168.0.1:18191' });
    const config = await service.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.password).toBeTruthy();
    expect(config.serverAddress).toContain('/api/v1/jsplugin/starlight');
    expect(config).not.toHaveProperty('token');
    expect(config).not.toHaveProperty('baseUrl');
    expect(config).not.toHaveProperty('conflict');
    expect(config).not.toHaveProperty('importDefaultList');
  });

  it('setLocalListData imports ListData into custom playlists by sourceListId', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });

    await service.setLocalListData(sampleList);
    let playlists = await store.loadAll();
    expect(playlists).toHaveLength(3);
    expect(playlists.map((p) => p.name).sort()).toEqual(['古风精选', '我喜欢', '默认列表'].sort());
    const love = playlists.find((p) => p.name === '我喜欢');
    expect(love?.sourceListId).toBe('lx:love');
    expect(love?.native_playlist_id).toBeUndefined();
    expect(love?.songs[0]?.source_data?.platform).toBe('kw');

    await service.setLocalListData(sampleList);
    playlists = await store.loadAll();
    expect(playlists).toHaveLength(3);
  });

  it('exports custom playlists as LX ListData via getLocalListData', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);
    const listData = await service.getLocalListData();
    expect(listData.loveList.length).toBe(1);
    expect(listData.userList.some((u) => u.name === '古风精选')).toBe(true);
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

  it('stores and reuses device list snapshot keys across reconnects', async () => {
    const service = new LxSyncService();
    const issued = await service.issueClientKey('Phone', true);
    expect(await service.getDeviceListSnapshotKey(issued.clientId)).toBeUndefined();

    await service.setDeviceListSnapshotKey(issued.clientId, 'fp-abc');
    expect(await service.getDeviceListSnapshotKey(issued.clientId)).toBe('fp-abc');

    // Re-read via a new service instance (persisted storage).
    const again = new LxSyncService();
    expect(await again.getDeviceListSnapshotKey(issued.clientId)).toBe('fp-abc');
  });

  it('auto-imports LX playlists into Songloft after setLocalListData (same names + song library)', async () => {
    const store = new CustomPlaylistStore();
    const importedIds: string[] = [];
    const syncToSongloftPlaylist = vi.fn(async (id: string) => {
      importedIds.push(id);
      const playlist = (await store.loadAll()).find((p) => p.id === id);
      return {
        playlist: playlist || { id, name: 'x', cover_url: '', imported_at: '', updated_at: '', songs: [] },
        total: playlist?.songs.length ?? 0,
        skipped: 0,
        errors: [],
      };
    });
    const service = new LxSyncService({
      playlistStore: store,
      customPlaylists: { syncToSongloftPlaylist },
    });

    await service.setLocalListData(sampleList);
    await service.awaitPendingAutoImport();

    const playlists = await store.loadAll();
    const lxIds = playlists.filter((p) => String(p.sourceListId || '').startsWith('lx:')).map((p) => p.id);
    expect(lxIds.length).toBe(3);
    expect(syncToSongloftPlaylist).toHaveBeenCalledTimes(3);
    expect(importedIds.sort()).toEqual(lxIds.sort());
    // Names mirror LX sync lists (default / love / user).
    const names = playlists.map((p) => p.name).sort();
    expect(names).toEqual(['古风精选', '我喜欢', '默认列表'].sort());
  });

  it('debounces auto-import so rapid list writes only import once per batch', async () => {
    const store = new CustomPlaylistStore();
    const syncToSongloftPlaylist = vi.fn(async (id: string) => ({
      playlist: { id, name: 'x', cover_url: '', imported_at: '', updated_at: '', songs: [] },
      total: 0,
      skipped: 0,
      errors: [],
    }));
    const service = new LxSyncService({
      playlistStore: store,
      customPlaylists: { syncToSongloftPlaylist },
    });

    await service.setLocalListData(sampleList);
    await service.setLocalListData(sampleList);
    await service.awaitPendingAutoImport();

    // One debounced pass over all LX playlists after the last write.
    expect(syncToSongloftPlaylist).toHaveBeenCalledTimes(3);
  });

  it('persists server password and preferences', async () => {
    const service = new LxSyncService();
    await service.updateConfig({ password: '999888', serverName: 'MySL' });
    const raw = JSON.parse(String(await songloft.storage.get(LX_SYNC_CONFIG_KEY)));
    expect(raw.password).toBe('999888');
    expect(raw.serverName).toBe('MySL');
    expect(raw.serverId).toBeTruthy();
    expect(raw.conflict).toBeUndefined();
    expect(raw.token).toBeUndefined();
  });

  it('disabling the service drops live peer connections', async () => {
    const service = new LxSyncService();
    const close = vi.fn();
    service.registerListPeer({
      clientId: 'live-1',
      isListReady: () => true,
      notifyListAction: async () => {},
      close,
    });
    expect(service.getConnectedCount()).toBe(1);

    await service.updateConfig({ enabled: false });
    expect(close).toHaveBeenCalled();
    expect(service.getConnectedCount()).toBe(0);

    // Re-enable should not close anything (no peers left).
    close.mockClear();
    await service.updateConfig({ enabled: true });
    expect(close).not.toHaveBeenCalled();
  });

  it('migrates legacy config without password to a stable password once', async () => {
    await songloft.storage.set(
      LX_SYNC_CONFIG_KEY,
      JSON.stringify({ conflict: 'merge', importDefaultList: true, enabled: true }),
    );
    const service = new LxSyncService();
    const first = await service.getConfig();
    expect(first.password).toBeTruthy();
    const second = await service.getConfig();
    expect(second.password).toBe(first.password);
    expect(second.serverId).toBe(first.serverId);
    const raw = JSON.parse(String(await songloft.storage.get(LX_SYNC_CONFIG_KEY)));
    expect(raw.password).toBe(first.password);
    expect(raw.conflict).toBeUndefined();
  });

  it('getLocalListData exports only lx-managed playlists', async () => {
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'manual',
        name: '手动',
        cover_url: '',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '手动曲',
            artist: 'M',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'm1',
          },
        ],
      },
    ]);
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);
    const listData = await service.getLocalListData();
    expect(listData.loveList.length).toBe(1);
    expect(listData.userList.every((u) => u.name !== '手动')).toBe(true);
  });

  it('preserves numeric native_playlist_id on snapshot re-apply', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);

    const before = await store.loadAll();
    const love = before.find((p) => p.sourceListId === 'lx:love');
    expect(love).toBeTruthy();
    love!.native_playlist_id = 4242;
    await store.saveAll(before);

    await service.setLocalListData(sampleList);
    const after = await store.loadAll();
    const loveAfter = after.find((p) => p.sourceListId === 'lx:love');
    expect(loveAfter?.native_playlist_id).toBe(4242);
  });

  it('drops legacy string native_playlist_id on snapshot re-apply', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);

    const before = await store.loadAll();
    const love = before.find((p) => p.sourceListId === 'lx:love');
    love!.native_playlist_id = 'lx:love' as unknown as number;
    await store.saveAll(before);

    await service.setLocalListData(sampleList);
    const after = await store.loadAll();
    const loveAfter = after.find((p) => p.sourceListId === 'lx:love');
    expect(loveAfter?.native_playlist_id).toBeUndefined();
  });

  it('does not hijack a user-created 我喜欢 playlist by name alone', async () => {
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'user_love',
        name: '我喜欢',
        cover_url: '',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '用户自建',
            artist: 'A',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'user:1',
          },
        ],
      },
    ]);

    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData({
      defaultList: [],
      loveList: sampleList.loveList,
      userList: [],
    });

    const playlists = await store.loadAll();
    expect(playlists).toHaveLength(3); // user + love + empty default
    const userLove = playlists.find((p) => p.id === 'user_love');
    const lxLove = playlists.find((p) => p.sourceListId === 'lx:love');
    expect(userLove?.songs[0]?.title).toBe('用户自建');
    expect(userLove?.sourceListId).toBeUndefined();
    expect(lxLove?.songs[0]?.title).toBe('喜欢曲');
  });

  it('setLocalListData snapshot replaces songs and clears empty lists', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);

    await service.setLocalListData({
      defaultList: sampleList.defaultList,
      loveList: [],
      userList: [],
    });

    const playlists = await store.loadAll();
    const love = playlists.find((p) => p.sourceListId === 'lx:love');
    const def = playlists.find((p) => p.sourceListId === 'lx:default');
    expect(love?.songs).toEqual([]);
    expect(def?.songs.length).toBe(1);
    expect(playlists.some((p) => p.sourceListId === 'lx:user:ul1')).toBe(false);
  });

  it('setLocalListData removes LX playlists absent from snapshot but keeps non-LX', async () => {
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'manual',
        name: '手动歌单',
        cover_url: '',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [],
      },
    ]);
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);
    expect((await store.loadAll()).some((p) => p.id === 'manual')).toBe(true);

    await service.setLocalListData({
      defaultList: [],
      loveList: sampleList.loveList,
      userList: [],
    });
    const playlists = await store.loadAll();
    expect(playlists.some((p) => p.id === 'manual')).toBe(true);
    expect(playlists.some((p) => p.sourceListId === 'lx:love')).toBe(true);
    expect(playlists.some((p) => p.sourceListId === 'lx:default')).toBe(true);
    expect(playlists.some((p) => String(p.sourceListId || '').startsWith('lx:user:'))).toBe(false);
  });

  it('setHostBaseUrl refreshes public serverAddress', async () => {
    const service = new LxSyncService({ hostBaseUrl: 'http://old.local:18191' });
    const before = await service.getConfig();
    expect(before.serverAddress).toContain('old.local');
    service.setHostBaseUrl('http://192.168.9.9:18191');
    const after = await service.getConfig();
    expect(after.serverAddress).toContain('192.168.9.9');
    expect(after.serverAddress).not.toContain('old.local');
  });

  it('export classifies fixed lists only by sourceListId not name', async () => {
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'user_named_love',
        name: '我喜欢',
        cover_url: '',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '用户曲',
            artist: 'U',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'user:x',
          },
        ],
      },
      {
        id: 'lx_love',
        name: '我喜欢',
        cover_url: '',
        sourceListId: 'lx:love',
        source_name: '洛雪同步',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: 'LX喜欢',
            artist: 'L',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'lx:kw:1',
            source_data: {
              platform: 'kw',
              quality: '320k',
              songInfo: { source: 'kw', name: 'LX喜欢', singer: 'L', album: '', duration: 1 },
            },
          },
        ],
      },
    ]);
    const service = new LxSyncService({ playlistStore: store });
    const listData = await service.getLocalListData();
    // Protocol export only includes lx-managed lists; name-only "我喜欢" is excluded.
    expect(listData.loveList.map((s) => s.name)).toEqual(['LX喜欢']);
    expect(listData.userList.some((u) => u.list.some((s) => s.name === '用户曲'))).toBe(false);
  });

  it('applyListAction list_music_clear empties target list', async () => {
    const store = new CustomPlaylistStore();
    const service = new LxSyncService({ playlistStore: store });
    await service.setLocalListData(sampleList);
    await service.applyListAction({ action: 'list_music_clear', data: ['love'] });
    const local = await service.getLocalListData();
    expect(local.loveList).toEqual([]);
    expect(local.defaultList.length).toBe(1);
  });

  it('regeneratePassword revokes all device session keys and rotates serverId', async () => {
    const service = new LxSyncService();
    const before = await service.getConfig();
    const issued = await service.issueClientKey('Phone', true);
    expect(await service.getDevice(issued.clientId)).not.toBeNull();

    await service.updateConfig({ regeneratePassword: true });
    expect(await service.getDevice(issued.clientId)).toBeNull();
    const config = await service.getConfig();
    expect(config.devices).toEqual([]);
    expect(config.connectedCount).toBe(0);
    expect(config.password).not.toBe(before.password);
    // New serverId forces LX clients to drop cached client keys and re-auth with password.
    expect(config.serverId).not.toBe(before.serverId);
    expect(config.enabled).toBe(true);
  });

  it('password change drops registered peers and clears devices', async () => {
    const service = new LxSyncService();
    const beforeId = (await service.getConfig()).serverId;
    await service.issueClientKey('Desktop', false);
    let closed = false;
    service.registerListPeer({
      clientId: 'peer-1',
      isListReady: () => true,
      notifyListAction: async () => {},
      close: () => {
        closed = true;
      },
    });
    expect(service.getConnectedCount()).toBe(1);

    await service.updateConfig({ password: 'new-secret-key' });
    expect(closed).toBe(true);
    expect(service.getConnectedCount()).toBe(0);
    expect((await service.getConfig()).devices).toEqual([]);
    expect((await service.getConfig()).serverId).not.toBe(beforeId);
  });

  it('unknown clientId after revoke does not permanently block the peer', async () => {
    const { handleLxProtocolHttp, resetAuthRateLimitForTests } = await import('../../src/lx_sync/protocol_http');
    const { SYNC_CODE } = await import('../../src/lx_sync/constants');
    const { aesEncrypt } = await import('../../src/lx_sync/crypto_lx');
    resetAuthRateLimitForTests();
    const service = new LxSyncService();
    await service.updateConfig({ password: '222333' });
    const peer = { 'x-forwarded-for': '10.0.0.55' };

    // Many keyAuth attempts with a revoked/unknown clientId must not trip the IP ban.
    for (let i = 0; i < 12; i++) {
      const res = await handleLxProtocolHttp(
        {
          method: 'GET',
          path: '/ah',
          query: '',
          headers: {
            ...peer,
            i: 'dead-client-id',
            m: aesEncrypt(`${SYNC_CODE.authMsg}Phone`, 'AAAAAAAAAAAAAAAAAAAAAA=='),
          },
          body: null,
        } as never,
        service,
      );
      expect(res?.statusCode).toBe(401);
      expect(res?.body).toBe(SYNC_CODE.msgAuthFailed);
    }

    // Password codeAuth should still succeed (peer not blocked).
    const { authCodeToAesKey } = await import('../../src/lx_sync/crypto_lx');
    const { generateKeyPairSync } = await import('node:crypto');
    const { publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const pubBody = String(publicKey)
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s+/g, '');
    const key = authCodeToAesKey('222333');
    const m = aesEncrypt(`${SYNC_CODE.authMsg}\n${pubBody}\nPhone\nlx_music_mobile`, key);
    const ok = await handleLxProtocolHttp(
      {
        method: 'GET',
        path: '/ah',
        query: '',
        headers: { ...peer, m },
        body: null,
      } as never,
      service,
    );
    expect(ok?.statusCode).toBe(200);
    expect(String(ok?.body).length).toBeGreaterThan(20);
  });

  it('broadcastListAction fans out only to other ready peers', async () => {
    const service = new LxSyncService();
    const received: Array<{ id: string; action: unknown }> = [];
    service.registerListPeer({
      clientId: 'from',
      isListReady: () => true,
      notifyListAction: async (action) => {
        received.push({ id: 'from', action });
      },
      close: () => {},
    });
    service.registerListPeer({
      clientId: 'ready',
      isListReady: () => true,
      notifyListAction: async (action) => {
        received.push({ id: 'ready', action });
      },
      close: () => {},
    });
    service.registerListPeer({
      clientId: 'not-ready',
      isListReady: () => false,
      notifyListAction: async (action) => {
        received.push({ id: 'not-ready', action });
      },
      close: () => {},
    });

    const action = { action: 'list_music_add', data: { id: 'love', musicInfos: [] } };
    await service.broadcastListAction('from', action);
    expect(received).toEqual([{ id: 'ready', action }]);
  });
});
