import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/service';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { PollResult } from '../../src/qrcode/qrcode';

function createService(): AuthService {
  return new AuthService(
    {} as unknown as ConfigManager,
    {} as unknown as AccountManager,
  );
}

function setQRCodeLogin(service: AuthService, accountId: string, qrLogin: unknown): void {
  const internals = service as unknown as { qrLogins: Map<string, unknown> };
  internals.qrLogins.set(accountId, qrLogin);
}

describe('AuthService QR code polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a waiting state instead of blocking the plugin HTTP request while Xiaomi long polling is pending', async () => {
    vi.useFakeTimers();
    const service = createService();
    const qrLogin = {
      poll: vi.fn(() => new Promise<PollResult>(() => {})),
    };
    setQRCodeLogin(service, 'qr_1', qrLogin);

    const outcomePromise = Promise.race([
      service.pollQRCode('qr_1').then(result => ({ kind: 'result' as const, result })),
      new Promise<{ kind: 'timeout' }>(resolve => {
        setTimeout(() => resolve({ kind: 'timeout' }), 2500);
      }),
    ]);

    await vi.advanceTimersByTimeAsync(2500);

    await expect(outcomePromise).resolves.toEqual({
      kind: 'result',
      result: {
        state: 'waiting',
        message: '等待扫码或在米家 App 中确认登录',
      },
    });
    expect(qrLogin.poll).toHaveBeenCalledTimes(1);
  });
});
