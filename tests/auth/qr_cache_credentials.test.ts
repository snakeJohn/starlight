import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/service';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { QRCodeLogin, PollResult } from '../../src/qrcode/qrcode';

/**
 * 扫码轮询的缓存结果会在后续每次 pollQRCode 里被重复返回。
 * 因此它绝不能长期持有 tokenInfo（serviceToken + ssecurity）和 passToken ——
 * 那等于把凭据留在内存里，并且每次轮询都再对外吐一次。
 *
 * 这里走真实路径：注入一个 poll() 返回完整凭据的 QRCodeLogin，让
 * runQRCodePoll 去写缓存，然后再读缓存被回吐的那一次。
 */
function serviceWithPollResult(pollResult: PollResult) {
  const service = new AuthService(
    {} as unknown as ConfigManager,
    {} as unknown as AccountManager,
  );
  const internals = service as unknown as {
    qrLogins: Map<string, QRCodeLogin>;
    qrPollResults: Map<string, PollResult>;
    finishQRCodePoll(accountId: string, result: PollResult): Promise<void>;
  };

  // 落账逻辑（建账号 / 存 token）不是本用例关注点，桩掉以隔离缓存行为
  internals.finishQRCodePoll = vi.fn(async () => undefined);

  const qrLogin = {
    poll: vi.fn(async () => pollResult),
    stopPolling: vi.fn(),
  } as unknown as QRCodeLogin;
  internals.qrLogins.set('acc-1', qrLogin);

  return { service, internals };
}

const CREDENTIALED: PollResult = {
  // 'confirmed' 才是 isQRCodePollTerminal 认的终态；'success' 不是
  state: 'confirmed',
  message: '登录成功',
  account_id: 'acc-1',
  passToken: 'PASS-TOKEN-SECRET',
  tokenInfo: { serviceToken: 'SVC-TOKEN-SECRET', ssecurity: 'SSECURITY-SECRET' },
} as unknown as PollResult;

describe('QR poll cache must not retain credentials', () => {
  it('keeps credentials out of the cache after a successful poll', async () => {
    const { service, internals } = serviceWithPollResult(CREDENTIALED);

    // 第一次轮询：调用方拿到完整结果（登录流程需要），但缓存不该留凭据
    await service.pollQRCode('acc-1');

    const cached = internals.qrPollResults.get('acc-1');
    expect(cached?.state).toBe('confirmed');
    const serialised = JSON.stringify(cached);
    expect(serialised).not.toContain('SVC-TOKEN-SECRET');
    expect(serialised).not.toContain('SSECURITY-SECRET');
    expect(serialised).not.toContain('PASS-TOKEN-SECRET');
  });

  it('does not re-serve credentials on a later poll after the login is gone', async () => {
    const { service, internals } = serviceWithPollResult(CREDENTIALED);
    await service.pollQRCode('acc-1');

    // 扫码会话结束后，pollQRCode 会把终态缓存直接回吐给调用方
    internals.qrLogins.delete('acc-1');
    const served = await service.pollQRCode('acc-1');

    expect(served.state).toBe('confirmed');
    const serialised = JSON.stringify(served);
    expect(serialised).not.toContain('SVC-TOKEN-SECRET');
    expect(serialised).not.toContain('PASS-TOKEN-SECRET');
  });

  it('still returns the full result to the caller that performed the poll', async () => {
    // 剥离只针对缓存：当次调用方要靠 tokenInfo 完成登录，不能一并剥掉
    const { service } = serviceWithPollResult(CREDENTIALED);
    const first = await service.pollQRCode('acc-1') as unknown as Record<string, unknown>;
    expect(first.tokenInfo).toBeDefined();
  });
});
