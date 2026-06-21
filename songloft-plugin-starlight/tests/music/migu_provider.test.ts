import { afterEach, describe, expect, test, vi } from 'vitest';
import { MiguProvider } from '../../src/music/platforms/providers/mg';

const originalCrypto = globalThis.crypto;

describe('MiguProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  test('sends a deterministic non-empty Migu search signature', async () => {
    const now = 1_764_543_210_000;
    const keyword = 'starlight';
    const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
    const signaturePayload = `${keyword}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${now}`;
    const expectedSign = 'de6820338dd3d400b63476c4fe366f4a';
    const cryptoMd5 = vi.fn((value: string) => (value === signaturePayload ? expectedSign : 'unexpected-signature-input'));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ songResultData: { resultList: [], totalCount: 0 } })));

    vi.spyOn(Date, 'now').mockReturnValue(now);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { md5: cryptoMd5 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await new MiguProvider().search(keyword, 2, 30);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cryptoMd5).toHaveBeenCalledWith(signaturePayload);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toBeDefined();
    if (!init) {
      throw new Error('Expected Migu search to pass request options');
    }
    expect(init.headers).toMatchObject({
      timestamp: String(now),
      deviceId,
      sign: expectedSign,
    });
    expect((init.headers as Record<string, string>).sign).not.toBe('');
  });
});
