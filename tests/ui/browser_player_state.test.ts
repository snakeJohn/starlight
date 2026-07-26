import { afterEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function apiResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 180;
  preload = '';
  private listeners = new Map<string, Array<() => unknown>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => unknown): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  async emit(type: string): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener();
    }
  }

  async play(): Promise<void> {
    this.paused = false;
    await this.emit('play');
  }

  pause(): void {
    this.paused = true;
    void this.emit('pause');
  }

  load(): void {}

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
}

function installBrowserGlobals(): void {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('window', {
    location: { origin: 'http://songloft.test' },
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    SongloftPlugin: { getAuthToken: () => '' },
    dispatchEvent: vi.fn(),
    setTimeout: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser player state transitions', () => {
  it('ignores an older URL resolution that completes after a newer track', async () => {
    installBrowserGlobals();
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise));

    const player = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
      browserPlayerAction(command: string): Promise<unknown>;
      getBrowserPlaybackStatus(): { current_song?: { title?: string }; queue_index: number };
    };

    const initial = player.playBrowserQueue([{ title: 'A' }, { title: 'B' }]);
    const next = player.browserPlayerAction('next');
    second.resolve(apiResponse({ url: 'https://media.test/b.mp3' }));
    await next;
    first.resolve(apiResponse({ url: 'https://media.test/a.mp3' }));
    await initial;

    expect(player.getBrowserPlaybackStatus()).toMatchObject({
      queue_index: 1,
      current_song: { title: 'B' },
    });
    expect(FakeAudio.instances[0].src).toBe('https://media.test/b.mp3');
  });

  it('captures automatic-next failures without an unhandled rejection', async () => {
    installBrowserGlobals();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(apiResponse({ url: 'https://media.test/a.mp3' }))
      .mockRejectedValueOnce(new Error('preview unavailable')));

    const player = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
      getBrowserPlaybackStatus(): { queue_index: number; error?: string };
    };
    await player.playBrowserQueue([{ title: 'A' }, { title: 'B' }]);

    await FakeAudio.instances[0].emit('ended');
    await Promise.resolve();

    expect(player.getBrowserPlaybackStatus()).toMatchObject({
      queue_index: 0,
      error: expect.stringContaining('preview unavailable'),
    });
  });

  it('keeps browser playback running when speaker handoff fails', async () => {
    installBrowserGlobals();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('speaker offline')));

    const browser = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
    };
    await browser.playBrowserQueue([{ title: 'A', url: 'https://media.test/a.mp3' }]);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'account-1';
    state.deviceId = 'speaker-1';
    const player = await import('../../static/js/speaker_modules/player.js') as {
      handoffBrowserQueueToSpeaker(): Promise<unknown>;
    };

    await expect(player.handoffBrowserQueueToSpeaker()).rejects.toThrow('speaker offline');
    expect(FakeAudio.instances[0].paused).toBe(false);
  });

  it('applies the queue offset when handing a windowed speaker queue to the browser', async () => {
    installBrowserGlobals();
    const queue = Array.from({ length: 200 }, (_, index) => ({
      id: index + 51,
      title: `Song ${index + 51}`,
      url: `https://media.test/${index + 51}.mp3`,
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse({
      state: 'playing',
      play_mode: 'random',
      current_index: 150,
      queue_offset: 50,
      queue,
    })));

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'account-1';
    state.deviceId = 'speaker-1';
    const player = await import('../../static/js/speaker_modules/player.js') as {
      handoffSpeakerQueueToBrowser(): Promise<unknown>;
    };

    await player.handoffSpeakerQueueToBrowser();

    expect(FakeAudio.instances[0].src).toBe('https://media.test/151.mp3');
    const browser = await import('../../static/js/speaker_modules/browser_player.js') as {
      getBrowserPlaybackStatus(): { play_mode: string };
    };
    expect(browser.getBrowserPlaybackStatus().play_mode).toBe('random');
  });

  it('does not resume a pending URL resolution after stop', async () => {
    installBrowserGlobals();
    const pending = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const player = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
      browserPlayerAction(command: string): Promise<unknown>;
    };

    const play = player.playBrowserQueue([{ title: 'A' }]);
    await player.browserPlayerAction('stop');
    pending.resolve(apiResponse({ url: 'https://media.test/a.mp3' }));
    await play;

    expect(FakeAudio.instances[0].paused).toBe(true);
    expect(FakeAudio.instances[0].src).toBe('');
  });

  it('allows manual next in once mode', async () => {
    installBrowserGlobals();
    const player = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
      browserPlayerAction(command: string, options?: Record<string, unknown>): Promise<unknown>;
      getBrowserPlaybackStatus(): { queue_index: number };
    };
    await player.playBrowserQueue([
      { title: 'A', url: 'https://media.test/a.mp3' },
      { title: 'B', url: 'https://media.test/b.mp3' },
    ]);
    await player.browserPlayerAction('mode', { playMode: 'once' });

    await player.browserPlayerAction('next');

    expect(player.getBrowserPlaybackStatus().queue_index).toBe(1);
  });

  it('does not pause current audio when only selecting the next playback target', async () => {
    installBrowserGlobals();
    const browser = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
    };
    await browser.playBrowserQueue([{ title: 'A', url: 'https://media.test/a.mp3' }]);
    const player = await import('../../static/js/speaker_modules/player.js') as {
      bindPlaybackTargetHandoff(): void;
    };
    const target = await import('../../static/js/speaker_modules/playback_target.js') as {
      setSelectedPlaybackTarget(value: 'browser' | 'speaker', options?: { silent?: boolean }): void;
    };
    player.bindPlaybackTargetHandoff();
    target.setSelectedPlaybackTarget('browser', { silent: true });

    target.setSelectedPlaybackTarget('speaker', { silent: true });

    expect(FakeAudio.instances[0].paused).toBe(false);
  });

  it('pauses browser audio after a speaker queue command succeeds', async () => {
    installBrowserGlobals();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse({
      state: 'playing',
      is_playing: true,
      current_index: 1,
      queue: [{ title: 'Speaker song' }],
    })));
    const browser = await import('../../static/js/speaker_modules/browser_player.js') as {
      playBrowserQueue(songs: unknown[]): Promise<void>;
    };
    await browser.playBrowserQueue([{ title: 'A', url: 'https://media.test/a.mp3' }]);
    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'account-1';
    state.deviceId = 'speaker-1';
    const player = await import('../../static/js/speaker_modules/player.js') as {
      runPlayerAction(action: string): Promise<unknown>;
    };

    await player.runPlayerAction('next');

    expect(FakeAudio.instances[0].paused).toBe(true);
  });
});
