import { afterEach, describe, expect, it, vi } from 'vitest';

interface CustomPlaylistUiModule {
  renderCustomPlaylistItem(playlist: Record<string, unknown>): string;
  renderCustomPlaylistDetail(playlist: Record<string, unknown>, page?: number): string;
  loadCustomPlaylists(): Promise<Array<Record<string, unknown>>>;
  bindCustomPlaylists(): void;
  setCustomPlaylistDependencies(dependencies: Record<string, unknown>): void;
  nextCustomPlaylistDetailId(currentId: string, playlistId: string): string;
  playCustomPlaylistOnSpeaker(playlist: Record<string, unknown>): Promise<unknown>;
  syncCustomPlaylistToSongloft(playlistId: string): Promise<unknown>;
  importCustomPlaylistFromSource(sourceId: string, listId: string): Promise<unknown>;
  favoriteSongListFromSource(sourceId: string, listId: string): Promise<unknown>;
  refreshCustomPlaylist(playlistId: string): Promise<unknown>;
}

interface MusicRenderersModule {
  renderSongRow(song: Record<string, unknown>, index: number, extraActions?: string): string;
  renderSongListItem(item: Record<string, unknown>, index: number): string;
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
  const modulePath = '../../static/js/music_modules/custom_playlists.js';
  return await import(modulePath) as CustomPlaylistUiModule;
}

async function loadRenderersModule(): Promise<MusicRenderersModule> {
  const modulePath = '../../static/js/music_modules/renderers.js';
  return await import(modulePath) as MusicRenderersModule;
}

describe('custom playlist music UI helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('adds a custom playlist action to song rows', async () => {
    const { renderSongRow } = await loadRenderersModule();

    const html = renderSongRow({
      title: '稻花香',
      artist: '周杰伦',
      album: '魔杰座',
      source_data: { platform: 'kw', quality: '320k' },
    }, 0);

    expect(html).toContain('加入歌单');
    expect(html).toContain('data-action="add-to-playlist"');
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
    const { favoriteSongListFromSource } = await loadMusicModule();
    const { renderSongListItem } = await loadRenderersModule();

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

  it('uses Songloft playlists for the My Playlists target selector without auto-selecting one', async () => {
    const select = { innerHTML: '', value: '', addEventListener: vi.fn() };
    const list = { innerHTML: '' };
    const detail = { innerHTML: '' };
    const label = { textContent: '' };
    const node = { className: '', textContent: '', remove: vi.fn() };
    const selectors = new Map<string, unknown>([
      ['[data-role="custom-playlist-select"]', select],
      ['[data-role="custom-playlist-list"]', list],
      ['[data-role="custom-playlist-detail"]', detail],
      ['.toast', null],
    ]);
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => selectors.get(selector) ?? null),
      querySelectorAll: vi.fn((selector: string) => selector === '[data-role="target-playlist-label"]' ? [label] : []),
      createElement: vi.fn(() => node),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/custom-playlists') {
        return okResponse([{
          id: 'imported_1',
          name: '插件导入歌单',
          source: 'kw',
          sourceListId: '3360244412',
          songs: [],
        }]) as Response;
      }
      if (url === 'api/songloft/playlists') {
        return okResponse({ list: [{ id: 12, name: 'Songloft 收藏' }], total: 1 }) as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { loadCustomPlaylists } = await loadMusicModule();
    const stateModulePath = '../../static/js/state.js';
    const { state } = await import(stateModulePath) as {
      state: {
        customPlaylistId: string;
        songloftTargetPlaylistId: string;
        songloftTargetPlaylistName: string;
        songloftTargetPlaylists: Array<Record<string, unknown>>;
      };
    };
    state.customPlaylistId = 'imported_1';
    state.songloftTargetPlaylistId = '';
    state.songloftTargetPlaylistName = '';
    state.songloftTargetPlaylists = [];

    await loadCustomPlaylists();

    expect(fetchMock).toHaveBeenCalledWith('api/songloft/playlists', expect.any(Object));
    expect(select.innerHTML).toContain('请选择 Songloft 歌单');
    expect(select.innerHTML).toContain('Songloft 收藏');
    expect(select.innerHTML).not.toContain('插件导入歌单');
    expect(select.value).toBe('');
    expect(list.innerHTML).toContain('请选择 Songloft 歌单');
    expect(list.innerHTML).not.toContain('暂无自建歌单');
    expect(list.innerHTML).not.toContain('插件导入歌单');
    expect(label.textContent).toBe('未选择 Songloft 歌单');
    expect(state.songloftTargetPlaylistId).toBe('');
    expect(state.songloftTargetPlaylistName).toBe('');
  });

  it('loads selected Songloft playlist songs into the My Playlists list area', async () => {
    const selectListeners = new Map<string, () => unknown>();
    const select = {
      innerHTML: '',
      value: '',
      addEventListener: vi.fn((event: string, handler: () => unknown) => selectListeners.set(event, handler)),
    };
    const list = { innerHTML: '', addEventListener: vi.fn() };
    const detail = { innerHTML: '', addEventListener: vi.fn() };
    const label = { textContent: '' };
    const node = { className: '', textContent: '', remove: vi.fn() };
    const selectors = new Map<string, unknown>([
      ['[data-role="custom-playlist-select"]', select],
      ['[data-role="custom-playlist-list"]', list],
      ['[data-role="custom-playlist-detail"]', detail],
      ['.toast', null],
    ]);
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => selectors.get(selector) ?? null),
      querySelectorAll: vi.fn((selector: string) => selector === '[data-role="target-playlist-label"]' ? [label] : []),
      createElement: vi.fn(() => node),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    const song = {
      id: 501,
      title: 'Songloft 歌曲',
      artist: '测试歌手',
      album: '测试专辑',
      duration: 188,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists/12/songs') {
        return okResponse({ list: [song], total: 1 }) as Response;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { bindCustomPlaylists, setCustomPlaylistDependencies } = await loadMusicModule();
    const stateModulePath = '../../static/js/state.js';
    const { state } = await import(stateModulePath) as {
      state: {
        songloftTargetPlaylistId: string;
        songloftTargetPlaylistName: string;
        songloftTargetPlaylists: Array<Record<string, unknown>>;
        songloftTargetPlaylistSongs?: Array<Record<string, unknown>>;
      };
    };
    state.songloftTargetPlaylistId = '';
    state.songloftTargetPlaylistName = '';
    state.songloftTargetPlaylists = [{ id: 12, name: 'Songloft 收藏' }];
    state.songloftTargetPlaylistSongs = [];
    setCustomPlaylistDependencies({
      downloadSong: vi.fn(),
      downloadSongs: vi.fn(),
      playOnSpeaker: vi.fn(),
      playResolvedSongOnSpeaker: vi.fn(),
      openSongloftPlaylistTarget: vi.fn(),
      setControlDisabled: vi.fn(),
      playSongloftSongOnSpeaker: vi.fn(),
    });
    bindCustomPlaylists();

    select.value = '12';
    await Promise.resolve(selectListeners.get('change')?.());

    expect(fetchMock).toHaveBeenCalledWith('api/songloft/playlists/12/songs', expect.any(Object));
    expect(label.textContent).toBe('Songloft 收藏');
    expect(list.innerHTML).toContain('Songloft 收藏');
    expect(list.innerHTML).toContain('Songloft 歌曲');
    expect(list.innerHTML).toContain('测试歌手');
    expect(list.innerHTML).toContain('data-action="speaker-songloft-song"');
    expect(list.innerHTML).not.toContain('暂无自建歌单');
    expect(state.songloftTargetPlaylistId).toBe('12');
    expect(state.songloftTargetPlaylistName).toBe('Songloft 收藏');
    expect(state.songloftTargetPlaylistSongs).toEqual([song]);
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
    expect(html).not.toContain('同步到SL歌单');
    expect(html).toContain('推送音箱');
    expect(html).toContain('查看歌曲');
    expect(html).toContain('data-action="view-custom-playlist"');
    expect(html).not.toContain('data-action="sync-custom-playlist"');
    expect(html).toContain('data-action="speaker-custom-playlist"');
    expect(html).not.toContain('播放歌单');
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
    expect(html).not.toContain('加入SL歌单');
    expect(html).toContain('推送音箱');
    expect(html).toContain('data-role="custom-playlist-song-check"');
    expect(html).toContain('data-action="add-selected-custom-playlist-songs"');
    expect(html).not.toContain('data-action="add-selected-custom-playlist-songs-to-songloft"');
    expect(html).not.toContain('data-action="add-custom-playlist-song-to-songloft"');
    expect(html).toContain('data-action="speaker-custom-playlist-song"');
    expect(html).not.toContain('>播放</button>');
    expect(html).not.toContain('kw-1');
  });

  it('paginates imported playlist song details', async () => {
    const { renderCustomPlaylistDetail } = await loadMusicModule();
    const songs = Array.from({ length: 45 }, (_, index) => ({
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

    expect(html).toContain('歌曲 21');
    expect(html).toContain('歌曲 40');
    expect(html).not.toContain('歌曲 20');
    expect(html).not.toContain('歌曲 41');
    expect(html).toContain('data-pagination="custom-playlist-detail"');
    expect(html).toContain('第 2 / 3 页');
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

});
