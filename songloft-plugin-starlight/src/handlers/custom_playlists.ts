import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { CustomPlaylistService } from '../custom_playlists/service';
import type { SongListDetail } from '../custom_playlists/types';
import type { PlatformRegistry } from '../music/platforms/registry';
import type { MusicPlatformProvider } from '../music/platforms/types';
import type { MusicPlatform, SearchResultSong } from '../music/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import { apiError, apiOk } from '../system/response';

interface NameBody {
  name?: unknown;
}

interface AddSongBody {
  song?: unknown;
}

interface ImportBody {
  source_id?: unknown;
  id?: unknown;
  sourceListId?: unknown;
  source_list_id?: unknown;
  link?: unknown;
  url?: unknown;
}

function handle(fn: () => unknown | Promise<unknown>, statusCode = 200): Promise<HTTPResponse> {
  return Promise.resolve()
    .then(fn)
    .then((data) => apiOk(data, statusCode))
    .catch((error) => apiError(error, statusFor(error)));
}

function statusFor(error: unknown): number {
  if (error instanceof StarlightError) {
    if (error.code === 'BAD_REQUEST' || error.code === 'MUSIC_PLATFORM_UNSUPPORTED') {
      return 400;
    }
  }
  return 500;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringishField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
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

function providerFor(platforms: PlatformRegistry, id: unknown): { provider: MusicPlatformProvider; source: MusicPlatform } {
  const source = requireString(id, 'source_id') as MusicPlatform;
  const provider = platforms.get(source);
  if (!provider) {
    throw new StarlightError('MUSIC_PLATFORM_UNSUPPORTED', '不支持的音乐平台', false);
  }
  return { provider, source };
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
  const platform = requireString(sourceData.platform, 'song.source_data.platform') as SearchResultSong['source_data']['platform'];
  const quality = requireString(sourceData.quality, 'song.source_data.quality') as SearchResultSong['source_data']['quality'];
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
      platform,
      quality,
      songInfo: songInfo as unknown as SearchResultSong['source_data']['songInfo'],
    },
  };
}

function importId(body: ImportBody): string {
  return requireString(body.id || body.sourceListId || body.source_list_id || body.link || body.url, 'id');
}

async function loadSongListDetail(provider: MusicPlatformProvider, id: string): Promise<SongListDetail> {
  const detail = await provider.songListDetail(id, 1, 100) as SongListDetail;
  return {
    name: detail.name || id,
    cover_url: detail.cover_url || detail.cover || detail.img || '',
    songs: Array.isArray(detail.songs) ? detail.songs : [],
    total: detail.total,
  };
}

export function registerCustomPlaylistHandlers(
  router: Router,
  service: CustomPlaylistService,
  platforms: PlatformRegistry,
): void {
  router.get('/api/custom-playlists', async () => handle(() => service.list()));

  router.post('/api/custom-playlists', async (req) =>
    handle(() => {
      const body = parseJsonBody<NameBody>(req);
      return service.create(requireString(body.name, 'name'));
    }, 201));

  router.post('/api/custom-playlists/import', async (req) =>
    handle(async () => {
      const body = parseJsonBody<ImportBody>(req);
      const { provider, source } = providerFor(platforms, body.source_id);
      const sourceListId = importId(body);
      const detail = await loadSongListDetail(provider, sourceListId);
      return service.importNetworkPlaylist({ source, sourceListId, detail });
    }, 201));

  router.post('/api/custom-playlists/:id/refresh', async (_req, params) =>
    handle(() => service.refreshNetworkPlaylist(requireString(params.id, 'id'), async (source, sourceListId) => {
      const provider = providerFor(platforms, source).provider;
      return loadSongListDetail(provider, sourceListId);
    })));

  router.post('/api/custom-playlists/:id/songs', async (req, params) =>
    handle(async () => {
      const id = requireString(params.id, 'id');
      const playlist = (await service.list()).find((item) => item.id === id);
      if (!playlist) {
        throw new StarlightError('BAD_REQUEST', 'playlist not found');
      }
      const body = parseJsonBody<AddSongBody>(req);
      return service.addSong(playlist.name, requireSong(body.song));
    }));

  router.put('/api/custom-playlists/:id', async (req, params) =>
    handle(() => {
      const body = parseJsonBody<NameBody>(req);
      return service.rename(requireString(params.id, 'id'), requireString(body.name, 'name'));
    }));

  router.delete('/api/custom-playlists/:id', async (_req, params) =>
    handle(() => service.delete(requireString(params.id, 'id'))));
}
