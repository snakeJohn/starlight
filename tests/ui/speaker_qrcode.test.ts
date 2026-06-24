import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { currentTarget: FakeElement | null; target?: FakeElement }) => unknown;

interface SpeakerModule {
  initSpeakerUI(): Promise<void>;
}

interface StateModule {
  state: {
    accountId: string;
    deviceId: string;
    deviceName: string;
  };
}

class FakeClassList {
  toggled: Array<[string, boolean | undefined]> = [];

  toggle(name: string, force?: boolean): boolean {
    this.toggled.push([name, force]);
    return Boolean(force);
  }
}

class FakeElement {
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  href = '';
  src = '';
  textContent = '';
  innerHTML = '';
  value = '';
  style: Record<string, string> = {};
  private listeners = new Map<string, Listener>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  async dispatch(type: string): Promise<void> {
    const event = { currentTarget: this as FakeElement | null, target: this };
    const result = this.listeners.get(type)?.(event);
    event.currentTarget = null;
    await result;
  }

  appendChild(): void {
    // Toast rendering is irrelevant to this behavior test.
  }

  remove(): void {
    // Toast cleanup is irrelevant to this behavior test.
  }

  querySelector(): FakeElement | null {
    return null;
  }

  closest(): FakeElement | null {
    return null;
  }
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function installSpeakerDom() {
  const qrStart = new FakeElement();
  const qrPoll = new FakeElement();
  const qrBox = new FakeElement();
  const qrImage = new FakeElement();
  const qrLink = new FakeElement();
  const qrStatus = new FakeElement();
  const refreshVoiceRecords = new FakeElement();
  const voiceRecordList = new FakeElement();
  const voiceRecordSummary = new FakeElement();
  const elements = new Map<string, FakeElement>([
    ['[data-action="qr-start"]', qrStart],
    ['[data-action="qr-poll"]', qrPoll],
    ['[data-action="refresh-voice-records"]', refreshVoiceRecords],
    ['[data-role="qr-box"]', qrBox],
    ['[data-role="qr-image"]', qrImage],
    ['[data-role="qr-link"]', qrLink],
    ['[data-role="qr-status"]', qrStatus],
    ['[data-role="voice-record-list"]', voiceRecordList],
    ['[data-role="voice-record-summary"]', voiceRecordSummary],
    ['[data-role="account-list"]', new FakeElement()],
    ['[data-role="account-select"]', new FakeElement()],
    ['[data-role="auth-summary"]', new FakeElement()],
    ['[data-role="device-list"]', new FakeElement()],
    ['[data-role="device-select"]', new FakeElement()],
    ['[data-role="speaker-player-device"]', new FakeElement()],
    ['[data-role="speaker-player-state"]', new FakeElement()],
    ['[data-role="speaker-player-title"]', new FakeElement()],
    ['[data-role="speaker-player-meta"]', new FakeElement()],
  ]);

  vi.stubGlobal('document', {
    querySelector: (selector: string) => elements.get(selector) ?? null,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    body: new FakeElement(),
  });
  vi.stubGlobal('CustomEvent', class {
    type: string;
    detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  });
  vi.stubGlobal('window', {
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
    dispatchEvent: vi.fn(),
    setTimeout: vi.fn(),
  });

  return { qrStart, refreshVoiceRecords, elements, qrBox, qrImage, qrLink, qrStatus, voiceRecordList, voiceRecordSummary };
}

describe('speaker QR login UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('starts polling immediately after generating a QR code', async () => {
    const { qrStart } = installSpeakerDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/accounts') || url.endsWith('/miot/auth/status') || url.endsWith('/miot/mina/devices')) {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.endsWith('/miot/auth/qrcode')) {
        return jsonResponse({
          success: true,
          account_id: 'qr_1',
          qrcode_url: 'https://qr.test/image.png',
          login_url: 'https://qr.test/login',
        });
      }
      if (url.endsWith('/miot/auth/qrcode/poll')) {
        return jsonResponse({ success: true, state: 'success', message: 'ok', account_id: '12345' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const modulePath = '../../static/js/speaker.js';
    const { initSpeakerUI } = await import(modulePath) as SpeakerModule;
    await initSpeakerUI();

    await qrStart.dispatch('click');

    expect(fetchMock).toHaveBeenCalledWith(
      'api/miot/auth/qrcode/poll',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('hides the QR code and keeps the speaker device unselected after QR login succeeds', async () => {
    const { qrStart, qrBox, qrImage, qrLink, qrStatus } = installSpeakerDom();
    let loginComplete = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/accounts')) {
        return jsonResponse({
          success: true,
          data: loginComplete ? [{ id: '12345', account: '小米账号' }] : [],
        });
      }
      if (url.endsWith('/miot/auth/status')) {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.endsWith('/miot/mina/devices?account_id=12345')) {
        return jsonResponse({
          success: true,
          data: [{
            account_id: '12345',
            account_name: '小米账号',
            devices: [{ device_id: 'speaker-1', name: '客厅音箱' }],
          }],
        });
      }
      if (url.endsWith('/miot/mina/devices')) {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.endsWith('/miot/auth/qrcode')) {
        return jsonResponse({
          success: true,
          account_id: 'qr_1',
          qrcode_url: 'https://qr.test/image.png',
          login_url: 'https://qr.test/login',
        });
      }
      if (url.endsWith('/miot/auth/qrcode/poll')) {
        loginComplete = true;
        return jsonResponse({ success: true, state: 'success', message: 'ok', account_id: '12345' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const modulePath = '../../static/js/speaker.js';
    const stateModulePath = '../../static/js/state.js';
    const { initSpeakerUI } = await import(modulePath) as SpeakerModule;
    const { state } = await import(stateModulePath) as StateModule;
    await initSpeakerUI();

    await qrStart.dispatch('click');
    await Promise.resolve();
    await Promise.resolve();

    expect(state.accountId).toBe('12345');
    expect(state.deviceId).toBe('');
    expect(state.deviceName).toBe('');
    expect(qrBox.hidden).toBe(true);
    expect(qrBox.classList.toggled).toContainEqual(['has-qr', false]);
    expect(qrImage.src).toBe('');
    expect(qrLink.href).toBe('#');
    expect(qrLink.textContent).toBe('');
    expect(qrStatus.textContent).toBe('登录成功，账号已保存');
  });

  it('keeps the voice record refresh button stable after async loading', async () => {
    const { refreshVoiceRecords, voiceRecordSummary } = installSpeakerDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/accounts') || url.endsWith('/miot/auth/status') || url.endsWith('/miot/mina/devices')) {
        return jsonResponse({ success: true, data: [] });
      }
      if (url.includes('/miot/conversation/messages')) {
        return jsonResponse({ success: true, data: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const modulePath = '../../static/js/speaker.js';
    const { initSpeakerUI } = await import(modulePath) as SpeakerModule;
    await initSpeakerUI();

    await expect(refreshVoiceRecords.dispatch('click')).resolves.toBeUndefined();

    expect(refreshVoiceRecords.disabled).toBe(false);
    expect(voiceRecordSummary.textContent).toBe('12 小时内 0 条');
  });
});
