import { afterEach, describe, expect, it, vi } from 'vitest';

interface AutomationSchedulesModule {
  scheduleFromForm(form: { elements: Record<string, { value?: string; checked?: boolean }> }): Record<string, unknown>;
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

describe('automation schedules module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('serializes a weekly task from the extracted schedules module', async () => {
    installDom();
    const modulePath = '../../static/js/automation_modules/schedules.js';
    const { scheduleFromForm } = await import(modulePath) as AutomationSchedulesModule;

    const task = scheduleFromForm({
      elements: {
        id: { value: '' },
        name: { value: '早安歌单' },
        action: { value: 'play_playlist' },
        schedule_type: { value: 'weekly' },
        time: { value: '08:30' },
        weekdays: { value: '1, 3, 5' },
        monthdays: { value: '' },
        playlist_name: { value: '每日推荐' },
        volume: { value: '36' },
        play_mode: { value: 'loop' },
        enabled: { checked: true },
        all_managed: { checked: true },
      },
    });

    expect(task).toEqual({
      id: undefined,
      name: '早安歌单',
      enabled: true,
      action: 'play_playlist',
      schedule: {
        type: 'weekly',
        time: '08:30',
        weekdays: [1, 3, 5],
      },
      target: {
        all_managed: true,
        devices: [],
      },
      params: {
        playlist_name: '每日推荐',
        volume: 36,
        play_mode: 'loop',
      },
    });
  });
});
