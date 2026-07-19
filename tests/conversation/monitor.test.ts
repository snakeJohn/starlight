import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMonitor } from '../../src/conversation/monitor';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { AskMessage } from '../../src/types';

describe('ConversationMonitor polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the configured one-second polling interval and forwards new Xiaoai messages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-26T00:00:00.000Z'));

    const askMessage = (): AskMessage => ({
      timestamp_ms: Date.now() + 100,
      response: {
        answer: [{ question: '播放歌曲 父亲', content: '好的' }],
      },
    });
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn(async () => [askMessage()]),
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
    await Promise.resolve();
    await Promise.resolve();

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

    const askMessage = (): AskMessage => ({
      timestamp_ms: Date.now() + 100,
      response: {
        answer: [{ question: '播放', content: '好的' }],
      },
    });
    const minaClient = {
      getLatestAskFromXiaoai: vi.fn(async () => [askMessage()]),
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
    await Promise.resolve();
    await Promise.resolve();

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
      getLatestAskFromXiaoai: vi.fn(async () => {
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
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(minaClient.getLatestAskFromXiaoai).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    expect(maxConcurrent).toBe(1);
  });
});
