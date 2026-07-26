import { afterEach, describe, expect, it, vi } from 'vitest';
import { QRCodeLogin } from '../../src/qrcode/qrcode';
import type { PollResult } from '../../src/qrcode/qrcode';

/** 服务端长轮询约 30s，远长于轮询间隔 */
const SERVER_LONG_POLL_MS = 30_000;

describe('QRCodeLogin.startPolling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never runs two long-polling requests at the same time', async () => {
    vi.useFakeTimers();

    const login = new QRCodeLogin();
    (login as unknown as { pollUrl: string }).pollUrl = 'https://account.xiaomi.com/longPolling/lp';

    let inFlight = 0;
    let maxInFlight = 0;
    const pollSpy = vi.spyOn(login, 'poll').mockImplementation(async (): Promise<PollResult> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, SERVER_LONG_POLL_MS));
      inFlight--;
      return { state: 'waiting', message: 'waiting for QR code scan' };
    });

    const started = login.startPolling();
    await vi.advanceTimersByTimeAsync(SERVER_LONG_POLL_MS);
    await started;
    await vi.advanceTimersByTimeAsync(120_000);

    // setInterval 不等待异步回调，会并发压出多个请求并迅速耗尽 MAX_POLL_COUNT
    expect(maxInFlight).toBe(1);
    expect(pollSpy.mock.calls.length).toBeLessThanOrEqual(6);

    const callsBeforeStop = pollSpy.mock.calls.length;
    login.stopPolling();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(pollSpy.mock.calls.length).toBe(callsBeforeStop);
  });

  it('does not start a second polling loop while the first one is running', async () => {
    vi.useFakeTimers();

    const login = new QRCodeLogin();
    (login as unknown as { pollUrl: string }).pollUrl = 'https://account.xiaomi.com/longPolling/lp';

    const pollSpy = vi.spyOn(login, 'poll').mockImplementation(async (): Promise<PollResult> => {
      await new Promise(resolve => setTimeout(resolve, SERVER_LONG_POLL_MS));
      return { state: 'waiting', message: 'waiting for QR code scan' };
    });

    // 第一次 startPolling 的首轮 poll 还没返回时再次调用，不应额外发起请求
    const first = login.startPolling();
    const second = login.startPolling();
    await vi.advanceTimersByTimeAsync(SERVER_LONG_POLL_MS);
    await Promise.all([first, second]);

    expect(pollSpy).toHaveBeenCalledTimes(1);
    login.stopPolling();
  });
});
