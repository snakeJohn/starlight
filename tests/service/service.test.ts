import { describe, expect, it, vi } from 'vitest';
import { MinaService } from '../../src/service/service';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';

function createService() {
  const client = {
    setVolume: vi.fn(async () => true),
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
  it('rejects invalid volume values before calling the device client', async () => {
    const { service, client, accountManager } = createService();

    await expect(service.setVolume('acc-1', 'dev-1', Number.NaN)).resolves.toBe(false);
    await expect(service.setVolume('acc-1', 'dev-1', -1)).resolves.toBe(false);
    await expect(service.setVolume('acc-1', 'dev-1', 101)).resolves.toBe(false);

    expect(client.setVolume).not.toHaveBeenCalled();
    expect(accountManager.updateDeviceConfig).not.toHaveBeenCalled();
  });
});
