import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { CustomPlaylistService } from '../custom_playlists/service';
import type { CustomPlaylistSong, SongListDetail } from '../custom_playlists/types';
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

const IMPORT_PAGE_SIZE = 100;
const MAX_IMPORT_PAGES = 100;

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

function readSongBase(song: Record<string, unknown>): Omit<CustomPlaylistSong, 'stable_key'> {
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
  };
}

function requireSong(value: unknown): SearchResultSong | CustomPlaylistSong {
  const song = objectField(value);
  if (!song) {
    throw new StarlightError('BAD_REQUEST', 'song is required');
  }
  const base = readSongBase(song);
  if (!base.title) {
    throw new StarlightError('BAD_REQUEST', 'song.title is required');
  }

  const sourceData = objectField(song.source_data);
  if (!sourceData) {
    return {
      ...base,
      stable_key: `query:${base.title}:${base.artist}`,
    };
  }
  const platform = requireString(sourceData.platform, 'song.source_data.platform') as SearchResultSong['source_data']['platform'];
  const quality = requireString(sourceData.quality, 'song.source_data.quality') as SearchResultSong['source_data']['quality'];
  const songInfo = objectField(sourceData.songInfo);
  if (!songInfo) {
    throw new StarlightError('BAD_REQUEST', 'song.source_data.songInfo is required');
  }

  return {
    ...base,
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

function numericTotal(value: unknown): number {
  const total = Number(value);
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
}

async function loadSongListDetail(provider: MusicPlatformProvider, id: string): Promise<SongListDetail> {
  const first = await provider.songListDetail(id, 1, IMPORT_PAGE_SIZE) as SongListDetail;
  const songs = Array.isArray(first.songs) ? [...first.songs] : [];
  const total = numericTotal(first.total);

  let page = 2;
  while (
    page <= MAX_IMPORT_PAGES
    && (
      (total > 0 && songs.length < total)
      || (total === 0 && songs.length > 0 && songs.length % IMPORT_PAGE_SIZE === 0)
    )
  ) {
    const detail = await provider.songListDetail(id, page, IMPORT_PAGE_SIZE) as SongListDetail;
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
    cover_url: first.cover_url || first.cover || first.img || '',
    songs: total > 0 ? songs.slice(0, total) : songs,
    total: total || songs.length,
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

  router.post('/api/custom-playlists/:id/sync-songloft', async (_req, params) =>
    handle(() => service.syncToSongloftPlaylist(requireString(params.id, 'id'))));

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
