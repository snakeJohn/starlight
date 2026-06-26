import { afterEach, describe, expect, it, vi } from 'vitest';

interface VoiceRecordsModule {
  renderVoiceRecordList(records: Array<Record<string, unknown>>, now?: number): string;
}

function installDom() {
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
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
}

describe('speaker voice record renderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('renders only the last 12 hours of speaker conversations newest first', async () => {
    installDom();
    const modulePath = '../../static/js/speaker_modules/voice_records.js';
    const { renderVoiceRecordList } = await import(modulePath) as VoiceRecordsModule;
    const now = new Date('2026-06-22T20:00:00+08:00').getTime();

    const html = renderVoiceRecordList([
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
});
