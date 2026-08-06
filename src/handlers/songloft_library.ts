import type { Router } from '@songloft/plugin-sdk';
import { runApi } from '../system/response';
import { StarlightError, toStarlightError } from '../system/errors';
import type { PlaylistManagerMap, PlayerSong } from '../player/manager';
import { isPlayMode } from '../player/modes';
import type { PlayMode } from '../types';
import { parseJsonBody, type JsonBodyRequest } from '../system/body';
import { generateId } from '../utils/crypto';
import type { PlaylistImportSong } from '../songloft/playlist_service';

interface NormalizedList {
  list: unknown[];
  total: number;
}

export interface SongloftImportJobProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
}

export type SongloftImportProgressReporter = (progress: SongloftImportJobProgress) => void;

interface SongloftLibraryHandlerOptions {
  playlistManagerMap?: PlaylistManagerMap;
  playlistService?: SongloftPlaylistHandlerService;
}

interface SongloftPlaylistHandlerService {
  createPlaylist(name: string): Promise<unknown>;
  importSongsToPlaylist(
    input: ImportSongsToPlaylistBody,
    options?: { onProgress?: SongloftImportProgressReporter },
  ): Promise<unknown>;
  importSourceSonglist(
    input: ImportSourceSonglistBody,
    options?: { onProgress?: SongloftImportProgressReporter },
  ): Promise<unknown>;
}

type SongloftImportJobType = 'songs' | 'source-songlist';
type SongloftImportJobStatus = 'running' | 'done' | 'failed';

interface SongloftImportJob {
  id: string;
  type: SongloftImportJobType;
  status: SongloftImportJobStatus;
  started_at: string;
  updated_at: string;
  progress?: SongloftImportJobProgress;
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
  conflict_action?: 'overwrite' | 'rename';
  rename_to?: string;
  songs: PlaylistImportSong[];
}

interface ImportSourceSonglistBody {
  source_id: string;
  id: string;
  quality?: string;
  playlist_name?: string;
  conflict_action?: 'overwrite' | 'rename';
  rename_to?: string;
}

const LIST_KEYS = ['list', 'items', 'songs', 'playlists'] as const;
const MAX_IMPORT_JOBS = 50;

class SongloftImportJobs {
  private readonly jobs = new Map<string, SongloftImportJob>();

  start(
    type: SongloftImportJobType,
    runner: (report: SongloftImportProgressReporter) => Promise<unknown>,
  ): SongloftImportJob {
    const now = new Date().toISOString();
    const job: SongloftImportJob = {
      id: importJobId(),
      type,
      status: 'running',
      started_at: now,
      updated_at: now,
      progress: {
        stage: 'queued',
        current: 0,
        total: 0,
        message: '任务已排队',
      },
    };
    this.jobs.set(job.id, job);
    this.prune();
    songloft.log.info(`[SongloftImportJobs] start type=${type} job=${job.id}`);

    const report: SongloftImportProgressReporter = (progress) => {
      if (job.status !== 'running') return;
      job.progress = {
        stage: String(progress.stage || 'running'),
        current: Math.max(0, Math.floor(Number(progress.current) || 0)),
        total: Math.max(0, Math.floor(Number(progress.total) || 0)),
        message: String(progress.message || '').slice(0, 240),
      };
      job.updated_at = new Date().toISOString();
    };

    try {
      const pending = Promise.resolve().then(() => runner(report));
      pending.then((result) => {
        job.status = 'done';
        job.result = result;
        job.updated_at = new Date().toISOString();
        const summary = summarizeImportResult(result);
        job.progress = {
          stage: 'done',
          current: Number((result as { added?: number })?.added || 0),
          total: Number((result as { source_total?: number; imported?: number })?.source_total
            || (result as { imported?: number })?.imported
            || 0),
          message: summary,
        };
        songloft.log.info(`[SongloftImportJobs] done type=${type} job=${job.id} ${summary}`);
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
    songloft.log.error(
      `[SongloftImportJobs] failed type=${job.type} job=${job.id} code=${starlightError.code}: ${starlightError.message}`,
    );
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
  return generateId('slimp');
}

function summarizeImportResult(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return 'result=empty';
  }
  const record = result as Record<string, unknown>;
  const playlist = record.playlist && typeof record.playlist === 'object'
    ? record.playlist as Record<string, unknown>
    : null;
  const name = typeof playlist?.name === 'string' ? playlist.name : '';
  const id = playlist?.id ?? '';
  const parts = [
    name ? `name="${name}"` : '',
    id !== '' && id !== undefined ? `playlist_id=${String(id)}` : '',
    typeof record.imported === 'number' ? `imported=${record.imported}` : '',
    typeof record.added === 'number' ? `added=${record.added}` : '',
    typeof record.skipped === 'number' ? `skipped=${record.skipped}` : '',
    typeof record.source_total === 'number' ? `source_total=${record.source_total}` : '',
    typeof record.conflict_resolution === 'string' ? `resolution=${record.conflict_resolution}` : '',
  ].filter(Boolean);
  return parts.join(' ') || 'ok';
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

function parseConflictAction(value: unknown): 'overwrite' | 'rename' | undefined {
  if (value === 'overwrite' || value === 'rename') return value;
  return undefined;
}

function parseImportSongsBody(req: JsonBodyRequest): ImportSongsToPlaylistBody {
  const body = parseJsonBody<Record<string, unknown>>(req);
  const playlistName = optionalStringValue(body.playlist_name);
  if (body.playlist_id === undefined && !playlistName) {
    throw new StarlightError('BAD_REQUEST', 'playlist_id or playlist_name is required');
  }
  const conflictAction = parseConflictAction(body.conflict_action);
  const renameTo = optionalStringValue(body.rename_to);
  return {
    ...(body.playlist_id !== undefined ? { playlist_id: body.playlist_id } : {}),
    ...(playlistName ? { playlist_name: playlistName } : {}),
    ...(conflictAction ? { conflict_action: conflictAction } : {}),
    ...(renameTo ? { rename_to: renameTo } : {}),
    songs: requireSearchSongs(body.songs),
  };
}

function parseImportSourceSonglistBody(req: JsonBodyRequest): ImportSourceSonglistBody {
  const body = parseJsonBody<Record<string, unknown>>(req);
  const conflictAction = parseConflictAction(body.conflict_action);
  const renameTo = optionalStringValue(body.rename_to);
  return {
    source_id: requireStringValue(body.source_id, 'source_id'),
    id: requireStringValue(body.id ?? body.sourceListId ?? body.source_list_id ?? body.link ?? body.url, 'id'),
    ...(optionalStringValue(body.quality) ? { quality: optionalStringValue(body.quality) } : {}),
    ...(optionalStringValue(body.playlist_name) ? { playlist_name: optionalStringValue(body.playlist_name) } : {}),
    ...(conflictAction ? { conflict_action: conflictAction } : {}),
    ...(renameTo ? { rename_to: renameTo } : {}),
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

  router.get('/api/songloft/songs', async () => runApi(async () => normalizeList(await songloft.songs.list())));

  router.get('/api/songloft/playlists', async () =>
    runApi(async () => normalizeList(await songloft.playlists.list())));

  router.post('/api/songloft/playlists', async (req) =>
    runApi(async () => {
      const body = parseJsonBody<Record<string, unknown>>(req);
      const service = requirePlaylistService(options);
      return service.createPlaylist(requireStringValue(body.name, 'name'));
    }, 201));

  router.post('/api/songloft/playlists/import-songs', async (req) =>
    runApi(async () => requirePlaylistService(options).importSongsToPlaylist(parseImportSongsBody(req))));

  router.post('/api/songloft/playlists/import-songs/jobs', async (req) =>
    runApi(() => {
      const service = requirePlaylistService(options);
      const input = parseImportSongsBody(req);
      return importJobs.start('songs', (report) => service.importSongsToPlaylist(input, { onProgress: report }));
    }, 202));

  router.post('/api/songloft/playlists/import-source-songlist', async (req) =>
    runApi(async () => requirePlaylistService(options).importSourceSonglist(parseImportSourceSonglistBody(req)), 201));

  router.post('/api/songloft/playlists/import-source-songlist/jobs', async (req) =>
    runApi(() => {
      const service = requirePlaylistService(options);
      const input = parseImportSourceSonglistBody(req);
      return importJobs.start('source-songlist', (report) =>
        service.importSourceSonglist(input, { onProgress: report }),
      );
    }, 202));

  router.get('/api/songloft/playlists/import-jobs/:id', async (_req, params) =>
    runApi(() => importJobs.get(params.id)));

  router.get('/api/songloft/playlists/:id/songs', async (_req, params) =>
    runApi(async () => normalizeList(await songloft.playlists.getSongs(requirePositiveInteger(params.id, 'playlist id')))));

  router.get('/api/songloft/local-songs', async () =>
    runApi(async () => {
      const songs = normalizeList(await songloft.songs.list()).list.filter(isLocalSong);
      return {
        list: songs,
        total: songs.length,
      };
    }));

  router.post('/api/songloft/player/song', async (req) =>
    runApi(async () => {
      if (!options.playlistManagerMap) {
        throw new StarlightError('INTERNAL_ERROR', 'playlist manager not available');
      }

      const body = parseJsonBody<Record<string, unknown>>(req);
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
