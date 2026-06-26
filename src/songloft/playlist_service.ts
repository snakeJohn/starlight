/// <reference types="@songloft/plugin-sdk" />

import type { BridgeService, SongloftRemoteSong } from '../bridge/service';
import type { PlatformRegistry } from '../music/platforms/registry';
import type { MusicPlatform, MusicQuality, SearchResultSong } from '../music/types';
import type { MusicPlatformProvider } from '../music/platforms/types';
import { StarlightError } from '../system/errors';
import { normalizeHostBaseUrl } from '../utils/http';

const IMPORT_PAGE_SIZE = 100;
const MAX_IMPORT_PAGES = 100;

type NativePlaylists = Record<string, unknown>;

export interface ImportSongsToPlaylistInput {
  playlist_id?: unknown;
  playlist_name?: string;
  songs: PlaylistImportSong[];
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

  async addSongIds(playlistId: unknown, songIds: unknown[]): Promise<SongloftPlaylistAddResult> {
    const id = requirePositiveInteger(playlistId, 'playlist_id');
    const ids = normalizeSongIds(songIds);
    if (ids.length === 0) {
      return { playlist_id: id, song_ids: [], added: 0, result: null };
    }

    const result = await this.hostRequest('POST', `/api/v1/playlists/${id}/songs`, { song_ids: ids });
    return {
      playlist_id: id,
      song_ids: ids,
      added: addedCountFromResult(result, ids.length),
      result,
    };
  }

  async importSongsToPlaylist(input: ImportSongsToPlaylistInput): Promise<SongloftPlaylistImportResult> {
    const resolved = await this.resolveImportSongs(requireImportSongs(input.songs));
    const playlist = input.playlist_name
      ? await this.createPlaylist(input.playlist_name)
      : { id: requirePositiveInteger(input.playlist_id, 'playlist_id') };
    const playlistId = requirePositiveInteger(playlist.id, 'playlist_id');
    const imported = await this.bridge.importSongsBestEffort(resolved.songs) as BestEffortImportResult;
    const songIds = remoteSongIds(imported.songs);
    const missingIdCount = Math.max(0, imported.total - songIds.length);
    const missingIdErrors = missingIdCount > 0
      ? [{ title: 'Songloft 歌曲库', message: `${missingIdCount} 首歌曲导入成功但未返回 Songloft song id，无法加入歌单` }]
      : [];
    const addResult = await this.addSongIds(playlistId, songIds);

    return {
      playlist,
      imported: imported.total,
      added: addResult.added,
      skipped: resolved.errors.length + imported.skipped + missingIdCount,
      errors: [...resolved.errors, ...imported.errors, ...missingIdErrors],
    };
  }

  private async resolveImportSongs(songs: PlaylistImportSong[]): Promise<{
    songs: SearchResultSong[];
    errors: Array<{ title: string; message: string }>;
  }> {
    const resolvedSongs: SearchResultSong[] = [];
    const errors: Array<{ title: string; message: string }> = [];
    for (const song of songs) {
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
      const resolved = await this.bridge.resolveSearchSong(title, artist);
      if (resolved) {
        resolvedSongs.push(resolved);
      } else {
        errors.push({ title, message: `未找到可用音源：${title}${artist ? ` - ${artist}` : ''}` });
      }
    }
    return { songs: resolvedSongs, errors };
  }

  async importSourceSonglist(input: ImportSourceSonglistInput): Promise<SourceSonglistImportResult> {
    const source = requireNonEmptyString(input.source_id, 'source_id') as MusicPlatform;
    const sourceListId = requireNonEmptyString(input.id, 'id');
    const provider = this.platforms.get(source);
    if (!provider) {
      throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
    }

    const detail = await loadSonglist(provider, sourceListId);
    const quality = normalizeQuality(input.quality);
    const songs = quality ? detail.songs.map((song) => applyQuality(song, quality)) : detail.songs;
    const result = await this.importSongsToPlaylist({
      playlist_name: input.playlist_name || detail.name || sourceListId,
      songs,
    });

    return {
      ...result,
      source_total: detail.total,
    };
  }

  private async hostRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const host = normalizeHostBaseUrl(await songloft.plugin.getHostUrl());
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
  const first = await provider.songListDetail(id, 1, IMPORT_PAGE_SIZE);
  const songs = Array.isArray(first.songs) ? [...first.songs] : [];
  const total = positiveTotal(first.total);
  let page = 2;

  while (
    page <= MAX_IMPORT_PAGES
    && (
      (total > 0 && songs.length < total)
      || (total === 0 && songs.length > 0 && songs.length % IMPORT_PAGE_SIZE === 0)
    )
  ) {
    const detail = await provider.songListDetail(id, page, IMPORT_PAGE_SIZE);
    const pageSongs = Array.isArray(detail.songs) ? detail.songs : [];
    if (pageSongs.length === 0) {
      break;
    }
    songs.push(...pageSongs);
    if (pageSongs.length < IMPORT_PAGE_SIZE) {
      break;
    }
    page += 1;
  }

  return {
    name: first.name || id,
    total: total || songs.length,
    songs: total > 0 ? songs.slice(0, total) : songs,
  };
}

function positiveTotal(value: unknown): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
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
