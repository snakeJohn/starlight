import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMonitor } from '../../src/conversation/monitor';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { AskMessage } from '../../src/types';

/** Drain a few microtasks so an in-flight start reaches an await gate. */
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
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

    await monitor.start();

    await vi.advanceTimersByTimeAsync(1000);

    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledWith(
      'speaker-1',
      'LX06',
      5,
      expect.any(AbortSignal),
      expect.any(String),
    );
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
    await monitor.start();

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
    await monitor.start();

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

    await monitor.start();
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

    await monitor.start();
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

    await monitor.start();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 0 });
  });

  it('installs the polling timer after a hung initial device request times out', async () => {
    vi.useFakeTimers();
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockImplementationOnce(() => new Promise<AskMessage[]>(() => {}))
        .mockResolvedValueOnce([]),
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

    monitor.start();
    await flushMicrotasks();
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it('primes multiple devices concurrently so one hung speaker does not delay the others', async () => {
    vi.useFakeTimers();
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn(() => new Promise<AskMessage[]>(() => {})),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [
        { device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'M01' },
        { device_id: 'speaker-2', device_name: '卧室音箱', hardware: 'M01' },
      ]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    const start = monitor.start();
    await flushMicrotasks();
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await start;
  });

  it('asks Mina to release a timed-out conversation slot on hosts without AbortController', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AbortController', undefined);
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockImplementationOnce(() => new Promise<AskMessage[]>(() => {}))
        .mockResolvedValueOnce([]),
      cancelConversationPoll: vi.fn(),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'M01' }]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    monitor.start();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    expect(minaClient.cancelConversationPoll).toHaveBeenCalledWith('speaker-1', expect.any(String));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it('keeps conversation polling working when the host lacks AbortController', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('AbortController', undefined);
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn().mockResolvedValue([]),
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

    await monitor.start();

    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledWith('speaker-1', 'LX06', 5, undefined, expect.any(String));
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_error: '' });
    monitor.stop();
  });

  it('surfaces last_error on status when conversation fetch keeps failing', async () => {
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn().mockResolvedValue(null),
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

    await monitor.start();
    const status = await monitor.getStatus();
    expect(status.devices[0]).toMatchObject({
      primed: false,
      last_error: expect.stringContaining('拉对话失败'),
    });
    monitor.stop();
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

    await monitor.start();
    monitor.stop();
    await monitor.start();

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

    const firstStart = monitor.start();
    await flushMicrotasks();
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(1);
    monitor.stop();
    await monitor.start();

    try {
      expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);
      expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true, last_timestamp_ms: 1_001 });
    } finally {
      releaseFirstPoll();
    }
    await firstStart;
    await flushMicrotasks();
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

    const firstStart = monitor.start();
    await flushMicrotasks();
    monitor.stop();
    await monitor.start();
    expect((await monitor.getStatus()).devices).toEqual([
      expect.objectContaining({ device_id: 'new-speaker', primed: true }),
    ]);

    releaseOldRefresh();
    await firstStart;
    await flushMicrotasks();
    expect((await monitor.getStatus()).devices).toEqual([
      expect.objectContaining({ device_id: 'new-speaker', primed: true }),
    ]);
  });

  it('does not let an older concurrent refresh overwrite a newer snapshot', async () => {
    vi.useFakeTimers();
    let releaseOldRefresh!: () => void;
    let releaseNewRefresh!: () => void;
    const oldRefresh = new Promise<Array<{ device_id: string; device_name: string; hardware: string }>>(resolve => {
      releaseOldRefresh = () => resolve([{ device_id: 'old-speaker', device_name: '旧音箱', hardware: 'LX06' }]);
    });
    const newRefresh = new Promise<Array<{ device_id: string; device_name: string; hardware: string }>>(resolve => {
      releaseNewRefresh = () => resolve([{ device_id: 'new-speaker', device_name: '新音箱', hardware: 'LX06' }]);
    });
    const minaClient = { getLatestAskFromXiaoai: vi.fn(async () => []) };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn()
        .mockResolvedValueOnce([{ device_id: 'initial-speaker', device_name: '初始音箱', hardware: 'LX06' }])
        .mockImplementationOnce(() => oldRefresh)
        .mockImplementationOnce(() => newRefresh),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    await monitor.start();
    const firstRefresh = monitor.refresh();
    await flushMicrotasks();
    const secondRefresh = monitor.refresh();
    await flushMicrotasks();

    releaseNewRefresh();
    await secondRefresh;
    expect((await monitor.getStatus()).devices).toEqual([
      expect.objectContaining({ device_id: 'new-speaker' }),
    ]);

    releaseOldRefresh();
    await firstRefresh;
    expect((await monitor.getStatus()).devices).toEqual([
      expect.objectContaining({ device_id: 'new-speaker' }),
    ]);
    monitor.stop();
  });

  it('disables and rejects when listener initialization fails', async () => {
    const initError = new Error('config unavailable');
    const accountManager = {
      getAccounts: vi.fn(async () => []),
      getManagedDevices: vi.fn(async () => []),
      getMinaClient: vi.fn(() => null),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => { throw initError; }),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    await expect(monitor.start()).rejects.toBe(initError);
    expect(monitor.isEnabled()).toBe(false);
    expect((await monitor.getStatus()).device_count).toBe(0);
  });

  it('does not deliver an in-flight poll after the managed device is removed', async () => {
    vi.useFakeTimers();
    let finishPoll!: (messages: AskMessage[]) => void;
    const inFlightPoll = new Promise<AskMessage[]>(resolve => {
      finishPoll = resolve;
    });
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn()
        .mockResolvedValueOnce([])
        .mockReturnValueOnce(inFlightPoll),
    };
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn()
        .mockResolvedValueOnce([{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }])
        .mockResolvedValueOnce([]),
      getMinaClient: vi.fn(() => minaClient),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => [{ id: 'wh-1', url: 'https://example.invalid/hook' }]),
    } as unknown as ConfigManager;
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const monitor = new ConversationMonitor(accountManager, configManager);
    const callback = vi.fn();
    monitor.registerCallback('test', callback);

    await monitor.start();
    expect((await monitor.getStatus()).devices[0]).toMatchObject({ primed: true });
    vi.advanceTimersByTime(1_000);
    await flushMicrotasks();
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(2);

    await monitor.refresh();
    expect((await monitor.getStatus()).device_count).toBe(0);

    finishPoll([ask(1_000, '移除后的口令')]);
    await flushMicrotasks();

    expect(callback).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(monitor.getMessages()).toEqual([]);
  });

  it('warns when getMinaClient returns null', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(songloft.log, 'warn');
    const accountManager = {
      getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
      getManagedDevices: vi.fn(async () => [{ device_id: 'speaker-1', device_name: '客厅音箱', hardware: 'LX06' }]),
      getMinaClient: vi.fn(() => null),
    } as unknown as AccountManager;
    const configManager = {
      getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
      getWebhooks: vi.fn(async () => []),
    } as unknown as ConfigManager;
    const monitor = new ConversationMonitor(accountManager, configManager);

    try {
      await monitor.start();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('No Mina client for account=acc-1 device=speaker-1'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
