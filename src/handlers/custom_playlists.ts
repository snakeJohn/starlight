import type { Router } from '@songloft/plugin-sdk';
import { CustomPlaylistService } from '../custom_playlists/service';
import type { CustomPlaylistSong, SongListDetail } from '../custom_playlists/types';
import type { PlatformRegistry } from '../music/platforms/registry';
import type { MusicPlatformProvider } from '../music/platforms/types';
import { loadFullSonglist } from '../music/songlist_loader';
import type { MusicPlatform, SearchResultSong } from '../music/types';
import { parseJsonBody } from '../system/body';
import { StarlightError } from '../system/errors';
import {
  objectField,
  requirePositiveInteger,
  requireString,
  stringishField,
} from '../system/fields';
import { runApi } from '../system/response';

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

interface ImportSongloftBody {
  playlist_id?: unknown;
  id?: unknown;
  name?: unknown;
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

function normalizeSongloftSongs(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of ['songs', 'items', 'list']) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
    }
  }
  return [];
}

async function loadSongListDetail(provider: MusicPlatformProvider, id: string): Promise<SongListDetail> {
  const detail = await loadFullSonglist(provider, id);
  return {
    name: detail.name,
    cover_url: detail.cover_url,
    songs: detail.songs,
    total: detail.total,
  };
}

export function registerCustomPlaylistHandlers(
  router: Router,
  service: CustomPlaylistService,
  platforms: PlatformRegistry,
): void {
  router.get('/api/custom-playlists', async () => runApi(() => service.list()));

  router.post('/api/custom-playlists', async (req) =>
    runApi(() => {
      const body = parseJsonBody<NameBody>(req);
      return service.create(requireString(body.name, 'name'));
    }, 201));

  router.post('/api/custom-playlists/import', async (req) =>
    runApi(async () => {
      const body = parseJsonBody<ImportBody>(req);
      const { provider, source } = providerFor(platforms, body.source_id);
      const sourceListId = importId(body);
      const detail = await loadSongListDetail(provider, sourceListId);
      return service.importNetworkPlaylist({ source, sourceListId, detail });
    }, 201));

  router.post('/api/custom-playlists/import-songloft', async (req) =>
    runApi(async () => {
      const body = parseJsonBody<ImportSongloftBody>(req);
      const playlistId = requirePositiveInteger(body.playlist_id ?? body.id, 'playlist_id');
      const songs = normalizeSongloftSongs(await songloft.playlists.getSongs(playlistId));
      return service.importSongloftPlaylistSnapshot({
        nativePlaylistId: playlistId,
        name: requireString(body.name, 'name'),
        songs,
      });
    }, 201));

  router.post('/api/custom-playlists/:id/refresh', async (_req, params) =>
    runApi(() => service.refreshNetworkPlaylist(requireString(params.id, 'id'), async (source, sourceListId) => {
      const provider = providerFor(platforms, source).provider;
      return loadSongListDetail(provider, sourceListId);
    })));

  router.post('/api/custom-playlists/:id/sync-songloft', async (_req, params) =>
    runApi(() => service.syncToSongloftPlaylist(requireString(params.id, 'id'))));

  router.post('/api/custom-playlists/:id/songs', async (req, params) =>
    runApi(async () => {
      const id = requireString(params.id, 'id');
      const playlist = (await service.list()).find((item) => item.id === id);
      if (!playlist) {
        throw new StarlightError('BAD_REQUEST', 'playlist not found');
      }
      const body = parseJsonBody<AddSongBody>(req);
      return service.addSong(playlist.name, requireSong(body.song));
    }));

  router.put('/api/custom-playlists/:id', async (req, params) =>
    runApi(() => {
      const body = parseJsonBody<NameBody>(req);
      return service.rename(requireString(params.id, 'id'), requireString(body.name, 'name'));
    }));

  router.delete('/api/custom-playlists/:id', async (_req, params) =>
    runApi(() => service.delete(requireString(params.id, 'id'))));
}
