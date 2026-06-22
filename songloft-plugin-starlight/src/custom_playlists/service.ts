import type { BridgeService } from '../bridge/service';
import { StarlightError } from '../system/errors';
import type { MusicPlatform, SearchResultSong } from '../music/types';
import { CustomPlaylistStore } from './store';
import type { CustomPlaylist, CustomPlaylistSong, ImportNetworkPlaylistInput, SongListDetail } from './types';

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

function createId(prefix = 'custom'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

function stableSongId(song: SearchResultSong): string {
  const info = song.source_data.songInfo;
  const id = info.musicId || info.songmid || info.hash || info.copyrightId || info.strMediaMid || `${song.title}:${song.artist}`;
  return `${song.source_data.platform}:${id}`;
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
    private readonly store = new CustomPlaylistStore(),
    private readonly bridge: Pick<BridgeService, 'importSongs'>,
    private readonly nativePlaylists: NativePlaylists = songloft.playlists as NativePlaylists,
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

  async addSong(playlistName: string, song: SearchResultSong): Promise<CustomPlaylist> {
    const playlist = await this.create(playlistName);
    if (playlist.songs.some((item) => item.stable_key === stableSongId(song))) {
      return playlist;
    }

    const imported = await this.bridge.importSongs([song]);
    const updated: CustomPlaylist = {
      ...playlist,
      cover_url: playlist.cover_url || song.cover_url,
      updated_at: nowIso(),
      songs: [...playlist.songs, toPlaylistSong(song)],
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
      return existing;
    }

    const imported = await this.bridge.importSongs(input.detail.songs);
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
      songs: input.detail.songs.map(toPlaylistSong),
    };
    playlist.native_playlist_id = await this.tryNativeCreate(playlist.name);
    await this.tryNativeAddSongs(playlist, imported.payloads ?? []);
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
    const imported = await this.bridge.importSongs(detail.songs);
    const refreshed: CustomPlaylist = {
      ...existing,
      name: detail.name || existing.name,
      cover_url: detailCover(detail) || existing.cover_url,
      updated_at: nowIso(),
      songs: detail.songs.map(toPlaylistSong),
    };
    await this.tryNativeAddSongs(refreshed, imported.payloads ?? []);
    await this.store.saveAll(playlists.map((playlist) => (playlist.id === id ? refreshed : playlist)));
    return refreshed;
  }

  private async replace(updated: CustomPlaylist): Promise<void> {
    const playlists = await this.store.loadAll();
    await this.store.saveAll(playlists.map((playlist) => (playlist.id === updated.id ? updated : playlist)));
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
