import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicModule {
  renderSongloftSongRow(song: Record<string, unknown>, index: number): string;
  playSongloftSongOnSpeaker(song: Record<string, unknown>): Promise<unknown>;
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
});
