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

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Bridge import result with Songloft library song ids (required to fill native playlists). */
function importResult(songs: SearchResultSong[]) {
  return {
    total: songs.length,
    skipped: 0,
    payloads: songs.map((song, index) => ({ id: index + 1, title: song.title })),
    songs: songs.map((song, index) => ({ id: index + 101, title: song.title, artist: song.artist })),
    errors: [] as Array<{ title: string; message: string }>,
  };
}

function mockHostPlaylistAdd(expected?: { playlistId: number; songIds: number[] }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/playlists/') && url.endsWith('/songs') && init?.method === 'POST') {
      if (expected) {
        expect(url).toContain(`/api/v1/playlists/${expected.playlistId}/songs`);
        expect(JSON.parse(String(init.body))).toEqual({ song_ids: expected.songIds });
      }
      return responseJson({ added: expected?.songIds.length ?? 1 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function createService() {
  const bridge = {
    importSongs: vi.fn(async (songs: SearchResultSong[]) => ({
      total: songs.length,
      payloads: songs.map((song) => ({ title: song.title, source_data: JSON.stringify(song.source_data) })),
      songs: songs.map((song, index) => ({ id: index + 101, title: song.title })),
    })),
    importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
    resolveSearchSong: vi.fn(async (title: string, artist?: string) => ({
      ...(title === kgSong.title ? kgSong : kwSong),
      artist: artist || (title === kgSong.title ? kgSong.artist : kwSong.artist),
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

  it('serializes concurrent mutate so last writer cannot drop prior edits', async () => {
    const store = new CustomPlaylistStore();
    await store.saveAll([]);

    const a = store.mutate(async (list) => {
      // Yield so a concurrent mutate can queue behind this exclusive section.
      await Promise.resolve();
      return [
        ...list,
        {
          id: 'a',
          name: 'A',
          cover_url: '',
          imported_at: 't',
          updated_at: 't',
          songs: [],
        },
      ];
    });
    const b = store.mutate(async (list) => {
      await Promise.resolve();
      return [
        ...list,
        {
          id: 'b',
          name: 'B',
          cover_url: '',
          imported_at: 't',
          updated_at: 't',
          songs: [],
        },
      ];
    });
    await Promise.all([a, b]);
    const final = await store.loadAll();
    expect(final.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('returns an existing playlist when creating the same name twice', async () => {
    const { service } = createService();

    const first = await service.create('古风');
    const second = await service.create(' 古风 ');

    expect(second.id).toBe(first.id);
    await expect(service.list()).resolves.toHaveLength(1);
  });

  it('does not create a second native Songloft playlist when the name already exists', async () => {
    const createNative = vi.fn(async (input: { name: string }) => ({
      id: createNative.mock.calls.length + 10,
      name: input.name,
    }));
    (songloft.playlists as unknown as Record<string, unknown>).create = createNative;
    const { service } = createService();

    const first = await service.create('古风');
    expect(createNative).toHaveBeenCalledTimes(1);
    expect(first.native_playlist_id).toBe(11);

    const second = await service.create('古风');
    expect(second.id).toBe(first.id);
    // Idempotent create must not orphan another host playlist.
    expect(createNative).toHaveBeenCalledTimes(1);
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
    (songloft.playlists as unknown as Record<string, unknown>).create = vi.fn(async () => {
      throw new Error('native create failed');
    });
    (songloft.playlists as unknown as Record<string, unknown>).addSongs = vi.fn(async () => {
      throw new Error('native add failed');
    });
    const { service } = createService();

    const playlist = await service.addSong('失败也保存', kgSong);

    expect(playlist.songs).toHaveLength(1);
    await expect(service.list()).resolves.toEqual([playlist]);
  });

  it('imports network playlists with source metadata and portable song references only', async () => {
    const { bridge, service } = createService();

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
    expect(imported.songs[0]).toMatchObject({
      title: '为龙',
      artist: '河图',
    });
    expect(imported.songs[0]).not.toHaveProperty('source_name');
    expect(imported.songs[0]).not.toHaveProperty('source_data');
    expect(bridge.importSongs).not.toHaveBeenCalled();
  });

  it('stores imported playlist details without touching the Songloft song library', async () => {
    const bridge = {
      importSongs: vi.fn(async () => {
        throw new Error('legacy import should not be used');
      }),
      importSongsBestEffort: vi.fn(async () => ({
        total: 0,
        skipped: 1,
        payloads: [],
        errors: [{ title: kgSong.title, message: '无法解析播放 URL' }],
      })),
      resolveSearchSong: vi.fn(),
    } as unknown as BridgeService;
    const service = new CustomPlaylistService(new CustomPlaylistStore(), bridge);

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

    expect(imported.songs).toHaveLength(1);
    expect(imported.songs[0]?.title).toBe('为龙');
    expect(bridge.importSongs).not.toHaveBeenCalled();
    expect(bridge.importSongsBestEffort).not.toHaveBeenCalled();
    await expect(service.list()).resolves.toEqual([imported]);
  });

  it('imports Songloft native playlists as custom playlist snapshots', async () => {
    const { service } = createService();

    const imported = await service.importSongloftPlaylistSnapshot({
      nativePlaylistId: 88,
      name: 'Songloft 收藏',
      songs: [{
        id: 501,
        title: '本地歌曲',
        artist: '歌手',
        album: '专辑',
        duration: 188,
        cover_url: 'https://img.test/local.jpg',
      }],
    });

    expect(imported).toMatchObject({
      name: 'Songloft 收藏',
      native_playlist_id: 88,
      native_playlist_name: 'Songloft 收藏',
      songs: [{
        title: '本地歌曲',
        artist: '歌手',
        album: '专辑',
        cover_url: 'https://img.test/local.jpg',
        native_song_id: 501,
        stable_key: 'songloft:501',
      }],
    });
    await expect(service.list()).resolves.toEqual([imported]);
  });

  it('resolves portable playlist song references when adding them into an own playlist', async () => {
    const { bridge, service } = createService();
    (songloft.playlists as unknown as Record<string, unknown>).create = vi.fn(async () => ({ id: 55 }));
    const fetchMock = mockHostPlaylistAdd({ playlistId: 55, songIds: [101] });

    const playlist = await service.addSong('古风', {
      title: '为龙',
      artist: '河图',
      album: '为龙',
      duration: 260,
      cover_url: 'https://img.test/weilong.jpg',
      stable_key: 'query:为龙:河图',
    });

    expect(bridge.resolveSearchSong).toHaveBeenCalledWith('为龙', '河图');
    expect(bridge.importSongs).toHaveBeenCalledWith([kgSong]);
    expect(playlist.songs[0]?.source_data).toEqual(kgSong.source_data);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('re-resolves online even when LX source_data is present (multi-source, not locked)', async () => {
    const onlineHit = {
      ...kwSong,
      cover_url: 'https://img.test/online-cover.jpg',
      source_data: {
        ...kwSong.source_data,
        quality: 'flac' as const,
      },
    } satisfies SearchResultSong;
    const bridge = {
      importSongs: vi.fn(async (songs: SearchResultSong[]) => ({
        total: songs.length,
        payloads: songs.map((song) => ({ title: song.title })),
        songs: songs.map((song, index) => ({ id: index + 101, title: song.title })),
      })),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
      resolveSearchSong: vi.fn(async () => onlineHit),
    } as unknown as BridgeService;
    mockHostPlaylistAdd();
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'lx_with_src',
        name: '古风',
        cover_url: '',
        sourceListId: 'lx:user:1',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '稻花香',
            artist: '周杰伦',
            album: '',
            duration: 0,
            cover_url: '',
            stable_key: 'lx:kw:old',
            // Stale / incomplete LX source — must NOT short-circuit online resolve.
            source_data: {
              platform: 'kw',
              quality: '128k',
              songInfo: {
                source: 'kw',
                name: '稻花香',
                singer: '周杰伦',
                album: '',
                duration: 0,
                musicId: 'old',
              },
            },
          },
        ],
      },
    ]);
    const service = new CustomPlaylistService(store, bridge, {
      create: vi.fn(async () => ({ id: 1 })),
      addSongs: vi.fn(async () => undefined),
    });

    await service.syncToSongloftPlaylist('lx_with_src');
    expect(bridge.resolveSearchSong).toHaveBeenCalledWith('稻花香', '周杰伦');
    expect(bridge.importSongsBestEffort).toHaveBeenCalledWith([
      expect.objectContaining({
        cover_url: 'https://img.test/online-cover.jpg',
        source_data: expect.objectContaining({ quality: 'flac' }),
      }),
    ]);
    const after = await store.loadAll();
    expect(after[0].songs[0]?.cover_url).toBe('https://img.test/online-cover.jpg');
  });

  it('syncs imported portable playlists into a native Songloft playlist on demand', async () => {
    const bridge = {
      importSongs: vi.fn(),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
      resolveSearchSong: vi.fn(async (title: string) => (title === kgSong.title ? kgSong : null)),
    } as unknown as BridgeService;
    const nativePlaylists = {
      create: vi.fn(async () => ({ id: 77 })),
      addSongs: vi.fn(async () => undefined),
    };
    const fetchMock = mockHostPlaylistAdd({ playlistId: 77, songIds: [101] });
    const service = new CustomPlaylistService(new CustomPlaylistStore(), bridge, nativePlaylists);
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

    await expect(service.syncToSongloftPlaylist(imported.id)).resolves.toMatchObject({
      playlist: expect.objectContaining({ native_playlist_id: 77 }),
      total: 1,
      skipped: 0,
    });

    // Network playlist songs already have source_data but still re-resolve online.
    expect(bridge.resolveSearchSong).toHaveBeenCalledWith('为龙', '河图');
    expect(bridge.importSongsBestEffort).toHaveBeenCalledWith([kgSong]);
    expect(nativePlaylists.create).toHaveBeenCalledWith({ name: '酷狗热歌' });
    // Host REST API gets library song ids — not remote payloads.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18191/api/v1/playlists/77/songs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ song_ids: [101] }),
      }),
    );
    expect(nativePlaylists.addSongs).not.toHaveBeenCalled();
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: imported.id,
        native_playlist_id: 77,
      }),
    ]);
  });

  it('does not clobber concurrent song updates when linking to Songloft', async () => {
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'lx_race',
        name: '古风精选',
        cover_url: '',
        sourceListId: 'lx:user:ul1',
        source_name: '洛雪同步',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '为龙',
            artist: '河图',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'lx:kg:1',
            source_data: kgSong.source_data,
          },
        ],
      },
    ]);
    const bridge = {
      importSongs: vi.fn(async () => ({ total: 0, payloads: [], songs: [] })),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => {
        // Mid-import: LX snapshot rewrote songs under the same playlist id.
        await store.saveAll([
          {
            id: 'lx_race',
            name: '古风精选',
            cover_url: '',
            sourceListId: 'lx:user:ul1',
            source_name: '洛雪同步',
            imported_at: '2020-01-01T00:00:00.000Z',
            updated_at: '2020-01-02T00:00:00.000Z',
            songs: [
              {
                title: '新曲',
                artist: '新歌手',
                album: '',
                duration: 1,
                cover_url: '',
                stable_key: 'lx:new',
              },
            ],
          },
        ]);
        return importResult(songs);
      }),
      resolveSearchSong: vi.fn(async () => kgSong),
    } as unknown as BridgeService;
    const nativePlaylists = {
      create: vi.fn(async () => ({ id: 88 })),
      addSongs: vi.fn(async () => undefined),
    };
    mockHostPlaylistAdd({ playlistId: 88, songIds: [101] });
    const service = new CustomPlaylistService(store, bridge, nativePlaylists);

    const result = await service.syncToSongloftPlaylist('lx_race');
    expect(result.playlist.native_playlist_id).toBe(88);
    // Songs from concurrent LX write must survive (no full-object replace).
    const after = await store.loadAll();
    expect(after[0].songs.map((s) => s.title)).toEqual(['新曲']);
    expect(after[0].native_playlist_id).toBe(88);
  });

  it('adds Songloft library song ids via host playlist API (not remote payloads)', async () => {
    const bridge = {
      importSongs: vi.fn(async () => ({ total: 0, payloads: [], songs: [] })),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
      resolveSearchSong: vi.fn(async () => kgSong),
    } as unknown as BridgeService;
    const nativePlaylists = {
      create: vi.fn(async () => ({ id: 33 })),
      setSongs: vi.fn(async () => undefined),
      addSongs: vi.fn(async () => undefined),
    };
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'lx_set',
        name: '测试',
        cover_url: '',
        sourceListId: 'lx:user:1',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '为龙',
            artist: '河图',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'k',
            source_data: kgSong.source_data,
          },
        ],
      },
    ]);
    const fetchMock = mockHostPlaylistAdd({ playlistId: 33, songIds: [101] });
    const service = new CustomPlaylistService(store, bridge, nativePlaylists);
    await service.syncToSongloftPlaylist('lx_set');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18191/api/v1/playlists/33/songs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ song_ids: [101] }),
      }),
    );
    // Host path succeeds — SDK helpers should not be needed.
    expect(nativePlaylists.setSongs).not.toHaveBeenCalled();
    expect(nativePlaylists.addSongs).not.toHaveBeenCalled();
  });

  it('falls back to SDK addSongs(ids) when host playlist API is unavailable', async () => {
    const bridge = {
      importSongs: vi.fn(async () => ({ total: 0, payloads: [], songs: [] })),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
      resolveSearchSong: vi.fn(async () => kgSong),
    } as unknown as BridgeService;
    const nativePlaylists = {
      create: vi.fn(async () => ({ id: 44 })),
      addSongs: vi.fn(async () => undefined),
    };
    globalThis.fetch = vi.fn(async () => {
      throw new Error('host down');
    });
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'lx_sdk',
        name: 'SDK 回退',
        cover_url: '',
        sourceListId: 'lx:user:sdk',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '为龙',
            artist: '河图',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'k',
            source_data: kgSong.source_data,
          },
        ],
      },
    ]);
    const service = new CustomPlaylistService(store, bridge, nativePlaylists);
    await service.syncToSongloftPlaylist('lx_sdk');
    expect(nativePlaylists.addSongs).toHaveBeenCalledWith(44, [101]);
  });

  it('reuses an existing Songloft playlist by the same name when linking', async () => {
    const bridge = {
      importSongs: vi.fn(async () => ({ total: 0, payloads: [], songs: [] })),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
      resolveSearchSong: vi.fn(async () => kgSong),
    } as unknown as BridgeService;
    const nativePlaylists = {
      list: vi.fn(async () => [{ id: 501, name: '古风精选' }]),
      create: vi.fn(async () => ({ id: 999 })),
      addSongs: vi.fn(async () => undefined),
    };
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'lx_user',
        name: '古风精选',
        cover_url: '',
        sourceListId: 'lx:user:ul1',
        source_name: '洛雪同步',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '为龙',
            artist: '河图',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'lx:kg:1',
            source_data: kgSong.source_data,
          },
        ],
      },
    ]);
    const fetchMock = mockHostPlaylistAdd({ playlistId: 501, songIds: [101] });
    const service = new CustomPlaylistService(store, bridge, nativePlaylists);

    await expect(service.syncToSongloftPlaylist('lx_user')).resolves.toMatchObject({
      playlist: expect.objectContaining({ native_playlist_id: 501, name: '古风精选' }),
      total: 1,
    });
    expect(nativePlaylists.list).toHaveBeenCalled();
    expect(nativePlaylists.create).not.toHaveBeenCalled();
    expect(bridge.importSongsBestEffort).toHaveBeenCalledWith([
      expect.objectContaining({ title: '为龙', source_data: kgSong.source_data }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18191/api/v1/playlists/501/songs',
      expect.objectContaining({ body: JSON.stringify({ song_ids: [101] }) }),
    );
  });

  it('mirrors Songloft playlists as lx:user:songloft:* for LX export', async () => {
    const bridge = {
      importSongs: vi.fn(async () => ({ total: 0, payloads: [], songs: [] })),
      importSongsBestEffort: vi.fn(async () => ({ total: 0, skipped: 0, payloads: [], songs: [], errors: [] })),
      resolveSearchSong: vi.fn(async () => null),
    } as unknown as BridgeService;
    const nativePlaylists = {
      list: vi.fn(async () => [{ id: 77, name: '晚安' }]),
      getSongs: vi.fn(async () => [
        { id: 501, title: '为龙', artist: '河图', album: '', duration: 260, cover_url: 'https://img/x.jpg' },
      ]),
      create: vi.fn(),
      addSongs: vi.fn(),
    };
    const store = new CustomPlaylistStore();
    const service = new CustomPlaylistService(store, bridge, nativePlaylists);

    const result = await service.mirrorSongloftPlaylistsForLx();
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.playlists[0]).toMatchObject({
      name: '晚安',
      native_playlist_id: 77,
      sourceListId: 'lx:user:songloft:77',
    });
    expect(result.playlists[0].songs[0]?.title).toBe('为龙');
    expect(nativePlaylists.getSongs).toHaveBeenCalledWith(77, { limit: 100000 });

    // Appears in LX list export.
    const { LxSyncService } = await import('../../src/lx_sync/service');
    const lx = new LxSyncService({ playlistStore: store });
    const listData = await lx.getLocalListData();
    expect(listData.userList.some((u) => u.id === 'songloft:77' && u.name === '晚安')).toBe(true);
  });

  it('recreates Songloft playlist when stored native_playlist_id was deleted', async () => {
    const bridge = {
      importSongs: vi.fn(async () => ({ total: 0, payloads: [], songs: [] })),
      importSongsBestEffort: vi.fn(async (songs: SearchResultSong[]) => importResult(songs)),
      resolveSearchSong: vi.fn(async () => kgSong),
    } as unknown as BridgeService;
    const nativePlaylists = {
      // Stale id 77 is gone; host only has unrelated playlists.
      list: vi.fn(async () => [{ id: 1, name: '其他' }]),
      create: vi.fn(async () => ({ id: 902 })),
      addSongs: vi.fn(async () => undefined),
    };
    const store = new CustomPlaylistStore();
    await store.saveAll([
      {
        id: 'lx_deleted',
        name: '古风精选',
        cover_url: '',
        sourceListId: 'lx:user:ul1',
        source_name: '洛雪同步',
        native_playlist_id: 77,
        native_playlist_name: '古风精选',
        imported_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
        songs: [
          {
            title: '为龙',
            artist: '河图',
            album: '',
            duration: 1,
            cover_url: '',
            stable_key: 'lx:kg:1',
            source_data: kgSong.source_data,
          },
        ],
      },
    ]);
    const fetchMock = mockHostPlaylistAdd({ playlistId: 902, songIds: [101] });
    const service = new CustomPlaylistService(store, bridge, nativePlaylists);

    await expect(service.syncToSongloftPlaylist('lx_deleted')).resolves.toMatchObject({
      playlist: expect.objectContaining({ native_playlist_id: 902, name: '古风精选' }),
      total: 1,
    });
    expect(nativePlaylists.list).toHaveBeenCalled();
    expect(nativePlaylists.create).toHaveBeenCalledWith({ name: '古风精选' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18191/api/v1/playlists/902/songs',
      expect.objectContaining({ body: JSON.stringify({ song_ids: [101] }) }),
    );
  });

  it('refreshes the existing playlist when importing the same source and upstream id twice', async () => {
    const { bridge, service } = createService();

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
    expect(second.name).toBe('新名字');
    expect(second.songs.map((item) => item.title)).toEqual(['为龙']);
    expect(bridge.importSongs).not.toHaveBeenCalled();
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
