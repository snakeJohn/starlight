import { afterEach, describe, expect, it, vi } from 'vitest';

interface SpeakerControlsModule {
  normalizeDeviceId(device: Record<string, unknown>): string;
  normalizeDeviceName(device: Record<string, unknown>): string;
  renderAccountRow(account: Record<string, unknown>): string;
  renderDeviceRow(row: Record<string, unknown>): string;
  selectAndPersistDevice(accountId: string, deviceId: string, name?: string): Promise<void>;
  clearSelectedDevice(): void;
  renderVoiceRecordList(records: Array<Record<string, unknown>>, now?: number): string;
  runPlayerAction(action: string): Promise<unknown>;
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

  it('renders the selected speaker with a cancel selection action', async () => {
    installDom();
    const { speaker, state } = await loadModules();
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    const html = speaker.renderDeviceRow({
      account_id: 'acc-1',
      account_name: '小米账号',
      device: { device_id: 'speaker-1', name: '客厅音箱', model: 'xiaomi' },
    });

    expect(html).toContain('data-action="clear-device-selection"');
    expect(html).toContain('>取消选择</button>');
    expect(html).toContain('selected-action');
    expect(html).not.toContain('>已选</button>');
  });

  it('clears the current selected speaker without changing the selected account', async () => {
    installDom();
    const { speaker, state } = await loadModules();
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    speaker.clearSelectedDevice();

    expect(state.accountId).toBe('acc-1');
    expect(state.deviceId).toBe('');
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

  it('renders only the last 12 hours of speaker conversations newest first', async () => {
    installDom();
    const { speaker } = await loadModules();
    const now = new Date('2026-06-22T20:00:00+08:00').getTime();

    const html = speaker.renderVoiceRecordList([
      {
        device_name: '卧室音箱',
        message: {
          timestamp_ms: now - 13 * 60 * 60 * 1000,
          response: { answer: [{ question: '旧记录', content: '过期回答' }] },
        },
      },
      {
        device_name: '客厅音箱',
        message: {
          timestamp_ms: now - 2 * 60 * 1000,
          response: { answer: [{ question: '播放稻香', content: '好的' }] },
        },
      },
      {
        device_name: '书房音箱',
        message: {
          timestamp_ms: now - 8 * 60 * 60 * 1000,
          response: { answer: [{ intention: { query: '下一首' }, content: '已切换' }] },
        },
      },
    ], now);

    expect(html).toContain('客厅音箱');
    expect(html).toContain('播放稻香');
    expect(html).toContain('书房音箱');
    expect(html).toContain('下一首');
    expect(html.indexOf('客厅音箱')).toBeLessThan(html.indexOf('书房音箱'));
    expect(html).not.toContain('旧记录');
    expect(html).not.toContain('过期回答');
  });

  it('renders speaker answers from alternate conversation fields before fallback text', async () => {
    installDom();
    const { speaker } = await loadModules();
    const now = new Date('2026-06-22T20:00:00+08:00').getTime();

    const html = speaker.renderVoiceRecordList([
      {
        device_name: '客厅音箱',
        message: {
          timestamp_ms: now - 1000,
          response: {
            answer: [{
              question: '今天几号',
              text: '今天是六月二十二日',
            }],
          },
        },
      },
      {
        device_name: '卧室音箱',
        message: {
          timestamp_ms: now - 2000,
          response: {
            answer: [{
              intention: { query: '播放稻香' },
              content: { to_speak: '即将播放稻香' },
            }],
          },
        },
      },
    ], now);

    expect(html).toContain('今天是六月二十二日');
    expect(html).toContain('即将播放稻香');
    expect(html).not.toContain('音箱暂无文本回应');
  });

  it('sends speaker player commands through the MIoT playlist endpoints', async () => {
    installDom();
    const fetchMock = vi.fn(async () => okResponse({ message: 'playing next song' }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { speaker, state } = await loadModules();
    state.accountId = 'acc-1';
    state.deviceId = 'speaker-1';

    await speaker.runPlayerAction('speaker-player-next');

    expect(fetchMock).toHaveBeenCalledWith('api/miot/player/next', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account_id: 'acc-1', device_id: 'speaker-1' }),
    }));
  });
});
