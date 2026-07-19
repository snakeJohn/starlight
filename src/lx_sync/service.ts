import { CustomPlaylistStore } from '../custom_playlists/store';
import type { CustomPlaylist } from '../custom_playlists/types';
import type { CustomPlaylistService } from '../custom_playlists/service';
import { StarlightError } from '../system/errors';
import {
  DEFAULT_SERVER_NAME,
  LX_SYNC_CONFIG_KEY,
} from './constants';
import {
  authCodeToAesKey,
  createClientSessionKey,
  createServerId,
  generatePassword,
} from './crypto_lx';
import { LxDeviceStore } from './devices';
import { clearAuthRateLimits } from './auth_rate_limit';
import { applyListActionToData } from './list_merge';
import {
  mapListDataToPlaylists,
  mapPlaylistsToListData,
} from './mapper';
import type {
  LxClientKeyInfo,
  LxListData,
  LxMappedPlaylist,
  LxSyncConfig,
  LxSyncConfigPatch,
  LxSyncConfigPublic,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix = 'lx'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function safeParse(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asConfig(value: unknown): { config: LxSyncConfig; needsPersist: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      config: {
        password: generatePassword(),
        serverId: createServerId(),
        serverName: DEFAULT_SERVER_NAME,
        enabled: true,
      },
      needsPersist: true,
    };
  }
  const record = value as Partial<LxSyncConfig> & Record<string, unknown>;
  const hadPassword = typeof record.password === 'string' && Boolean(record.password);
  const hadServerId = typeof record.serverId === 'string' && Boolean(record.serverId);
  // Legacy JSON-import config may still hold conflict/importDefaultList without stable keys.
  const isLegacyShape =
    'conflict' in record || 'importDefaultList' in record || !hadPassword || !hadServerId;
  return {
    config: {
      password: hadPassword ? String(record.password) : generatePassword(),
      serverId: hadServerId ? String(record.serverId) : createServerId(),
      serverName:
        typeof record.serverName === 'string' && record.serverName.trim()
          ? record.serverName.trim()
          : DEFAULT_SERVER_NAME,
      enabled: record.enabled !== false,
      ...(typeof record.lastSyncAt === 'string' && record.lastSyncAt ? { lastSyncAt: record.lastSyncAt } : {}),
    },
    needsPersist: isLegacyShape || !hadPassword || !hadServerId,
  };
}

/** Live WS peer used for multi-client list action fan-out. */
export type LxListSyncPeer = {
  clientId: string;
  isListReady: () => boolean;
  /** Push an incremental list action to this client (message2call remote). */
  notifyListAction: (action: unknown) => Promise<void>;
  /** Force-close the underlying socket (e.g. after password revoke). */
  close: () => void;
};

export class LxSyncService {
  private readonly store: CustomPlaylistStore;
  private readonly customPlaylists?: Partial<
    Pick<CustomPlaylistService, 'syncToSongloftPlaylist' | 'mirrorSongloftPlaylistsForLx'>
  >;
  private readonly devices = new LxDeviceStore();
  private connectedClientIds = new Set<string>();
  private listPeers = new Map<string, LxListSyncPeer>();
  private hostBaseUrl = '';
  /** Serialize concurrent list sync / action writes. */
  private syncChain: Promise<void> = Promise.resolve();
  /**
   * Serialize auto Songloft import after LX list writes.
   * Kept separate from syncChain so WS list RPCs are not blocked by host import I/O.
   */
  private autoImportChain: Promise<void> = Promise.resolve();
  private autoImportTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: {
    playlistStore?: CustomPlaylistStore;
    customPlaylists?: Partial<
      Pick<CustomPlaylistService, 'syncToSongloftPlaylist' | 'mirrorSongloftPlaylistsForLx'>
    >;
    hostBaseUrl?: string;
  } = {}) {
    this.store = options.playlistStore || new CustomPlaylistStore();
    this.customPlaylists = options.customPlaylists;
    this.hostBaseUrl = options.hostBaseUrl || '';
  }

  setHostBaseUrl(url: string): void {
    this.hostBaseUrl = String(url || '').replace(/\/$/, '');
  }

  /**
   * Run exclusive list-sync work so overlapping WS sessions cannot race store writes.
   */
  async withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.syncChain;
    this.syncChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  getConnectedCount(): number {
    return this.connectedClientIds.size;
  }

  /** Register a connected list-sync peer (replaces any prior registration for the same clientId). */
  registerListPeer(peer: LxListSyncPeer): void {
    const existing = this.listPeers.get(peer.clientId);
    if (existing && existing !== peer) {
      try {
        existing.close();
      } catch {
        /* ignore */
      }
    }
    this.listPeers.set(peer.clientId, peer);
    this.connectedClientIds.add(peer.clientId);
  }

  unregisterListPeer(clientId: string): void {
    this.listPeers.delete(clientId);
    this.connectedClientIds.delete(clientId);
  }

  /**
   * Fan-out an incremental list action to other ready clients (lxserver multi-device live sync).
   * Never re-sends to the originator.
   */
  async broadcastListAction(fromClientId: string, action: unknown): Promise<void> {
    const targets: LxListSyncPeer[] = [];
    for (const [id, peer] of this.listPeers) {
      if (id === fromClientId) continue;
      if (!peer.isListReady()) continue;
      targets.push(peer);
    }
    await Promise.all(
      targets.map(async (peer) => {
        try {
          await peer.notifyListAction(action);
        } catch (err) {
          songloft.log.warn(
            `[LxSync] fan-out onListSyncAction failed client=${peer.clientId}: ${String(err)}`,
          );
        }
      }),
    );
  }

  /** Close every live socket and clear the peer registry (password revoke / disable). */
  dropAllConnections(): void {
    const peers = Array.from(this.listPeers.values());
    this.listPeers.clear();
    this.connectedClientIds.clear();
    for (const peer of peers) {
      try {
        peer.close();
      } catch {
        /* ignore */
      }
    }
  }

  async getConfig(): Promise<LxSyncConfigPublic> {
    const config = await this.ensureConfig();
    return this.toPublic(config);
  }

  async updateConfig(patch: LxSyncConfigPatch): Promise<LxSyncConfigPublic> {
    const current = await this.ensureConfig();
    let password = current.password;
    if (patch.regeneratePassword) {
      password = generatePassword();
    } else if (typeof patch.password === 'string' && patch.password.trim()) {
      password = patch.password.trim();
    }
    const passwordChanged = password !== current.password;
    // Keep service enabled when only rotating the key unless the user explicitly disables it.
    const enabled =
      patch.enabled !== undefined
        ? Boolean(patch.enabled)
        : current.enabled !== false;
    const next: LxSyncConfig = {
      ...current,
      password,
      enabled,
      // Rotate serverId on password change so LX clients drop cached client keys and
      // re-run password (code) auth — otherwise they keep keyAuth with a revoked clientId.
      ...(passwordChanged ? { serverId: createServerId() } : {}),
      ...(patch.serverName !== undefined
        ? { serverName: String(patch.serverName || '').trim() || DEFAULT_SERVER_NAME }
        : {}),
    };
    await this.saveConfig(next);
    if (passwordChanged) {
      // Password regen/change must revoke long-lived device session keys and kick sockets.
      await this.devices.clearAll();
      this.dropAllConnections();
      // Failed reconnect attempts with the old key must not leave the LAN peer blocked.
      clearAuthRateLimits();
      songloft.log.info(
        `[LxSync] password changed: new serverId issued, revoked devices, cleared auth rate limits`,
      );
    }
    // Disabling the service must also tear down live peers (new connections are already blocked).
    if (current.enabled && next.enabled === false) {
      this.dropAllConnections();
      songloft.log.info('[LxSync] service disabled: dropped all live connections');
    }
    songloft.log.info(`[LxSync] config updated enabled=${next.enabled}`);
    return this.toPublic(next);
  }

  async getAuthPasswordKey(): Promise<string> {
    const config = await this.ensureConfig();
    return authCodeToAesKey(config.password);
  }

  async getServerMeta(): Promise<{ serverId: string; serverName: string; enabled: boolean; helloMsg: string }> {
    const config = await this.ensureConfig();
    return {
      serverId: config.serverId,
      serverName: config.serverName,
      enabled: config.enabled,
      helloMsg: 'Hello~::^-^::~v4~',
    };
  }

  async issueClientKey(deviceName: string, isMobile: boolean): Promise<LxClientKeyInfo & { serverName: string }> {
    const config = await this.ensureConfig();
    if (!config.enabled) throw new StarlightError('BAD_REQUEST', '洛雪同步服务已关闭');
    const session = createClientSessionKey();
    const info: LxClientKeyInfo = {
      clientId: session.clientId,
      key: session.key,
      deviceName: deviceName || 'Unknown',
      isMobile,
      lastConnectDate: Date.now(),
      serverName: config.serverName,
    };
    await this.devices.save(info);
    return { ...info, serverName: config.serverName };
  }

  async getDevice(clientId: string): Promise<LxClientKeyInfo | null> {
    return this.devices.get(clientId);
  }

  async touchDevice(clientId: string, deviceName?: string): Promise<LxClientKeyInfo | null> {
    const info = await this.devices.get(clientId);
    if (!info) return null;
    if (deviceName && deviceName !== info.deviceName) info.deviceName = deviceName;
    info.lastConnectDate = Date.now();
    await this.devices.save(info);
    return info;
  }

  /** Local ListData for protocol sync — only LX-managed playlists (`sourceListId` starts with `lx:`). */
  async getLocalListData(): Promise<LxListData> {
    const playlists = await this.store.loadAll();
    const lxOnly = playlists.filter((p) => String(p.sourceListId || '').startsWith('lx:'));
    return mapPlaylistsToListData(lxOnly);
  }

  /**
   * Persist protocol ListData as a full snapshot of LX-managed lists.
   * - Includes empty lists (clear/overwrite).
   * - Full song replace.
   * - Removes LX playlists absent from the snapshot; keeps non-LX custom playlists.
   * - After write, schedules auto-import of each LX playlist into Songloft
   *   (same playlist name + songs into the Songloft song library).
   */
  async setLocalListData(listData: LxListData): Promise<void> {
    const mapped = mapListDataToPlaylists(listData, { includeEmpty: true });
    await this.replaceLxManagedSnapshot(mapped);
    const config = await this.ensureConfig();
    await this.saveConfig({ ...config, lastSyncAt: nowIso() });
    this.scheduleAutoImportToSongloft();
  }

  /** Apply an incremental list action from a connected LX client. */
  async applyListAction(action: unknown): Promise<void> {
    const local = await this.getLocalListData();
    const next = applyListActionToData(local, action);
    await this.setLocalListData(next);
  }

  /**
   * Wait for pending auto Songloft imports (tests / diagnostics).
   */
  async awaitPendingAutoImport(): Promise<void> {
    if (this.autoImportTimer) {
      clearTimeout(this.autoImportTimer);
      this.autoImportTimer = null;
      this.enqueueAutoImportNow();
    }
    await this.autoImportChain;
  }

  async markSynced(): Promise<void> {
    const config = await this.ensureConfig();
    await this.saveConfig({ ...config, lastSyncAt: nowIso() });
  }

  /** Device list snapshot key from last successful full list sync (if any). */
  async getDeviceListSnapshotKey(clientId: string): Promise<string | undefined> {
    const info = await this.devices.get(clientId);
    const key = info?.listSnapshotKey;
    return typeof key === 'string' && key ? key : undefined;
  }

  /**
   * Persist device snapshot key after a successful list sync so the next reconnect
   * can auto-merge without re-prompting the first-sync mode dialog.
   */
  async setDeviceListSnapshotKey(clientId: string, snapshotKey: string): Promise<void> {
    const info = await this.devices.get(clientId);
    if (!info) return;
    const nextKey = String(snapshotKey || '').trim();
    if (!nextKey) return;
    if (info.listSnapshotKey === nextKey) {
      info.lastConnectDate = Date.now();
      await this.devices.save(info);
      return;
    }
    info.listSnapshotKey = nextKey;
    info.lastConnectDate = Date.now();
    await this.devices.save(info);
  }

  /**
   * Always re-import LX playlists into Songloft after a successful list-sync session.
   * Needed when setLocalListData was skipped (lists already equal) but the user
   * deleted Songloft playlists and expects them to be recreated on re-enable.
   */
  ensureSongloftImportAfterSync(): void {
    this.scheduleAutoImportToSongloft();
  }

  async importToSongloft(playlistIds: string[]): Promise<{
    results: Array<{
      id: string;
      total: number;
      skipped: number;
      errors: Array<{ title: string; message: string }>;
    }>;
  }> {
    if (!this.customPlaylists?.syncToSongloftPlaylist) {
      throw new StarlightError('INTERNAL_ERROR', 'CustomPlaylistService is not available');
    }
    const ids = playlistIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (!ids.length) {
      throw new StarlightError('BAD_REQUEST', 'playlist_ids is required');
    }

    const results = [];
    for (const id of ids) {
      const synced = await this.customPlaylists.syncToSongloftPlaylist(id);
      results.push({
        id,
        total: synced.total,
        skipped: synced.skipped,
        errors: synced.errors,
      });
    }
    return { results };
  }

  /**
   * Export Songloft host playlists into LX list data (user lists under
   * `lx:user:songloft:{id}`). Live LX peers receive a full list overwrite so
   * 洛雪 clients pick up the lists without reconnecting when possible.
   *
   * @param nativePlaylistIds Optional Songloft playlist ids; omit to export all.
   */
  async exportSongloftPlaylistsToLx(nativePlaylistIds?: Array<string | number>): Promise<{
    total: number;
    pushed_to_peers: number;
    playlists: Array<{ id: string; name: string; songs: number; sourceListId?: string }>;
    errors: Array<{ name: string; message: string }>;
  }> {
    if (!this.customPlaylists?.mirrorSongloftPlaylistsForLx) {
      throw new StarlightError('INTERNAL_ERROR', 'CustomPlaylistService is not available');
    }

    const mirrored = await this.customPlaylists.mirrorSongloftPlaylistsForLx(nativePlaylistIds);
    await this.markSynced();
    const pushed = await this.pushLocalListSnapshotToPeers();

    return {
      total: mirrored.total,
      pushed_to_peers: pushed,
      playlists: mirrored.playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        songs: playlist.songs?.length || 0,
        sourceListId: playlist.sourceListId,
      })),
      errors: mirrored.errors,
    };
  }

  /** Push current LX list snapshot to all ready peers (list_data_overwrite). */
  async pushLocalListSnapshotToPeers(): Promise<number> {
    const listData = await this.getLocalListData();
    const action = { action: 'list_data_overwrite', data: listData } as const;
    const targets = Array.from(this.listPeers.values()).filter((peer) => peer.isListReady());
    await Promise.all(
      targets.map(async (peer) => {
        try {
          await peer.notifyListAction(action);
        } catch (err) {
          songloft.log.warn(
            `[LxSync] push list_data_overwrite failed client=${peer.clientId}: ${String(err)}`,
          );
        }
      }),
    );
    return targets.length;
  }

  private async toPublic(config: LxSyncConfig): Promise<LxSyncConfigPublic> {
    const devices = await this.devices.loadAll();
    const serverAddress = await this.resolveServerAddress();
    return {
      serverAddress,
      password: config.password,
      serverId: config.serverId,
      serverName: config.serverName,
      enabled: config.enabled,
      ...(config.lastSyncAt ? { lastSyncAt: config.lastSyncAt } : {}),
      devices: devices.map((d) => ({
        clientId: d.clientId,
        deviceName: d.deviceName,
        isMobile: d.isMobile,
        lastConnectDate: d.lastConnectDate,
      })),
      connectedCount: this.connectedClientIds.size,
    };
  }

  private async resolveServerAddress(): Promise<string> {
    let base = this.hostBaseUrl;
    if (!base) {
      try {
        base = String((await songloft.plugin.getHostUrl()) || '').replace(/\/$/, '');
      } catch {
        base = '';
      }
    }
    if (!base) return '';
    if (/\/api\/v1\/jsplugin\/starlight\/?$/i.test(base)) {
      return base.replace(/\/$/, '');
    }
    if (/\/api\/v1\/jsplugin\/?$/i.test(base)) {
      return `${base.replace(/\/$/, '')}/starlight`;
    }
    return `${base.replace(/\/$/, '')}/api/v1/jsplugin/starlight`;
  }

  /**
   * Protocol snapshot: upsert mapped drafts with full song replace; drop LX lists
   * not present in the snapshot; keep non-LX custom playlists.
   */
  private async replaceLxManagedSnapshot(mapped: LxMappedPlaylist[]): Promise<void> {
    const mappedIds = new Set(mapped.map((draft) => draft.lxListId));
    const timestamp = nowIso();

    // Atomic load → snapshot replace → save so UI edits cannot race last-write-win.
    await this.store.mutate((playlists) => {
      const nextPlaylists: CustomPlaylist[] = playlists.filter((playlist) => {
        const sid = String(playlist.sourceListId || '');
        if (!sid.startsWith('lx:')) return true;
        return mappedIds.has(sid);
      });

      for (const draft of mapped) {
        const existingIndex = nextPlaylists.findIndex((playlist) => this.isSameLxPlaylist(playlist, draft));
        const existing = existingIndex >= 0 ? nextPlaylists[existingIndex] : undefined;
        const base: CustomPlaylist = existing
          ? { ...existing }
          : {
              id: createId('lx'),
              name: draft.name,
              cover_url: '',
              imported_at: timestamp,
              updated_at: timestamp,
              songs: [],
            };

        if (base.native_playlist_id !== undefined && typeof base.native_playlist_id !== 'number') {
          delete base.native_playlist_id;
        }

        const next: CustomPlaylist = {
          ...base,
          name: draft.name,
          cover_url: draft.cover_url || existing?.cover_url || '',
          source_name: '洛雪同步',
          sourceListId: draft.lxListId,
          native_playlist_name: draft.name,
          updated_at: timestamp,
          songs: draft.songs,
        };

        if (existingIndex >= 0) nextPlaylists[existingIndex] = next;
        else nextPlaylists.push(next);
      }

      return nextPlaylists;
    });
  }

  private isSameLxPlaylist(playlist: CustomPlaylist, draft: LxMappedPlaylist): boolean {
    if (String(playlist.sourceListId || '') === draft.lxListId) return true;
    // Legacy love-list only — never match by bare name (user-created 我喜欢 stays separate).
    if (draft.kind !== 'love') return false;
    if (playlist.name.trim() !== '我喜欢') return false;
    if (typeof playlist.native_playlist_id === 'number') return false;
    if (playlist.source) return false;
    const sourceListId = String(playlist.sourceListId || '');
    if (sourceListId === 'lx:love') return true;
    // Any other sourceListId (including lx:user:…) is a different list.
    if (sourceListId) return false;
    // Untagged legacy row that was already managed by LX sync.
    return playlist.source_name === '洛雪同步';
  }

  private async ensureConfig(): Promise<LxSyncConfig> {
    const raw = await songloft.storage.get(LX_SYNC_CONFIG_KEY);
    const { config, needsPersist } = asConfig(safeParse(raw));
    // Persist on first create and when migrating legacy / incomplete config blobs.
    if (!raw || needsPersist) await this.saveConfig(config);
    return config;
  }

  private async saveConfig(config: LxSyncConfig): Promise<void> {
    const payload: LxSyncConfig = {
      password: config.password,
      serverId: config.serverId,
      serverName: config.serverName,
      enabled: config.enabled,
    };
    if (config.lastSyncAt) payload.lastSyncAt = config.lastSyncAt;
    await songloft.storage.set(LX_SYNC_CONFIG_KEY, JSON.stringify(payload));
  }

  /**
   * Debounce rapid list writes (e.g. multi-step WS actions) then import all
   * LX-managed playlists into Songloft under the same names.
   */
  private scheduleAutoImportToSongloft(): void {
    if (!this.customPlaylists?.syncToSongloftPlaylist) return;
    if (this.autoImportTimer) clearTimeout(this.autoImportTimer);
    this.autoImportTimer = setTimeout(() => {
      this.autoImportTimer = null;
      this.enqueueAutoImportNow();
    }, 400);
  }

  private enqueueAutoImportNow(): void {
    if (!this.customPlaylists?.syncToSongloftPlaylist) return;
    this.autoImportChain = this.autoImportChain
      .then(() => this.runAutoImportToSongloft())
      .catch((error) => {
        songloft.log.warn(
          `[LxSync] auto-import to Songloft failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  private async runAutoImportToSongloft(): Promise<void> {
    if (!this.customPlaylists?.syncToSongloftPlaylist) return;
    const playlists = await this.store.loadAll();
    const lxPlaylists = playlists.filter((playlist) => String(playlist.sourceListId || '').startsWith('lx:'));
    if (!lxPlaylists.length) return;

    songloft.log.info(`[LxSync] auto-import ${lxPlaylists.length} LX playlist(s) → Songloft (same name + song library)`);
    for (const playlist of lxPlaylists) {
      try {
        const result = await this.customPlaylists.syncToSongloftPlaylist(playlist.id);
        songloft.log.info(
          `[LxSync] Songloft import ok name="${playlist.name}" total=${result.total} skipped=${result.skipped}`,
        );
      } catch (error) {
        songloft.log.warn(
          `[LxSync] Songloft import failed name="${playlist.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
