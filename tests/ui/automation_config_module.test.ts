import { afterEach, describe, expect, it, vi } from 'vitest';

interface AutomationConfigModule {
  configFromForm(form: { elements: Record<string, { value?: string; checked?: boolean; disabled?: boolean }> }): Record<string, unknown>;
  setConfigState(message: string, form?: { querySelector?: (selector: string) => { textContent: string } | null } | null): void;
  prepareConversationMonitorFromCheckbox(input: {
    checked: boolean;
    disabled?: boolean;
    closest?: (selector: string) => unknown;
  }): Promise<void>;
  updateVoiceCommandAccess(form: { elements: Record<string, { checked?: boolean; disabled?: boolean }> }, enabled: boolean): void;
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

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

  it('enables voice command access immediately after conversation monitor is checked and devices are managed', async () => {
    installDom();
    const stateNode = { textContent: '' };
    const form = {
      elements: {
        voice_command_enabled: { checked: false, disabled: true },
      },
      querySelector: vi.fn((selector: string) => selector === '[data-role="config-state"]' ? stateNode : null),
    };
    const input = {
      checked: true,
      disabled: false,
      closest: vi.fn(() => form),
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/mina/devices')) {
        return okResponse([{
          account_id: 'acc-1',
          devices: [{ deviceID: 'speaker-1', name: '客厅' }],
        }]) as Response;
      }
      return okResponse({}) as Response;
    }));

    const modulePath = '../../static/js/automation_modules/config.js';
    const { prepareConversationMonitorFromCheckbox } = await import(modulePath) as AutomationConfigModule;

    await prepareConversationMonitorFromCheckbox(input);

    expect(form.elements.voice_command_enabled.disabled).toBe(false);
    expect(form.elements.voice_command_enabled.checked).toBe(false);
    expect(stateNode.textContent).toContain('可勾选语音口令');
    expect(input.disabled).toBe(false);
  });

  it('disables and clears voice command when conversation monitor is unchecked', async () => {
    installDom();
    const form = {
      elements: {
        voice_command_enabled: { checked: true, disabled: false },
      },
      querySelector: vi.fn(() => ({ textContent: '' })),
    };
    const input = {
      checked: false,
      disabled: false,
      closest: vi.fn(() => form),
    };

    const modulePath = '../../static/js/automation_modules/config.js';
    const { prepareConversationMonitorFromCheckbox } = await import(modulePath) as AutomationConfigModule;

    await prepareConversationMonitorFromCheckbox(input);

    expect(form.elements.voice_command_enabled.disabled).toBe(true);
    expect(form.elements.voice_command_enabled.checked).toBe(false);
  });

  it('reverts conversation monitor and keeps voice disabled when device management fails', async () => {
    installDom();
    const form = {
      elements: {
        voice_command_enabled: { checked: false, disabled: true },
      },
      querySelector: vi.fn(() => ({ textContent: '' })),
    };
    const input = {
      checked: true,
      disabled: false,
      closest: vi.fn(() => form),
    };

    vi.stubGlobal('fetch', vi.fn(async () => okResponse([]) as Response));

    const modulePath = '../../static/js/automation_modules/config.js';
    const { prepareConversationMonitorFromCheckbox } = await import(modulePath) as AutomationConfigModule;

    await prepareConversationMonitorFromCheckbox(input);

    expect(input.checked).toBe(false);
    expect(form.elements.voice_command_enabled.disabled).toBe(true);
    expect(form.elements.voice_command_enabled.checked).toBe(false);
  });

  it('includes both conversation monitor and voice command in one save payload when both are checked', async () => {
    installDom();
    const modulePath = '../../static/js/automation_modules/config.js';
    const { configFromForm } = await import(modulePath) as AutomationConfigModule;

    const payload = configFromForm({
      elements: {
        conversation_monitor_enabled: { checked: true },
        voice_command_enabled: { checked: true },
      },
    });

    expect(payload).toEqual({
      conversation_monitor_enabled: true,
      voice_command_enabled: true,
    });
  });
});
