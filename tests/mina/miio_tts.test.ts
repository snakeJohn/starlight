import { describe, expect, it } from 'vitest';
import { MiIOClient } from '../../src/mina/miio_client';
import { XIAOMI_IO_SID } from '../../src/mina/constants';
import type { XiaomiTokenInfo } from '../../src/types';

function tokenInfo(services: XiaomiTokenInfo['services']): XiaomiTokenInfo {
  return {
    user_id: 'user-1',
    device_id: 'client-device-1',
    services,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('MiIOClient TTS command', () => {
  it('reports failure (not success) when the MiIO request cannot be sent', async () => {
    // 没有 xiaomiio token → miotAction 返回 null。以前 null 被当作 code=0 从而误报成功，
    // 导致 MinaClient 跳过 Mina UBus 回退，音箱最终完全没有播报。
    const client = new MiIOClient(tokenInfo({}));

    await expect(client.textToSpeechByCommand('123456789', '5-3', '你好')).resolves.toBe(false);
  });

  it('reports failure when the xiaomiio service token is incomplete', async () => {
    const client = new MiIOClient(tokenInfo({
      [XIAOMI_IO_SID]: {
        service_token: 'st-1',
        ssecurity: '',
        expires_at: Date.now() + 3600_000,
      },
    }));

    await expect(client.textToSpeechByCommand('123456789', '5-3', '你好')).resolves.toBe(false);
  });

  it('rejects malformed TTS commands', async () => {
    const client = new MiIOClient(tokenInfo({}));

    await expect(client.textToSpeechByCommand('123456789', 'not-a-command', '你好')).resolves.toBe(false);
    await expect(client.textToSpeechByCommand('', '5-3', '你好')).resolves.toBe(false);
  });
});
