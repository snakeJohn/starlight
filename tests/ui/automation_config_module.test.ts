import { afterEach, describe, expect, it, vi } from 'vitest';

interface AutomationConfigModule {
  configFromForm(form: { elements: Record<string, { value?: string; checked?: boolean; disabled?: boolean }> }): Record<string, unknown>;
  setConfigState(message: string, form?: { querySelector?: (selector: string) => { textContent: string } | null } | null): void;
}

function installDom() {
  const node = { className: '', textContent: '', remove: vi.fn() };
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
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

describe('automation config module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('saves visible speaker settings including the Songloft access host from the extracted config module', async () => {
    installDom();
    const modulePath = '../../static/js/automation_modules/config.js';
    const { configFromForm } = await import(modulePath) as AutomationConfigModule;

    const payload = configFromForm({
      elements: {
        server_host: { value: '  http://192.168.31.63:18191/api/v1  ' },
        conversation_monitor_enabled: { checked: true },
        voice_command_enabled: { checked: false },
        scheduled_tasks_enabled: { checked: false },
        force_mp3: { checked: true },
      },
    });

    expect(payload).toEqual({
      server_host: 'http://192.168.31.63:18191/api/v1',
      conversation_monitor_enabled: true,
      voice_command_enabled: false,
      scheduled_tasks_enabled: false,
      force_mp3: true,
    });
  });

  it('updates only the scoped config status node from the extracted config module', async () => {
    installDom();
    const localNode = { textContent: '' };
    const globalNode = { textContent: '' };
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => globalNode),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
      body: {
        appendChild: vi.fn(),
      },
    });
    const modulePath = '../../static/js/automation_modules/config.js';
    const { setConfigState } = await import(modulePath) as AutomationConfigModule;

    setConfigState('音箱设置已保存', {
      querySelector: vi.fn((selector: string) => selector === '[data-role="config-state"]' ? localNode : null),
    });

    expect(localNode.textContent).toBe('音箱设置已保存');
    expect(globalNode.textContent).toBe('');
  });
});
