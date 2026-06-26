import { afterEach, describe, expect, it, vi } from 'vitest';

interface SpeakerPlayerModule {
  runPlayerAction(action: string): Promise<unknown>;
}

interface SpeakerModule {
  initSpeakerUI(): Promise<void>;
}

type Listener = (event: { currentTarget: FakeElement | null; target?: FakeElement }) => unknown;

class FakeElement {
  dataset: Record<string, string> = {};
  disabled = false;
  textContent = '';
  value = '';
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  async dispatch(type: string): Promise<void> {
    const event = { currentTarget: this as FakeElement | null, target: this };
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      await listener(event);
    }
    event.currentTarget = null;
  }

  appendChild(): void {}
  remove(): void {}
  querySelector(): FakeElement | null { return null; }
  closest(): FakeElement | null { return null; }
  setAttribute(): void {}
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
});
