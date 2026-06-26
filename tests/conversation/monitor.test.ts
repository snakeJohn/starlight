import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMonitor } from '../../src/conversation/monitor';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { AskMessage } from '../../src/types';

describe('ConversationMonitor polling', () => {
  afterEach(() => {
    vi.useRealTimers();
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
});
