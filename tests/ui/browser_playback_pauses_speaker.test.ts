import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 不变量：任何浏览器播放入口都必须先把音箱停下，否则两端同时出声。
 *
 * 这条不变量原本靠「每个调用点自己记得调一次」维持，于是音乐页那三个入口
 * （单曲 / 歌单 / Songloft 曲库）全部漏掉。现在守卫放在 playBrowserQueue()
 * 内部，本用例直接对着入口函数验证，新增入口也会被这条测试覆盖。
 */
class FakeAudio {
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 180;
  preload = '';
  private listeners = new Map<string, Array<() => unknown>>();
  addEventListener(type: string, listener: () => unknown): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }
  removeEventListener(): void {}
  async play(): Promise<void> { this.paused = false; }
  pause(): void { this.paused = true; }
  load(): void {}
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
}

function installDom() {
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    location: { origin: 'http://songloft.test', href: 'http://songloft.test/' },
    SongloftPlugin: { getAuthToken: () => 'ui-token' },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
  vi.stubGlobal('Audio', FakeAudio);
}

const SONG = {
  id: 1256,
  title: '风起天阑',
  artist: '河图',
  duration: 300,
  url: 'http://songloft.test/api/v1/songs/1256/play',
};

async function loadModule(posts: string[], opts: { pauseFails?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') posts.push(url);
    if (url.includes('/mina/pause')) {
      if (opts.pauseFails) {
        return { ok: true, status: 200, json: async () => ({ success: false, error: 'failed to pause' }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: { message: 'paused' } }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  const { state } = await import('../../static/js/state.js') as {
    state: { accountId: string; deviceId: string };
  };
  state.accountId = 'acc-1';
  state.deviceId = 'dev-1';

  return await import('../../static/js/speaker_modules/browser_player.js') as {
    playBrowserQueue(songs: unknown[], options?: Record<string, unknown>): Promise<void>;
  };
}

describe('every browser playback entry point pauses the speaker', () => {
  beforeEach(() => {
    vi.resetModules();
    installDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('pauses the speaker when a single song starts in the browser', async () => {
    const posts: string[] = [];
    const { playBrowserQueue } = await loadModule(posts);

    await playBrowserQueue([SONG]);

    expect(posts.some((url) => url.includes('/miot/mina/pause'))).toBe(true);
  });

  it('pauses the speaker when a whole songlist starts in the browser', async () => {
    const posts: string[] = [];
    const { playBrowserQueue } = await loadModule(posts);

    await playBrowserQueue([SONG, { ...SONG, id: 1257, title: '第二首' }]);

    expect(posts.some((url) => url.includes('/miot/mina/pause'))).toBe(true);
  });

  it('never uses flip-semantics toggle to stop the speaker', async () => {
    // toggle 会把已暂停的音箱唤醒；只能用幂等的 pause。
    const posts: string[] = [];
    const { playBrowserQueue } = await loadModule(posts);

    await playBrowserQueue([SONG]);

    expect(posts.some((url) => url.includes('/player/toggle'))).toBe(false);
  });

  it('still plays in the browser when the speaker refuses to pause', async () => {
    // 音箱停不下来不该连浏览器播放一起中断——只提示，不抛。
    const posts: string[] = [];
    const { playBrowserQueue } = await loadModule(posts, { pauseFails: true });

    await expect(playBrowserQueue([SONG])).resolves.toBeUndefined();
    expect(posts.some((url) => url.includes('/miot/mina/pause'))).toBe(true);
  });

  it('does not call the speaker at all when no device is selected', async () => {
    const posts: string[] = [];
    const { playBrowserQueue } = await loadModule(posts);
    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = '';
    state.deviceId = '';

    await playBrowserQueue([SONG]);

    expect(posts.some((url) => url.includes('/miot/mina/pause'))).toBe(false);
  });
});
