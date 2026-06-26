import { afterEach, describe, expect, it, vi } from 'vitest';

interface SpeakerDevicesModule {
  selectAndPersistDevice(accountId: string, deviceId: string, name?: string): Promise<void>;
}

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
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

describe('speaker devices module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('persists selected speaker as managed and last selected from the extracted devices module', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const stateModulePath = '../../static/js/state.js';
    const modulePath = '../../static/js/speaker_modules/devices.js';
    const { state } = await import(stateModulePath) as { state: { accountId: string; deviceId: string } };
    const { selectAndPersistDevice } = await import(modulePath) as SpeakerDevicesModule;

    await selectAndPersistDevice('miot-account', 'speaker-1', '客厅音箱');

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
