import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinaAuth } from '../../src/mina/auth';
import { LoginState } from '../../src/mina/constants';

/** int64 nonce，JSON.parse 后无法用 Number 还原原始十进制字符串 */
const BIG_NEGATIVE_NONCE = '-3057847348874358421';

function makeResponse(body: string, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    text: async () => body,
  } as unknown as Response;
}

/**
 * 走完 serviceLogin → serviceLoginAuth2 → STS 三步，返回 STS 请求上带的 clientSign。
 * nonceLiteral 直接拼进 JSON：既可以是裸数字，也可以是带引号的字符串。
 */
async function clientSignForNonce(nonceLiteral: string): Promise<string> {
  const stsUrls: string[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url);
    if (target.includes('/pass/serviceLoginAuth2')) {
      return makeResponse(
        `&&&START&&&{"code":0,"ssecurity":"c2VjcmV0","nonce":${nonceLiteral},"userId":123456789,` +
        `"location":"https://sts.example.com/sts?a=1"}`,
      );
    }
    if (target.includes('/pass/serviceLogin')) {
      return makeResponse('&&&START&&&{"code":0,"_sign":"sign-1","qs":"?qs=1","callback":"https://cb.example.com/cb","sid":"micoapi"}');
    }
    stsUrls.push(target);
    return makeResponse('{}', { 'set-cookie': 'serviceToken=st-1; path=/' });
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await new MinaAuth().login('tester', 'secret');
  expect(result.state).toBe(LoginState.SUCCESS);
  expect(stsUrls.length).toBe(1);

  return new URL(stsUrls[0]).searchParams.get('clientSign') || '';
}

describe('MinaAuth clientSign nonce handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps int64 precision for negative nonces', async () => {
    // 负号必须被大整数提取正则覆盖，否则会回落到 JSON.parse 的 double 结果并丢失末尾数字，
    // 算出的 clientSign 与服务端不一致，登录在 STS 这一步失败且没有明确报错。
    const fromNumericNonce = await clientSignForNonce(BIG_NEGATIVE_NONCE);
    const fromStringNonce = await clientSignForNonce(`"${BIG_NEGATIVE_NONCE}"`);

    expect(fromNumericNonce).not.toBe('');
    expect(fromNumericNonce).toBe(fromStringNonce);
  });

  it('keeps int64 precision for positive nonces', async () => {
    const fromNumericNonce = await clientSignForNonce('1610098522385872896');
    const fromStringNonce = await clientSignForNonce('"1610098522385872896"');

    expect(fromNumericNonce).not.toBe('');
    expect(fromNumericNonce).toBe(fromStringNonce);
  });
});
