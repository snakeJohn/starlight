import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { BridgeService } from '../bridge/service';
import type { SearchResultSong } from '../music/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';

interface SongBody {
  song?: unknown;
}

interface SongsBody {
  songs?: unknown;
}

interface PlayBody {
  account_id?: unknown;
  device_id?: unknown;
  song?: unknown;
}

interface ExternalSearchBody {
  keyword?: unknown;
}

interface ResolvedPlayBody {
  account_id?: unknown;
  device_id?: unknown;
  title?: unknown;
  artist?: unknown;
}

function handle(fn: () => unknown | Promise<unknown>): Promise<HTTPResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => apiOk(data))
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
  if (error.code === 'DEVICE_OFFLINE') {
    return 503;
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

function requireString(value: unknown, name: string): string {
  const text = stringField(value);
  if (!text) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }

  return text;
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
  if (!platform) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.platform is required');
  }

  const quality = stringField(sourceData.quality);
  if (!quality) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.quality is required');
  }

  const songInfo = objectField(sourceData.songInfo);
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

export function registerBridgeHandlers(router: Router, bridge: BridgeService): void {
  router.post('/api/bridge/preview-url', async (req) =>
    handle(async () => {
      const body = parseJsonBody<SongBody>(req);
      return { url: await bridge.previewUrl(requireSong(body.song)) };
    }));

  router.post('/api/bridge/songs/import', async (req) =>
    handle(() => {
      const body = parseJsonBody<SongsBody>(req);
      const songs = requireSongs(body.songs);
      return bridge.importSongs(songs);
    }));

  router.post('/api/bridge/play-url', async (req) =>
    handle(() => {
      const body = parseJsonBody<PlayBody>(req);
      return bridge.playOnSpeaker(
        requireString(body.account_id, 'account_id'),
        requireString(body.device_id, 'device_id'),
        requireSong(body.song),
      );
    }));

  router.post('/api/bridge/play-songlist', async (req) =>
    handle(() => {
      const body = parseJsonBody<PlayBody & SongsBody>(req);
      return bridge.playSonglistOnSpeaker(
        requireString(body.account_id, 'account_id'),
        requireString(body.device_id, 'device_id'),
        requireSongs(body.songs),
      );
    }));

  router.post('/api/bridge/play-resolved-url', async (req) =>
    handle(() => {
      const body = parseJsonBody<ResolvedPlayBody>(req);
      return bridge.playResolvedOnSpeaker(
        requireString(body.account_id, 'account_id'),
        requireString(body.device_id, 'device_id'),
        requireString(body.title, 'title'),
        stringishField(body.artist),
      );
    }));

  router.post('/api/bridge/external-search', async (req) =>
    handle(() => {
      const body = parseJsonBody<ExternalSearchBody>(req);
      return bridge.externalSearch(requireString(body.keyword, 'keyword'));
    }));
}
