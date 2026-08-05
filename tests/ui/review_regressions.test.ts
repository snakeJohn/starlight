import { afterEach, describe, expect, it, vi } from 'vitest';

type FakeEvent = {
  currentTarget: FakeElement | null;
  target?: FakeElement;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};
type Listener = (event: FakeEvent) => unknown;

class FakeElement {
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  innerHTML = '';
  textContent = '';
  value = '';
  className = '';
  attributes: Record<string, string> = {};
  elements: Record<string, { value?: string; checked?: boolean }> = {};
  classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(): void {}

  async dispatch(type: string, target: FakeElement = this): Promise<void> {
    const event: FakeEvent = {
      currentTarget: this as FakeElement | null,
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
    event.currentTarget = null;
  }

  appendChild(): void {}
  remove(): void {}
  querySelector(): FakeElement | null { return null; }
  querySelectorAll(): FakeElement[] { return []; }
  closest(): FakeElement | null { return null; }
  insertAdjacentHTML(): void {}
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  removeAttribute(name: string): void { delete this.attributes[name]; }
}

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
}

function errorResponse(message: string) {
  return {
    ok: false,
    status: 500,
    statusText: 'Server Error',
    json: async () => ({ success: false, error: { message } }),
  } as Response;
}

/** Minimal document/window stubs; `elements` maps a selector to the node it resolves to. */
function installDom(elements: Map<string, unknown> = new Map()) {
  const toastNode = { className: '', textContent: '', remove: vi.fn() };
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => toastNode),
    getElementById: vi.fn(() => null),
    body: { appendChild: vi.fn(), classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() } },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    SongloftPlugin: { getAuthToken: () => '' },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('markup escaping for remote data', () => {
  it('escapes the MIoT account auth type in the account row', async () => {
    installDom();
    const { renderAccountRow } = await import('../../static/js/speaker_modules/devices.js') as {
      renderAccountRow(account: Record<string, unknown>): string;
    };

    const html = renderAccountRow({
      id: 'acc-1',
      account: '小明',
      auth_type: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('escapes LX sync device connect timestamps that are not valid dates', async () => {
    const deviceList = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="lx-sync-device-list"]', deviceList],
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({
      enabled: true,
      devices: [{
        deviceName: 'LX 桌面端',
        isMobile: false,
        lastConnectDate: '<img src=x onerror="alert(1)">',
      }],
    })));

    const { loadLxSyncConfig } = await import('../../static/js/music_modules/lx_sync.js') as {
      loadLxSyncConfig(options?: Record<string, unknown>): Promise<unknown>;
    };
    await loadLxSyncConfig();

    expect(deviceList.innerHTML).toContain('LX 桌面端');
    expect(deviceList.innerHTML).not.toContain('<img src=x');
    expect(deviceList.innerHTML).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});

describe('status strip re-render cost', () => {
  // doMock survives resetModules — drop the domain stubs so later suites load the real modules.
  afterEach(() => {
    vi.doUnmock('../../static/js/music.js');
    vi.doUnmock('../../static/js/speaker.js');
    vi.doUnmock('../../static/js/automation.js');
    vi.doUnmock('../../static/js/diagnostics.js');
  });

  it('only rebuilds the status strip for fields it actually renders', async () => {
    const statusStrip = new FakeElement();
    const stateListeners: Listener[] = [];
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      querySelector: vi.fn((selector: string) => (selector === '#statusStrip' ? statusStrip : null)),
      querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: Listener) => {
        if (type === 'starlight:state') stateListeners.push(listener);
      }),
      dispatchEvent: vi.fn(),
      SongloftPlugin: { getAuthToken: () => '' },
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    vi.doMock('../../static/js/music.js', () => ({ initMusicUI: vi.fn(async () => undefined) }));
    vi.doMock('../../static/js/speaker.js', () => ({ initSpeakerUI: vi.fn(async () => undefined) }));
    vi.doMock('../../static/js/automation.js', () => ({ initAutomationUI: vi.fn(async () => undefined) }));
    vi.doMock('../../static/js/diagnostics.js', () => ({ initDiagnosticsUI: vi.fn(async () => undefined) }));

    await import('../../static/js/app.js');
    const domReady = (globalThis.document.addEventListener as ReturnType<typeof vi.fn>).mock.calls
      .find(([type]) => type === 'DOMContentLoaded')?.[1] as () => void;
    domReady();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(stateListeners).toHaveLength(1);
    const notify = (detail: Record<string, unknown>) => (
      stateListeners[0] as unknown as (event: { detail: Record<string, unknown> }) => unknown
    )({ detail });

    statusStrip.innerHTML = 'SENTINEL';
    // Playback progress patches fire several times per second — they must not rebuild the strip.
    notify({ speakerPlayerState: 'playing', speakerPlayerCurrentIndex: 3 });
    expect(statusStrip.innerHTML).toBe('SENTINEL');

    notify({ message: '已连接' });
    expect(statusStrip.innerHTML).not.toBe('SENTINEL');
    expect(statusStrip.innerHTML).toContain('已连接');
  });
});

describe('download progress polling lifecycle', () => {
  it('stops polling once the batch is no longer active', async () => {
    installDom();
    const clearInterval = vi.fn();
    const setInterval = vi.fn(() => 4242);
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      setInterval,
      clearInterval,
      dispatchEvent: vi.fn(),
      SongloftPlugin: { getAuthToken: () => '' },
    });

    const progressStates = [
      { active: true, done: false, current: 1, total: 3 },
      { active: false },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(progressStates.shift() ?? { active: false })));

    const { loadDownloadProgress } = await import('../../static/js/music_modules/downloads.js') as {
      loadDownloadProgress(): Promise<unknown>;
    };

    await loadDownloadProgress();
    expect(setInterval).toHaveBeenCalledTimes(1);

    await loadDownloadProgress();
    expect(clearInterval).toHaveBeenCalledWith(4242);
  });
});

describe('repeat init does not duplicate listeners', () => {
  it('binds music UI source refresh only once across two initializations', async () => {
    const refreshSources = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-action="refresh-sources"]', refreshSources],
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/music/platforms')) return okResponse([{ id: 'kw', name: '酷我' }]);
      if (url.endsWith('/music/sources')) return okResponse([]);
      if (url.endsWith('/download/sources')) return okResponse([]);
      if (url.endsWith('/download/settings')) return okResponse({});
      if (url.endsWith('/download/batch/progress')) return okResponse({ active: false });
      if (url.endsWith('/custom-playlists')) return okResponse([]);
      if (url.endsWith('/songloft/playlists')) return okResponse([]);
      if (url.endsWith('/lx-sync/config')) return okResponse({ enabled: false });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { initMusicUI } = await import('../../static/js/music.js') as { initMusicUI(): Promise<void> };
    await initMusicUI();
    await initMusicUI();

    fetchMock.mockClear();
    await refreshSources.dispatch('click');

    const sourceCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/music/sources'));
    expect(sourceCalls).toHaveLength(1);
  });

  it('binds diagnostics log refresh only once across two initializations', async () => {
    const refreshLogs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-action="refresh-source-logs"]', refreshLogs],
    ]));
    const fetchMock = vi.fn(async () => okResponse({ logs: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const { initDiagnosticsUI } = await import('../../static/js/diagnostics.js') as {
      initDiagnosticsUI(): void;
    };
    initDiagnosticsUI();
    initDiagnosticsUI();

    fetchMock.mockClear();
    await refreshLogs.dispatch('click');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('speaker playlist loading', () => {
  it('fetches the Songloft playlist list once per refresh', async () => {
    const playlistSelect = new FakeElement();
    const playlistList = new FakeElement();
    const playlistSongs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="speaker-playlist-select"]', playlistSelect],
      ['[data-role="speaker-playlist-list"]', playlistList],
      ['[data-role="speaker-playlist-songs"]', playlistSongs],
    ]));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists') {
        return okResponse([
          { id: 41, name: '电台收藏', type: 'radio' },
          { id: 12, name: '收藏', type: 'normal', song_count: 1 },
        ]);
      }
      if (url === 'api/songloft/playlists/12/songs') return okResponse([{ title: '稻香' }]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { speakerPlaylistId: string };
    };
    state.speakerPlaylistId = '';
    const { loadSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      loadSpeakerPlaylists(): Promise<unknown[]>;
    };

    await loadSpeakerPlaylists();

    const listCalls = fetchMock.mock.calls.filter(([input]) => String(input) === 'api/songloft/playlists');
    expect(listCalls).toHaveLength(1);
    expect(playlistList.innerHTML).toContain('收藏');
  });

  it('refreshes the playlist list when a playlist songs response is marked expired', async () => {
    const playlistSelect = new FakeElement();
    const playlistList = new FakeElement();
    const playlistSongs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="speaker-playlist-select"]', playlistSelect],
      ['[data-role="speaker-playlist-list"]', playlistList],
      ['[data-role="speaker-playlist-songs"]', playlistSongs],
    ]));
    let songsRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists') {
        return okResponse([{ id: 12, name: '刷新后的歌单', type: 'normal', song_count: 1 }]);
      }
      if (url === 'api/songloft/playlists/12/songs') {
        songsRequestCount += 1;
        if (songsRequestCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { list: [], total: 0, expired: true },
            }),
          } as Response;
        }
        return okResponse([{ title: '新歌' }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { speakerPlaylistId: string; speakerPlaylists: unknown[] };
    };
    state.speakerPlaylistId = '12';
    state.speakerPlaylists = [{ id: 12, name: '过期快照', type: 'normal' }];
    const { loadSpeakerPlaylistSongs } = await import('../../static/js/speaker_modules/playlists.js') as {
      loadSpeakerPlaylistSongs(id?: string): Promise<unknown[]>;
    };

    await loadSpeakerPlaylistSongs('12');

    expect(songsRequestCount).toBe(2);
    expect(playlistList.innerHTML).toContain('刷新后的歌单');
    expect(playlistSongs.innerHTML).toContain('新歌');
  });

  it('replaces the loading placeholder when playlist songs fail to load', async () => {
    const playlistSongs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="speaker-playlist-songs"]', playlistSongs],
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('歌单不存在')));

    const { loadSpeakerPlaylistSongs } = await import('../../static/js/speaker_modules/playlists.js') as {
      loadSpeakerPlaylistSongs(id?: string): Promise<unknown[]>;
    };

    await expect(loadSpeakerPlaylistSongs('12')).rejects.toThrow('歌单不存在');
    expect(playlistSongs.innerHTML).not.toContain('正在加载歌单歌曲');
    expect(playlistSongs.innerHTML).toContain('歌单歌曲加载失败');
  });

  it('ignores a stale drawer song response after switching playlists', async () => {
    const drawerPlaylists = new FakeElement();
    const drawerSongs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="speaker-song-list-playlists"]', drawerPlaylists],
      ['[data-role="speaker-song-list-songs"]', drawerSongs],
    ]));

    let releaseStale: () => void = () => {};
    const stale = new Promise<void>(resolve => { releaseStale = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists/12/songs') {
        await stale;
        return okResponse([{ title: '旧歌单歌曲' }]);
      }
      if (url === 'api/songloft/playlists/15/songs') return okResponse([{ title: '新歌单歌曲' }]);
      throw new Error(`Unexpected request: ${url}`);
    }));

    const { state } = await import('../../static/js/state.js') as {
      state: { speakerPlaylistSongs: Array<{ title: string }>; speakerPlaylists: unknown[] };
    };
    state.speakerPlaylists = [];
    state.speakerPlaylistSongs = [];
    const { bindSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      bindSpeakerPlaylists(options?: Record<string, unknown>): void;
    };
    bindSpeakerPlaylists({});

    const rowFor = (id: string) => {
      const row = new FakeElement();
      row.dataset.id = id;
      row.closest = () => row;
      return row;
    };

    const slowClick = drawerPlaylists.dispatch('click', rowFor('12'));
    const fastClick = drawerPlaylists.dispatch('click', rowFor('15'));
    await fastClick;
    releaseStale();
    await slowClick;

    expect(state.speakerPlaylistSongs).toEqual([{ title: '新歌单歌曲' }]);
    expect(drawerSongs.innerHTML).toContain('新歌单歌曲');
    expect(drawerSongs.innerHTML).not.toContain('旧歌单歌曲');
  });

  it('ignores a stale expired drawer response after switching playlists', async () => {
    const drawerPlaylists = new FakeElement();
    const drawerSongs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="speaker-song-list-playlists"]', drawerPlaylists],
      ['[data-role="speaker-song-list-songs"]', drawerSongs],
    ]));

    let releaseStale: () => void = () => {};
    const stale = new Promise<void>(resolve => { releaseStale = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists/12/songs') {
        await stale;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [], expired: true }),
        } as Response;
      }
      if (url === 'api/songloft/playlists/15/songs') return okResponse([{ title: '新歌单歌曲' }]);
      if (url === 'api/songloft/playlists') return okResponse([]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: {
        speakerPlaylistId: string;
        speakerPlaylistSongs: Array<{ title: string }>;
        speakerPlaylists: unknown[];
      };
    };
    state.speakerPlaylistId = '';
    state.speakerPlaylists = [];
    state.speakerPlaylistSongs = [];
    const { bindSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      bindSpeakerPlaylists(options?: Record<string, unknown>): void;
    };
    bindSpeakerPlaylists({});

    const rowFor = (id: string) => {
      const row = new FakeElement();
      row.dataset.id = id;
      row.closest = () => row;
      return row;
    };

    const slowClick = drawerPlaylists.dispatch('click', rowFor('12'));
    const fastClick = drawerPlaylists.dispatch('click', rowFor('15'));
    await fastClick;
    releaseStale();
    await slowClick;

    expect(state.speakerPlaylistId).toBe('15');
    expect(state.speakerPlaylistSongs).toEqual([{ title: '新歌单歌曲' }]);
    expect(drawerSongs.innerHTML).toContain('新歌单歌曲');
    expect(fetchMock).not.toHaveBeenCalledWith('api/songloft/playlists', expect.anything());
  });

  it('does not clear a newer drawer selection while an expired-list refresh is pending', async () => {
    const drawerPlaylists = new FakeElement();
    const drawerSongs = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="speaker-song-list-playlists"]', drawerPlaylists],
      ['[data-role="speaker-song-list-songs"]', drawerSongs],
    ]));

    let releaseRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>(resolve => { releaseRefresh = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists/12/songs') return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [], expired: true }),
      } as Response;
      if (url === 'api/songloft/playlists') return refreshResponse;
      if (url === 'api/songloft/playlists/15/songs') return okResponse([{ title: '新歌单歌曲' }]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: {
        speakerPlaylistId: string;
        speakerPlaylistSongs: Array<{ title: string }>;
        speakerPlaylists: unknown[];
      };
    };
    state.speakerPlaylistId = '';
    state.speakerPlaylists = [];
    state.speakerPlaylistSongs = [];
    const { bindSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      bindSpeakerPlaylists(options?: Record<string, unknown>): void;
    };
    bindSpeakerPlaylists({});

    const rowFor = (id: string) => {
      const row = new FakeElement();
      row.dataset.id = id;
      row.closest = () => row;
      return row;
    };

    const staleClick = drawerPlaylists.dispatch('click', rowFor('12'));
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    const currentClick = drawerPlaylists.dispatch('click', rowFor('15'));
    await currentClick;
    releaseRefresh(okResponse([{ id: 15, name: '新歌单', type: 'normal' }]));
    await staleClick;

    expect(state.speakerPlaylistId).toBe('15');
    expect(state.speakerPlaylistSongs).toEqual([{ title: '新歌单歌曲' }]);
  });
});

describe('Songloft library panel error state', () => {
  it('replaces the loading placeholder when the songs request fails', async () => {
    const panel = new FakeElement();
    panel.hidden = true;
    const button = new FakeElement();
    const songsNode = new FakeElement();
    installDom(new Map<string, unknown>([
      ['[data-role="songloft-songs-panel"]', panel],
      ['[data-action="load-songloft-songs"]', button],
      ['[data-role="songloft-songs"]', songsNode],
    ]));
    vi.stubGlobal('fetch', vi.fn(async () => errorResponse('曲库不可用')));

    const { bindSongloftLibrary, setSongloftLibraryDependencies } = await import('../../static/js/music_modules/songloft_library.js') as {
      bindSongloftLibrary(): void;
      setSongloftLibraryDependencies(dependencies: Record<string, unknown>): void;
    };
    setSongloftLibraryDependencies({
      playSongloftSongOnSpeaker: vi.fn(),
      setControlDisabled: vi.fn(),
    });
    bindSongloftLibrary();

    await button.dispatch('click');

    expect(panel.hidden).toBe(false);
    expect(songsNode.innerHTML).not.toContain('正在加载 Songloft 歌曲库');
    expect(songsNode.innerHTML).toContain('加载失败：曲库不可用');
  });
});
