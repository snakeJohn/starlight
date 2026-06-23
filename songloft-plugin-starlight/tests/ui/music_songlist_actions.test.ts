import { afterEach, describe, expect, it, vi } from 'vitest';

interface MusicActionsModule {
  previewSong(song: Record<string, unknown>): Promise<unknown>;
  downloadSong(song: Record<string, unknown>): Promise<unknown>;
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
  const appendChild = vi.fn();
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(() => node),
    body: {
      appendChild,
    },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
  });
  return { node, appendChild };
}

function installNativePlayerDom() {
  const node = { className: '', textContent: '', remove: vi.fn() };
  const postMessage = vi.fn();
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
    parent: { postMessage },
  });
  vi.stubGlobal('CustomEvent', class {
    type: string;
    detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  });
  return { postMessage };
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

  it('plays all detail songs as a speaker queue after importing them', async () => {
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe('api/bridge/play-songlist');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      account_id: 'miot-account',
      device_id: 'speaker-1',
      songs,
    });
  });

  it('queues plugin local playback after importing the song into Songloft', async () => {
    const { postMessage } = installNativePlayerDom();
    const nativeSong = { id: 99, type: 'remote', title: '晴天', artist: '周杰伦' };
    const fetchMock = vi.fn(async () => okResponse({ total: 1, songs: [nativeSong] }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { music } = await loadModules();
    const { state } = await import('../../static/js/state.js') as { state: { pluginPlayerQueue: unknown[]; pluginPlayerIndex: number; pluginPlayerState: string } };
    const song = { title: '晴天', artist: '周杰伦', source_data: { platform: 'kw', quality: '320k', songInfo: {} } };

    await music.previewSong(song);

    expect(fetchMock).toHaveBeenCalledWith('api/bridge/songs/import', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ songs: [song] }),
    }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'songloft:native-player:play',
      songs: [nativeSong],
      startIndex: 0,
    }, '*');
    expect(state.pluginPlayerQueue).toEqual([nativeSong]);
    expect(state.pluginPlayerIndex).toBe(0);
    expect(state.pluginPlayerState).toBe('playing');
  });

  it('starts one-song downloads through the background download endpoint', async () => {
    const { node } = installToastDom();
    const fetchMock = vi.fn(async () => okResponse({ started: true, total: 1 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { music } = await loadModules();
    const song = { title: 'Song', artist: 'Singer', source_data: { platform: 'kw', quality: '320k', songInfo: {} } };

    await expect(music.downloadSong(song)).resolves.toMatchObject({ started: true, total: 1 });

    expect(fetchMock).toHaveBeenCalledWith('api/download/song', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ song }),
    }));
    expect(node.textContent).toBe('已开始下载 1 首歌曲，可在下载进度中查看');
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
