import { beforeEach, describe, expect, it } from 'vitest';
import { LxDeviceStore } from '../../src/lx_sync/devices';
import { LX_SYNC_DEVICES_KEY } from '../../src/lx_sync/constants';
import type { LxClientKeyInfo } from '../../src/lx_sync/types';

function device(id: string, overrides: Partial<LxClientKeyInfo> = {}): LxClientKeyInfo {
  return {
    clientId: id,
    key: `key-${id}`,
    deviceName: id,
    isMobile: false,
    lastConnectDate: Date.now(),
    ...overrides,
  };
}

describe('LxDeviceStore', () => {
  beforeEach(async () => {
    await songloft.storage.delete(LX_SYNC_DEVICES_KEY).catch(() => undefined);
  });

  it('serializes concurrent saves so both devices survive', async () => {
    const store = new LxDeviceStore();
    // Force both saves to start before either finishes reading/persisting.
    await Promise.all([store.save(device('a')), store.save(device('b'))]);

    const all = await store.loadAll();
    expect(all.map((d) => d.clientId).sort()).toEqual(['a', 'b']);

    // Fresh store instance must still see both (persisted, not only in-memory).
    const again = new LxDeviceStore();
    const reloaded = await again.loadAll();
    expect(reloaded.map((d) => d.clientId).sort()).toEqual(['a', 'b']);
  });

  it('clearAll drops every device under the exclusive chain', async () => {
    const store = new LxDeviceStore();
    await store.save(device('x'));
    await store.clearAll();
    expect(await store.loadAll()).toEqual([]);
    expect(await store.get('x')).toBeNull();
  });
});
