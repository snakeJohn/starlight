import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMonitor } from '../../src/conversation/monitor';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { AskMessage } from '../../src/types';

async function flushStart(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function ask(timestamp_ms: number, question: string): AskMessage {
  return {
    timestamp_ms,
    response: { answer: [{ question, content: '好的' }] },
  };
}

describe('ConversationMonitor polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the configured one-second polling interval and forwards new Xiaoai messages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T00:00:00.000Z'));

    const history = ask(1_000, '历史口令');
    const current = ask(1_001, '播放歌曲 父亲');
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockResolvedValueOnce([history])
        .mockResolvedValueOnce([history, current]),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{
        device_id: 'speaker-1',
        device_name: '客厅音箱',
        hardware: 'LX06',
      }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);
    const callback = vi.fn();
    monitor.registerCallback('voice_engine', callback);

    monitor.start();
    await flushStart();

    await vi.advanceTimersByTimeAsync(1000);

    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledWith('speaker-1', 'LX06', 5);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'acc-1',
      device_id: 'speaker-1',
      message: expect.objectContaining({
        response: {
          answer: [expect.objectContaining({ question: '播放歌曲 父亲' })],
        },
      }),
    }));
  });

  it('times out a hung webhook without blocking a healthy recipient', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T00:00:00.000Z'));

    const history = ask(1_000, '历史口令');
    const current = ask(1_001, '播放');
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockResolvedValueOnce([history])
        .mockResolvedValueOnce([history, current]),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{
        device_id: 'speaker-1',
        device_name: '客厅音箱',
        hardware: 'LX06',
      }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;

    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('hang')) {
        return new Promise(() => {
          /* never settles until abort */
        });
      }
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => [
        { id: 'wh-hang', url: 'https://example.invalid/hang' },
        { id: 'wh-ok', url: 'https://example.invalid/ok' },
      ]),
    } as unknown as ConfigManager;

    const monitor = new ConversationMonitor(accountManager, configManager);
    monitor.start();
    await flushStart();

    const tick = vi.advanceTimersByTimeAsync(1000);
    // Allow webhook timeout (5s) to fire.
    await vi.advanceTimersByTimeAsync(5100);
    await tick;

    expect(fetchMock).toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('https://example.invalid/hang');
    expect(urls).toContain('https://example.invalid/ok');
  });

  it('does not start overlapping poll cycles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T00:00:00.000Z'));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let concurrent = 0;
    let maxConcurrent = 0;

    const minaClient = {
      getLatestAskFromXiaoai: vi.fn().mockResolvedValueOnce([]).mockImplementation(async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await gate;
        concurrent -= 1;
        return [] as AskMessage[];
      }),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{
        device_id: 'speaker-1',
        device_name: '客厅音箱',
        hardware: 'LX06',
      }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;

    const monitor = new ConversationMonitor(accountManager, configManager);
    monitor.start();
    await flushStart();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);
    release();
    await Promise.resolve();
    expect(maxConcurrent).toBe(1);
  });

  it('primes from the newest server timestamp without replaying history', async () => {
    vi.useFakeTimers();
    const history = ask(1_000, '历史口令');
    const current = ask(1_001, '新口令');
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockResolvedValueOnce([history])
        .mockResolvedValueOnce([history, current]),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);
    const callback = vi.fn();
    monitor.registerCallback('test', callback);

    monitor.start();
    await flushStart();
    expect(callback).not.toHaveBeenCalled();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: current }));
  });

  it('does not prime a device when fetching conversations fails', async () => {
    vi.useFakeTimers();
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce([ask(2_000, '历史口令')])
        .mockResolvedValueOnce([ask(2_001, '新口令')]),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);
    const callback = vi.fn();
    monitor.registerCallback('test', callback);

    monitor.start();
    await flushStart();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: false, last_timestamp_ms: 0 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('primes a successful empty first response with a zero baseline', async () => {
    vi.useFakeTimers();
    const minaClient = { getLatestAskFromXiaoai: vi.fn().mockResolvedValueOnce([]) };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    monitor.start();
    await flushStart();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 0 });
  });

  it('re-primes retained devices after restart without delivering stopped-period history', async () => {
    vi.useFakeTimers();
    const history = ask(1_000, '启动前历史');
    const stoppedPeriod = ask(1_001, '停止期间口令');
    const current = ask(1_002, '恢复后口令');
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockResolvedValueOnce([history])
        .mockResolvedValueOnce([history, stoppedPeriod])
        .mockResolvedValueOnce([history, stoppedPeriod, current]),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);
    const callback = vi.fn();
    monitor.registerCallback('test', callback);

    monitor.start();
    await flushStart();
    monitor.stop();
    monitor.start();
    await flushStart();

    expect(callback).not.toHaveBeenCalled();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 1_001 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: current }));
  });

  it('ignores an older in-flight priming response when restarted', async () => {
    vi.useFakeTimers();
    const history = ask(1_000, '启动前历史');
    const stoppedPeriod = ask(1_001, '停止期间口令');
    const current = ask(1_002, '恢复后口令');
    let releaseFirstPoll!: () => void;
    const firstPoll = new Promise<AskMessage[]>((resolve) => {
      releaseFirstPoll = () => resolve([history]);
    });
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockImplementationOnce(() => firstPoll)
        .mockResolvedValueOnce([history, stoppedPeriod])
        .mockResolvedValueOnce([history, stoppedPeriod, current]),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);
    const callback = vi.fn();
    monitor.registerCallback('test', callback);

    monitor.start();
    await flushStart();
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(1);
    monitor.stop();
    monitor.start();
    await flushStart();

    try {
      expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);
      expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 1_001 });
    } finally {
      releaseFirstPoll();
    }
    await flushStart();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 1_001 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: current }));
  });

  it('does not apply an obsolete managed-device refresh after restart', async () => {
    vi.useFakeTimers();
    let releaseOldRefresh!: () => void;
    const oldRefresh = new Promise<Array<{ device_id: string; device_name: string; hardware: string }>>((resolve) => {
      releaseOldRefresh = () => resolve([{ device_id: 'old-speaker', device_name: '旧音箱', hardware: 'LX06' }]);
    });
    const minaClient = { getLatestAskFromXiaoai: vi.fn(async () => []) };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn()
        .mockImplementationOnce(() => oldRefresh)
        .mockResolvedValueOnce([{ device_id: 'new-speaker', device_name: '新音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    monitor.start();
    await flushStart();
    monitor.stop();
    monitor.start();
    await flushStart();
    expect((await monitor.getStatus()).devices).toEqual([
      expect.objectContaining({ device_id: 'new-speaker', primed: true }),
    ]);

    releaseOldRefresh();
    await flushStart();
    expect((await monitor.getStatus()).devices).toEqual([
      expect.objectContaining({ device_id: 'new-speaker', primed: true }),
    ]);
  });
});
