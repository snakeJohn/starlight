import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicActionsModule {
  previewSong(song: Record<string, unknown>): Promise<unknown>;
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

function installMiniPlayerDom(audio: { play: ReturnType<typeof vi.fn> }) {
  const node = { className: '', textContent: '', remove: vi.fn() };
  const player = {
    innerHTML: '',
    querySelector: vi.fn((selector: string) => selector === 'audio' ? audio : null),
  };
  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => selector === '#miniPlayer' ? player : null),
    createElement: vi.fn(() => node),
    body: {
      appendChild: vi.fn(),
    },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
  });
  return player;
}

async function loadModules() {
  const musicModulePath = '../../static/js/music.js';
  const stateModulePath = '../../static/js/state.js';
  const music = await import(musicModulePath) as MusicActionsModule;
  const stateModule = await import(stateModulePath) as StateModule;
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

  it('starts page playback after resolving the preview URL', async () => {
    const audio = { play: vi.fn(async () => undefined) };
    const player = installMiniPlayerDom(audio);
    const fetchMock = vi.fn(async () => okResponse({ url: 'https://audio.test/song.mp3' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { music } = await loadModules();
    const song = { title: '晴天', artist: '周杰伦', source_data: { platform: 'kw', quality: '320k', songInfo: {} } };

    await music.previewSong(song);

    expect(fetchMock).toHaveBeenCalledWith('api/bridge/preview-url', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ song }),
    }));
    expect(player.innerHTML).toContain('https://audio.test/song.mp3');
    expect(audio.play).toHaveBeenCalled();
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
