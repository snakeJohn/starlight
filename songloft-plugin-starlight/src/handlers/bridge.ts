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

function handle(fn: () => unknown | Promise<unknown>): Promise<HTTPResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => apiOk(data))
    .catch((error) => apiError(error, error instanceof StarlightError ? 400 : 500));
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireString(value: unknown, name: string): string {
  const text = stringField(value);
  if (!text) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }

  return text;
}

function requireSong(value: unknown): SearchResultSong {
  if (!value || typeof value !== 'object') {
    throw new StarlightError('BAD_REQUEST', 'song is required');
  }

  return value as SearchResultSong;
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
      const songs = Array.isArray(body.songs) ? (body.songs as SearchResultSong[]) : [];
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

  router.post('/api/bridge/external-search', async (req) =>
    handle(() => {
      const body = parseJsonBody<ExternalSearchBody>(req);
      return bridge.externalSearch(requireString(body.keyword, 'keyword'));
    }));
}
