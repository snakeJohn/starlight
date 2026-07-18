import { CustomPlaylistStore } from '../custom_playlists/store';
import type { CustomPlaylist, CustomPlaylistSong } from '../custom_playlists/types';
import type { CustomPlaylistService } from '../custom_playlists/service';
import { StarlightError } from '../system/errors';
import { LxSyncClient } from './client';
import { mapListDataToPlaylists, mergeSongsByStableKey, normalizeBaseUrl, summarizeListData } from './mapper';
import {
  DEFAULT_LX_SYNC_CONFIG,
  LX_SYNC_CONFIG_KEY,
  type LxSyncConfig,
  type LxSyncConfigPatch,
  type LxSyncConfigPublic,
  type LxSyncConflict,
  type LxSyncConnectInput,
  type LxSyncPreviewResult,
  type LxSyncPullStats,
  type LxMappedPlaylist,
} from './types';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix = 'lx'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function asConfig(value: unknown): LxSyncConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_LX_SYNC_CONFIG };
  }
  const record = value as Partial<LxSyncConfig>;
  const conflict: LxSyncConflict = record.conflict === 'merge' ? 'merge' : 'replace';
  return {
    baseUrl: typeof record.baseUrl === 'string' ? normalizeBaseUrl(record.baseUrl) : '',
    username: typeof record.username === 'string' ? record.username.trim() : '',
    ...(typeof record.token === 'string' && record.token ? { token: record.token } : {}),
    ...(typeof record.lastSyncAt === 'string' && record.lastSyncAt ? { lastSyncAt: record.lastSyncAt } : {}),
    importDefaultList: record.importDefaultList !== false,
    conflict,
  };
}

function publicConfig(config: LxSyncConfig): LxSyncConfigPublic {
  return {
    baseUrl: config.baseUrl,
    username: config.username,
    connected: Boolean(config.token && config.baseUrl),
    ...(config.lastSyncAt ? { lastSyncAt: config.lastSyncAt } : {}),
    importDefaultList: config.importDefaultList,
    conflict: config.conflict,
  };
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

export class LxSyncService {
  private readonly store: CustomPlaylistStore;
  private readonly customPlaylists?: Pick<CustomPlaylistService, 'syncToSongloftPlaylist'>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    playlistStore?: CustomPlaylistStore;
    customPlaylists?: Pick<CustomPlaylistService, 'syncToSongloftPlaylist'>;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.store = options.playlistStore || new CustomPlaylistStore();
    this.customPlaylists = options.customPlaylists;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async getConfig(): Promise<LxSyncConfigPublic> {
    return publicConfig(await this.loadConfig());
  }

  async updateConfig(patch: LxSyncConfigPatch): Promise<LxSyncConfigPublic> {
    const current = await this.loadConfig();
    const next: LxSyncConfig = {
      ...current,
      ...(patch.baseUrl !== undefined ? { baseUrl: normalizeBaseUrl(String(patch.baseUrl || '')) } : {}),
      ...(patch.username !== undefined ? { username: String(patch.username || '').trim() } : {}),
      ...(patch.importDefaultList !== undefined ? { importDefaultList: Boolean(patch.importDefaultList) } : {}),
      ...(patch.conflict !== undefined
        ? { conflict: patch.conflict === 'merge' ? 'merge' : 'replace' }
        : {}),
    };
    // Changing base/user invalidates token
    if (
      (patch.baseUrl !== undefined && next.baseUrl !== current.baseUrl) ||
      (patch.username !== undefined && next.username !== current.username)
    ) {
      delete next.token;
    }
    await this.saveConfig(next);
    songloft.log.info(`[LxSync] config updated baseUrl=${next.baseUrl ? 'set' : 'empty'} user=${next.username || '(none)'}`);
    return publicConfig(next);
  }

  async connect(input: LxSyncConnectInput): Promise<LxSyncConfigPublic> {
    const baseUrl = normalizeBaseUrl(input.baseUrl || '');
    const username = (input.username || '').trim();
    const password = input.password || '';
    if (!baseUrl) {
      throw new StarlightError('BAD_REQUEST', 'baseUrl is required');
    }
    if (!username) {
      throw new StarlightError('BAD_REQUEST', 'username is required');
    }
    if (!password) {
      throw new StarlightError('BAD_REQUEST', 'password is required');
    }

    const client = this.createClient(baseUrl);
    const token = await client.login(username, password);
    const current = await this.loadConfig();
    const next: LxSyncConfig = {
      ...current,
      baseUrl,
      username,
      token,
    };
    await this.saveConfig(next);
    songloft.log.info(`[LxSync] connected user=${username} baseUrl=${baseUrl}`);
    return publicConfig(next);
  }

  async disconnect(): Promise<LxSyncConfigPublic> {
    const current = await this.loadConfig();
    const next: LxSyncConfig = {
      ...current,
    };
    delete next.token;
    await this.saveConfig(next);
    songloft.log.info('[LxSync] disconnected');
    return publicConfig(next);
  }

  async preview(): Promise<LxSyncPreviewResult> {
    const config = await this.requireConnectedConfig();
    const client = this.createClient(config.baseUrl, config.token);
    const listData = await client.getList();
    const playlists = summarizeListData(listData, { importDefaultList: config.importDefaultList });
    return {
      playlists,
      totalSongs: playlists.reduce((sum, item) => sum + item.songCount, 0),
    };
  }

  async pull(): Promise<LxSyncPullStats> {
    const config = await this.requireConnectedConfig();
    const client = this.createClient(config.baseUrl, config.token);
    const listData = await client.getList();
    const mapped = mapListDataToPlaylists(listData, { importDefaultList: config.importDefaultList });
    const stats = await this.importMapped(mapped, config.conflict);

    const lastSyncAt = nowIso();
    await this.saveConfig({ ...config, lastSyncAt });

    songloft.log.info(
      `[LxSync] pull done playlists=${stats.playlistsCreated + stats.playlistsUpdated} songs=${stats.songsImported}`,
    );

    return {
      ...stats,
      lastSyncAt,
    };
  }

  async importToSongloft(playlistIds: string[]): Promise<{
    results: Array<{
      id: string;
      total: number;
      skipped: number;
      errors: Array<{ title: string; message: string }>;
    }>;
  }> {
    if (!this.customPlaylists) {
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

  private async importMapped(
    mapped: LxMappedPlaylist[],
    conflict: LxSyncConflict,
  ): Promise<Omit<LxSyncPullStats, 'lastSyncAt'>> {
    const playlists = await this.store.loadAll();
    let playlistsCreated = 0;
    let playlistsUpdated = 0;
    let songsImported = 0;
    const touched: LxSyncPullStats['playlists'] = [];

    for (const draft of mapped) {
      // LX identity lives in sourceListId only. Do NOT set native_playlist_id:
      // that field is reserved for Songloft numeric playlist ids and would
      // block loadDynamicPlayerSongs + poison syncToSongloftPlaylist.
      const existingIndex = playlists.findIndex(
        (playlist) =>
          String(playlist.sourceListId || '') === draft.native_playlist_id ||
          String(playlist.native_playlist_id || '') === draft.native_playlist_id ||
          (draft.kind === 'love' && playlist.name.trim() === '我喜欢' && (
            String(playlist.sourceListId || '').startsWith('lx:') ||
            String(playlist.native_playlist_id || '').startsWith('lx:') ||
            playlist.source_name === '洛雪同步' ||
            !playlist.source
          )),
      );

      const existing = existingIndex >= 0 ? playlists[existingIndex] : undefined;
      const songs = this.resolveSongs(existing?.songs || [], draft.songs, conflict);
      const timestamp = nowIso();
      const { native_playlist_id: _dropNative, ...existingWithoutNative } = (existing || {
        id: createId('lx'),
        imported_at: timestamp,
      }) as CustomPlaylist & { native_playlist_id?: string | number };
      const next: CustomPlaylist = {
        ...existingWithoutNative,
        name: draft.name,
        cover_url: draft.cover_url || existing?.cover_url || '',
        source_name: '洛雪同步',
        sourceListId: draft.native_playlist_id,
        native_playlist_name: draft.name,
        updated_at: timestamp,
        songs,
      };

      if (existing) {
        playlists[existingIndex] = next;
        playlistsUpdated += 1;
      } else {
        playlists.push(next);
        playlistsCreated += 1;
      }
      songsImported += songs.length;
      touched.push({
        id: next.id,
        name: next.name,
        songs: next.songs,
        songCount: next.songs.length,
      });
    }

    await this.store.saveAll(playlists);
    return { playlistsCreated, playlistsUpdated, songsImported, playlists: touched };
  }

  private resolveSongs(
    existing: CustomPlaylistSong[],
    incoming: CustomPlaylistSong[],
    conflict: LxSyncConflict,
  ): CustomPlaylistSong[] {
    if (conflict === 'merge') {
      return mergeSongsByStableKey(existing, incoming);
    }
    return incoming;
  }

  private async requireConnectedConfig(): Promise<LxSyncConfig & { token: string }> {
    const config = await this.loadConfig();
    if (!config.baseUrl || !config.token) {
      throw new StarlightError('AUTH_TOKEN_EXPIRED', '未连接洛雪同步服务，请先登录', false);
    }
    return config as LxSyncConfig & { token: string };
  }

  private createClient(baseUrl: string, token?: string): LxSyncClient {
    return new LxSyncClient({
      baseUrl,
      token,
      fetchImpl: this.fetchImpl,
    });
  }

  private async loadConfig(): Promise<LxSyncConfig> {
    const raw = await songloft.storage.get(LX_SYNC_CONFIG_KEY);
    return asConfig(safeParse(raw));
  }

  private async saveConfig(config: LxSyncConfig): Promise<void> {
    // Never persist password; token is optional private storage.
    const payload: LxSyncConfig = {
      baseUrl: config.baseUrl,
      username: config.username,
      importDefaultList: config.importDefaultList,
      conflict: config.conflict,
    };
    if (config.token) payload.token = config.token;
    if (config.lastSyncAt) payload.lastSyncAt = config.lastSyncAt;
    await songloft.storage.set(LX_SYNC_CONFIG_KEY, JSON.stringify(payload));
  }
}
