import type { BridgeService } from '../bridge/service';
import { StarlightError } from '../system/errors';
import type { MusicPlatform, SearchResultSong } from '../music/types';
import type { PlayerSong } from '../player/manager';
import { CustomPlaylistStore } from './store';
import type { CustomPlaylist, CustomPlaylistSong, ImportNetworkPlaylistInput, SongListDetail } from './types';
import { customPlaylistIndexFromSyntheticId, syntheticSongId } from './synthetic';

type NativePlaylists = Record<string, unknown>;

const SOURCE_NAMES: Record<MusicPlatform, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ 音乐',
  mg: '咪咕',
  wy: '网易云',
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(name: string): string {
  return name.trim();
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function createId(prefix = 'custom'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function stableSongTextKey(song: Pick<CustomPlaylistSong, 'title' | 'artist'>): string {
  return `query:${normalizeKey(song.title)}:${normalizeKey(song.artist)}`;
}

function stableSongId(song: SearchResultSong): string {
  const info = song.source_data.songInfo;
  const id = info.musicId || info.songmid || info.hash || info.copyrightId || info.strMediaMid || `${song.title}:${song.artist}`;
  return `${song.source_data.platform}:${id}`;
}

function hasSourceData(song: SearchResultSong | CustomPlaylistSong): song is SearchResultSong {
  return Boolean((song as SearchResultSong).source_data?.platform && (song as SearchResultSong).source_data?.songInfo);
}

function toPlaylistSong(song: SearchResultSong): CustomPlaylistSong {
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    cover_url: song.cover_url,
    source_name: SOURCE_NAMES[song.source_data.platform] || song.source_data.platform,
    source_data: song.source_data,
    stable_key: stableSongId(song),
  };
}

function toPortablePlaylistSong(song: SearchResultSong): CustomPlaylistSong {
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    cover_url: song.cover_url,
    stable_key: stableSongTextKey(song),
  };
}

function detailCover(detail: SongListDetail): string {
  return detail.cover_url || detail.cover || detail.img || '';
}

function nativeId(value: unknown): string | number | undefined {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'number' || typeof record.id === 'string') {
      return record.id;
    }
    if (typeof record.playlist_id === 'number' || typeof record.playlist_id === 'string') {
      return record.playlist_id;
    }
  }
  return undefined;
}

export class CustomPlaylistService {
  constructor(
    private readonly store: CustomPlaylistStore,
    private readonly bridge: Pick<BridgeService, 'importSongs' | 'importSongsBestEffort' | 'resolveSearchSong'>,
    private readonly nativePlaylists: NativePlaylists = songloft.playlists as unknown as NativePlaylists,
  ) {}

  async list(): Promise<CustomPlaylist[]> {
    return this.store.loadAll();
  }

  async create(name: string): Promise<CustomPlaylist> {
    const normalized = normalizeName(name);
    if (!normalized) {
      throw new StarlightError('BAD_REQUEST', 'playlist name is required');
    }

    const playlists = await this.store.loadAll();
    const existing = playlists.find((playlist) => playlist.name.trim() === normalized);
    if (existing) {
      return existing;
    }

    const timestamp = nowIso();
    const playlist: CustomPlaylist = {
      id: createId(),
      name: normalized,
      cover_url: '',
      imported_at: timestamp,
      updated_at: timestamp,
      songs: [],
    };
    playlist.native_playlist_id = await this.tryNativeCreate(playlist.name);
    playlists.push(playlist);
    await this.store.saveAll(playlists);
    return playlist;
  }

  async addSong(playlistName: string, song: SearchResultSong | CustomPlaylistSong): Promise<CustomPlaylist> {
    const playlist = await this.create(playlistName);
    const resolved = await this.resolveSongForOwnPlaylist(song);
    if (playlist.songs.some((item) => item.stable_key === stableSongId(resolved))) {
      return playlist;
    }

    const imported = await this.bridge.importSongs([resolved]);
    const updated: CustomPlaylist = {
      ...playlist,
      cover_url: playlist.cover_url || resolved.cover_url,
      updated_at: nowIso(),
      songs: [...playlist.songs, toPlaylistSong(resolved)],
    };
    await this.tryNativeAddSongs(updated, imported.payloads ?? []);
    await this.replace(updated);
    return updated;
  }

  async rename(id: string, name: string): Promise<CustomPlaylist> {
    const normalized = normalizeName(name);
    if (!normalized) {
      throw new StarlightError('BAD_REQUEST', 'playlist name is required');
    }

    const playlists = await this.store.loadAll();
    const playlist = playlists.find((item) => item.id === id);
    if (!playlist) {
      throw new StarlightError('BAD_REQUEST', 'playlist not found');
    }
    const updated = { ...playlist, name: normalized, updated_at: nowIso() };
    await this.store.saveAll(playlists.map((item) => (item.id === id ? updated : item)));
    return updated;
  }

  async delete(id: string): Promise<{ id: string }> {
    const playlists = await this.store.loadAll();
    await this.store.saveAll(playlists.filter((playlist) => playlist.id !== id));
    return { id };
  }

  async importNetworkPlaylist(input: ImportNetworkPlaylistInput): Promise<CustomPlaylist> {
    const sourceListId = normalizeName(input.sourceListId);
    if (!sourceListId) {
      throw new StarlightError('BAD_REQUEST', 'sourceListId is required');
    }

    const playlists = await this.store.loadAll();
    const existing = playlists.find((playlist) => playlist.source === input.source && playlist.sourceListId === sourceListId);
    if (existing) {
      const { native_playlist_id: _nativePlaylistId, ...existingWithoutNative } = existing;
      const refreshed: CustomPlaylist = {
        ...existingWithoutNative,
        name: input.detail.name || existing.name,
        cover_url: detailCover(input.detail) || existing.cover_url,
        source: input.source,
        source_name: SOURCE_NAMES[input.source] || input.source,
        sourceListId,
        updated_at: nowIso(),
        songs: input.detail.songs.map(toPortablePlaylistSong),
      };
      await this.store.saveAll(playlists.map((playlist) => (playlist.id === existing.id ? refreshed : playlist)));
      return refreshed;
    }

    const timestamp = nowIso();
    const playlist: CustomPlaylist = {
      id: createId('imported'),
      name: input.detail.name || sourceListId,
      cover_url: detailCover(input.detail),
      source: input.source,
      source_name: SOURCE_NAMES[input.source] || input.source,
      sourceListId,
      imported_at: timestamp,
      updated_at: timestamp,
      songs: input.detail.songs.map(toPortablePlaylistSong),
    };
    playlists.push(playlist);
    await this.store.saveAll(playlists);
    return playlist;
  }

  async refreshNetworkPlaylist(
    id: string,
    detailLoader: (source: MusicPlatform, sourceListId: string) => Promise<SongListDetail>,
  ): Promise<CustomPlaylist> {
    const playlists = await this.store.loadAll();
    const existing = playlists.find((playlist) => playlist.id === id);
    if (!existing || !existing.source || !existing.sourceListId) {
      throw new StarlightError('BAD_REQUEST', 'imported playlist not found');
    }

    const detail = await detailLoader(existing.source, existing.sourceListId);
    const { native_playlist_id: _nativePlaylistId, ...existingWithoutNative } = existing;
    const refreshed: CustomPlaylist = {
      ...existingWithoutNative,
      name: detail.name || existing.name,
      cover_url: detailCover(detail) || existing.cover_url,
      updated_at: nowIso(),
      songs: detail.songs.map(toPortablePlaylistSong),
    };
    await this.store.saveAll(playlists.map((playlist) => (playlist.id === id ? refreshed : playlist)));
    return refreshed;
  }

  async loadDynamicPlayerSongs(playlistId: number): Promise<PlayerSong[] | null> {
    const playlists = await this.store.loadAll();
    const index = customPlaylistIndexFromSyntheticId(playlistId);
    if (index < 0 || index >= playlists.length) {
      return null;
    }
    const playlist = playlists[index];
    if (playlist.native_playlist_id !== undefined) {
      return null;
    }
    return playlist.songs.map((song, songIndex) => ({
      id: syntheticSongId(index, songIndex),
      type: 'dynamic',
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      file_path: '',
      url: '',
      cover_path: '',
      cover_url: song.cover_url,
      lyric_url: '',
      file_size: 0,
      format: '',
      bit_rate: 0,
      sample_rate: 0,
      is_live: false,
      cache_hash: '',
    }));
  }

  async syncToSongloftPlaylist(id: string): Promise<{
    playlist: CustomPlaylist;
    total: number;
    skipped: number;
    errors: Array<{ title: string; message: string }>;
  }> {
    const playlists = await this.store.loadAll();
    const playlist = playlists.find((item) => item.id === id);
    if (!playlist) {
      throw new StarlightError('BAD_REQUEST', 'playlist not found');
    }

    const resolvedSongs: SearchResultSong[] = [];
    const errors: Array<{ title: string; message: string }> = [];
    for (const song of playlist.songs) {
      try {
        resolvedSongs.push(await this.resolveSongForOwnPlaylist(song));
      } catch (error) {
        errors.push({
          title: song.title,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const imported = await this.bridge.importSongsBestEffort(resolvedSongs);
    const nativePlaylistId = playlist.native_playlist_id ?? await this.tryNativeCreate(playlist.name);
    const updated: CustomPlaylist = {
      ...playlist,
      ...(nativePlaylistId !== undefined ? { native_playlist_id: nativePlaylistId } : {}),
      updated_at: nowIso(),
    };
    await this.tryNativeAddSongs(updated, imported.payloads ?? []);
    await this.replace(updated);

    return {
      playlist: updated,
      total: imported.total,
      skipped: errors.length + imported.skipped,
      errors: [...errors, ...imported.errors],
    };
  }

  private async replace(updated: CustomPlaylist): Promise<void> {
    const playlists = await this.store.loadAll();
    await this.store.saveAll(playlists.map((playlist) => (playlist.id === updated.id ? updated : playlist)));
  }

  private async resolveSongForOwnPlaylist(song: SearchResultSong | CustomPlaylistSong): Promise<SearchResultSong> {
    if (hasSourceData(song)) {
      return song;
    }

    const resolved = await this.bridge.resolveSearchSong(song.title, song.artist);
    if (!resolved) {
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', `未找到可用音源：${song.title}${song.artist ? ` - ${song.artist}` : ''}`, true);
    }
    return resolved;
  }

  private async tryNativeCreate(name: string): Promise<string | number | undefined> {
    const create = this.nativePlaylists.create;
    if (typeof create !== 'function') {
      return undefined;
    }
    try {
      return nativeId(await create.call(this.nativePlaylists, { name }));
    } catch (error) {
      songloft.log.warn(`[CustomPlaylistService] Native playlist create failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async tryNativeAddSongs(playlist: CustomPlaylist, payloads: unknown[]): Promise<void> {
    const addSongs = this.nativePlaylists.addSongs;
    if (typeof addSongs !== 'function' || playlist.native_playlist_id === undefined) {
      return;
    }
    try {
      await addSongs.call(this.nativePlaylists, playlist.native_playlist_id, payloads);
    } catch (error) {
      songloft.log.warn(`[CustomPlaylistService] Native playlist addSongs failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export { SOURCE_NAMES as CUSTOM_PLAYLIST_SOURCE_NAMES };
