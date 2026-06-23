import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { apiError, apiOk } from '../system/response';
import { StarlightError } from '../system/errors';
import type { PlaylistManagerMap, PlayerSong } from '../player/manager';
import type { PlayMode } from '../types';

interface NormalizedList {
  list: unknown[];
  total: number;
}

interface SongloftLibraryHandlerOptions {
  playlistManagerMap?: PlaylistManagerMap;
}

const LIST_KEYS = ['list', 'items', 'songs', 'playlists'] as const;

async function handle(fn: () => unknown | Promise<unknown>): Promise<HTTPResponse> {
  try {
    return apiOk(await fn());
  } catch (error) {
    return apiError(error);
  }
}

function normalizeList(value: unknown): NormalizedList {
  if (Array.isArray(value)) {
    return { list: value, total: value.length };
  }

  if (!value || typeof value !== 'object') {
    return { list: [], total: 0 };
  }

  const record = value as Record<string, unknown>;
  const list = findList(record);
  return {
    list,
    total: readTotal(record, list.length),
  };
}

function findList(record: Record<string, unknown>): unknown[] {
  for (const key of LIST_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function readTotal(record: Record<string, unknown>, fallback: number): number {
  const value = record.total ?? record.count;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return fallback;
}

function requireId(value: unknown, name = 'id'): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }

  return id;
}

function parseBody(req: { body?: unknown }): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  try {
    return JSON.parse(String.fromCharCode.apply(null, Array.from(req.body as Uint8Array))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : 0;
}

function songField(song: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = song[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function songNumberField(song: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = numberValue(song[key]);
    if (value > 0) return value;
  }
  return 0;
}

function toPlayerSong(value: unknown): PlayerSong {
  if (!value || typeof value !== 'object') {
    throw new StarlightError('BAD_REQUEST', 'song is required');
  }

  const song = value as Record<string, unknown>;
  const id = songNumberField(song, 'id', 'song_id', 'songId');
  const url = songField(song, 'url', 'play_url', 'playUrl') || (id ? `/api/v1/songs/${id}/play` : '');
  if (!url) {
    throw new StarlightError('BAD_REQUEST', 'song url or id is required');
  }

  return {
    id,
    type: songField(song, 'type') || (isLocalSong(song) ? 'local' : 'remote'),
    title: songField(song, 'title', 'name', 'songName') || '未知歌曲',
    artist: songField(song, 'artist', 'singer', 'author', 'singerName') || '未知歌手',
    album: songField(song, 'album', 'albumName'),
    duration: songNumberField(song, 'duration'),
    file_path: songField(song, 'file_path', 'filePath'),
    url,
    cover_path: songField(song, 'cover_path', 'coverPath'),
    cover_url: songField(song, 'cover_url', 'coverUrl', 'picUrl', 'img'),
    lyric_url: songField(song, 'lyric_url', 'lyricUrl'),
    file_size: songNumberField(song, 'file_size', 'fileSize'),
    format: songField(song, 'format'),
    bit_rate: songNumberField(song, 'bit_rate', 'bitRate'),
    sample_rate: songNumberField(song, 'sample_rate', 'sampleRate'),
    is_live: Boolean(song.is_live || song.isLive),
    cache_hash: songField(song, 'cache_hash', 'cacheHash'),
  };
}

function isLocalSong(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const song = value as Record<string, unknown>;
  if (isTruthyLocalMarker(song.local)) {
    return true;
  }

  if (typeof song.type === 'string') {
    const type = song.type.trim().toLowerCase().replace(/[\s_-]+/g, '');
    return type === 'local' || type === 'localsong' || type === '本地';
  }

  return false;
}

function isTruthyLocalMarker(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }

  if (typeof value === 'string') {
    const marker = value.trim().toLowerCase();
    return marker === 'true' || marker === '1' || marker === 'yes' || marker === 'local';
  }

  return false;
}

export function registerSongloftLibraryHandlers(router: Router, options: SongloftLibraryHandlerOptions = {}): void {
  router.get('/api/songloft/songs', async () => handle(async () => normalizeList(await songloft.songs.list())));

  router.get('/api/songloft/playlists', async () =>
    handle(async () => normalizeList(await songloft.playlists.list())));

  router.get('/api/songloft/playlists/:id/songs', async (_req, params) =>
    handle(async () => normalizeList(await songloft.playlists.getSongs(requireId(params.id) as unknown as number))));

  router.get('/api/songloft/local-songs', async () =>
    handle(async () => {
      const songs = normalizeList(await songloft.songs.list()).list.filter(isLocalSong);
      return {
        list: songs,
        total: songs.length,
      };
    }));

  router.post('/api/songloft/player/song', async (req) =>
    handle(async () => {
      if (!options.playlistManagerMap) {
        throw new StarlightError('INTERNAL_ERROR', 'playlist manager not available');
      }

      const body = parseBody(req);
      const accountId = requireId(body.account_id, 'account_id');
      const deviceId = requireId(body.device_id, 'device_id');
      const playMode = (stringValue(body.play_mode) || 'single') as PlayMode;
      const song = toPlayerSong(body.song);
      const manager = await options.playlistManagerMap.getOrCreate(accountId, deviceId);
      const ok = await manager.playStandalone([song], 0, playMode);
      if (!ok) {
        throw new StarlightError('DEVICE_OFFLINE', '音箱播放 Songloft 歌曲失败', true);
      }

      return {
        message: 'song started',
        current_song: song,
      };
    }));
}
