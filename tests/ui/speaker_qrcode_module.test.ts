import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { currentTarget: FakeElement | null; target?: FakeElement }) => unknown;

interface QrCodeModule {
  bindQrLogin(options: { refreshSpeaker: (options?: { restoreSavedDevice?: boolean }) => Promise<void> | void }): void;
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
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function installDom() {
  const qrStart = new FakeElement();
  const qrBox = new FakeElement();
  const qrImage = new FakeElement();
  const qrLink = new FakeElement();
  const qrStatus = new FakeElement();
  const elements = new Map<string, FakeElement>([
    ['[data-action="qr-start"]', qrStart],
    ['[data-action="qr-poll"]', new FakeElement()],
    ['[data-role="qr-box"]', qrBox],
    ['[data-role="qr-image"]', qrImage],
    ['[data-role="qr-link"]', qrLink],
    ['[data-role="qr-status"]', qrStatus],
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

  return { qrStart };
}

describe('speaker QR module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('starts polling immediately after generating a QR code from the extracted module', async () => {
    const { qrStart } = installDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/auth/qrcode')) {
        return jsonResponse({
          success: true,
          account_id: 'qr_1',
          qrcode_url: 'https://qr.test/image.png',
          login_url: 'https://qr.test/login',
        });
      }
      if (url.endsWith('/miot/auth/qrcode/poll')) {
        return jsonResponse({ success: true, state: 'pending', message: 'waiting', account_id: 'qr_1' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const modulePath = '../../static/js/speaker_modules/qrcode.js';
    const { bindQrLogin } = await import(modulePath) as QrCodeModule;
    bindQrLogin({ refreshSpeaker: vi.fn(async () => undefined) });

    await qrStart.dispatch('click');

    expect(fetchMock).toHaveBeenCalledWith(
      'api/miot/auth/qrcode/poll',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
