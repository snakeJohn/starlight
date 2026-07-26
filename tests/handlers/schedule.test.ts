import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerScheduleHandlers } from '../../src/handlers/schedule';
import type { ConfigManager } from '../../src/config/manager';
import type { Scheduler } from '../../src/schedule/scheduler';
import type { ScheduledTask } from '../../src/types';

function request(method: string, path: string, body?: unknown, query = ''): HTTPRequest {
  return {
    method,
    path,
    query,
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function createHarness() {
  const router = createRouter();
  const scheduler = {
    getLogs: vi.fn(() => []),
  } as unknown as Scheduler;
  const configManager = {
    getScheduledTasks: vi.fn(async () => [] as ScheduledTask[]),
    addScheduledTask: vi.fn(async () => {}),
  } as unknown as ConfigManager;

  registerScheduleHandlers(router, scheduler, configManager);
  return { router, scheduler, configManager };
}

describe('registerScheduleHandlers input validation', () => {
  it('rejects a non-array target.devices instead of crashing on the iteration', async () => {
    const { router, configManager } = createHarness();

    const response = await router.handle(request('POST', '/schedules', {
      name: '早安音乐',
      action: 'play_playlist',
      schedule: { type: 'weekly', time: '07:30', weekdays: [1] },
      target: { all_managed: false, devices: { device_id: 'dev-1' } },
      params: { playlist_id: 3 },
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({
      success: false,
      error: '请至少选择一个目标设备',
    });
    expect(configManager.addScheduledTask).not.toHaveBeenCalled();
  });

  it('falls back to the default log limit for invalid limit query values', async () => {
    const { router, scheduler } = createHarness();

    await router.handle(request('GET', '/schedules/logs', undefined, 'limit=abc'));
    expect(scheduler.getLogs).toHaveBeenLastCalledWith(50);

    await router.handle(request('GET', '/schedules/logs', undefined, 'limit=-20'));
    expect(scheduler.getLogs).toHaveBeenLastCalledWith(50);

    await router.handle(request('GET', '/schedules/logs', undefined, 'limit=999999'));
    expect(scheduler.getLogs).toHaveBeenLastCalledWith(200);

    await router.handle(request('GET', '/schedules/logs', undefined, 'limit=25'));
    expect(scheduler.getLogs).toHaveBeenLastCalledWith(25);
  });
});
