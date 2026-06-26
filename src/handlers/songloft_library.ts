import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { apiError, apiOk } from '../system/response';
import { StarlightError, toStarlightError } from '../system/errors';
import type { PlaylistManagerMap, PlayerSong } from '../player/manager';
import { isPlayMode } from '../player/modes';
import type { PlayMode } from '../types';
import { parseJsonBody, type JsonBodyRequest } from '../system/body';
import type { PlaylistImportSong } from '../songloft/playlist_service';

interface NormalizedList {
  list: unknown[];
  total: number;
}

interface SongloftLibraryHandlerOptions {
  playlistManagerMap?: PlaylistManagerMap;
  playlistService?: SongloftPlaylistHandlerService;
}

interface SongloftPlaylistHandlerService {
  createPlaylist(name: string): Promise<unknown>;
  importSongsToPlaylist(input: ImportSongsToPlaylistBody): Promise<unknown>;
  importSourceSonglist(input: ImportSourceSonglistBody): Promise<unknown>;
}

type SongloftImportJobType = 'songs' | 'source-songlist';
type SongloftImportJobStatus = 'running' | 'done' | 'failed';

interface SongloftImportJob {
  id: string;
  type: SongloftImportJobType;
  status: SongloftImportJobStatus;
  started_at: string;
  updated_at: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}

interface ImportSongsToPlaylistBody {
  playlist_id?: unknown;
  playlist_name?: string;
  songs: PlaylistImportSong[];
}

interface ImportSourceSonglistBody {
  source_id: string;
  id: string;
  quality?: string;
  playlist_name?: string;
}

const LIST_KEYS = ['list', 'items', 'songs', 'playlists'] as const;
const MAX_IMPORT_JOBS = 50;

class SongloftImportJobs {
  private readonly jobs = new Map<string, SongloftImportJob>();

  start(type: SongloftImportJobType, runner: () => Promise<unknown>): SongloftImportJob {
    const now = new Date().toISOString();
    const job: SongloftImportJob = {
      id: importJobId(),
      type,
      status: 'running',
      started_at: now,
      updated_at: now,
    };
    this.jobs.set(job.id, job);
    this.prune();

    try {
      const pending = runner();
      pending.then((result) => {
        job.status = 'done';
        job.result = result;
        job.updated_at = new Date().toISOString();
      }).catch((error) => {
        this.fail(job, error);
      });
    } catch (error) {
      this.fail(job, error);
    }

    return this.snapshot(job, true);
  }

  get(id: unknown): SongloftImportJob {
    const jobId = requireId(id, 'job id');
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new StarlightError('BAD_REQUEST', 'Songloft import job not found');
    }
    return this.snapshot(job);
  }

  private fail(job: SongloftImportJob, error: unknown): void {
    const starlightError = toStarlightError(error);
    job.status = 'failed';
    job.error = {
      code: starlightError.code,
      message: starlightError.message,
      retryable: starlightError.retryable,
      details: starlightError.details,
    };
    job.updated_at = new Date().toISOString();
    songloft.log.warn(`[SongloftImportJobs] ${job.type} job failed: ${starlightError.message}`);
  }

  private snapshot(job: SongloftImportJob, started = false): SongloftImportJob & { started?: true; job_id?: string } {
    return {
      ...job,
      ...(started ? { started: true as const, job_id: job.id } : {}),
      ...(job.error ? { error: { ...job.error, details: { ...job.error.details } } } : {}),
    };
  }

  private prune(): void {
    const overflow = this.jobs.size - MAX_IMPORT_JOBS;
    if (overflow <= 0) return;
    for (const [id, job] of this.jobs) {
      if (job.status === 'running') continue;
      this.jobs.delete(id);
      if (this.jobs.size <= MAX_IMPORT_JOBS) break;
    }
  }
}

function importJobId(): string {
  return `slimp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function handle(fn: () => unknown | Promise<unknown>, successStatus = 200): Promise<HTTPResponse> {
  try {
    return apiOk(await fn(), successStatus);
  } catch (error) {
    const statusCode = error instanceof StarlightError && error.code === 'BAD_REQUEST' ? 400 : 500;
    return apiError(error, statusCode);
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

function requirePositiveInteger(value: unknown, name = 'id'): number {
  const id = requireId(value, name);
  const parsed = Number(id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new StarlightError('BAD_REQUEST', `invalid ${name}`);
  }

  return parsed;
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

function requirePlaylistService(options: SongloftLibraryHandlerOptions): SongloftPlaylistHandlerService {
  if (!options.playlistService) {
    throw new StarlightError('INTERNAL_ERROR', 'Songloft playlist service not available');
  }
  return options.playlistService;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringishValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return '';
}

function requireStringValue(value: unknown, name: string): string {
  const text = stringishValue(value);
  if (!text) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }
  return text;
}

function optionalStringValue(value: unknown): string | undefined {
  const text = stringishValue(value);
  return text || undefined;
}

function requireSearchSongs(value: unknown): PlaylistImportSong[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'songs must be an array');
  }
  for (const song of value) {
    requireSearchSong(song);
  }
  return value as PlaylistImportSong[];
}

function requireSearchSong(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'song must be an object');
  }
  const song = value as Record<string, unknown>;
  if (!stringishValue(song.title)) {
    throw new StarlightError('BAD_REQUEST', 'song.title is required');
  }
  const sourceData = song.source_data;
  if (sourceData === undefined || sourceData === null) {
    return;
  }
  if (typeof sourceData !== 'object' || Array.isArray(sourceData)) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data must be an object');
  }
  const source = sourceData as Record<string, unknown>;
  requireStringValue(source.platform, 'song.source_data.platform');
  requireStringValue(source.quality, 'song.source_data.quality');
  if (!source.songInfo || typeof source.songInfo !== 'object' || Array.isArray(source.songInfo)) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.songInfo is required');
  }
}

function parseImportSongsBody(req: JsonBodyRequest): ImportSongsToPlaylistBody {
  const body = parseJsonBody<Record<string, unknown>>(req);
  const playlistName = optionalStringValue(body.playlist_name);
  if (body.playlist_id === undefined && !playlistName) {
    throw new StarlightError('BAD_REQUEST', 'playlist_id or playlist_name is required');
  }
  return {
    ...(body.playlist_id !== undefined ? { playlist_id: body.playlist_id } : {}),
    ...(playlistName ? { playlist_name: playlistName } : {}),
    songs: requireSearchSongs(body.songs),
  };
}

function parseImportSourceSonglistBody(req: JsonBodyRequest): ImportSourceSonglistBody {
  const body = parseJsonBody<Record<string, unknown>>(req);
  return {
    source_id: requireStringValue(body.source_id, 'source_id'),
    id: requireStringValue(body.id ?? body.sourceListId ?? body.source_list_id ?? body.link ?? body.url, 'id'),
    ...(optionalStringValue(body.quality) ? { quality: optionalStringValue(body.quality) } : {}),
    ...(optionalStringValue(body.playlist_name) ? { playlist_name: optionalStringValue(body.playlist_name) } : {}),
  };
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
  const importJobs = new SongloftImportJobs();

  router.get('/api/songloft/songs', async () => handle(async () => normalizeList(await songloft.songs.list())));

  router.get('/api/songloft/playlists', async () =>
    handle(async () => normalizeList(await songloft.playlists.list())));

  router.post('/api/songloft/playlists', async (req) =>
    handle(async () => {
      const body = parseJsonBody<Record<string, unknown>>(req);
      const service = requirePlaylistService(options);
      return service.createPlaylist(requireStringValue(body.name, 'name'));
    }, 201));

  router.post('/api/songloft/playlists/import-songs', async (req) =>
    handle(async () => requirePlaylistService(options).importSongsToPlaylist(parseImportSongsBody(req))));

  router.post('/api/songloft/playlists/import-songs/jobs', async (req) =>
    handle(() => {
      const service = requirePlaylistService(options);
      const input = parseImportSongsBody(req);
      return importJobs.start('songs', () => service.importSongsToPlaylist(input));
    }, 202));

  router.post('/api/songloft/playlists/import-source-songlist', async (req) =>
    handle(async () => requirePlaylistService(options).importSourceSonglist(parseImportSourceSonglistBody(req)), 201));

  router.post('/api/songloft/playlists/import-source-songlist/jobs', async (req) =>
    handle(() => {
      const service = requirePlaylistService(options);
      const input = parseImportSourceSonglistBody(req);
      return importJobs.start('source-songlist', () => service.importSourceSonglist(input));
    }, 202));

  router.get('/api/songloft/playlists/import-jobs/:id', async (_req, params) =>
    handle(() => importJobs.get(params.id)));

  router.get('/api/songloft/playlists/:id/songs', async (_req, params) =>
    handle(async () => normalizeList(await songloft.playlists.getSongs(requirePositiveInteger(params.id, 'playlist id')))));

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
      const requestedPlayMode = stringValue(body.play_mode);
      if (requestedPlayMode && !isPlayMode(requestedPlayMode)) {
        throw new StarlightError('BAD_REQUEST', 'invalid play_mode');
      }
      const playMode: PlayMode = requestedPlayMode ? requestedPlayMode as PlayMode : 'single';
      const song = toPlayerSong(body.song);
      const manager = await options.playlistManagerMap.getOrCreate(accountId, deviceId);
      const ok = await manager.playStandalone([song], 0, playMode, {
        autoAdvance: Boolean(requestedPlayMode),
      });
      if (!ok) {
        throw new StarlightError('DEVICE_OFFLINE', '音箱播放 Songloft 歌曲失败', true);
      }

      return {
        message: 'song started',
        current_song: song,
      };
    }));
}
