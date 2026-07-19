import type { BridgeService, SongloftRemoteSong } from '../bridge/service';
import { StarlightError } from '../system/errors';
import type { MusicPlatform, SearchResultSong } from '../music/types';
import type { PlayerSong } from '../player/manager';
import { normalizeHostBaseUrl } from '../utils/http';
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

/**
 * Prefer online-resolved fields (cover, album, duration, source) while keeping
 * a non-empty cover/album hint from the LX snapshot when the network hit is blank.
 */
function mergeResolvedWithHint(
  resolved: SearchResultSong,
  hint: SearchResultSong | CustomPlaylistSong,
): SearchResultSong {
  return {
    ...resolved,
    cover_url: resolved.cover_url || hint.cover_url || '',
    album: resolved.album || hint.album || '',
    duration: resolved.duration > 0 ? resolved.duration : hint.duration || 0,
  };
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

function parseSongSourceData(song: Record<string, unknown>): SearchResultSong['source_data'] | undefined {
  const raw = song.source_data ?? song.sourceData;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as SearchResultSong['source_data'];
    if (record.platform && record.songInfo) return record;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as SearchResultSong['source_data'];
      if (parsed?.platform && parsed?.songInfo) return parsed;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function toNativePlaylistSong(song: Record<string, unknown>): CustomPlaylistSong {
  const id = nativeId(song);
  const title = stringField(song.title) || stringField(song.name) || '未知歌曲';
  const artist = stringField(song.artist) || stringField(song.singer) || stringField(song.author) || '未知歌手';
  const album = stringField(song.album) || stringField(song.albumName);
  const duration = typeof song.duration === 'number' && Number.isFinite(song.duration)
    ? song.duration
    : typeof song.duration === 'string' && Number.isFinite(Number(song.duration))
      ? Number(song.duration)
      : 0;
  const sourceData = parseSongSourceData(song);
  return {
    title,
    artist,
    album,
    duration,
    cover_url: stringField(song.cover_url) || stringField(song.coverUrl) || stringField(song.picUrl),
    ...(id !== undefined ? { native_song_id: id } : {}),
    ...(sourceData ? { source_data: sourceData } : {}),
    stable_key: id !== undefined ? `songloft:${id}` : stableSongTextKey({ title, artist }),
  };
}

/** Stable LX user-list id for a Songloft native playlist (exported to LX clients). */
export function songloftLxListId(nativePlaylistId: string | number): string {
  return `lx:user:songloft:${nativePlaylistId}`;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

    // Fast path: same-name playlist already exists — never create a host orphan.
    const existing = (await this.store.loadAll()).find((playlist) => playlist.name.trim() === normalized);
    if (existing) {
      return existing;
    }

    // Host I/O only when we still believe a new row is needed.
    const nativeId = await this.tryNativeCreate(normalized);
    let created: CustomPlaylist | null = null;
    await this.store.mutate(async (playlists) => {
      const raced = playlists.find((playlist) => playlist.name.trim() === normalized);
      if (raced) {
        // Concurrent create won; attach native id only if the winner still lacks one.
        if (raced.native_playlist_id === undefined && nativeId !== undefined) {
          const linked: CustomPlaylist = { ...raced, native_playlist_id: nativeId };
          created = linked;
          return playlists.map((playlist) => (playlist.id === raced.id ? linked : playlist));
        }
        created = raced;
        return playlists;
      }
      const timestamp = nowIso();
      const playlist: CustomPlaylist = {
        id: createId(),
        name: normalized,
        cover_url: '',
        imported_at: timestamp,
        updated_at: timestamp,
        songs: [],
        ...(nativeId !== undefined ? { native_playlist_id: nativeId } : {}),
      };
      created = playlist;
      return [...playlists, playlist];
    });
    return created!;
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
    // Songloft playlists accept library song ids, not remote import payloads.
    await this.tryNativeAddSongIds(updated.native_playlist_id, remoteSongIds(imported.songs ?? []));
    await this.replace(updated);
    return updated;
  }

  async rename(id: string, name: string): Promise<CustomPlaylist> {
    const normalized = normalizeName(name);
    if (!normalized) {
      throw new StarlightError('BAD_REQUEST', 'playlist name is required');
    }

    let updated: CustomPlaylist | null = null;
    await this.store.mutate((playlists) => {
      const playlist = playlists.find((item) => item.id === id);
      if (!playlist) {
        throw new StarlightError('BAD_REQUEST', 'playlist not found');
      }
      updated = { ...playlist, name: normalized, updated_at: nowIso() };
      return playlists.map((item) => (item.id === id ? updated! : item));
    });
    return updated!;
  }

  async delete(id: string): Promise<{ id: string }> {
    await this.store.mutate((playlists) => playlists.filter((playlist) => playlist.id !== id));
    return { id };
  }

  async importNetworkPlaylist(input: ImportNetworkPlaylistInput): Promise<CustomPlaylist> {
    const sourceListId = normalizeName(input.sourceListId);
    if (!sourceListId) {
      throw new StarlightError('BAD_REQUEST', 'sourceListId is required');
    }

    let result: CustomPlaylist | null = null;
    await this.store.mutate((playlists) => {
      const existing = playlists.find(
        (playlist) => playlist.source === input.source && playlist.sourceListId === sourceListId,
      );
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
        result = refreshed;
        return playlists.map((playlist) => (playlist.id === existing.id ? refreshed : playlist));
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
      result = playlist;
      return [...playlists, playlist];
    });
    return result!;
  }

  async importSongloftPlaylistSnapshot(input: {
    nativePlaylistId: string | number;
    name: string;
    songs: Array<Record<string, unknown>>;
    /** When true, tag as LX-exportable (`lx:user:songloft:*`) so 洛雪 clients receive it. */
    forLxExport?: boolean;
  }): Promise<CustomPlaylist> {
    const normalizedName = normalizeName(input.name);
    if (!normalizedName) {
      throw new StarlightError('BAD_REQUEST', 'playlist name is required');
    }
    const nativePlaylistId = input.nativePlaylistId;
    const songs = input.songs.map(toNativePlaylistSong);
    const lxListId = songloftLxListId(nativePlaylistId);
    let result: CustomPlaylist | null = null;
    await this.store.mutate((playlists) => {
      const existing = playlists.find(
        (playlist) =>
          String(playlist.native_playlist_id) === String(nativePlaylistId)
          || String(playlist.sourceListId || '') === lxListId,
      );
      const timestamp = nowIso();
      const playlist: CustomPlaylist = {
        ...(existing ?? {
          id: createId('songloft'),
          imported_at: timestamp,
        }),
        name: normalizedName,
        cover_url: songs[0]?.cover_url || existing?.cover_url || '',
        native_playlist_id: nativePlaylistId,
        native_playlist_name: normalizedName,
        ...(input.forLxExport
          ? {
              sourceListId: lxListId,
              source_name: existing?.source_name || 'Songloft',
            }
          : {}),
        updated_at: timestamp,
        songs,
      };
      result = playlist;
      return existing
        ? playlists.map((item) => (item.id === existing.id ? playlist : item))
        : [...playlists, playlist];
    });
    return result!;
  }

  /**
   * Mirror Songloft host playlists into LX-exportable custom playlists
   * (`sourceListId = lx:user:songloft:{nativeId}`) so 洛雪 clients receive them
   * on the next list sync (and immediately if peers are live).
   */
  async mirrorSongloftPlaylistsForLx(nativePlaylistIds?: Array<string | number>): Promise<{
    total: number;
    playlists: CustomPlaylist[];
    errors: Array<{ name: string; message: string }>;
  }> {
    const wanted = new Set(
      (nativePlaylistIds || [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    );
    const items = await this.listNativePlaylists();
    const selected = wanted.size
      ? items.filter((item) => wanted.has(String(item.id)))
      : items;

    const playlists: CustomPlaylist[] = [];
    const errors: Array<{ name: string; message: string }> = [];

    for (const item of selected) {
      try {
        const rawSongs = await this.loadNativePlaylistSongs(item.id);
        const mirrored = await this.importSongloftPlaylistSnapshot({
          nativePlaylistId: item.id,
          name: item.name || `歌单 ${item.id}`,
          songs: rawSongs,
          forLxExport: true,
        });
        playlists.push(mirrored);
      } catch (error) {
        errors.push({
          name: item.name || String(item.id),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { total: playlists.length, playlists, errors };
  }

  private async loadNativePlaylistSongs(
    nativePlaylistId: string | number,
  ): Promise<Array<Record<string, unknown>>> {
    const getSongs = this.nativePlaylists.getSongs;
    if (typeof getSongs !== 'function') {
      throw new StarlightError('INTERNAL_ERROR', 'Songloft playlists.getSongs is unavailable');
    }
    const raw = await getSongs.call(this.nativePlaylists, nativePlaylistId, { limit: 100000 });
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    }
    if (raw && typeof raw === 'object') {
      const record = raw as { items?: unknown; songs?: unknown; list?: unknown };
      const list = record.items ?? record.songs ?? record.list;
      if (Array.isArray(list)) {
        return list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      }
    }
    return [];
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

    // Network fetch outside the store lock.
    const detail = await detailLoader(existing.source, existing.sourceListId);
    let refreshed: CustomPlaylist | null = null;
    await this.store.mutate((current) => {
      const still = current.find((playlist) => playlist.id === id);
      if (!still || !still.source || !still.sourceListId) {
        throw new StarlightError('BAD_REQUEST', 'imported playlist not found');
      }
      const { native_playlist_id: _nativePlaylistId, ...existingWithoutNative } = still;
      refreshed = {
        ...existingWithoutNative,
        name: detail.name || still.name,
        cover_url: detailCover(detail) || still.cover_url,
        updated_at: nowIso(),
        songs: detail.songs.map(toPortablePlaylistSong),
      };
      return current.map((playlist) => (playlist.id === id ? refreshed! : playlist));
    });
    return refreshed!;
  }

  async loadDynamicPlayerSongs(playlistId: number): Promise<PlayerSong[] | null> {
    const playlists = await this.store.loadAll();
    const index = customPlaylistIndexFromSyntheticId(playlistId);
    if (index < 0 || index >= playlists.length) {
      return null;
    }
    const playlist = playlists[index];
    // Only numeric Songloft native playlist ids skip dynamic local load.
    // String ids (e.g. legacy lx:*) are treated as local custom playlists.
    if (typeof playlist.native_playlist_id === 'number') {
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

    // Import every resolved song into the Songloft song library first
    // (URL + cover from multi-source resolve; lyrics filled asynchronously by bridge).
    const imported = await this.bridge.importSongsBestEffort(resolvedSongs);
    // Reuse linked Songloft playlist, else match by name, else create with the same name.
    // Prefer live store name/link fields (playlist may have been updated by LX sync mid-import).
    // Validate preferred native id still exists — user may have deleted the Songloft playlist.
    const live = (await this.store.loadAll()).find((item) => item.id === id) ?? playlist;
    const nativePlaylistId = await this.resolveNativePlaylistId(
      live.name || playlist.name,
      live.native_playlist_id ?? playlist.native_playlist_id,
    );

    // Host playlist API expects Songloft library song ids (not remote payloads).
    // This is the same contract as SongloftPlaylistService.addSongIds.
    const songIds = remoteSongIds(imported.songs ?? []);
    const missingIdCount = Math.max(0, imported.total - songIds.length);
    if (missingIdCount > 0) {
      errors.push({
        title: 'Songloft 歌曲库',
        message: `${missingIdCount} 首歌曲导入成功但未返回 Songloft song id，无法加入歌单`,
      });
    }
    await this.tryNativeAddSongIds(nativePlaylistId, songIds);

    // Patch Songloft link fields and refresh local song metadata from online resolve
    // (cover_url / source_data) without clobbering concurrent LX song-list rewrites.
    const patched = await this.patchPlaylistAfterImport(id, {
      native_playlist_id: nativePlaylistId,
      native_playlist_name: live.name || playlist.name,
      resolvedSongs,
    });

    return {
      playlist: patched ?? {
        ...live,
        ...(nativePlaylistId !== undefined ? { native_playlist_id: nativePlaylistId } : {}),
        native_playlist_name: live.name || playlist.name,
        updated_at: nowIso(),
      },
      total: imported.total,
      skipped: errors.length + imported.skipped + missingIdCount,
      errors: [...errors, ...imported.errors],
    };
  }

  private async replace(updated: CustomPlaylist): Promise<void> {
    await this.store.mutate((playlists) =>
      playlists.map((playlist) => (playlist.id === updated.id ? updated : playlist)),
    );
  }

  /**
   * Merge only Songloft link fields onto the current store row.
   * Avoids clobbering songs/name updated by concurrent LX setLocalListData.
   */
  private async patchPlaylistLink(
    id: string,
    link: {
      native_playlist_id?: string | number;
      native_playlist_name?: string;
    },
  ): Promise<CustomPlaylist | undefined> {
    return this.patchPlaylistAfterImport(id, link);
  }

  /**
   * Patch link fields and optionally enrich matching songs with online metadata
   * (cover / source_data). Matching is by title+artist so concurrent LX list
   * rewrites that keep the same tracks still get covers; new tracks are left alone.
   */
  private async patchPlaylistAfterImport(
    id: string,
    link: {
      native_playlist_id?: string | number;
      native_playlist_name?: string;
      resolvedSongs?: SearchResultSong[];
    },
  ): Promise<CustomPlaylist | undefined> {
    let result: CustomPlaylist | undefined;
    const resolvedByKey = new Map<string, SearchResultSong>();
    for (const song of link.resolvedSongs || []) {
      resolvedByKey.set(stableSongTextKey(song), song);
    }

    await this.store.mutate((playlists) =>
      playlists.map((playlist) => {
        if (playlist.id !== id) return playlist;

        const songs =
          resolvedByKey.size === 0
            ? playlist.songs
            : playlist.songs.map((existing) => {
                const hit =
                  resolvedByKey.get(stableSongTextKey(existing))
                  || [...resolvedByKey.values()].find(
                    (r) =>
                      normalizeKey(r.title) === normalizeKey(existing.title)
                      && normalizeKey(r.artist) === normalizeKey(existing.artist),
                  );
                if (!hit) return existing;
                const mapped = toPlaylistSong(hit);
                return {
                  ...existing,
                  cover_url: mapped.cover_url || existing.cover_url,
                  album: mapped.album || existing.album,
                  duration: mapped.duration || existing.duration,
                  source_name: mapped.source_name || existing.source_name,
                  source_data: mapped.source_data || existing.source_data,
                  // Keep existing stable_key if present so UI keys stay stable.
                  stable_key: existing.stable_key || mapped.stable_key,
                };
              });

        const coverFromSongs = songs.find((s) => s.cover_url)?.cover_url || '';
        result = {
          ...playlist,
          ...(link.native_playlist_id !== undefined
            ? { native_playlist_id: link.native_playlist_id }
            : {}),
          ...(link.native_playlist_name !== undefined
            ? { native_playlist_name: link.native_playlist_name }
            : {}),
          cover_url: playlist.cover_url || coverFromSongs,
          songs,
          updated_at: nowIso(),
        };
        return result;
      }),
    );
    return result;
  }

  /**
   * Always re-resolve via Starlight multi-source online search (title + artist).
   * Do not trust LX / portable source_data for playback — cover, lyrics and URL
   * come from whichever channel can provide the highest playable quality.
   *
   * Falls back to the existing source_data only when online search finds nothing
   * (so offline/local ids still have a chance via previewUrl quality ladder).
   */
  private async resolveSongForOwnPlaylist(song: SearchResultSong | CustomPlaylistSong): Promise<SearchResultSong> {
    const title = String(song.title || '').trim();
    const artist = String(song.artist || '').trim();
    if (title) {
      try {
        const resolved = await this.bridge.resolveSearchSong(title, artist);
        if (resolved) {
          return mergeResolvedWithHint(resolved, song);
        }
      } catch (error) {
        songloft.log.warn(
          `[CustomPlaylistService] Online resolve failed for "${title}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (hasSourceData(song)) {
      return song;
    }

    throw new StarlightError(
      'PLAY_URL_RESOLVE_FAILED',
      `未找到可用音源：${title}${artist ? ` - ${artist}` : ''}`,
      true,
    );
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

  /**
   * Resolve a live Songloft playlist id for linking:
   * 1) preferred id if it still exists on the host
   * 2) existing playlist with the same name
   * 3) create a new playlist
   *
   * Step 1 prevents silent no-ops after the user deletes a Songloft playlist while
   * Starlight still holds a stale native_playlist_id.
   */
  private async resolveNativePlaylistId(
    name: string,
    preferredId?: string | number,
  ): Promise<string | number | undefined> {
    const canList = typeof this.nativePlaylists.list === 'function';
    // Without list API we cannot detect deletions — keep preferred id if any.
    if (!canList) {
      if (preferredId !== undefined && preferredId !== null && preferredId !== '') {
        return preferredId;
      }
      return this.tryNativeCreate(name);
    }

    const items = await this.listNativePlaylists();
    if (preferredId !== undefined && preferredId !== null && preferredId !== '') {
      const stillThere = items.some((item) => String(item.id) === String(preferredId));
      if (stillThere) return preferredId;
      songloft.log.info(
        `[CustomPlaylistService] Stale native_playlist_id=${preferredId} for "${name}"; will re-link`,
      );
    }
    const byName = this.findNativePlaylistIdInItems(items, name);
    if (byName !== undefined) return byName;
    return this.tryNativeCreate(name);
  }

  private async listNativePlaylists(): Promise<Array<{ id: string | number; name: string }>> {
    const list = this.nativePlaylists.list;
    if (typeof list !== 'function') return [];
    try {
      const raw = await list.call(this.nativePlaylists);
      const items = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
          ? Array.isArray((raw as { items?: unknown }).items)
            ? (raw as { items: unknown[] }).items
            : Array.isArray((raw as { playlists?: unknown }).playlists)
              ? (raw as { playlists: unknown[] }).playlists
              : []
          : [];
      const result: Array<{ id: string | number; name: string }> = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const id = nativeId(record);
        if (id === undefined) continue;
        const itemName = stringField(record.name) || stringField(record.title);
        result.push({ id, name: itemName });
      }
      return result;
    } catch (error) {
      songloft.log.warn(
        `[CustomPlaylistService] Native playlist list failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private findNativePlaylistIdInItems(
    items: Array<{ id: string | number; name: string }>,
    name: string,
  ): string | number | undefined {
    const normalized = normalizeName(name);
    if (!normalized) return undefined;
    for (const item of items) {
      if (normalizeName(item.name) === normalized) return item.id;
    }
    return undefined;
  }

  /** Prefer an existing Songloft playlist with the same name to avoid duplicates on re-sync. */
  private async findNativePlaylistIdByName(name: string): Promise<string | number | undefined> {
    const items = await this.listNativePlaylists();
    return this.findNativePlaylistIdInItems(items, name);
  }

  /**
   * Add library songs into a Songloft native playlist by numeric song id.
   * Prefer the documented host REST API; fall back to SDK helpers that accept ids.
   */
  private async tryNativeAddSongIds(
    nativePlaylistId: string | number | undefined,
    songIds: number[],
  ): Promise<void> {
    if (nativePlaylistId === undefined || nativePlaylistId === null || nativePlaylistId === '') {
      return;
    }
    const ids = uniquePositiveSongIds(songIds);
    if (!ids.length) return;

    const playlistId = typeof nativePlaylistId === 'number'
      ? nativePlaylistId
      : Number(String(nativePlaylistId).trim());
    if (!Number.isInteger(playlistId) || playlistId <= 0) {
      songloft.log.warn(
        `[CustomPlaylistService] Invalid native playlist id for song add: ${String(nativePlaylistId)}`,
      );
      return;
    }

    // 1) Official host API — same as SongloftPlaylistService.addSongIds.
    try {
      await this.hostAddSongIds(playlistId, ids);
      return;
    } catch (error) {
      songloft.log.warn(
        `[CustomPlaylistService] Host playlist add songs failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 2) Append-only SDK addSongs (never setSongs — partial ids would wipe the playlist).
    const addSongs = this.nativePlaylists.addSongs;
    if (typeof addSongs === 'function') {
      try {
        await addSongs.call(this.nativePlaylists, playlistId, ids);
        return;
      } catch (error) {
        // Some hosts expect { song_ids } instead of a bare id array.
        try {
          await addSongs.call(this.nativePlaylists, playlistId, { song_ids: ids });
          return;
        } catch (inner) {
          songloft.log.warn(
            `[CustomPlaylistService] Native playlist addSongs failed: ${error instanceof Error ? error.message : String(error)}; fallback: ${inner instanceof Error ? inner.message : String(inner)}`,
          );
        }
      }
    }
  }

  private async hostAddSongIds(playlistId: number, songIds: number[]): Promise<void> {
    const host = normalizeHostBaseUrl(await songloft.plugin.getHostUrl());
    const token = await songloft.plugin.getToken();
    if (!host) {
      throw new Error('Songloft host URL is empty');
    }
    const response = await fetch(`${host}/api/v1/playlists/${playlistId}/songs`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ song_ids: songIds }),
    });
    if (!response.ok) {
      const text = typeof response.text === 'function'
        ? (await response.text().catch(() => '')).trim().slice(0, 200)
        : '';
      throw new Error(`HTTP ${response.status}${text ? ` ${text}` : ''}`);
    }
  }
}

function remoteSongIds(songs: SongloftRemoteSong[]): number[] {
  return uniquePositiveSongIds(songs.map((song) => song.id));
}

function uniquePositiveSongIds(values: unknown[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const id = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof id === 'number' && Number.isInteger(id) && id > 0 && !seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }
  return ids;
}

export { SOURCE_NAMES as CUSTOM_PLAYLIST_SOURCE_NAMES };
