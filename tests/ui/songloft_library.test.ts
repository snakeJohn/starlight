import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicModule {
  renderSongloftSongRow(song: Record<string, unknown>, index: number): string;
  playSongloftSongOnSpeaker(song: Record<string, unknown>): Promise<unknown>;
  setSongloftLibraryPanelExpanded(kind: string, expanded: boolean): boolean;
}

interface StateModule {
  state: {
    accountId: string;
    deviceId: string;
  };
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
  const stateModule = await import('../../static/js/state.js') as StateModule;
  return { music, state: stateModule.state };
}

describe('Songloft library UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders Songloft songs with speaker actions without exposing raw ids', async () => {
    const { music } = await loadModules();

    const html = music.renderSongloftSongRow({
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
    expect(html).toContain('>推送音箱</button>');
    expect(html).toContain('data-index="2"');
    expect(html).not.toContain('>501<');
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
    const { music } = await loadModules();

    expect(music.setSongloftLibraryPanelExpanded('songs', true)).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(button.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');
    expect(button.classList.toggle).toHaveBeenCalledWith('selected-action', true);

    expect(music.setSongloftLibraryPanelExpanded('songs', false)).toBe(true);
    expect(panel.hidden).toBe(true);
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-expanded', 'false');
    expect(button.classList.toggle).toHaveBeenLastCalledWith('selected-action', false);
  });
});
