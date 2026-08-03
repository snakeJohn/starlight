import { describe, expect, it, vi } from 'vitest';
import { MinaService } from '../../src/service/service';
import type { PauseVerificationResult } from '../../src/mina/client';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';

function createService() {
  const client = {
    setVolume: vi.fn(async () => true),
    playerPauseVerified: vi.fn(async (): Promise<PauseVerificationResult> => 'paused'),
  };
  const accountManager = {
    getMinaClient: vi.fn(() => client),
    updateDeviceConfig: vi.fn(async () => {}),
  } as unknown as AccountManager;
  const configManager = {} as ConfigManager;

  return {
    service: new MinaService(accountManager, configManager),
    client,
    accountManager,
  };
}

describe('MinaService', () => {
  it('delegates verified pause results to the Mina client', async () => {
    const { service, client } = createService();
    client.playerPauseVerified.mockResolvedValue('stopped');

    await expect(service.pausePlayVerified('acc-1', 'dev-1')).resolves.toBe('stopped');
    expect(client.playerPauseVerified).toHaveBeenCalledWith('dev-1');
  });

  it('returns failed when verified pause has no client', async () => {
    const accountManager = {
      getMinaClient: vi.fn(() => null),
    } as unknown as AccountManager;
    const service = new MinaService(accountManager, {} as ConfigManager);

    await expect(service.pausePlayVerified('missing', 'dev-1')).resolves.toBe('failed');
  });

  it('returns failed when verified pause throws', async () => {
    const { service, client } = createService();
    client.playerPauseVerified.mockRejectedValue(new Error('network failed'));

    await expect(service.pausePlayVerified('acc-1', 'dev-1')).resolves.toBe('failed');
  });

  it('rejects invalid volume values before calling the device client', async () => {
    const { service, client, accountManager } = createService();

    await expect(service.setVolume('acc-1', 'dev-1', Number.NaN)).resolves.toBe(false);
    await expect(service.setVolume('acc-1', 'dev-1', -1)).resolves.toBe(false);
    await expect(service.setVolume('acc-1', 'dev-1', 101)).resolves.toBe(false);

    expect(client.setVolume).not.toHaveBeenCalled();
    expect(accountManager.updateDeviceConfig).not.toHaveBeenCalled();
  });

  it('caches device identity for speakers that have no MIoT DID', async () => {
    // 没有 miotDID 的设备如果不进缓存，每次 TTS/播放都会重新拉一遍 device_list
    const client = {
      getDeviceList: vi.fn(async () => [
        { deviceID: 'dev-1', name: '音箱', miotDID: '', model: 'model-1', hardware: 'ZZZ', alias: '', presence: 'online' },
      ]),
      textToSpeech: vi.fn(async () => true),
    };
    const accountManager = {
      getMinaClient: vi.fn(() => client),
    } as unknown as AccountManager;
    const service = new MinaService(accountManager, {} as ConfigManager);

    await expect(service.textToSpeech('acc-1', 'dev-1', '你好')).resolves.toBe(true);
    await expect(service.textToSpeech('acc-1', 'dev-1', '再见')).resolves.toBe(true);

    expect(client.getDeviceList).toHaveBeenCalledTimes(1);
    expect(client.textToSpeech).toHaveBeenCalledTimes(2);
  });
});
