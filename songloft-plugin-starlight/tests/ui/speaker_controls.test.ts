import { afterEach, describe, expect, it, vi } from 'vitest';

interface SpeakerControlsModule {
  normalizeDeviceId(device: Record<string, unknown>): string;
  normalizeDeviceName(device: Record<string, unknown>): string;
  renderAccountRow(account: Record<string, unknown>): string;
  selectAndPersistDevice(accountId: string, deviceId: string, name?: string): Promise<void>;
  togglePlayerPlayback(): Promise<Record<string, unknown>>;
}

interface StateModule {
  state: {
    accountId: string;
    deviceId: string;
  };
}

const okResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

async function loadModules() {
  const speakerModulePath = '../../static/js/speaker.js';
  const stateModulePath = '../../static/js/state.js';
  const speaker = await import(speakerModulePath) as SpeakerControlsModule;
  const stateModule = await import(stateModulePath) as StateModule;
  return { speaker, state: stateModule.state };
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

describe('speaker controls helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('normalizes Xiaomi API deviceID fields for selection state', async () => {
    installDom();
    const { speaker } = await loadModules();

    expect(speaker.normalizeDeviceId({ deviceID: 'xiaomi-device-1' })).toBe('xiaomi-device-1');
    expect(speaker.normalizeDeviceName({ name: '厨房音箱', deviceID: 'xiaomi-device-1' })).toBe('厨房音箱');
  });

  it('toggles playlist playback through the player toggle endpoint', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({ state: 'paused', message: 'playlist paused' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { speaker, state } = await loadModules();
    state.accountId = 'miot-account';
    state.deviceId = 'speaker-1';

    await expect(speaker.togglePlayerPlayback()).resolves.toMatchObject({ state: 'paused' });

    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/toggle', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'miot-account', device_id: 'speaker-1' }),
    }));
  });

  it('renders selected account rows with relogin and delete actions', async () => {
    installDom();
    const { speaker, state } = await loadModules();
    state.accountId = 'account-1';

    const html = speaker.renderAccountRow({ id: 'account-1', account: '小米账号', auth_type: 'token' });

    expect(html).toContain('data-action="select-account"');
    expect(html).toContain('data-action="relogin-account"');
    expect(html).toContain('data-action="delete-account"');
    expect(html).toContain('selected-action');
    expect(html).toContain('>已选</button>');
  });

  it('persists selected speaker as managed and last selected for conversation monitoring', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({}) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { speaker, state } = await loadModules();

    await speaker.selectAndPersistDevice('miot-account', 'speaker-1', '客厅音箱');

    expect(state.accountId).toBe('miot-account');
    expect(state.deviceId).toBe('speaker-1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'api/miot/mina/device/managed', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'miot-account', device_id: 'speaker-1', managed: true }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'api/miot/mina/last_selection', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'miot-account', device_id: 'speaker-1' }),
    }));
  });
});
