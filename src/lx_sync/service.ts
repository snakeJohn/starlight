import { CustomPlaylistStore } from '../custom_playlists/store';
import type { CustomPlaylist, CustomPlaylistSong } from '../custom_playlists/types';
import type { CustomPlaylistService } from '../custom_playlists/service';
import { StarlightError } from '../system/errors';
import {
  mapListDataToPlaylists,
  mapPlaylistsToListData,
  mergeSongsByStableKey,
  parseLxListPayload,
  summarizeListData,
} from './mapper';
import {
  DEFAULT_LX_SYNC_CONFIG,
  LX_SYNC_CONFIG_KEY,
  type LxListData,
  type LxMappedPlaylist,
  type LxSyncConfig,
  type LxSyncConfigPatch,
  type LxSyncConfigPublic,
  type LxSyncConflict,
  type LxSyncImportStats,
  type LxSyncPreviewResult,
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
  const record = value as Partial<LxSyncConfig> & Record<string, unknown>;
  const conflict: LxSyncConflict = record.conflict === 'merge' ? 'merge' : 'replace';
  return {
    importDefaultList: record.importDefaultList !== false,
    conflict,
    ...(typeof record.lastImportAt === 'string' && record.lastImportAt ? { lastImportAt: record.lastImportAt } : {}),
    ...(typeof record.lastExportAt === 'string' && record.lastExportAt ? { lastExportAt: record.lastExportAt } : {}),
  };
}

function publicConfig(config: LxSyncConfig): LxSyncConfigPublic {
  return {
    importDefaultList: config.importDefaultList,
    conflict: config.conflict,
    ...(config.lastImportAt ? { lastImportAt: config.lastImportAt } : {}),
    ...(config.lastExportAt ? { lastExportAt: config.lastExportAt } : {}),
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

  constructor(options: {
    playlistStore?: CustomPlaylistStore;
    customPlaylists?: Pick<CustomPlaylistService, 'syncToSongloftPlaylist'>;
  } = {}) {
    this.store = options.playlistStore || new CustomPlaylistStore();
    this.customPlaylists = options.customPlaylists;
  }

  async getConfig(): Promise<LxSyncConfigPublic> {
    return publicConfig(await this.loadConfig());
  }

  async updateConfig(patch: LxSyncConfigPatch): Promise<LxSyncConfigPublic> {
    const current = await this.loadConfig();
    const next: LxSyncConfig = {
      ...current,
      ...(patch.importDefaultList !== undefined ? { importDefaultList: Boolean(patch.importDefaultList) } : {}),
      ...(patch.conflict !== undefined
        ? { conflict: patch.conflict === 'merge' ? 'merge' : 'replace' }
        : {}),
    };
    await this.saveConfig(next);
    songloft.log.info(`[LxSync] config updated conflict=${next.conflict} importDefault=${next.importDefaultList}`);
    return publicConfig(next);
  }

  /**
   * Parse and preview LX list JSON without writing playlists.
   */
  async preview(rawPayload: unknown, options: { importDefaultList?: boolean } = {}): Promise<LxSyncPreviewResult> {
    const config = await this.loadConfig();
    const importDefaultList = options.importDefaultList ?? config.importDefaultList;
    const listData = this.parsePayload(rawPayload);
    const playlists = summarizeListData(listData, { importDefaultList });
    return {
      playlists,
      totalSongs: playlists.reduce((sum, item) => sum + item.songCount, 0),
    };
  }

  /**
   * Import LX list JSON into Starlight custom playlists.
   */
  async importList(
    rawPayload: unknown,
    options: { importDefaultList?: boolean; conflict?: LxSyncConflict } = {},
  ): Promise<LxSyncImportStats> {
    const config = await this.loadConfig();
    const importDefaultList = options.importDefaultList ?? config.importDefaultList;
    const conflict: LxSyncConflict = options.conflict === 'merge' || options.conflict === 'replace'
      ? options.conflict
      : config.conflict;

    const listData = this.parsePayload(rawPayload);
    const mapped = mapListDataToPlaylists(listData, { importDefaultList });
    const stats = await this.importMapped(mapped, conflict);
    const lastImportAt = nowIso();
    await this.saveConfig({ ...config, importDefaultList, conflict, lastImportAt });

    songloft.log.info(
      `[LxSync] import done playlists=${stats.playlistsCreated + stats.playlistsUpdated} songs=${stats.songsImported}`,
    );

    return {
      ...stats,
      lastImportAt,
    };
  }

  /**
   * Export custom playlists as LX Music ListData JSON.
   */
  async exportList(playlistIds?: string[]): Promise<{ listData: LxListData; lastExportAt: string }> {
    const config = await this.loadConfig();
    const playlists = await this.store.loadAll();
    const listData = mapPlaylistsToListData(playlists, { playlistIds });
    const lastExportAt = nowIso();
    await this.saveConfig({ ...config, lastExportAt });
    songloft.log.info(
      `[LxSync] export done love=${listData.loveList.length} default=${listData.defaultList.length} user=${listData.userList.length}`,
    );
    return { listData, lastExportAt };
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

  private parsePayload(rawPayload: unknown): LxListData {
    try {
      return parseLxListPayload(rawPayload);
    } catch (error) {
      throw new StarlightError(
        'BAD_REQUEST',
        error instanceof Error ? error.message : '无法解析洛雪歌单 JSON',
        false,
      );
    }
  }

  private async importMapped(
    mapped: LxMappedPlaylist[],
    conflict: LxSyncConflict,
  ): Promise<Omit<LxSyncImportStats, 'lastImportAt'>> {
    const playlists = await this.store.loadAll();
    let playlistsCreated = 0;
    let playlistsUpdated = 0;
    let songsImported = 0;
    const touched: LxSyncImportStats['playlists'] = [];

    for (const draft of mapped) {
      // LX identity lives in sourceListId only — never Songloft native_playlist_id.
      const existingIndex = playlists.findIndex(
        (playlist) =>
          String(playlist.sourceListId || '') === draft.lxListId ||
          (draft.kind === 'love' && playlist.name.trim() === '我喜欢' && (
            String(playlist.sourceListId || '').startsWith('lx:') ||
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
        sourceListId: draft.lxListId,
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

  private async loadConfig(): Promise<LxSyncConfig> {
    const raw = await songloft.storage.get(LX_SYNC_CONFIG_KEY);
    return asConfig(safeParse(raw));
  }

  private async saveConfig(config: LxSyncConfig): Promise<void> {
    const payload: LxSyncConfig = {
      importDefaultList: config.importDefaultList,
      conflict: config.conflict,
    };
    if (config.lastImportAt) payload.lastImportAt = config.lastImportAt;
    if (config.lastExportAt) payload.lastExportAt = config.lastExportAt;
    // Drop any legacy server fields if present in old storage.
    await songloft.storage.set(LX_SYNC_CONFIG_KEY, JSON.stringify(payload));
  }
}
