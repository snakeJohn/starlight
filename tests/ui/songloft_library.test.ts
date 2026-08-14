import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicModule {
  playSongloftSongOnSpeaker(song: Record<string, unknown>): Promise<unknown>;
}

interface RenderersModule {
  renderSongloftSongRow(song: Record<string, unknown>, index: number): string;
  renderSongloftPlaylistRow(song: Record<string, unknown>, index: number): string;
}

interface SongloftLibraryModule {
  setSongloftLibraryPanelExpanded(kind: string, expanded: boolean): boolean;
  setSongloftLibraryDependencies(dependencies: Record<string, unknown>): void;
  bindSongloftLibrary(): void;
}

interface StateModule {
  state: {
    accountId: string;
    deviceId: string;
    songloftPlaylists: Array<Record<string, unknown>>;
  };
}

type FakeEvent = { currentTarget: FakeElement | null; target: FakeElement };
type Listener = (event: FakeEvent) => unknown;

class FakeElement {
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  innerHTML = '';
  textContent = '';
  value = '';
  classList = { toggle: vi.fn() };
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type: string, target: FakeElement = this): Promise<void> {
    const event: FakeEvent = { currentTarget: this, target };
    for (const listener of this.listeners.get(type) || []) await listener(event);
    event.currentTarget = null;
  }

  closest(_selector: string): FakeElement | null { return null; }
  querySelector(_selector: string): FakeElement | null { return null; }
  setAttribute(_name: string, _value: string): void {}
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

async function loadModules() {
  const music = await import('../../static/js/music.js') as MusicModule;
  const renderers = await import('../../static/js/music_modules/renderers.js') as RenderersModule;
  const library = await import('../../static/js/music_modules/songloft_library.js') as SongloftLibraryModule;
  const stateModule = await import('../../static/js/state.js') as StateModule;
  return { music, renderers, library, state: stateModule.state };
}

describe('Songloft library UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('renders Songloft songs with speaker actions without exposing raw ids', async () => {
    const { renderers } = await loadModules();

    const html = renderers.renderSongloftSongRow({
      id: 501,
      title: '本地歌曲',
      artist: '歌手',
      album: '专辑',
      cover_url: 'https://img.test/local.jpg',
    }, 2);

    expect(html).toContain('https://img.test/local.jpg');
    expect(html).toContain('本地歌曲');
    expect(html).toContain('歌手');
    expect(html).toContain('data-action="speaker-songloft-song"');
    expect(html).toContain('>播放</button>');
    expect(html).toContain('data-index="2"');
    expect(html).not.toContain('>501<');
  });

  it('renders Songloft playlist rows with custom playlist import actions', async () => {
    const { renderers } = await loadModules();

    const html = renderers.renderSongloftPlaylistRow({
      id: 88,
      name: 'Songloft 收藏',
      song_count: 12,
    }, 1);

    expect(html).toContain('Songloft 收藏');
    expect(html).toContain('data-action="view-songloft-playlist"');
    expect(html).toContain('data-action="import-songloft-playlist-to-custom"');
    expect(html).toContain('导入我的歌单');
    expect(html).not.toContain('>88<');
  });

  it('posts Songloft songs to the plugin speaker endpoint', async () => {
    installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ message: 'song started' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { music, state } = await loadModules();
    state.accountId = 'acc-1';
    state.deviceId = 'dev-1';
    const song = { id: 501, title: '本地歌曲', artist: '歌手' };

    await music.playSongloftSongOnSpeaker(song);

    expect(fetchMock).toHaveBeenCalledWith('api/songloft/player/song', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        account_id: 'acc-1',
        device_id: 'dev-1',
        song,
      }),
    }));
  });

  it('can expand and collapse Songloft library sections independently', async () => {
    const panel = {
      hidden: true,
      setAttribute: vi.fn(),
    };
    const button = {
      classList: { toggle: vi.fn() },
      setAttribute: vi.fn(),
    };
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => {
        if (selector === '[data-role="songloft-songs-panel"]') return panel;
        if (selector === '[data-action="load-songloft-songs"]') return button;
        return null;
      }),
      createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    const { library } = await loadModules();

    expect(library.setSongloftLibraryPanelExpanded('songs', true)).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(button.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');
    expect(button.classList.toggle).toHaveBeenCalledWith('selected-action', true);

    expect(library.setSongloftLibraryPanelExpanded('songs', false)).toBe(true);
    expect(panel.hidden).toBe(true);
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-expanded', 'false');
    expect(button.classList.toggle).toHaveBeenLastCalledWith('selected-action', false);
  });

  it('paginates large Songloft playlists with stable source indices and resets on playlist change', async () => {
    const playlistList = new FakeElement();
    const playlistSongs = new FakeElement();
    const playlistTitle = new FakeElement();
    const playlistTotal = new FakeElement();
    const pagination = new FakeElement();
    const elements = new Map<string, FakeElement>([
      ['[data-role="songloft-playlists"]', playlistList],
      ['[data-role="songloft-playlist-songs"]', playlistSongs],
      ['[data-role="songloft-playlist-title"]', playlistTitle],
      ['[data-role="songloft-playlist-songs-total"]', playlistTotal],
      ['[data-role="songloft-playlist-songs-pagination"]', pagination],
    ]);
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
      createElement: vi.fn(() => new FakeElement()),
      body: new FakeElement(),
    });
    vi.stubGlobal('window', { setTimeout: vi.fn(), dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

    const firstSongs = Array.from({ length: 45 }, (_, index) => ({
      id: index + 1,
      title: `甲歌 ${index + 1}`,
      artist: '甲',
    }));
    const secondSongs = Array.from({ length: 25 }, (_, index) => ({
      id: index + 101,
      title: `乙歌 ${index + 1}`,
      artist: '乙',
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/12/songs')) return okResponse(firstSongs) as Response;
      if (url.endsWith('/13/songs')) return okResponse(secondSongs) as Response;
      throw new Error(`Unexpected request: ${url}`);
    }));

    const { library, state } = await loadModules();
    state.songloftPlaylists = [
      { id: 12, name: '甲歌单' },
      { id: 13, name: '乙歌单' },
    ];
    library.setSongloftLibraryDependencies({
      playSongloftSongOnSpeaker: vi.fn(),
      setControlDisabled: vi.fn(),
    });
    library.bindSongloftLibrary();

    const firstPlaylistButton = new FakeElement();
    firstPlaylistButton.dataset.action = 'view-songloft-playlist';
    firstPlaylistButton.dataset.index = '0';
    firstPlaylistButton.closest = vi.fn(() => firstPlaylistButton);
    await playlistList.dispatch('click', firstPlaylistButton);

    expect(playlistSongs.innerHTML.match(/data-action="speaker-songloft-song"/g)).toHaveLength(20);
    expect(playlistSongs.innerHTML).toContain('甲歌 20');
    expect(playlistSongs.innerHTML).not.toContain('甲歌 21');

    const pageRoot = new FakeElement();
    pageRoot.dataset.page = '1';
    pageRoot.dataset.totalPages = '3';
    pageRoot.dataset.pagination = 'songloft-playlist-songs';
    const nextButton = new FakeElement();
    nextButton.dataset.pageAction = 'next';
    nextButton.closest = vi.fn((selector: string) => (
      selector === '[data-page-action]' ? nextButton : pageRoot
    ));
    await pagination.dispatch('click', nextButton);

    expect(playlistSongs.innerHTML.match(/data-action="speaker-songloft-song"/g)).toHaveLength(20);
    expect(playlistSongs.innerHTML).toContain('甲歌 21');
    expect(playlistSongs.innerHTML).toContain('data-index="20"');
    expect(playlistSongs.innerHTML).not.toContain('甲歌 1</strong>');

    const secondPlaylistButton = new FakeElement();
    secondPlaylistButton.dataset.action = 'view-songloft-playlist';
    secondPlaylistButton.dataset.index = '1';
    secondPlaylistButton.closest = vi.fn(() => secondPlaylistButton);
    await playlistList.dispatch('click', secondPlaylistButton);

    expect(playlistSongs.innerHTML).toContain('乙歌 1');
    expect(playlistSongs.innerHTML).not.toContain('乙歌 21');
    expect(pagination.innerHTML).toContain('data-page="1"');
  });
});
