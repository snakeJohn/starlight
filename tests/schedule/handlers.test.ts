import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerScheduleHandlers } from '../../src/handlers/schedule';
import type { ConfigManager } from '../../src/config/manager';
import type { Scheduler } from '../../src/schedule/scheduler';
import type { PluginConfig, ScheduledTask } from '../../src/types';

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function pluginConfig(): PluginConfig {
  return {
    version: '1.0',
    server_host: '',
    timezone: 'Asia/Shanghai',
    conversation_monitor_enabled: false,
    voice_command_enabled: false,
    scheduled_tasks_enabled: false,
    force_mp3: false,
    external_search_enabled: false,
    external_search_url: '',
    external_search_token: '',
    external_search_playlist_id: '',
    external_search_timeout: 6,
    indicator_light_enabled: true,
    interrupt_tts_hint_enabled: false,
    interrupt_tts_hint_text: '',
    conversation_poll_interval: 1,
    smart_resume_timeout: 30,
    max_song_index: 10000,
    ai_config: {
      enabled: false,
      api_url: '',
      api_key: '',
      model: '',
      timeout: 6,
    },
  };
}

function createHarness() {
  const tasks: ScheduledTask[] = [];
  const router = createRouter();
  const scheduler = {
    getLogs: vi.fn(() => []),
  } as unknown as Scheduler;
  const configManager = {
    getScheduledTasks: vi.fn(async () => tasks),
    getConfig: vi.fn(async () => pluginConfig()),
    addScheduledTask: vi.fn(async (task: ScheduledTask) => {
      tasks.push(task);
    }),
    updateScheduledTask: vi.fn(async (id: string, updates: Partial<ScheduledTask>) => {
      const idx = tasks.findIndex(t => t.id === id);
      if (idx >= 0) {
        tasks[idx] = { ...tasks[idx], ...updates } as ScheduledTask;
      }
    }),
    removeScheduledTask: vi.fn(async () => {}),
  } as unknown as ConfigManager;

  registerScheduleHandlers(router, scheduler, configManager);
  return { router, configManager, tasks };
}

const validSchedule = {
  type: 'weekly',
  time: '08:30',
  weekdays: [1],
};

const validTarget = {
  all_managed: false,
  devices: [{ account_id: 'account-1', device_id: 'speaker-1' }],
};

describe('registerScheduleHandlers validation', () => {
  it('accepts global monitor actions without a device target', async () => {
    const { router, configManager } = createHarness();

    const response = await router.handle(request('POST', '/schedules', {
      name: '开启对话监听',
      action: 'enable_monitor',
      schedule: validSchedule,
      params: {},
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response).success).toBe(true);
    expect(configManager.addScheduledTask).toHaveBeenCalledWith(expect.objectContaining({
      action: 'enable_monitor',
      target: expect.objectContaining({ all_managed: true, devices: [] }),
    }));
  });

  it('rejects invalid time, weekday, and monthday ranges', async () => {
    const { router } = createHarness();

    const invalidTime = await router.handle(request('POST', '/schedules', {
      name: '坏时间',
      action: 'stop',
      schedule: { type: 'weekly', time: '24:60', weekdays: [1] },
      target: validTarget,
      params: {},
    }));
    const invalidWeekday = await router.handle(request('POST', '/schedules', {
      name: '坏星期',
      action: 'stop',
      schedule: { type: 'weekly', time: '08:30', weekdays: [7] },
      target: validTarget,
      params: {},
    }));
    const invalidMonthday = await router.handle(request('POST', '/schedules', {
      name: '坏日期',
      action: 'stop',
      schedule: { type: 'monthly', time: '08:30', monthdays: [0, 32] },
      target: validTarget,
      params: {},
    }));

    expect(parseResponseBody(invalidTime).success).toBe(false);
    expect(parseResponseBody(invalidWeekday).success).toBe(false);
    expect(parseResponseBody(invalidMonthday).success).toBe(false);
  });

  it('rejects invalid play mode and non-numeric volume values', async () => {
    const { router } = createHarness();

    const invalidMode = await router.handle(request('POST', '/schedules', {
      name: '坏模式',
      action: 'set_play_mode',
      schedule: validSchedule,
      target: validTarget,
      params: { play_mode: 'shuffle_all' },
    }));
    const invalidVolume = await router.handle(request('POST', '/schedules', {
      name: '坏音量',
      action: 'set_volume',
      schedule: validSchedule,
      target: validTarget,
      params: { volume: 'loud' },
    }));

    expect(parseResponseBody(invalidMode).success).toBe(false);
    expect(parseResponseBody(invalidVolume).success).toBe(false);
  });

  it('patches schedule fields without clearing action when action is omitted', async () => {
    const { router, configManager, tasks } = createHarness();
    tasks.push({
      id: 'task-1',
      name: '晨间播放',
      enabled: true,
      action: 'play_playlist',
      schedule: { type: 'weekly', time: '08:30', weekdays: [1] },
      target: validTarget,
      params: { playlist_name: '喜欢' },
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
    } as ScheduledTask);

    const response = await router.handle(request('POST', '/schedules/update', {
      id: 'task-1',
      name: '晨间播放（改名）',
      schedule: { type: 'weekly', time: '09:00', weekdays: [1, 2] },
      // intentionally omit action / params / target
    }));

    expect(parseResponseBody(response).success).toBe(true);
    expect(configManager.updateScheduledTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      name: '晨间播放（改名）',
      action: 'play_playlist',
      params: { playlist_name: '喜欢' },
      schedule: expect.objectContaining({ time: '09:00' }),
    }));
  });
});
