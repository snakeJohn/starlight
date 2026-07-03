import { afterEach, describe, expect, it, vi } from 'vitest';

interface SpeakerPlayerModule {
  renderPlayerStatus(status: Record<string, unknown>): void;
  runPlayerAction(action: string, options?: Record<string, unknown>): Promise<unknown>;
  bindProgressInteraction(): void;
}

interface SpeakerModule {
  initSpeakerUI(): Promise<void>;
}

type FakeEvent = {
  currentTarget: FakeElement | null;
  target?: FakeElement;
  clientX?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};
type Listener = (event: FakeEvent) => unknown;

class FakeElement {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  disabled = false;
  hidden = false;
  innerHTML = '';
  src = '';
  textContent = '';
  title = '';
  value = '';
  className = '';
  attributes: Record<string, string> = {};
  classList = {
    add: (...tokens: string[]) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      tokens.forEach(token => classes.add(token));
      this.className = Array.from(classes).join(' ');
    },
    remove: (...tokens: string[]) => {
      const removeSet = new Set(tokens);
      this.className = this.className.split(/\s+/).filter(token => token && !removeSet.has(token)).join(' ');
    },
    toggle: (token: string, force?: boolean) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const shouldAdd = force ?? !classes.has(token);
      if (shouldAdd) classes.add(token);
      else classes.delete(token);
      this.className = Array.from(classes).join(' ');
      return shouldAdd;
    },
    contains: (token: string) => this.className.split(/\s+/).includes(token),
  };
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) || [];
    this.listeners.set(type, current.filter(item => item !== listener));
  }

  async dispatch(type: string, target: FakeElement = this, extra: Partial<FakeEvent> = {}): Promise<void> {
    const event: FakeEvent = {
      currentTarget: this as FakeElement | null,
      target,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...extra,
    };
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      await listener(event);
    }
    event.currentTarget = null;
  }

  appendChild(): void {}
  remove(): void {}
  querySelector(_selector: string): FakeElement | null { return null; }
  closest(_selector: string): FakeElement | null { return null; }
  getBoundingClientRect(): { left: number; width: number } { return { left: 0, width: 200 }; }
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

function installDom() {
  const node = { className: '', textContent: '', remove: vi.fn() };
  const speakerPlayerState = { textContent: '' };
  const speakerPlayerTitle = { textContent: '' };
  const speakerPlayerMeta = { textContent: '' };
  const speakerPlayerMode = { value: 'order' };
  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => {
      if (selector === '[data-role="speaker-player-state"]') return speakerPlayerState;
      if (selector === '[data-role="speaker-player-title"]') return speakerPlayerTitle;
      if (selector === '[data-role="speaker-player-meta"]') return speakerPlayerMeta;
      if (selector === '[data-role="speaker-player-mode"]') return speakerPlayerMode;
      return null;
    }),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => node),
    body: {
      appendChild: vi.fn(),
    },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
}

function installPlayerRenderDom() {
  const selectors = [
    '[data-role="speaker-player-state"]',
    '[data-role="speaker-player-title"]',
    '[data-role="speaker-player-meta"]',
    '[data-role="speaker-player-mode"]',
    '[data-role="speaker-player-cover"]',
    '[data-role="speaker-player-lyric"]',
    '[data-role="speaker-player-current-time"]',
    '[data-role="speaker-player-total-time"]',
    '[data-role="speaker-player-progress"]',
    '[data-role="speaker-player-progress-thumb"]',
    '[data-role="speaker-player-play-icon"]',
    '[data-role="speaker-player-mode-icon"]',
    '[data-role="global-player-state"]',
    '[data-role="global-player-title"]',
    '[data-role="global-player-artist"]',
    '[data-role="global-player-lyric"]',
    '[data-role="global-player-current-time"]',
    '[data-role="global-player-total-time"]',
    '[data-role="global-player-progress"]',
    '[data-role="global-player-progress-thumb"]',
    '[data-role="global-player-play-icon"]',
    '[data-role="global-player-mode-icon"]',
    '[data-role="global-player-cover"]',
    '[data-role="fullscreen-player-title"]',
    '[data-role="fullscreen-player-artist"]',
    '[data-role="fullscreen-player-current-time"]',
    '[data-role="fullscreen-player-total-time"]',
    '[data-role="fullscreen-player-progress"]',
    '[data-role="fullscreen-player-progress-thumb"]',
    '[data-role="fullscreen-player-play-icon"]',
    '[data-role="fullscreen-player-mode-icon"]',
    '[data-role="fullscreen-player-cover"]',
    '[data-role="fullscreen-player-bg"]',
  ];
  const elements = new Map<string, FakeElement>(selectors.map(selector => [selector, new FakeElement()]));
  const progressTracks = new Map<string, FakeElement>();
  for (const scope of ['speaker-player', 'global-player', 'fullscreen-player']) {
    const track = new FakeElement();
    elements.get(`[data-role="${scope}-progress"]`)!.parentElement = track;
    progressTracks.set(scope, track);
  }
  const documentNode = new FakeElement();
  const toggleButton = new FakeElement();
  const globalToggleButton = new FakeElement();
  toggleButton.querySelector = vi.fn((selector: string) => {
    if (selector.includes('speaker-player-play-icon')) return elements.get('[data-role="speaker-player-play-icon"]') ?? null;
    return null;
  });
  globalToggleButton.querySelector = vi.fn((selector: string) => {
    if (selector.includes('global-player-play-icon')) return elements.get('[data-role="global-player-play-icon"]') ?? null;
    return null;
  });

  vi.stubGlobal('document', Object.assign(documentNode, {
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '[data-action="speaker-player-toggle"]') return [toggleButton, globalToggleButton];
      return [];
    }),
    createElement: vi.fn(() => new FakeElement()),
    body: new FakeElement(),
  }));
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
  vi.stubGlobal('performance', { now: () => 1000 });

  return { elements, toggleButton, globalToggleButton, progressTracks, documentNode };
}

async function flushPromises() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function installInteractiveDom() {
  const nextButton = new FakeElement();
  const speakerPlayerState = new FakeElement();
  const speakerPlayerTitle = new FakeElement();
  const speakerPlayerMeta = new FakeElement();
  const speakerPlayerMode = new FakeElement();
  speakerPlayerMode.value = 'order';
  const voiceRecordSummary = new FakeElement();
  const voiceRecordList = new FakeElement();
  const elements = new Map<string, FakeElement>([
    ['[data-action="speaker-player-next"]', nextButton],
    ['[data-role="speaker-player-state"]', speakerPlayerState],
    ['[data-role="speaker-player-title"]', speakerPlayerTitle],
    ['[data-role="speaker-player-meta"]', speakerPlayerMeta],
    ['[data-role="speaker-player-mode"]', speakerPlayerMode],
    ['[data-role="voice-record-summary"]', voiceRecordSummary],
    ['[data-role="voice-record-list"]', voiceRecordList],
    ['[data-role="account-list"]', new FakeElement()],
    ['[data-role="account-select"]', new FakeElement()],
    ['[data-role="auth-summary"]', new FakeElement()],
    ['[data-role="device-list"]', new FakeElement()],
    ['[data-role="device-select"]', new FakeElement()],
    ['[data-role="speaker-player-device"]', new FakeElement()],
  ]);

  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
    querySelectorAll: vi.fn((selector: string) => selector === '[data-action="speaker-player-toggle"]' ? [] : []),
    createElement: vi.fn(() => new FakeElement()),
    body: new FakeElement(),
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    setInterval: vi.fn(),
    clearInterval: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

  return { nextButton, speakerPlayerState };
}

describe('speaker player module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sends speaker player commands through the MIoT playlist endpoints', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({ message: 'playing next song' }));
    vi.stubGlobal('fetch', fetchMock);

    const stateModulePath = '../../static/js/state.js';
    const modulePath = '../../static/js/speaker_modules/player.js';
    const { state } = await import(stateModulePath) as { state: { accountId: string; deviceId: string } };
    const { runPlayerAction } = await import(modulePath) as SpeakerPlayerModule;
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    await runPlayerAction('speaker-player-next');

    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/next', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'acc-1', device_id: 'speaker-1' }),
    }));
  });

  it('keeps speaker player button clicks working after speaker UI initialization', async () => {
    const { nextButton, speakerPlayerState } = installInteractiveDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/accounts') || url.endsWith('/miot/auth/status')) {
        return okResponse([{ id: 'acc-1', account: '小米账号' }]);
      }
      if (url.endsWith('/miot/mina/devices?account_id=acc-1') || url.endsWith('/miot/mina/devices')) {
        return okResponse([{
          account_id: 'acc-1',
          account_name: '小米账号',
          devices: [{ device_id: 'speaker-1', name: '客厅音箱' }],
        }]);
      }
      if (url.includes('/miot/conversation/messages')) {
        return okResponse([]);
      }
      if (url.includes('/miot/player/status')) {
        return okResponse({
          state: 'playing',
          play_mode: 'order',
          position: 12,
          duration: 120,
          current_song: { title: '稻香', artist: '周杰伦' },
        });
      }
      if (url.endsWith('/miot/player/next')) {
        return okResponse({ message: 'queued' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const stateModulePath = '../../static/js/state.js';
    const modulePath = '../../static/js/speaker.js';
    const { state } = await import(stateModulePath) as { state: { accountId: string; deviceId: string } };
    const { initSpeakerUI } = await import(modulePath) as SpeakerModule;
    await initSpeakerUI();
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    await expect(nextButton.dispatch('click')).resolves.toBeUndefined();
    expect(speakerPlayerState.textContent).toBe('控制命令已发送');
  });

  it('renders the persistent bottom player and speaker panel from player status', async () => {
    const { elements, toggleButton, globalToggleButton } = installPlayerRenderDom();

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { renderPlayerStatus } = await import(modulePath) as SpeakerPlayerModule;

    renderPlayerStatus({
      state: 'playing',
      is_playing: true,
      play_mode: 'loop',
      position: 65,
      duration: 245,
      current_song: {
        title: '夜曲',
        artist: '周杰伦',
      },
    });

    expect(elements.get('[data-role="global-player-title"]')?.textContent).toBe('夜曲');
    expect(elements.get('[data-role="global-player-artist"]')?.textContent).toBe('周杰伦');
    expect(elements.get('[data-role="global-player-current-time"]')?.textContent).toBe('1:05');
    expect(elements.get('[data-role="global-player-total-time"]')?.textContent).toBe('4:05');
    expect(elements.get('[data-role="global-player-progress"]')?.style.width).toBe('26.5%');
    expect(elements.get('[data-role="global-player-play-icon"]')?.className).toContain('fa-pause');
    expect(elements.get('[data-role="global-player-mode-icon"]')?.className).toContain('fa-redo');
    expect(elements.get('[data-role="speaker-player-title"]')?.textContent).toBe('夜曲 - 周杰伦');
    expect(elements.get('[data-role="speaker-player-current-time"]')?.textContent).toBe('1:05');
    expect(elements.get('[data-role="speaker-player-play-icon"]')?.className).toContain('fa-pause');
    expect(elements.get('[data-role="fullscreen-player-title"]')?.textContent).toBe('夜曲');
    expect(elements.get('[data-role="fullscreen-player-play-icon"]')?.className).toContain('fa-pause');
    expect(toggleButton.textContent).toBe('');
    expect(globalToggleButton.textContent).toBe('');
  });

  it('sets the selected play mode instead of cycling modes implicitly', async () => {
    const { elements } = installPlayerRenderDom();
    elements.get('[data-role="speaker-player-mode"]')!.value = 'loop';
    const fetchMock = vi.fn(async () => okResponse({ play_mode: 'random' }));
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string; speakerPlayerPlaylistId: string; };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';
    state.speakerPlayerPlaylistId = '12';

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { runPlayerAction } = await import(modulePath) as SpeakerPlayerModule;

    await runPlayerAction('speaker-player-mode', { playMode: 'random' });

    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/mode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        account_id: 'acc-1',
        device_id: 'speaker-1',
        play_mode: 'random',
      }),
    }));
    expect(elements.get('[data-role="speaker-player-mode"]')?.value).toBe('random');
  });

  it('loads authenticated cover and lyric assets for the current song', async () => {
    const { elements } = installPlayerRenderDom();
    const lyricBlob = { text: async () => JSON.stringify({ lyric: '[00:10.00]到这里都是你\n[00:20.00]下一句' }) };
    const coverBlob = { text: async () => '' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        status: 200,
        blob: async () => url.endsWith('/lyric') ? lyricBlob : coverBlob,
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:cover-url'),
      revokeObjectURL: vi.fn(),
    });

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { renderPlayerStatus } = await import(modulePath) as SpeakerPlayerModule;

    renderPlayerStatus({
      state: 'playing',
      is_playing: true,
      position: 11,
      duration: 180,
      current_song: {
        title: '星晴',
        artist: '周杰伦',
        cover_url: '/api/v1/songs/1/cover',
        lyric_url: '/api/v1/songs/1/lyric',
      },
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/songs/1/cover', expect.objectContaining({
      headers: { Authorization: 'Bearer ui-token' },
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/songs/1/lyric', expect.objectContaining({
      headers: { Authorization: 'Bearer ui-token' },
    }));
    expect(elements.get('[data-role="global-player-cover"]')?.src).toBe('blob:cover-url');
    expect(elements.get('[data-role="speaker-player-cover"]')?.src).toBe('blob:cover-url');
    expect(elements.get('[data-role="global-player-lyric"]')?.textContent).toBe('到这里都是你');
    expect(elements.get('[data-role="speaker-player-lyric"]')?.textContent).toBe('到这里都是你');
  });

  it('does not send a seek request when the speaker transport is not seekable', async () => {
    const { progressTracks } = installPlayerRenderDom();
    const fetchMock = vi.fn(async () => okResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { renderPlayerStatus, bindProgressInteraction } = await import(modulePath) as SpeakerPlayerModule;

    renderPlayerStatus({
      state: 'playing',
      is_playing: true,
      position: 12,
      duration: 120,
      can_seek: false,
      current_song: { title: '夜曲', artist: '周杰伦' },
    });
    bindProgressInteraction();

    await progressTracks.get('global-player')!.dispatch('mousedown', progressTracks.get('global-player')!, { clientX: 100 });

    expect(fetchMock).not.toHaveBeenCalledWith('api/miot/player/seek', expect.anything());
    expect(progressTracks.get('global-player')?.attributes['aria-disabled']).toBe('true');
  });

  it('sends one seek request for a complete drag when future seek support is enabled', async () => {
    const { progressTracks, documentNode } = installPlayerRenderDom();
    const fetchMock = vi.fn(async () => okResponse({ position: 60 }));
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { renderPlayerStatus, bindProgressInteraction } = await import(modulePath) as SpeakerPlayerModule;

    renderPlayerStatus({
      state: 'playing',
      is_playing: true,
      position: 12,
      duration: 120,
      can_seek: true,
      current_song: { title: '夜曲', artist: '周杰伦' },
    });
    bindProgressInteraction();

    const track = progressTracks.get('global-player')!;
    await track.dispatch('mousedown', track, { clientX: 100 });
    await documentNode.dispatch('mouseup', documentNode, { clientX: 100 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/seek', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        account_id: 'acc-1',
        device_id: 'speaker-1',
        position: 60,
      }),
    }));
  });
});

describe('speaker lrc parser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('parses timed lyric lines and returns the active line for a position', async () => {
    const modulePath = '../../static/js/speaker_modules/lrc_parser.js';
    const { parseLrc, getCurrentLyricIndex } = await import(modulePath) as {
      parseLrc(text: string): Array<{ time: number; text: string }>;
      getCurrentLyricIndex(lines: Array<{ time: number; text: string }>, position: number): number;
    };

    const lyrics = parseLrc('[00:01.00]第一句\n[00:05.50]第二句\n[00:05.50][00:08.00]重复行');

    expect(lyrics).toEqual([
      { time: 1, text: '第一句' },
      { time: 5.5, text: '第二句' },
      { time: 5.5, text: '重复行' },
      { time: 8, text: '重复行' },
    ]);
    expect(getCurrentLyricIndex(lyrics, 6)).toBe(2);
  });
});

describe('speaker playlist browser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('clears stale songs when the refreshed Songloft playlist list has no normal playlists', async () => {
    const playlistSelect = new FakeElement();
    const playlistList = new FakeElement();
    const playlistSongs = new FakeElement();
    const playlistSummary = new FakeElement();
    playlistSongs.innerHTML = '<div>旧歌曲</div>';

    const elements = new Map<string, FakeElement>([
      ['[data-role="speaker-playlist-select"]', playlistSelect],
      ['[data-role="speaker-playlist-list"]', playlistList],
      ['[data-role="speaker-playlist-songs"]', playlistSongs],
      ['[data-role="speaker-playlist-summary"]', playlistSummary],
    ]);

    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => new FakeElement()),
      body: new FakeElement(),
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    vi.stubGlobal('fetch', vi.fn(async () => okResponse([
      { id: 98, name: '电台收藏', type: 'radio', song_count: 0 },
    ])));

    const { state } = await import('../../static/js/state.js') as {
      state: { speakerPlaylistId: string; speakerPlaylistSongs: unknown[] };
    };
    state.speakerPlaylistId = '12';
    state.speakerPlaylistSongs = [{ title: '旧歌曲' }];

    const { loadSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      loadSpeakerPlaylists(): Promise<unknown[]>;
    };

    await loadSpeakerPlaylists();

    expect(state.speakerPlaylistId).toBe('');
    expect(state.speakerPlaylistSongs).toEqual([]);
    expect(playlistSelect.innerHTML).not.toContain('电台收藏');
    expect(playlistList.innerHTML).toContain('暂无 Songloft 普通歌单');
    expect(playlistSongs.innerHTML).toContain('请选择歌单');
  });

  it('shows only normal Songloft playlists in the speaker browser and selects the first playable playlist', async () => {
    const playlistSelect = new FakeElement();
    const playlistList = new FakeElement();
    const playlistSongs = new FakeElement();
    const playlistSummary = new FakeElement();

    const elements = new Map<string, FakeElement>([
      ['[data-role="speaker-playlist-select"]', playlistSelect],
      ['[data-role="speaker-playlist-list"]', playlistList],
      ['[data-role="speaker-playlist-songs"]', playlistSongs],
      ['[data-role="speaker-playlist-summary"]', playlistSummary],
    ]);

    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => new FakeElement()),
      body: new FakeElement(),
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'api/songloft/playlists') {
        return okResponse([
          { id: 41, name: '电台收藏', type: 'radio', song_count: 0 },
          { id: 12, name: '收藏', type: 'normal', song_count: 6, cover_url: 'https://img.test/cover.jpg' },
          { id: 15, name: '网络音乐', type: 'normal', song_count: 0 },
        ]);
      }
      if (url === 'api/songloft/playlists/12/songs') {
        return okResponse([{ title: '稻香', artist: '周杰伦', duration: 210 }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: {
        speakerPlaylistId: string;
        speakerPlaylists: Array<{ id: number; name: string; type: string }>;
        speakerPlaylistSongs: Array<{ title: string }>;
      };
    };

    const { loadSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      loadSpeakerPlaylists(): Promise<Array<{ id: number; name: string; type: string }>>;
    };

    const playlists = await loadSpeakerPlaylists();

    expect(playlists.map(playlist => playlist.name)).toEqual(['收藏', '网络音乐']);
    expect(state.speakerPlaylists.map(playlist => playlist.name)).toEqual(['收藏', '网络音乐']);
    expect(state.speakerPlaylistId).toBe('12');
    expect(state.speakerPlaylistSongs).toEqual([{ title: '稻香', artist: '周杰伦', duration: 210 }]);
    expect(playlistSelect.innerHTML).toContain('收藏');
    expect(playlistSelect.innerHTML).not.toContain('电台收藏');
    expect(playlistList.innerHTML).toContain('speaker-playlist-count');
    expect(playlistList.innerHTML).toContain('普通歌单');
    expect(playlistList.innerHTML).not.toContain('电台收藏');
    expect(playlistSummary.textContent).toBe('1 首');
    expect(fetchMock).toHaveBeenCalledWith('api/songloft/playlists/12/songs', expect.any(Object));
  });

  it('plays a clicked Songloft playlist song through the MIoT playlist endpoint', async () => {
    const playlistSongs = new FakeElement();
    const speakerPlayerMode = new FakeElement();
    speakerPlayerMode.value = 'random';
    const elements = new Map<string, FakeElement>([
      ['[data-role="speaker-playlist-songs"]', playlistSongs],
      ['[data-role="speaker-player-mode"]', speakerPlayerMode],
    ]);

    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => new FakeElement()),
      body: new FakeElement(),
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
    const fetchMock = vi.fn(async () => okResponse({ message: 'playlist started' }));
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: {
        accountId: string;
        deviceId: string;
        speakerPlaylists: Array<{ id: number; name: string }>;
        speakerPlaylistId: string;
        speakerPlaylistSongs: Array<{ title: string }>;
      };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';
    state.speakerPlaylists = [{ id: 12, name: '测试歌单' }];
    state.speakerPlaylistId = '12';
    state.speakerPlaylistSongs = [{ title: '第一首' }, { title: '第二首' }];

    const { bindSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      bindSpeakerPlaylists(options?: { refreshPlayerStatus?: () => Promise<unknown> }): void;
    };
    const refreshPlayerStatus = vi.fn(async () => null);
    bindSpeakerPlaylists({ refreshPlayerStatus });

    const songButton = new FakeElement();
    songButton.dataset.index = '1';
    songButton.closest = vi.fn((selector: string) => (
      selector === '[data-action="speaker-playlist-song"]' ? songButton : null
    ));

    await playlistSongs.dispatch('click', songButton);

    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/play', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        account_id: 'acc-1',
        device_id: 'speaker-1',
        playlist_id: 12,
        start_index: 1,
        play_mode: 'random',
      }),
    }));
    expect(refreshPlayerStatus).toHaveBeenCalledTimes(1);
  });

  it('opens a right-sliding drawer with playlist and song list, then plays a selected song', async () => {
    const drawer = new FakeElement();
    const playlistsContainer = new FakeElement();
    const songsContainer = new FakeElement();
    const speakerPlayerMode = new FakeElement();
    speakerPlayerMode.value = 'loop';
    drawer.className = 'speaker-song-list-drawer';
    const elements = new Map<string, FakeElement>([
      ['[data-role="speaker-song-list-drawer"]', drawer],
      ['[data-role="speaker-song-list-playlists"]', playlistsContainer],
      ['[data-role="speaker-song-list-songs"]', songsContainer],
      ['[data-role="speaker-player-mode"]', speakerPlayerMode],
    ]);

    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === '[data-action="speaker-player-song-list"]') return [new FakeElement()];
        if (selector === '[data-action="close-speaker-song-list"]') return [];
        return [];
      }),
      createElement: vi.fn(() => new FakeElement()),
      body: new FakeElement(),
    });
    vi.stubGlobal('window', {
      setTimeout: vi.fn(),
      dispatchEvent: vi.fn(),
      SongloftPlugin: { getAuthToken: () => '' },
    });
    vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/songloft/playlists/')) return okResponse([{ title: '第一首', artist: '歌手A', duration: 180 }, { title: '第二首', artist: '歌手B', duration: 220 }]);
      if (url.includes('/songloft/playlists')) return okResponse([{ id: 12, name: '测试歌单', song_count: 2 }]);
      return okResponse({ message: 'started' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string; speakerPlayerPlaylistId: string; };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';
    state.speakerPlayerPlaylistId = '12';

    const { openSpeakerSongListDrawer, bindSpeakerPlaylists } = await import('../../static/js/speaker_modules/playlists.js') as {
      openSpeakerSongListDrawer(): Promise<void>;
      bindSpeakerPlaylists(options?: { refreshPlayerStatus?: () => Promise<unknown> }): void;
      loadSpeakerPlaylists(): Promise<unknown>;
    };

    const refreshPlayerStatus = vi.fn(async () => null);
    bindSpeakerPlaylists({ refreshPlayerStatus });

    await openSpeakerSongListDrawer();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/songloft/playlists'), expect.anything());
    expect(drawer.className).toContain('open');
    expect(playlistsContainer.innerHTML).toContain('测试歌单');
    expect(songsContainer.innerHTML).toContain('第一首');
    expect(songsContainer.innerHTML).toContain('第二首');
  });
});
