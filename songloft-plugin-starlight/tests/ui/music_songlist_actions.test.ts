import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicActionsModule {
  playSonglistOnSpeaker(songs: Array<Record<string, unknown>>): Promise<unknown>;
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
  });
}

async function loadModules() {
  const music = await import('../../static/js/music.js') as MusicActionsModule;
  const stateModule = await import('../../static/js/state.js') as StateModule;
  return { music, state: stateModule.state };
}

describe('songlist speaker actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('imports all detail songs before playing the first song on the selected speaker', async () => {
    installToastDom();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => okResponse({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { music, state } = await loadModules();
    state.accountId = 'miot-account';
    state.deviceId = 'speaker-1';
    const songs = [
      { title: '第一首', source_data: { platform: 'kw', songmid: 'a' } },
      { title: '第二首', source_data: { platform: 'kg', songmid: 'b' } },
    ];

    await music.playSonglistOnSpeaker(songs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/bridge/songs/import');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ songs });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('api/bridge/play-url');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      account_id: 'miot-account',
      device_id: 'speaker-1',
      song: songs[0],
    });
  });

  it('rejects empty songlists without calling bridge APIs', async () => {
    installToastDom();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { music } = await loadModules();

    await expect(music.playSonglistOnSpeaker([])).rejects.toThrow('歌单没有可播放歌曲');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
