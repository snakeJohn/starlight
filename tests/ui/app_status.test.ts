import { afterEach, describe, expect, it, vi } from 'vitest';

type EventListener = (event: { type: string; target?: FakeTarget; detail?: unknown }) => unknown;

interface MockModule {
  initMusicUI?: ReturnType<typeof vi.fn>;
  initSpeakerUI?: ReturnType<typeof vi.fn>;
  initAutomationUI?: ReturnType<typeof vi.fn>;
  initDiagnosticsUI?: ReturnType<typeof vi.fn>;
}

class FakeClassList {
  toggle(): void {}
}

class FakeElement {
  innerHTML = '';
  textContent = '';
  dataset: Record<string, string> = {};
  classList = new FakeClassList();
}

class FakeTarget {
  constructor(private readonly resolvers: Record<string, { dataset?: Record<string, string> } | null>) {}

  closest(selector: string) {
    return this.resolvers[selector] ?? null;
  }
}

class FakeEventTarget {
  private listeners = new Map<string, EventListener[]>();

  addEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  async dispatchEvent(event: { type: string; target?: FakeTarget; detail?: unknown }): Promise<void> {
    const listeners = this.listeners.get(event.type) || [];
    for (const listener of listeners) {
      await listener(event);
    }
  }
}

function installDom() {
  const statusStrip = new FakeElement();
  const sideRail = new FakeElement();
  const bottomTabs = new FakeElement();
  const documentTarget = new FakeEventTarget();
  const windowTarget = new FakeEventTarget();

  vi.stubGlobal('document', {
    addEventListener: documentTarget.addEventListener.bind(documentTarget),
    dispatchEvent: documentTarget.dispatchEvent.bind(documentTarget),
    querySelector: vi.fn((selector: string) => {
      if (selector === '#statusStrip') return statusStrip;
      if (selector === '#sideRail') return sideRail;
      if (selector === '#bottomTabs') return bottomTabs;
      return null;
    }),
    querySelectorAll: vi.fn(() => []),
  });

  vi.stubGlobal('window', {
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
  });

  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

  return {
    statusStrip,
    async triggerDomReady() {
      await documentTarget.dispatchEvent({ type: 'DOMContentLoaded' });
    },
    async clickRetry() {
      await documentTarget.dispatchEvent({
        type: 'click',
        target: new FakeTarget({
          '[data-tab]': null,
          '[data-action]': { dataset: { action: 'retry-init' } },
        }),
      });
    },
  };
}

async function loadAppModule(modules: MockModule = {}) {
  vi.doMock('../../static/js/music.js', () => ({
    initMusicUI: modules.initMusicUI || vi.fn(async () => undefined),
  }));
  vi.doMock('../../static/js/speaker.js', () => ({
    initSpeakerUI: modules.initSpeakerUI || vi.fn(async () => undefined),
  }));
  vi.doMock('../../static/js/automation.js', () => ({
    initAutomationUI: modules.initAutomationUI || vi.fn(async () => undefined),
  }));
  vi.doMock('../../static/js/diagnostics.js', () => ({
    initDiagnosticsUI: modules.initDiagnosticsUI || vi.fn(async () => undefined),
  }));

  await import('../../static/js/app.js');
}

describe('app init status visibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('hides per-module init chips while keeping failure summary and retry action', async () => {
    const dom = installDom();
    await loadAppModule({
      initMusicUI: vi.fn(async () => {
        throw new Error('music failed');
      }),
    });

    await dom.triggerDomReady();

    expect(dom.statusStrip.innerHTML).not.toContain('data-domain="music"');
    expect(dom.statusStrip.innerHTML).not.toContain('data-domain="speaker"');
    expect(dom.statusStrip.innerHTML).not.toContain('data-domain="automation"');
    expect(dom.statusStrip.innerHTML).not.toContain('data-domain="diagnostics"');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>音乐</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>音箱</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>自动化</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>诊断</strong>');
    expect(dom.statusStrip.innerHTML).toContain('音乐 初始化失败');
    expect(dom.statusStrip.innerHTML).toContain('data-action="retry-init"');
  });

  it('retries only failed init modules from the top strip action', async () => {
    const dom = installDom();
    const initMusicUI = vi.fn()
      .mockRejectedValueOnce(new Error('music failed'))
      .mockResolvedValueOnce(undefined);
    const initSpeakerUI = vi.fn(async () => undefined);
    const initAutomationUI = vi.fn(async () => undefined);
    const initDiagnosticsUI = vi.fn(async () => undefined);
    await loadAppModule({
      initMusicUI,
      initSpeakerUI,
      initAutomationUI,
      initDiagnosticsUI,
    });

    await dom.triggerDomReady();
    await dom.clickRetry();

    expect(initMusicUI).toHaveBeenCalledTimes(2);
    expect(initSpeakerUI).toHaveBeenCalledTimes(1);
    expect(initAutomationUI).toHaveBeenCalledTimes(1);
    expect(initDiagnosticsUI).toHaveBeenCalledTimes(1);
    expect(dom.statusStrip.innerHTML).toContain('已连接');
    expect(dom.statusStrip.innerHTML).not.toContain('data-domain=');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>音乐</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>音箱</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>自动化</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('<strong>诊断</strong>');
    expect(dom.statusStrip.innerHTML).not.toContain('music failed');
  });
});
