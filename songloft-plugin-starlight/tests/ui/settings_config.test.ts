import { afterEach, describe, expect, it, vi } from 'vitest';

interface AutomationModule {
  configFromForm(form: { elements: Record<string, { value?: string; checked?: boolean; disabled?: boolean }> }): Record<string, unknown>;
  manageAllConversationDevices(): Promise<number>;
  updateVoiceCommandAccess(form: { elements: Record<string, { checked?: boolean; disabled?: boolean }> }, enabled: boolean): void;
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

async function loadAutomationModule(): Promise<AutomationModule> {
  const modulePath = '../../static/js/automation.js';
  return await import(modulePath) as AutomationModule;
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

describe('settings config helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('only saves the four visible setting toggles', async () => {
    installDom();
    const { configFromForm } = await loadAutomationModule();

    const payload = configFromForm({
      elements: {
        conversation_monitor_enabled: { checked: true },
        voice_command_enabled: { checked: false },
        scheduled_tasks_enabled: { checked: false },
        force_mp3: { checked: true },
      },
    });

    expect(payload).toEqual({
      conversation_monitor_enabled: true,
      voice_command_enabled: false,
      scheduled_tasks_enabled: false,
      force_mp3: true,
    });
    expect(payload).not.toHaveProperty('timezone');
    expect(payload).not.toHaveProperty('extra_music_api_models');
    expect(payload).not.toHaveProperty('external_search_enabled');
    expect(payload).not.toHaveProperty('external_search_url');
    expect(payload).not.toHaveProperty('indicator_light_enabled');
    expect(payload).not.toHaveProperty('interrupt_tts_hint_enabled');
    expect(payload).not.toHaveProperty('ai_config');
  });

  it('saves speaker setting toggles without touching scheduled tasks', async () => {
    installDom();
    const { configFromForm } = await loadAutomationModule();

    const payload = configFromForm({
      elements: {
        conversation_monitor_enabled: { checked: true },
        voice_command_enabled: { checked: true },
        force_mp3: { checked: false },
      },
    });

    expect(payload).toEqual({
      conversation_monitor_enabled: true,
      voice_command_enabled: true,
      force_mp3: false,
    });
    expect(payload).not.toHaveProperty('scheduled_tasks_enabled');
  });

  it('saves the automation schedule toggle without touching speaker settings', async () => {
    installDom();
    const { configFromForm } = await loadAutomationModule();

    const payload = configFromForm({
      elements: {
        scheduled_tasks_enabled: { checked: true },
      },
    });

    expect(payload).toEqual({
      scheduled_tasks_enabled: true,
    });
    expect(payload).not.toHaveProperty('conversation_monitor_enabled');
    expect(payload).not.toHaveProperty('voice_command_enabled');
    expect(payload).not.toHaveProperty('force_mp3');
  });

  it('keeps voice command access disabled until conversation monitoring is saved', async () => {
    installDom();
    const { updateVoiceCommandAccess } = await loadAutomationModule();
    const form = {
      elements: {
        voice_command_enabled: { checked: true, disabled: false },
      },
    };

    updateVoiceCommandAccess(form, false);

    expect(form.elements.voice_command_enabled.disabled).toBe(true);
    expect(form.elements.voice_command_enabled.checked).toBe(false);

    updateVoiceCommandAccess(form, true);

    expect(form.elements.voice_command_enabled.disabled).toBe(false);
  });

  it('marks every detected speaker device as managed when enabling conversation monitoring', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse([
      {
        account_id: 'acc-1',
        devices: [
          { deviceID: 'speaker-1', name: '客厅音箱' },
          { device_id: 'speaker-2', name: '卧室音箱' },
        ],
      },
      {
        account_id: 'acc-2',
        devices: [
          { id: 'speaker-3', name: '书房音箱' },
        ],
      },
    ]) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { manageAllConversationDevices } = await loadAutomationModule();

    await expect(manageAllConversationDevices()).resolves.toBe(3);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'api/miot/mina/devices', expect.objectContaining({
      headers: expect.any(Object),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'api/miot/mina/device/managed', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'acc-1', device_id: 'speaker-1', managed: true }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'api/miot/mina/device/managed', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'acc-1', device_id: 'speaker-2', managed: true }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'api/miot/mina/device/managed', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'acc-2', device_id: 'speaker-3', managed: true }),
    }));
  });

  it('reports when no speaker devices are detected for conversation monitoring', async () => {
    installDom();
    vi.stubGlobal('fetch', vi.fn(async () => okResponse([]) as Response));
    const { manageAllConversationDevices } = await loadAutomationModule();

    await expect(manageAllConversationDevices()).rejects.toThrow('未检测到音箱设备');
  });
});
