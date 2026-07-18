import { LX_SYNC_DEVICES_KEY } from './constants';
import type { LxClientKeyInfo } from './types';

function safeParse(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeDevice(value: unknown): LxClientKeyInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.clientId !== 'string' || typeof r.key !== 'string') return null;
  return {
    clientId: r.clientId,
    key: r.key,
    deviceName: typeof r.deviceName === 'string' ? r.deviceName : 'Unknown',
    isMobile: r.isMobile === true,
    lastConnectDate: typeof r.lastConnectDate === 'number' ? r.lastConnectDate : 0,
    ...(typeof r.serverName === 'string' ? { serverName: r.serverName } : {}),
    ...(typeof r.listSnapshotKey === 'string' && r.listSnapshotKey
      ? { listSnapshotKey: r.listSnapshotKey }
      : {}),
  };
}

/**
 * Device session key store. All load/mutate/persist paths share one async queue
 * so concurrent first-auth after password regenerate cannot last-write-win.
 */
export class LxDeviceStore {
  private cache: Map<string, LxClientKeyInfo> | null = null;
  private chain: Promise<void> = Promise.resolve();

  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.chain;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async loadAll(): Promise<LxClientKeyInfo[]> {
    return this.runExclusive(async () => {
      const map = await this.ensureUnlocked();
      return Array.from(map.values()).sort((a, b) => (b.lastConnectDate || 0) - (a.lastConnectDate || 0));
    });
  }

  async get(clientId: string): Promise<LxClientKeyInfo | null> {
    return this.runExclusive(async () => {
      const map = await this.ensureUnlocked();
      return map.get(clientId) ?? null;
    });
  }

  async save(info: LxClientKeyInfo): Promise<void> {
    await this.runExclusive(async () => {
      const map = await this.ensureUnlocked();
      if (!map.has(info.clientId) && map.size > 100) {
        throw new Error('max devices');
      }
      map.set(info.clientId, info);
      await this.persistUnlocked(map);
    });
  }

  async touch(clientId: string): Promise<LxClientKeyInfo | null> {
    return this.runExclusive(async () => {
      const map = await this.ensureUnlocked();
      const info = map.get(clientId);
      if (!info) return null;
      info.lastConnectDate = Date.now();
      map.set(clientId, info);
      await this.persistUnlocked(map);
      return info;
    });
  }

  async remove(clientId: string): Promise<void> {
    await this.runExclusive(async () => {
      const map = await this.ensureUnlocked();
      map.delete(clientId);
      await this.persistUnlocked(map);
    });
  }

  /** Drop all authorized device session keys (e.g. after password change). */
  async clearAll(): Promise<void> {
    await this.runExclusive(async () => {
      this.cache = new Map();
      await songloft.storage.set(LX_SYNC_DEVICES_KEY, JSON.stringify({}));
    });
  }

  /** Caller must hold the exclusive chain. */
  private async ensureUnlocked(): Promise<Map<string, LxClientKeyInfo>> {
    if (this.cache) return this.cache;
    const raw = safeParse(await songloft.storage.get(LX_SYNC_DEVICES_KEY));
    const map = new Map<string, LxClientKeyInfo>();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        const device = normalizeDevice(value);
        if (device) map.set(id, device);
      }
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        const device = normalizeDevice(item);
        if (device) map.set(device.clientId, device);
      }
    }
    this.cache = map;
    return map;
  }

  /** Caller must hold the exclusive chain. */
  private async persistUnlocked(map: Map<string, LxClientKeyInfo>): Promise<void> {
    const obj: Record<string, LxClientKeyInfo> = {};
    for (const [id, info] of map) obj[id] = info;
    await songloft.storage.set(LX_SYNC_DEVICES_KEY, JSON.stringify(obj));
    this.cache = map;
  }
}
