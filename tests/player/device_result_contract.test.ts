import { describe, expect, it, vi } from 'vitest';
import { MinaHTTPClient } from '../../src/mina/client';
import { TaskExecutor } from '../../src/schedule/executor';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { ConversationMonitor } from '../../src/conversation/monitor';
import type { ScheduledTask } from '../../src/types';

/**
 * 设备指令的成败判定必须看设备返回码，而不是「HTTP 层收到了回复」。
 * playURL 用的是 isDeviceResultOK；pause/stop 曾只判 `!== null`，
 * 于是设备在 data.code 里明确拒绝时，上层整条布尔链仍然报成功。
 */
function clientWithUbusResult(result: unknown): MinaHTTPClient {
  const client = new MinaHTTPClient({} as never);
  (client as unknown as {
    ubusRequest(...args: unknown[]): Promise<unknown>;
  }).ubusRequest = vi.fn(async () => result);
  return client;
}

describe('pause/stop must honour the device return code', () => {
  it('reports failure when the device rejects a pause with a non-zero code', async () => {
    const client = clientWithUbusResult({ code: 0, data: { code: 5, message: 'busy' } });
    await expect(client.playerPause('dev-1')).resolves.toBe(false);
  });

  it('reports success when the device accepts the pause', async () => {
    const client = clientWithUbusResult({ code: 0, data: { code: 0 } });
    await expect(client.playerPause('dev-1')).resolves.toBe(true);
  });

  it('reports failure when the device rejects a stop with a non-zero code', async () => {
    const client = clientWithUbusResult({ code: 0, data: { code: 7, message: 'refused' } });
    await expect(client.playerStop('dev-1')).resolves.toBe(false);
  });
});

describe('scheduled stop task must not log success when the speaker keeps playing', () => {
  function executorWithStopResult(stopped: boolean) {
    const pm = { stop: vi.fn(async () => stopped) };
    const playlistManagerMap = {
      getOrCreate: vi.fn(async () => pm),
      get: vi.fn(() => pm),
    } as unknown as PlaylistManagerMap;
    const configManager = {
      getAccounts: vi.fn(async () => [{
        id: 'acc-1',
        devices: [{ device_id: 'dev-1', device_name: '音箱', managed: true }],
      }]),
      getConfig: vi.fn(async () => ({})),
      saveConfig: vi.fn(async () => undefined),
      getDevices: vi.fn(async () => [{ device_id: 'dev-1', device_name: '音箱', managed: true }]),
      updateDevice: vi.fn(async () => undefined),
    } as unknown as ConfigManager;

    return {
      executor: new TaskExecutor(
        configManager,
        {} as unknown as MinaService,
        playlistManagerMap,
        {} as unknown as IndexingManager,
        {} as unknown as ConversationMonitor,
      ),
      pm,
    };
  }

  const stopTask = {
    id: 'task_sleep', name: '睡前停止', enabled: true, action: 'stop',
    schedule: { type: 'weekly', time: '23:30', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    params: {}, target: { all_managed: true },
  } as unknown as ScheduledTask;

  it('records a failure when the device refused to stop', async () => {
    // 丢掉 stop() 的返回值时，睡眠定时器会在音箱仍在播放的情况下
    // 记一条「停止播放成功」——用户第二天只看到成功日志，却整晚被吵。
    const { executor } = executorWithStopResult(false);
    const logs = await executor.execute(stopTask);

    expect(logs).toHaveLength(1);
    expect(logs[0].success).toBe(false);
  });

  it('records success when the device really stopped', async () => {
    const { executor } = executorWithStopResult(true);
    const logs = await executor.execute(stopTask);

    expect(logs[0].success).toBe(true);
    expect(logs[0].message).toContain('成功');
  });
});
