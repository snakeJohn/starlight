/// <reference types="@songloft/plugin-sdk" />

import type { BridgeService, SongloftRemoteSong } from '../bridge/service';
import type { PlatformRegistry } from '../music/platforms/registry';
import type { MusicPlatform, MusicQuality, SearchResultSong } from '../music/types';
import type { MusicPlatformProvider } from '../music/platforms/types';
import { loadFullSonglist } from '../music/songlist_loader';
import { StarlightError } from '../system/errors';
import { requireHostBaseUrl } from '../utils/http';

type NativePlaylists = Record<string, unknown>;

/** How to resolve a Songloft playlist name that already exists. */
export type PlaylistNameConflictAction = 'overwrite' | 'rename';

export interface ImportProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
}

export type ImportProgressReporter = (progress: ImportProgress) => void;

export interface ImportSongsToPlaylistInput {
  playlist_id?: unknown;
  playlist_name?: string;
  /** Required when playlist_name matches an existing Songloft playlist. */
  conflict_action?: PlaylistNameConflictAction;
  /** Final name when conflict_action is rename (defaults to "name (2)", "name (3)", …). */
  rename_to?: string;
  songs: PlaylistImportSong[];
}

export interface ImportRunOptions {
  onProgress?: ImportProgressReporter;
}

export interface PortablePlaylistSong {
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  duration?: unknown;
  cover_url?: unknown;
  source_data?: unknown;
}

export type PlaylistImportSong = SearchResultSong | PortablePlaylistSong;

export interface ImportSourceSonglistInput {
  source_id: string;
  id: string;
  quality?: string;
  playlist_name?: string;
  conflict_action?: PlaylistNameConflictAction;
  rename_to?: string;
}

export interface SongloftPlaylistRef {
  id: string | number;
  name?: string;
  [key: string]: unknown;
}

export interface SongloftPlaylistAddResult {
  playlist_id: number;
  song_ids: number[];
  added: number;
  result: unknown;
}

export interface SongloftPlaylistImportResult {
  playlist: SongloftPlaylistRef;
  imported: number;
  added: number;
  skipped: number;
  errors: Array<{ title: string; message: string }>;
  /** How the target playlist was chosen. */
  conflict_resolution?: 'created' | 'overwrite' | 'rename' | 'existing_id';
}

export interface SourceSonglistImportResult extends SongloftPlaylistImportResult {
  source_total: number;
}

interface BestEffortImportResult {
  total: number;
  skipped: number;
  payloads: unknown[];
  songs: SongloftRemoteSong[];
  errors: Array<{ title: string; message: string }>;
}

/** Resolve/import batch size — keeps host calls bounded and allows progress heartbeats. */
const IMPORT_BATCH_SIZE = 30;
/** Host playlist add-songs batch size. */
const PLAYLIST_ADD_BATCH_SIZE = 80;

export class SongloftPlaylistService {
  constructor(
    private readonly bridge: Pick<BridgeService, 'importSongsBestEffort' | 'resolveSearchSong'>,
    private readonly platforms: PlatformRegistry,
    private readonly nativePlaylists: NativePlaylists = songloft.playlists as unknown as NativePlaylists,
  ) {}

  async createPlaylist(name: string): Promise<SongloftPlaylistRef> {
    const playlistName = requireNonEmptyString(name, 'name');
    const sdkCreate = this.nativePlaylists.create;
    if (typeof sdkCreate === 'function') {
      try {
        return normalizePlaylistRef(await sdkCreate.call(this.nativePlaylists, { name: playlistName }));
      } catch (error) {
        songloft.log.warn(`[SongloftPlaylistService] SDK playlist create failed, falling back to host API: ${errorMessage(error)}`);
      }
    }

    return normalizePlaylistRef(await this.hostRequest('POST', '/api/v1/playlists', { name: playlistName }));
  }

  /** List Songloft playlists via SDK when available, else host REST. */
  async listPlaylists(): Promise<SongloftPlaylistRef[]> {
    const sdkList = this.nativePlaylists.list;
    if (typeof sdkList === 'function') {
      try {
        const raw = await sdkList.call(this.nativePlaylists);
        return normalizePlaylistList(raw);
      } catch (error) {
        songloft.log.warn(
          `[SongloftPlaylistService] SDK playlist list failed, falling back to host API: ${errorMessage(error)}`,
        );
      }
    }
    try {
      return normalizePlaylistList(await this.hostRequest('GET', '/api/v1/playlists'));
    } catch (error) {
      songloft.log.warn(`[SongloftPlaylistService] Host playlist list failed: ${errorMessage(error)}`);
      return [];
    }
  }

  async findPlaylistByName(name: string): Promise<SongloftPlaylistRef | null> {
    const normalized = normalizePlaylistName(name);
    if (!normalized) return null;
    const items = await this.listPlaylists();
    for (const item of items) {
      if (normalizePlaylistName(item.name || '') === normalized) {
        return item;
      }
    }
    return null;
  }

  async addSongIds(playlistId: unknown, songIds: unknown[]): Promise<SongloftPlaylistAddResult> {
    const id = requirePositiveInteger(playlistId, 'playlist_id');
    const ids = normalizeSongIds(songIds);
    if (ids.length === 0) {
      return { playlist_id: id, song_ids: [], added: 0, result: null };
    }

    // Chunk large id lists — host may reject or time out on huge single requests.
    let added = 0;
    let lastResult: unknown = null;
    for (let offset = 0; offset < ids.length; offset += PLAYLIST_ADD_BATCH_SIZE) {
      const chunk = ids.slice(offset, offset + PLAYLIST_ADD_BATCH_SIZE);
      lastResult = await this.hostRequest('POST', `/api/v1/playlists/${id}/songs`, { song_ids: chunk });
      added += addedCountFromResult(lastResult, chunk.length);
    }
    return {
      playlist_id: id,
      song_ids: ids,
      added,
      result: lastResult,
    };
  }

  async importSongsToPlaylist(
    input: ImportSongsToPlaylistInput,
    options: ImportRunOptions = {},
  ): Promise<SongloftPlaylistImportResult> {
    const report = options.onProgress;
    const rawSongs = requireImportSongs(input.songs);
    report?.({
      stage: 'resolve',
      current: 0,
      total: rawSongs.length,
      message: `准备解析 ${rawSongs.length} 首歌曲…`,
    });

    const resolved = await this.resolveImportSongs(rawSongs, {
      onProgress: (current, total) => {
        report?.({
          stage: 'resolve',
          current,
          total,
          message: `解析音源 ${current}/${total}`,
        });
      },
    });

    report?.({
      stage: 'playlist',
      current: 0,
      total: resolved.songs.length,
      message: '准备 Songloft 目标歌单…',
    });
    const target = await this.resolveImportTargetPlaylist(input);
    const playlistId = requirePositiveInteger(target.playlist.id, 'playlist_id');

    if (target.resolution === 'overwrite') {
      report?.({
        stage: 'playlist',
        current: 0,
        total: resolved.songs.length,
        message: '覆盖同名歌单…',
      });
      await this.replacePlaylistSongsBestEffort(playlistId);
    }

    const imported = await this.importSongsBestEffortBatched(resolved.songs, report);
    const songIds = remoteSongIds(imported.songs);
    const missingIdCount = Math.max(0, imported.total - songIds.length);
    const missingIdErrors = missingIdCount > 0
      ? [{ title: 'Songloft 歌曲库', message: `${missingIdCount} 首歌曲导入成功但未返回 Songloft song id，无法加入歌单` }]
      : [];

    report?.({
      stage: 'link',
      current: 0,
      total: songIds.length,
      message: `写入歌单 ${songIds.length} 首…`,
    });
    const addResult = await this.addSongIds(playlistId, songIds);
    report?.({
      stage: 'done',
      current: addResult.added,
      total: rawSongs.length,
      message: `完成：加入 ${addResult.added} 首`,
    });

    const errors = [...resolved.errors, ...imported.errors, ...missingIdErrors];
    const skipped = resolved.errors.length + imported.skipped + missingIdCount;
    if (skipped > 0) {
      const sample = errors.slice(0, 8)
        .map((item) => `${item.title || '?'}: ${item.message}`)
        .join(' | ');
      songloft.log.warn(
        `[SongloftPlaylistService] skipped ${skipped}/${rawSongs.length} `
        + `(resolve=${resolved.errors.length}, import=${imported.skipped}, no_id=${missingIdCount}) `
        + `sample: ${sample}`,
      );
    }

    return {
      playlist: target.playlist,
      imported: imported.total,
      added: addResult.added,
      skipped,
      errors,
      conflict_resolution: target.resolution,
    };
  }

  /**
   * Import songs in batches so large playlists keep heartbeating and avoid one giant host call.
   */
  private async importSongsBestEffortBatched(
    songs: SearchResultSong[],
    report?: ImportProgressReporter,
  ): Promise<BestEffortImportResult> {
    if (songs.length === 0) {
      return { total: 0, skipped: 0, payloads: [], songs: [], errors: [] };
    }

    const allSongs: SongloftRemoteSong[] = [];
    const allPayloads: unknown[] = [];
    const errors: Array<{ title: string; message: string }> = [];
    let total = 0;
    let skipped = 0;

    for (let offset = 0; offset < songs.length; offset += IMPORT_BATCH_SIZE) {
      const batch = songs.slice(offset, offset + IMPORT_BATCH_SIZE);
      const done = Math.min(offset + batch.length, songs.length);
      report?.({
        stage: 'import',
        current: offset,
        total: songs.length,
        message: `处理歌曲 ${offset + 1}-${done}/${songs.length}（曲库已有则复用并加入歌单）`,
      });
      songloft.log.info(
        `[SongloftPlaylistService] import batch ${offset + 1}-${done}/${songs.length}`,
      );

      const batchResult = await this.bridge.importSongsBestEffort(batch) as BestEffortImportResult;
      total += batchResult.total;
      skipped += batchResult.skipped;
      allPayloads.push(...(batchResult.payloads || []));
      allSongs.push(...(batchResult.songs || []));
      errors.push(...(batchResult.errors || []));

      report?.({
        stage: 'import',
        current: done,
        total: songs.length,
        message: `已就绪 ${allSongs.length} 首可加入歌单（处理 ${done}/${songs.length}）`,
      });
    }

    return {
      total,
      skipped,
      payloads: allPayloads,
      songs: allSongs,
      errors,
    };
  }

  /**
   * Resolve create / overwrite / rename for a named import target.
   * Throws PLAYLIST_NAME_CONFLICT when the name exists and no action is provided.
   */
  private async resolveImportTargetPlaylist(input: ImportSongsToPlaylistInput): Promise<{
    playlist: SongloftPlaylistRef;
    resolution: NonNullable<SongloftPlaylistImportResult['conflict_resolution']>;
  }> {
    if (!input.playlist_name) {
      return {
        playlist: { id: requirePositiveInteger(input.playlist_id, 'playlist_id') },
        resolution: 'existing_id',
      };
    }

    const desiredName = requireNonEmptyString(input.playlist_name, 'playlist_name');
    const existing = await this.findPlaylistByName(desiredName);
    if (!existing) {
      return {
        playlist: await this.createPlaylist(desiredName),
        resolution: 'created',
      };
    }

    const action = input.conflict_action;
    if (action === 'overwrite') {
      // Prefer recreating under the same name so the list fully replaces.
      const recreated = await this.recreatePlaylistBestEffort(existing, desiredName);
      return { playlist: recreated, resolution: 'overwrite' };
    }
    if (action === 'rename') {
      const renameTo = (typeof input.rename_to === 'string' ? input.rename_to.trim() : '')
        || await this.allocateUniquePlaylistName(desiredName);
      return {
        playlist: await this.createPlaylist(renameTo),
        resolution: 'rename',
      };
    }

    throw new StarlightError(
      'PLAYLIST_NAME_CONFLICT',
      `Songloft 已存在同名歌单「${desiredName}」`,
      false,
      {
        existing_id: existing.id,
        existing_name: existing.name || desiredName,
        suggested_name: await this.allocateUniquePlaylistName(desiredName),
      },
    );
  }

  private async allocateUniquePlaylistName(baseName: string): Promise<string> {
    const items = await this.listPlaylists();
    const used = new Set(
      items.map((item) => normalizePlaylistName(item.name || '')).filter(Boolean),
    );
    const base = baseName.trim() || '导入歌单';
    if (!used.has(normalizePlaylistName(base))) return base;
    for (let n = 2; n < 1000; n += 1) {
      const candidate = `${base} (${n})`;
      if (!used.has(normalizePlaylistName(candidate))) return candidate;
    }
    return `${base} (${Date.now()})`;
  }

  /**
   * Overwrite strategy: delete the existing playlist and create a new one with the same name.
   * Falls back to reusing the existing id (caller will clear/replace songs best-effort).
   */
  private async recreatePlaylistBestEffort(
    existing: SongloftPlaylistRef,
    name: string,
  ): Promise<SongloftPlaylistRef> {
    const id = requirePositiveInteger(existing.id, 'playlist_id');
    try {
      await this.hostRequest('DELETE', `/api/v1/playlists/${id}`);
    } catch (error) {
      songloft.log.warn(
        `[SongloftPlaylistService] Delete playlist ${id} failed, will clear/replace songs: ${errorMessage(error)}`,
      );
      return { ...existing, name: existing.name || name };
    }
    return this.createPlaylist(name);
  }

  /** Best-effort empty a playlist before re-adding songs (when delete-recreate was not used). */
  private async replacePlaylistSongsBestEffort(playlistId: number): Promise<void> {
    const setSongs = this.nativePlaylists.setSongs;
    if (typeof setSongs === 'function') {
      try {
        await setSongs.call(this.nativePlaylists, playlistId, []);
        return;
      } catch (error) {
        songloft.log.warn(
          `[SongloftPlaylistService] setSongs([]) failed for ${playlistId}: ${errorMessage(error)}`,
        );
      }
    }
    try {
      await this.hostRequest('PUT', `/api/v1/playlists/${playlistId}/songs`, { song_ids: [] });
      return;
    } catch {
      // Host may not support replace.
    }
    try {
      await this.hostRequest('DELETE', `/api/v1/playlists/${playlistId}/songs`, { song_ids: [] });
    } catch (error) {
      songloft.log.warn(
        `[SongloftPlaylistService] Could not clear playlist ${playlistId} before overwrite: ${errorMessage(error)}`,
      );
    }
  }

  private async resolveImportSongs(
    songs: PlaylistImportSong[],
    options: { onProgress?: (current: number, total: number) => void } = {},
  ): Promise<{
    songs: SearchResultSong[];
    errors: Array<{ title: string; message: string }>;
  }> {
    const resolvedSongs: SearchResultSong[] = [];
    const errors: Array<{ title: string; message: string }> = [];
    const total = songs.length;
    for (let index = 0; index < songs.length; index += 1) {
      const song = songs[index];
      if (index === 0 || (index + 1) % 10 === 0 || index + 1 === total) {
        options.onProgress?.(index + 1, total);
      }
      if (hasSourceData(song)) {
        resolvedSongs.push(song);
        continue;
      }
      const title = stringValue((song as PortablePlaylistSong).title);
      const artist = stringValue((song as PortablePlaylistSong).artist);
      if (!title) {
        errors.push({ title: '未知歌曲', message: 'song.title is required' });
        continue;
      }
      // 单曲解析异常（网络/音源故障）只记账，不能中断整份歌单导入。
      let resolved: SearchResultSong | null = null;
      try {
        resolved = await this.bridge.resolveSearchSong(title, artist);
      } catch (error) {
        errors.push({ title, message: errorMessage(error) });
        continue;
      }
      if (resolved) {
        resolvedSongs.push(resolved);
      } else {
        errors.push({ title, message: `未找到可用音源：${title}${artist ? ` - ${artist}` : ''}` });
      }
    }
    return { songs: resolvedSongs, errors };
  }

  async importSourceSonglist(
    input: ImportSourceSonglistInput,
    options: ImportRunOptions = {},
  ): Promise<SourceSonglistImportResult> {
    const source = requireNonEmptyString(input.source_id, 'source_id') as MusicPlatform;
    const sourceListId = requireNonEmptyString(input.id, 'id');
    const provider = this.platforms.get(source);
    if (!provider) {
      throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
    }

    const report = options.onProgress;
    songloft.log.info(
      `[SongloftPlaylistService] importSourceSonglist source=${source} id=${sourceListId} action=${input.conflict_action || 'create'}`,
    );
    report?.({
      stage: 'load',
      current: 0,
      total: 0,
      message: `拉取平台歌单 ${source}/${sourceListId}…`,
    });
    const detail = await loadSonglist(provider, sourceListId);
    const quality = normalizeQuality(input.quality);
    const songs = quality ? detail.songs.map((song) => applyQuality(song, quality)) : detail.songs;
    const playlistName = input.playlist_name || detail.name || sourceListId;
    songloft.log.info(
      `[SongloftPlaylistService] loaded songlist name="${playlistName}" songs=${songs.length} total=${detail.total}`,
    );
    report?.({
      stage: 'load',
      current: songs.length,
      total: detail.total || songs.length,
      message: `已拉取「${playlistName}」${songs.length} 首，开始导入…`,
    });
    const result = await this.importSongsToPlaylist({
      playlist_name: playlistName,
      songs,
      ...(input.conflict_action ? { conflict_action: input.conflict_action } : {}),
      ...(input.rename_to ? { rename_to: input.rename_to } : {}),
    }, options);
    songloft.log.info(
      `[SongloftPlaylistService] import finished name="${result.playlist?.name || playlistName}" added=${result.added} skipped=${result.skipped} resolution=${result.conflict_resolution || ''}`,
    );

    return {
      ...result,
      source_total: detail.total,
    };
  }

  private async hostRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const host = await requireHostBaseUrl();
    const token = await songloft.plugin.getToken();
    const response = await fetch(`${host}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await safeResponseText(response);
    if (!response.ok) {
      throw new StarlightError('INTERNAL_ERROR', `Songloft playlist API failed: ${response.status}${text ? ` ${text}` : ''}`, true, {
        upstream: 'songloft_playlist',
        status: response.status,
        path,
      });
    }
    return parseJsonOrText(text);
  }
}

function requireNonEmptyString(value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }
  return text;
}

function normalizePlaylistName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePlaylistList(value: unknown): SongloftPlaylistRef[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Array.isArray((value as { list?: unknown }).list)
        ? (value as { list: unknown[] }).list
        : Array.isArray((value as { items?: unknown }).items)
          ? (value as { items: unknown[] }).items
          : Array.isArray((value as { playlists?: unknown }).playlists)
            ? (value as { playlists: unknown[] }).playlists
            : []
      : [];
  const result: SongloftPlaylistRef[] = [];
  for (const item of items) {
    try {
      result.push(normalizePlaylistRef(item));
    } catch {
      // skip malformed entries
    }
  }
  return result;
}

function requirePositiveInteger(value: unknown, name: string): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric <= 0) {
    throw new StarlightError('BAD_REQUEST', `invalid ${name}`);
  }
  return numeric;
}

function requireImportSongs(value: unknown): PlaylistImportSong[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'songs must be an array');
  }
  return value as PlaylistImportSong[];
}

function hasSourceData(song: PlaylistImportSong): song is SearchResultSong {
  const sourceData = (song as SearchResultSong)?.source_data;
  return Boolean(sourceData?.platform && sourceData?.quality && sourceData?.songInfo);
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function normalizeSongIds(values: unknown[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const id = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof id === 'number' && Number.isInteger(id) && id > 0 && !seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }
  return ids;
}

function normalizePlaylistRef(value: unknown): SongloftPlaylistRef {
  const playlist = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = playlist.id ?? playlist.playlist_id;
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new StarlightError('INTERNAL_ERROR', 'Songloft playlist response did not include id', true);
  }
  return {
    ...playlist,
    id,
    ...(typeof playlist.name === 'string' ? { name: playlist.name } : {}),
  };
}

function remoteSongIds(songs: SongloftRemoteSong[]): number[] {
  return normalizeSongIds(songs.map((song) => song.id));
}

function addedCountFromResult(result: unknown, fallback: number): number {
  if (!result || typeof result !== 'object') {
    return fallback;
  }
  const record = result as Record<string, unknown>;
  for (const key of ['added', 'added_count', 'count']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return fallback;
}

async function loadSonglist(provider: MusicPlatformProvider, id: string): Promise<{ name: string; total: number; songs: SearchResultSong[] }> {
  const detail = await loadFullSonglist(provider, id);
  return {
    name: detail.name,
    total: detail.total,
    songs: detail.songs,
  };
}

function normalizeQuality(value: unknown): MusicQuality | null {
  if (value === '128k' || value === '320k' || value === 'flac' || value === 'flac24bit') {
    return value;
  }
  return null;
}

function applyQuality(song: SearchResultSong, quality: MusicQuality): SearchResultSong {
  return {
    ...song,
    source_data: {
      ...song.source_data,
      quality,
    },
  };
}

async function safeResponseText(response: Response): Promise<string> {
  if (typeof response.text !== 'function') {
    return '';
  }
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseJsonOrText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
