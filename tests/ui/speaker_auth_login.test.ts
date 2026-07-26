import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  hidden = false;
  disabled = false;
  value = '';
  src = '';
  classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() };
  private listeners = new Map<string, Array<(event: any) => unknown>>();
  elements: Record<string, { value: string }> = {};

  constructor(attrs: Record<string, string> = {}) {
    Object.assign(this, attrs);
  }

  addEventListener(type: string, listener: (event: any) => unknown): void {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  async dispatch(type: string, extra: Record<string, unknown> = {}): Promise<void> {
    const event = {
      preventDefault: vi.fn(),
      currentTarget: this,
      target: this,
      ...extra,
    };
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
  }

  setAttribute = vi.fn();
  getAttribute(name: string): string | null {
    return (this as any)[name] ?? null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === 'button[type="submit"]') return this;
    return null;
  }

  reset(): void {
    for (const key of Object.keys(this.elements)) {
      this.elements[key].value = '';
    }
  }

  appendChild(): void {}
  remove(): void {}
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe('speaker auth_login module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as any).document;
    delete (globalThis as any).fetch;
    delete (globalThis as any).window;
  });

  it('submits token login without exposing password login routes', async () => {
    const tokenForm = new FakeElement();
    tokenForm.elements = {
      user_id: { value: '12345' },
      pass_token: { value: 'pt-xxx' },
    };
    const tabToken = new FakeElement({ 'data-auth-tab': 'token' });
    tabToken.getAttribute = (name: string) => (name === 'data-auth-tab' ? 'token' : null);
    const tokenPanel = new FakeElement({ 'data-auth-panel': 'token' });
    tokenPanel.getAttribute = (name: string) => (name === 'data-auth-panel' ? 'token' : null);
    const qrPanel = new FakeElement({ 'data-auth-panel': 'qrcode' });
    qrPanel.getAttribute = (name: string) => (name === 'data-auth-panel' ? 'qrcode' : null);

    const map = new Map<string, FakeElement>([
      ['[data-role="token-login-form"]', tokenForm],
    ]);

    (globalThis as any).document = {
      querySelector(selector: string) {
        return map.get(selector) || null;
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-action="auth-tab"]') return [tabToken];
        if (selector === '[data-auth-panel]') return [qrPanel, tokenPanel];
        if (selector === '[data-auth-tab]') return [tabToken];
        return [];
      },
      createElement: () => new FakeElement(),
      body: new FakeElement(),
    };
    (globalThis as any).CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    (globalThis as any).window = {
      open: vi.fn(),
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      SongloftPlugin: { getAuthToken: () => 'ui-token', getBaseUrl: () => '' },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
    };

    const calls: Array<{ url: string; body: unknown }> = [];
    (globalThis as any).fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(input), body });
      if (String(input).includes('/miot/auth/token')) {
        return jsonResponse({ success: true, state: 'success', message: 'Token 登录成功' });
      }
      return jsonResponse({ success: true });
    });

    const { bindTokenLogin } = await import('../../static/js/speaker_modules/auth_login.js');
    const refreshSpeaker = vi.fn(async () => undefined);
    bindTokenLogin({ refreshSpeaker });

    await tokenForm.dispatch('submit');
    expect(calls.find((c) => String(c.url).includes('/miot/auth/token'))?.body).toMatchObject({
      user_id: '12345',
      pass_token: 'pt-xxx',
    });
    expect(refreshSpeaker).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => String(c.url).includes('/miot/auth/login'))).toBe(false);
  });
});
