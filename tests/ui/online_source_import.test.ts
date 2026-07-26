import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: FakeEvent) => unknown;

interface FakeEvent {
  currentTarget: FakeElement | null;
  target: FakeElement;
  key?: string;
  preventDefault?: () => void;
}

class FakeElement {
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = true;
  textContent = '';
  value = '';
  className = '';
  private listeners = new Map<string, Listener[]>();
  private attrs = new Map<string, string>();

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  closest(selector: string): FakeElement | null {
    if (selector === 'button[data-action]' && this.dataset.action) {
      return this;
    }
    return null;
  }

  appendChild(_child?: FakeElement): void {}
  remove(): void {}
  querySelector(): FakeElement | null {
    return null;
  }

  async dispatch(type: string, extra: Partial<FakeEvent> = {}): Promise<void> {
    const event: FakeEvent = {
      currentTarget: this,
      target: this,
      preventDefault: () => {},
      ...extra,
    };
    for (const listener of this.listeners.get(type) || []) {
      await listener(event);
    }
    event.currentTarget = null;
  }
}

interface OnlineSourceModule {
  normalizeOnlineSourceInput: (value: string) => { sourceUrl: string; pathname: string } | null;
  openOnlineSourceImportDialog: (url: string) => Promise<boolean>;
  submitOnlineSourceImport: (mode: string) => Promise<void>;
  bindOnlineSourceImport: () => void;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function installOnlineSourceDom(options: {
  sources?: Array<Record<string, unknown>>;
  downloadSources?: Array<Record<string, unknown>>;
} = {}) {
  const dialog = new FakeElement();
  dialog.hidden = true;
  const urlLabel = new FakeElement();
  const existingHint = new FakeElement();
  existingHint.hidden = true;
  const input = new FakeElement();
  const openButton = new FakeElement();
  openButton.dataset.action = 'open-online-source-import';

  const playbackBtn = new FakeElement();
  playbackBtn.dataset.action = 'online-import-playback';
  const downloadBtn = new FakeElement();
  downloadBtn.dataset.action = 'online-import-download';
  const bothBtn = new FakeElement();
  bothBtn.dataset.action = 'online-import-both';
  const cancelBtn = new FakeElement();
  cancelBtn.dataset.action = 'online-import-cancel';

  const elements = new Map<string, FakeElement>([
    ['[data-role="online-source-dialog"]', dialog],
    ['[data-role="online-source-url"]', urlLabel],
    ['[data-role="online-source-existing"]', existingHint],
    ['[data-role="online-source-input"]', input],
    ['[data-action="open-online-source-import"]', openButton],
  ]);

  const modeButtons = [playbackBtn, downloadBtn, bothBtn, cancelBtn];
  const body = new FakeElement();

  vi.stubGlobal('document', {
    querySelector: (selector: string) => {
      if (selector === '.toast') return null;
      return elements.get(selector) ?? null;
    },
    querySelectorAll: (selector: string) => {
      if (selector === '[data-action^="online-import-"]') {
        return modeButtons;
      }
      return [];
    },
    createElement: () => new FakeElement(),
    body,
  });

  vi.stubGlobal('window', {
    SongloftPlugin: { getAuthToken: () => '' },
    dispatchEvent: vi.fn(),
    setTimeout: vi.fn((fn: () => void) => {
      // Do not auto-fire toast timers.
      void fn;
      return 0;
    }),
  });

  return {
    dialog,
    urlLabel,
    existingHint,
    input,
    openButton,
    playbackBtn,
    downloadBtn,
    bothBtn,
    cancelBtn,
    seedSources: options.sources || [],
    seedDownloadSources: options.downloadSources || [],
  };
}

async function loadSourcesModule(ui: ReturnType<typeof installOnlineSourceDom>): Promise<OnlineSourceModule> {
  const stateModule = await import('../../static/js/state.js') as {
    setState: (patch: Record<string, unknown>) => void;
  };
  stateModule.setState({
    sources: ui.seedSources,
    downloadSources: ui.seedDownloadSources,
    sourcePage: 1,
  });

  return await import('../../static/js/music_modules/sources.js') as OnlineSourceModule;
}

describe('online source import UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('normalizes fragment/default port and rejects non-HTTPS or non-JS pathname', async () => {
    const ui = installOnlineSourceDom();
    const { normalizeOnlineSourceInput } = await loadSourcesModule(ui);

    expect(normalizeOnlineSourceInput('HTTPS://Example.test:443/a.js?token=x#part')).toEqual({
      sourceUrl: 'https://example.test/a.js?token=x',
      pathname: '/a.js',
    });
    expect(normalizeOnlineSourceInput('http://example.test/source.js')).toBeNull();
    expect(normalizeOnlineSourceInput('https://example.test/source.txt')).toBeNull();
  });

  it('does not open for non-HTTPS or non-JS pathname', async () => {
    const ui = installOnlineSourceDom();
    const { openOnlineSourceImportDialog } = await loadSourcesModule(ui);

    await expect(openOnlineSourceImportDialog('http://example.test/source.js')).resolves.toBe(false);
    await expect(openOnlineSourceImportDialog('https://example.test/source.txt')).resolves.toBe(false);
    expect(ui.dialog.hidden).toBe(true);
  });

  it('opens dialog with URL and existing-source hint when sourceUrl matches', async () => {
    const ui = installOnlineSourceDom({
      sources: [{ id: 'online-1', sourceUrl: 'https://example.test/source.js', name: 'Existing' }],
    });
    const { openOnlineSourceImportDialog } = await loadSourcesModule(ui);

    await expect(openOnlineSourceImportDialog('https://example.test/source.js#frag')).resolves.toBe(true);
    expect(ui.dialog.hidden).toBe(false);
    expect(ui.urlLabel.textContent).toBe('https://example.test/source.js');
    expect(ui.existingHint.hidden).toBe(false);
  });

  it.each(['playback', 'download', 'both'] as const)('submits %s and refreshes the list', async (mode) => {
    const ui = installOnlineSourceDom();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/music/sources/import-url')) {
        return jsonResponse({
          success: true,
          data: {
            operation: 'imported',
            source: { id: 'online-1', name: 'Online', sourceUrl: 'https://example.test/source.js' },
            playbackEnabled: mode !== 'download',
            downloadEnabled: mode !== 'playback',
            contentChanged: true,
          },
        });
      }
      if (url.endsWith('/music/sources') || url.endsWith('/download/sources')) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse({ success: false, error: { message: `unexpected ${url}` } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { openOnlineSourceImportDialog, submitOnlineSourceImport } = await loadSourcesModule(ui);
    await openOnlineSourceImportDialog('https://example.test/source.js');
    await submitOnlineSourceImport(mode);

    const importCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/music/sources/import-url'));
    expect(importCall).toBeTruthy();
    const body = importCall?.[1] && typeof importCall[1] === 'object' ? (importCall[1] as RequestInit).body : undefined;
    expect(JSON.parse(String(body))).toEqual({
      url: 'https://example.test/source.js',
      enable_mode: mode,
    });
    expect(ui.dialog.hidden).toBe(true);
  });

  it('cancel closes dialog without calling the import API', async () => {
    const ui = installOnlineSourceDom();
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ success: true, data: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const module = await loadSourcesModule(ui);
    module.bindOnlineSourceImport();
    await module.openOnlineSourceImportDialog('https://example.test/source.js');
    expect(ui.dialog.hidden).toBe(false);

    // Trigger cancel through the dialog click handler.
    await ui.dialog.dispatch('click', { target: ui.cancelBtn });

    const importCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/music/sources/import-url'));
    expect(importCalls).toHaveLength(0);
    expect(ui.dialog.hidden).toBe(true);
  });
});
