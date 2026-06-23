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
    indicator_light_enabled: true,
    interrupt_tts_hint_enabled: false,
    interrupt_tts_hint_text: '',
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
    updateScheduledTask: vi.fn(async () => {}),
    removeScheduledTask: vi.fn(async () => {}),
  } as unknown as ConfigManager;

  registerScheduleHandlers(router, scheduler, configManager);
  return { router, configManager };
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
});
