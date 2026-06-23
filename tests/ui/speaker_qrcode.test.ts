import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { currentTarget: FakeElement; target?: FakeElement }) => unknown;

interface SpeakerModule {
  initSpeakerUI(): Promise<void>;
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
    await this.listeners.get(type)?.({ currentTarget: this, target: this });
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
  const elements = new Map<string, FakeElement>([
    ['[data-action="qr-start"]', qrStart],
    ['[data-action="qr-poll"]', qrPoll],
    ['[data-role="qr-box"]', new FakeElement()],
    ['[data-role="qr-image"]', new FakeElement()],
    ['[data-role="qr-link"]', new FakeElement()],
    ['[data-role="qr-status"]', new FakeElement()],
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

  return { qrStart, elements };
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
});
