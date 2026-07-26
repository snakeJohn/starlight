import type { Router } from '@songloft/plugin-sdk';
import { DownloadService, type DownloadSettingsPatch } from '../download/service';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SourceManager } from '../music/source_manager';
import type { SearchResultSong } from '../music/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { boolField, objectField, stringField, stringishField } from '../system/fields';
import { runApi } from '../system/response';
import { registerSourceCrudRoutes } from './sources_crud';

interface SongBody {
  song?: unknown;
}

interface SongsBody {
  songs?: unknown;
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

export function registerDownloadHandlers(
  router: Router,
  sources: SourceManager,
  runtimes: RuntimeManager,
  downloads: DownloadService,
): void {
  registerSourceCrudRoutes(router, {
    prefix: '/api/download/sources',
    sources,
    runtimes,
    runtimeLabel: 'download',
  });

  router.get('/api/download/settings', async () => runApi(() => downloads.getSettings()));

  router.post('/api/download/settings', async (req) =>
    runApi(() => downloads.saveSettings(settingsPatch(parseJsonBody(req)))));

  router.post('/api/download/song', async (req) =>
    runApi(() => {
      const body = parseJsonBody<SongBody>(req);
      return downloads.startBatch([requireSong(body.song)]);
    }));

  router.post('/api/download/batch', async (req) =>
    runApi(() => {
      const body = parseJsonBody<SongsBody>(req);
      return downloads.startBatch(requireSongs(body.songs));
    }));

  router.get('/api/download/batch/progress', async () => runApi(() => downloads.getBatchProgress()));

  router.post('/api/download/batch/clear', async () => runApi(() => downloads.clearBatch()));
}
