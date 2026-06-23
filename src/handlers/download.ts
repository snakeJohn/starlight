import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { DownloadService, type DownloadSettingsPatch } from '../download/service';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SourceManager } from '../music/source_manager';
import type { SearchResultSong } from '../music/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';

interface SourceImportBody {
  filename?: unknown;
  content?: unknown;
}

interface SourceToggleBody {
  id?: unknown;
  enabled?: unknown;
}

interface SongBody {
  song?: unknown;
}

interface SongsBody {
  songs?: unknown;
}

function handle(fn: () => unknown | Promise<unknown>, statusCode = 200): Promise<HTTPResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => apiOk(data, statusCode))
    .catch((error) => apiError(error, statusFor(error)));
}

function statusFor(error: unknown): number {
  if (!(error instanceof StarlightError)) {
    return 500;
  }
  if (error.code === 'BAD_REQUEST') {
    return 400;
  }
  if (error.code === 'PLAY_URL_RESOLVE_FAILED') {
    return 404;
  }
  if (error.code === 'INTERNAL_ERROR' && error.details.upstream === 'songloft_remote_import') {
    return 502;
  }
  return 500;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringishField(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function boolField(value: unknown): boolean {
  return value === true || value === 'true';
}

function requireId(value: unknown, name = 'id'): string {
  const id = stringField(value);
  if (!id) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }
  return id;
}

function requireSong(value: unknown): SearchResultSong {
  const song = objectField(value);
  if (!song) {
    throw new StarlightError('BAD_REQUEST', 'song is required');
  }

  const sourceData = objectField(song.source_data);
  if (!sourceData) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data is required');
  }

  const platform = stringField(sourceData.platform);
  const quality = stringField(sourceData.quality);
  const songInfo = objectField(sourceData.songInfo);
  if (!platform) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.platform is required');
  }
  if (!quality) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.quality is required');
  }
  if (!songInfo) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.songInfo is required');
  }

  const rawDuration = song.duration;
  const duration =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration)
      ? rawDuration
      : typeof rawDuration === 'string' && rawDuration.trim() !== '' && Number.isFinite(Number(rawDuration))
        ? Number(rawDuration)
        : 0;

  return {
    title: stringishField(song.title),
    artist: stringishField(song.artist),
    album: stringishField(song.album),
    duration,
    cover_url: stringishField(song.cover_url),
    source_data: {
      platform: platform as SearchResultSong['source_data']['platform'],
      quality: quality as SearchResultSong['source_data']['quality'],
      songInfo: songInfo as unknown as SearchResultSong['source_data']['songInfo'],
    },
  };
}

function requireSongs(value: unknown): SearchResultSong[] {
  if (!Array.isArray(value)) {
    throw new StarlightError('BAD_REQUEST', 'songs must be an array');
  }
  return value.map((entry) => requireSong(entry));
}

function settingsPatch(value: unknown): DownloadSettingsPatch {
  const body = objectField(value) || {};
  const patch: DownloadSettingsPatch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'path_template')) {
    patch.path_template = stringishField(body.path_template);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'embed_metadata')) {
    patch.embed_metadata = boolField(body.embed_metadata);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'download_interval')) {
    const interval = Number(body.download_interval);
    patch.download_interval = Number.isFinite(interval) ? interval : 0;
  }
  return patch;
}

function reloadRuntimesInBackground(runtimes: RuntimeManager): void {
  runtimes.loadEnabledSources().catch((error) => {
    songloft.log.warn('Failed to reload download source runtimes: ' + String(error));
  });
}

export function registerDownloadHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
  downloads: DownloadService,
): void {
  router.get('/api/download/sources', async () => handle(() => sources.listSources()));

  router.post('/api/download/sources/import', async (req) =>
    handle(() => {
      const body = parseJsonBody<SourceImportBody>(req);
      const filename = requireId(body.filename, 'filename');
      const content = typeof body.content === 'string' ? body.content : '';
      if (!content) {
        throw new StarlightError('BAD_REQUEST', 'content is required');
      }
      return sources.importFromJS(filename, content);
    }, 201));

  router.post('/api/download/sources/toggle', async (req) =>
    handle(async () => {
      const body = parseJsonBody<SourceToggleBody>(req);
      const id = requireId(body.id);
      const enabled = boolField(body.enabled);
      await sources.setEnabled(id, enabled);
      reloadRuntimesInBackground(runtimes);
      return sources.listSources().find((source) => source.id === id) || { id, enabled };
    }));

  router.delete('/api/download/sources/:id', async (_req, params) =>
    handle(async () => {
      const id = requireId(params.id);
      await sources.deleteSource(id);
      reloadRuntimesInBackground(runtimes);
      return { id };
    }));

  router.get('/api/download/settings', async () => handle(() => downloads.getSettings()));

  router.post('/api/download/settings', async (req) =>
    handle(() => downloads.saveSettings(settingsPatch(parseJsonBody(req)))));

  router.post('/api/download/song', async (req) =>
    handle(() => {
      const body = parseJsonBody<SongBody>(req);
      return downloads.startBatch([requireSong(body.song)]);
    }));

  router.post('/api/download/batch', async (req) =>
    handle(() => {
      const body = parseJsonBody<SongsBody>(req);
      return downloads.startBatch(requireSongs(body.songs));
    }));

  router.get('/api/download/batch/progress', async () => handle(() => downloads.getBatchProgress()));

  router.post('/api/download/batch/clear', async () => handle(() => downloads.clearBatch()));
}
