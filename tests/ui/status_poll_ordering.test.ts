import { afterEach, describe, expect, it, vi } from 'vitest';

// This suite proves the ordering guard added to refreshPlayerStatus() in
// static/js/speaker_modules/player.js: several `/miot/player/status` fetches
// can be in flight at once (the 5s poll timer + direct calls from user
// actions like toggle/next/previous). Because responses can land out of
// send-order, an OLDER request that resolves LAST must not repaint the UI
// over a NEWER request's already-applied state.

interface SpeakerPlayerModule {
  renderPlayerStatus(status: Record<string, unknown>): void;
  refreshPlayerStatus(): Promise<unknown>;
}

type FakeEvent = {
  currentTarget: FakeElement | null;
  target?: FakeElement;
  clientX?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
};
type Listener = (event: FakeEvent) => unknown;

// Copied from tests/ui/speaker_player.test.ts (no shared harness module exists
// in this repo yet — every UI test file defines its own fake DOM).
class FakeElement {
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  disabled = false;
  clientHeight = 0;
  offsetHeight = 0;
  offsetTop = 0;
  scrollTop = 0;
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
    setInterval: vi.fn(),
    clearInterval: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
    // Gotcha: player.js's isSameOriginUrl() resolves cover URLs against
    // window.location — without this, `new URL(url, window.location?.href)`
    // silently falls back to 'http://localhost', which happens to work for
    // these tests since we don't exercise cover/lyric URLs, but keep it
    // wired up so this harness matches the real DOM shape.
    location: { href: 'http://localhost/', origin: 'http://localhost' },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));
  vi.stubGlobal('performance', { now: () => 1000 });

  return { elements, toggleButton, globalToggleButton, progressTracks, documentNode };
}

describe('status poll request ordering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('keeps the newer status response even when the older (stale) one resolves last', async () => {
    const { elements } = installPlayerRenderDom();

    // Two /miot/player/status fetches will be in flight at once (e.g. the 5s
    // poll timer plus a direct user-triggered refresh). We hold both fetches
    // open with our own resolvers so we can control resolution order
    // independently of call/send order.
    const resolvers: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/player/status')) {
        return new Promise<Response>((resolve) => { resolvers.push(resolve); });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'dev-1';

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { refreshPlayerStatus } = await import(modulePath) as SpeakerPlayerModule;

    // Call #1 (the FIRST one sent) — imagine this is the poll tick that fired
    // while the speaker was still playing.
    const firstSent = refreshPlayerStatus();
    // Call #2 (the SECOND one sent) — imagine this is a refresh right after
    // the user hit pause.
    const secondSent = refreshPlayerStatus();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);

    // Resolve the SECOND (newer) request FIRST, with the fresh "paused" state...
    resolvers[1](okResponse({
      state: 'paused',
      is_playing: false,
      play_mode: 'order',
      position: 40,
      duration: 200,
      current_song: { title: '稻香', artist: '周杰伦' },
    }));
    await secondSent;

    expect(elements.get('[data-role="global-player-state"]')?.textContent).toBe('已暂停');
    expect(elements.get('[data-role="global-player-play-icon"]')?.className).toContain('fa-play');

    // ...then resolve the FIRST (older) request LAST, carrying stale
    // "playing" state. It must be dropped, not repainted over the newer,
    // already-applied "paused" state.
    resolvers[0](okResponse({
      state: 'playing',
      is_playing: true,
      play_mode: 'order',
      position: 10,
      duration: 200,
      current_song: { title: '稻香', artist: '周杰伦' },
    }));
    const firstResult = await firstSent;

    expect(firstResult).toBeNull();
    expect(elements.get('[data-role="global-player-state"]')?.textContent).toBe('已暂停');
    expect(elements.get('[data-role="global-player-play-icon"]')?.className).toContain('fa-play');
    expect(elements.get('[data-role="global-player-current-time"]')?.textContent).toBe('0:40');
  });

  it('lets a fresh user-triggered refresh apply normally when nothing supersedes it', async () => {
    // Sanity check for the non-racing path: a single refreshPlayerStatus()
    // call (no overlapping newer call) must still render its own result.
    const { elements } = installPlayerRenderDom();

    const fetchMock = vi.fn(async () => okResponse({
      state: 'playing',
      is_playing: true,
      play_mode: 'order',
      position: 5,
      duration: 100,
      current_song: { title: '晴天', artist: '周杰伦' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { state } = await import('../../static/js/state.js') as {
      state: { accountId: string; deviceId: string };
    };
    state.accountId = 'acc-1';
    state.deviceId = 'dev-1';

    const modulePath = '../../static/js/speaker_modules/player.js';
    const { refreshPlayerStatus } = await import(modulePath) as SpeakerPlayerModule;

    const result = await refreshPlayerStatus();

    expect(result).not.toBeNull();
    expect(elements.get('[data-role="global-player-state"]')?.textContent).toBe('播放中');
    expect(elements.get('[data-role="global-player-title"]')?.textContent).toBe('晴天');
  });
});
