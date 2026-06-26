import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { currentTarget: FakeElement | null; target?: FakeElement }) => unknown;

interface AutomationModule {
  initAutomationUI(): Promise<void>;
}

class FakeElement {
  dataset: Record<string, string> = {};
  disabled = false;
  textContent = '';
  innerHTML = '';
  value = '';
  checked = false;
  elements: Record<string, { value?: string; checked?: boolean; disabled?: boolean }> = {};
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
  querySelectorAll(): FakeElement[] { return []; }
  closest(): FakeElement | null { return null; }
  insertAdjacentHTML(): void {}
}

function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
}

function installAutomationDom() {
  const refreshIndex = new FakeElement();
  const refreshAutomation = new FakeElement();
  const scheduleForm = new FakeElement();
  const scheduleList = new FakeElement();
  const voiceCommandList = new FakeElement();
  const indexingState = new FakeElement();
  const indexPlaylists = new FakeElement();
  const indexSongs = new FakeElement();
  const indexUpdated = new FakeElement();
  const loadConfig = new FakeElement();
  const scheduleConfigForm = new FakeElement();
  scheduleConfigForm.elements = {
    scheduled_tasks_enabled: { checked: false },
  };
  const formNodes = [scheduleConfigForm];
  const elements = new Map<string, FakeElement>([
    ['[data-action="refresh-index"]', refreshIndex],
    ['[data-action="refresh-automation"]', refreshAutomation],
    ['[data-action="load-config"]', loadConfig],
    ['[data-role="schedule-form"]', scheduleForm],
    ['[data-role="schedule-list"]', scheduleList],
    ['[data-role="voice-command-list"]', voiceCommandList],
    ['[data-role="indexing-state"]', indexingState],
    ['[data-role="index-playlists"]', indexPlaylists],
    ['[data-role="index-songs"]', indexSongs],
    ['[data-role="index-updated"]', indexUpdated],
  ]);

  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '[data-action="load-config"]') return [loadConfig];
      if (selector === '[data-config-form]') return formNodes;
      if (selector === '[name="conversation_monitor_enabled"]' || selector === '[name="server_host"]' || selector === '[data-role="voice-command-row"]') return [];
      return [];
    }),
    createElement: vi.fn(() => new FakeElement()),
    body: new FakeElement(),
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: {
      getAuthToken: () => 'ui-token',
    },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

  return { refreshIndex };
}

describe('automation UI repeat init', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('does not register duplicate indexing refresh listeners when automation UI initializes twice', async () => {
    const { refreshIndex } = installAutomationDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/miot/voice-commands')) return okResponse({ enabled: false, commands: [] });
      if (url.endsWith('/miot/indexing/status')) return okResponse({ ready: false, is_refreshing: false, playlist_count: 0, song_count: 0 });
      if (url.endsWith('/miot/schedules')) return okResponse([]);
      if (url.endsWith('/miot/config')) return okResponse({ scheduled_tasks_enabled: false });
      if (url.endsWith('/miot/indexing/refresh')) return okResponse({});
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const modulePath = '../../static/js/automation.js';
    const { initAutomationUI } = await import(modulePath) as AutomationModule;
    await initAutomationUI();
    await initAutomationUI();

    fetchMock.mockClear();
    await refreshIndex.dispatch('click');

    const refreshCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/miot/indexing/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});
