import { afterEach, describe, expect, it, vi } from 'vitest';

interface AutomationModule {
  flattenAutomationPlayerDevices(groups: unknown): Array<Record<string, string>>;
  selectAutomationPlayerDevice(accountId: string, deviceId: string, deviceName?: string): void;
  automationPlayerPayload(extra?: Record<string, unknown>): Record<string, unknown>;
  runAutomationPlayerAction(action: string): Promise<Record<string, unknown>>;
  refreshAutomationPlayerStatus(): Promise<Record<string, unknown> | null>;
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
  const node = {
    className: '',
    textContent: '',
    value: '',
    innerHTML: '',
    remove: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    closest: vi.fn(() => null),
    classList: { toggle: vi.fn() },
  };
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => node),
    body: { appendChild: vi.fn() },
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

describe('automation speaker playback controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('flattens logged-in speaker devices for the automation player selector', async () => {
    installDom();
    const { flattenAutomationPlayerDevices } = await loadAutomationModule();

    expect(flattenAutomationPlayerDevices([
      {
        account_id: 'acc-1',
        account_name: '小米账号',
        devices: [
          { deviceID: 'speaker-1', name: '客厅音箱' },
          { device_id: 'speaker-2', alias: '卧室音箱' },
        ],
      },
    ])).toEqual([
      { account_id: 'acc-1', account_name: '小米账号', device_id: 'speaker-1', device_name: '客厅音箱' },
      { account_id: 'acc-1', account_name: '小米账号', device_id: 'speaker-2', device_name: '卧室音箱' },
    ]);
  });

  it('sends automation playback actions to the selected speaker', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({ state: 'paused', message: 'playlist paused' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const automation = await loadAutomationModule();

    automation.selectAutomationPlayerDevice('acc-1', 'speaker-1', '客厅音箱');

    await expect(automation.runAutomationPlayerAction('toggle')).resolves.toMatchObject({ state: 'paused' });
    expect(automation.automationPlayerPayload({ play_mode: 'random' })).toEqual({
      account_id: 'acc-1',
      device_id: 'speaker-1',
      play_mode: 'random',
    });
    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/toggle', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'acc-1', device_id: 'speaker-1' }),
    }));
  });

  it('loads player status for the selected automation speaker', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({
      state: 'playing',
      play_mode: 'order',
      current_song: { title: '父亲', artist: '筷子兄弟' },
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const automation = await loadAutomationModule();

    automation.selectAutomationPlayerDevice('acc-1', 'speaker-1', '客厅音箱');

    await expect(automation.refreshAutomationPlayerStatus()).resolves.toMatchObject({
      state: 'playing',
      current_song: { title: '父亲' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'api/miot/player/status?account_id=acc-1&device_id=speaker-1',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});
