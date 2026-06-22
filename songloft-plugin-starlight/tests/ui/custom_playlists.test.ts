import { afterEach, describe, expect, it, vi } from 'vitest';

interface CustomPlaylistUiModule {
  renderSongRow(song: Record<string, unknown>, index: number, extraActions?: string): string;
  renderSongListItem(item: Record<string, unknown>, index: number): string;
  renderCustomPlaylistItem(playlist: Record<string, unknown>): string;
  renderCustomPlaylistDetail(playlist: Record<string, unknown>, page?: number): string;
  nextCustomPlaylistDetailId(currentId: string, playlistId: string): string;
  playCustomPlaylistOnSpeaker(playlist: Record<string, unknown>): Promise<unknown>;
  syncCustomPlaylistToSongloft(playlistId: string): Promise<unknown>;
  addSelectedSongsToCustomPlaylist(playlistId: string, songs: Array<Record<string, unknown>>): Promise<unknown[]>;
  addSongToCustomPlaylist(playlistId: string, song: Record<string, unknown>): Promise<unknown>;
  importCustomPlaylistFromSource(sourceId: string, listId: string): Promise<unknown>;
  favoriteSongListFromSource(sourceId: string, listId: string): Promise<unknown>;
  refreshCustomPlaylist(playlistId: string): Promise<unknown>;
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

function installToastDom() {
  const node = { className: '', textContent: '', remove: vi.fn() };
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => node),
    body: {
      appendChild: vi.fn(),
    },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
}

async function loadMusicModule(): Promise<CustomPlaylistUiModule> {
  const modulePath = '../../static/js/music.js';
  return await import(modulePath) as CustomPlaylistUiModule;
}

describe('custom playlist music UI helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adds a custom playlist action to song rows', async () => {
    const { renderSongRow } = await loadMusicModule();

    const html = renderSongRow({
      title: '稻花香',
      artist: '周杰伦',
      album: '魔杰座',
      source_data: { platform: 'kw', quality: '320k' },
    }, 0);

    expect(html).toContain('加入歌单');
    expect(html).toContain('data-action="add-to-playlist"');
  });

  it('posts selected songs into a custom playlist', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ id: 'custom_1' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { addSongToCustomPlaylist } = await loadMusicModule();
    const song = { title: '为龙', source_data: { platform: 'kg', quality: '320k', songInfo: {} } };

    await addSongToCustomPlaylist('custom_1', song);

    expect(fetchMock).toHaveBeenCalledWith('api/custom-playlists/custom_1/songs', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ song }),
    }));
  });

  it('imports and refreshes LX Server-style playlists through custom playlist APIs', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ id: 'imported_1' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { importCustomPlaylistFromSource, refreshCustomPlaylist } = await loadMusicModule();

    await importCustomPlaylistFromSource('kw', '3360244412');
    await refreshCustomPlaylist('imported_1');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('api/custom-playlists/import');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      source_id: 'kw',
      id: '3360244412',
    });
    expect(calls.map((call) => call[0])).toContain('api/custom-playlists/imported_1/refresh');
  });

  it('favorites discovered songlists through the custom playlist import API', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ id: 'imported_1' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { favoriteSongListFromSource, renderSongListItem } = await loadMusicModule();

    await favoriteSongListFromSource('kw', '3360244412');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('api/custom-playlists/import');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      source_id: 'kw',
      id: '3360244412',
    });

    const html = renderSongListItem({
      id: '3360244412',
      name: '华语热歌',
      cover_url: 'https://img.test/list.jpg',
      description: '热门歌单',
    }, 0);

    expect(html).toContain('收藏');
    expect(html).not.toContain('3360244412');
  });

  it('renders imported playlist metadata without exposing upstream ids', async () => {
    const { renderCustomPlaylistItem } = await loadMusicModule();

    const html = renderCustomPlaylistItem({
      id: 'imported_1',
      name: '酷我歌单',
      cover_url: 'https://img.test/list.jpg',
      source: 'kw',
      source_name: '酷我',
      sourceListId: '3360244412',
      songs: [{ title: '稻花香', artist: '周杰伦', source_name: '酷我' }],
    });

    expect(html).toContain('https://img.test/list.jpg');
    expect(html).toContain('酷我歌单');
    expect(html).toContain('酷我');
    expect(html).toContain('刷新');
    expect(html).toContain('同步 Songloft 歌单');
    expect(html).toContain('播放歌单');
    expect(html).toContain('查看歌曲');
    expect(html).toContain('data-action="view-custom-playlist"');
    expect(html).toContain('data-action="sync-custom-playlist"');
    expect(html).toContain('data-action="play-custom-playlist"');
    expect(html).not.toContain('3360244412');
  });

  it('toggles imported playlist details when clicking the viewed row again', async () => {
    const { nextCustomPlaylistDetailId } = await loadMusicModule();

    expect(nextCustomPlaylistDetailId('', 'imported_1')).toBe('imported_1');
    expect(nextCustomPlaylistDetailId('imported_1', 'imported_1')).toBe('');
    expect(nextCustomPlaylistDetailId('imported_1', 'imported_2')).toBe('imported_2');
  });

  it('renders imported playlist song details with cover artwork and add actions', async () => {
    const { renderCustomPlaylistDetail } = await loadMusicModule();

    const html = renderCustomPlaylistDetail({
      id: 'imported_1',
      name: '酷我歌单',
      source_name: '酷我',
      songs: [{
        title: '稻花香',
        artist: '周杰伦',
        album: '魔杰座',
        cover_url: 'https://img.test/daohuaxiang.jpg',
        source_name: '酷我',
        source_data: { platform: 'kw', quality: '320k', songInfo: { musicId: 'kw-1' } },
      }],
    });

    expect(html).toContain('酷我歌单');
    expect(html).toContain('https://img.test/daohuaxiang.jpg');
    expect(html).toContain('稻花香');
    expect(html).toContain('加入歌单');
    expect(html).toContain('音箱播放');
    expect(html).toContain('data-role="custom-playlist-song-check"');
    expect(html).toContain('data-action="add-selected-custom-playlist-songs"');
    expect(html).toContain('data-action="speaker-custom-playlist-song"');
    expect(html).not.toContain('kw-1');
  });

  it('paginates imported playlist song details', async () => {
    const { renderCustomPlaylistDetail } = await loadMusicModule();
    const songs = Array.from({ length: 55 }, (_, index) => ({
      title: `歌曲 ${index + 1}`,
      artist: '歌手',
      album: '',
      cover_url: '',
    }));

    const html = renderCustomPlaylistDetail({
      id: 'imported_1',
      name: '大歌单',
      source_name: '酷我',
      songs,
    }, 2);

    expect(html).toContain('歌曲 51');
    expect(html).toContain('歌曲 55');
    expect(html).not.toContain('歌曲 50');
    expect(html).toContain('data-pagination="custom-playlist-detail"');
    expect(html).toContain('第 2 / 2 页');
  });

  it('posts imported playlist sync and playback actions', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ total: 1, playlist: { id: 'imported_1' } }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { playCustomPlaylistOnSpeaker, syncCustomPlaylistToSongloft } = await loadMusicModule();
    const stateModulePath = '../../static/js/state.js';
    const { state } = await import(stateModulePath) as { state: { accountId: string; deviceId: string } };
    state.accountId = 'acc-1';
    state.deviceId = 'dev-1';

    await syncCustomPlaylistToSongloft('imported_1');
    await playCustomPlaylistOnSpeaker({
      id: 'imported_1',
      native_playlist_id: 77,
      songs: [{ title: '为龙' }],
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe('api/custom-playlists/imported_1/sync-songloft');
    const playCall = calls.find(([url]) => url === 'api/miot/player/play');
    expect(playCall).toBeTruthy();
    expect(JSON.parse(String(playCall?.[1]?.body))).toMatchObject({
      playlist_id: 77,
      play_mode: 'order',
    });
  });

  it('adds selected imported playlist songs into the selected custom playlist', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ id: 'custom_1' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { addSelectedSongsToCustomPlaylist } = await loadMusicModule();
    const songs = [
      { title: '稻花香', source_data: { platform: 'kw', quality: '320k', songInfo: {} } },
      { title: '为龙', source_data: { platform: 'kg', quality: '320k', songInfo: {} } },
    ];

    await addSelectedSongsToCustomPlaylist('custom_1', songs);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls.filter(([url]) => String(url).includes('/songs'))).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ song: songs[0] });
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({ song: songs[1] });
  });
});
