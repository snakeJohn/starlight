import type { CustomPlaylistSong } from '../custom_playlists/types';
import type { LxSongInfo, MusicPlatform, MusicQuality, SearchResultSong } from '../music/types';
import {
  LX_NATIVE_IDS,
  type LxListData,
  type LxMappedPlaylist,
  type LxMusicInfo,
  type LxMusicPlatform,
  type LxPlaylistPreview,
  type LxUserListInfo,
} from './types';

const PLATFORM_SOURCE_NAMES: Record<LxMusicPlatform, string> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ 音乐',
  mg: '咪咕',
  wy: '网易云',
};

const ONLINE_PLATFORMS = new Set<string>(['kw', 'kg', 'tx', 'mg', 'wy']);

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringishField(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Parse LX interval strings (`mm:ss` or `hh:mm:ss`) into seconds.
 */
export function parseIntervalSeconds(interval: string | null | undefined): number {
  if (!interval || typeof interval !== 'string') return 0;
  const parts = interval.trim().split(':').map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return 0;
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return Math.floor(minutes * 60 + seconds);
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return Math.floor(hours * 3600 + minutes * 60 + seconds);
  }
  return 0;
}

function isOnlinePlatform(source: string): source is LxMusicPlatform {
  return ONLINE_PLATFORMS.has(source);
}

function buildSongInfo(music: LxMusicInfo, platform: LxMusicPlatform, duration: number): LxSongInfo {
  const meta = music.meta || {};
  const songInfo: LxSongInfo = {
    source: platform,
    name: music.name,
    singer: music.singer,
    album: stringField(meta.albumName),
    duration,
  };

  const songId = meta.songId ?? music.id;
  if (songId !== undefined && songId !== null && String(songId) !== '') {
    songInfo.songId = String(songId);
    songInfo.musicId = String(songId);
  }

  if (platform === 'kg' && meta.hash) {
    songInfo.hash = stringishField(meta.hash);
  }
  if (platform === 'tx') {
    if (meta.strMediaMid) songInfo.strMediaMid = stringishField(meta.strMediaMid);
    if (meta.albumMid) songInfo.albumMid = stringishField(meta.albumMid);
    if (typeof meta.songId === 'number' || typeof meta.songId === 'string') {
      songInfo.id = String(meta.songId);
    }
  }
  if (platform === 'mg') {
    const copyrightId = meta.copyrightId || (meta.songId !== undefined ? String(meta.songId) : '');
    if (copyrightId) songInfo.copyrightId = copyrightId;
    if (meta.lrcUrl) songInfo.lrcUrl = stringishField(meta.lrcUrl);
    if (meta.mrcUrl) songInfo.mrcUrl = stringishField(meta.mrcUrl);
    if (meta.trcUrl) songInfo.trcUrl = stringishField(meta.trcUrl);
  }
  if (meta.albumId !== undefined) {
    songInfo.albumId = String(meta.albumId);
  }

  // Prefer explicit mid fields from meta when present
  if (typeof meta.songmid === 'string' || typeof meta.songmid === 'number') {
    songInfo.songmid = String(meta.songmid);
  }
  if (typeof meta.mid === 'string' || typeof meta.mid === 'number') {
    songInfo.mid = String(meta.mid);
  }

  return songInfo;
}

function buildSourceData(music: LxMusicInfo, platform: LxMusicPlatform, duration: number): SearchResultSong['source_data'] {
  return {
    platform: platform as MusicPlatform,
    quality: '320k' as MusicQuality,
    songInfo: buildSongInfo(music, platform, duration),
  };
}

export function mapLxMusicToSong(music: LxMusicInfo): CustomPlaylistSong {
  const title = stringField(music.name) || '未知歌曲';
  const artist = stringField(music.singer) || '未知歌手';
  const album = stringField(music.meta?.albumName);
  const duration = parseIntervalSeconds(music.interval);
  const cover_url = stringField(music.meta?.picUrl) || '';
  const source = stringField(music.source) || 'unknown';
  const musicId = stringField(music.id) || `${title}:${artist}`;

  if (isOnlinePlatform(source)) {
    const source_data = buildSourceData(music, source, duration);
    return {
      title,
      artist,
      album,
      duration,
      cover_url,
      source_name: PLATFORM_SOURCE_NAMES[source],
      source_data,
      native_song_id: music.meta?.songId ?? music.id,
      stable_key: `lx:${source}:${musicId}`,
    };
  }

  return {
    title,
    artist,
    album,
    duration,
    cover_url,
    source_name: source === 'local' ? '本地' : source,
    native_song_id: music.id,
    stable_key: musicId ? `lx:${source}:${musicId}` : `query:${normalizeKey(title)}:${normalizeKey(artist)}`,
  };
}

function mapSongs(list: LxMusicInfo[] | undefined | null): CustomPlaylistSong[] {
  if (!Array.isArray(list)) return [];
  return list.map(mapLxMusicToSong);
}

function firstCover(songs: CustomPlaylistSong[]): string {
  return songs.find((song) => song.cover_url)?.cover_url || '';
}

function mapUserList(userList: LxUserListInfo): LxMappedPlaylist {
  const songs = mapSongs(userList.list);
  const id = stringField(userList.id) || `user_${userList.name}`;
  return {
    name: stringField(userList.name) || id,
    native_playlist_id: `lx:user:${id}`,
    kind: 'user',
    cover_url: firstCover(songs),
    songs,
  };
}

/**
 * Map LX ListData into Starlight custom playlist drafts.
 */
export function mapListDataToPlaylists(
  data: LxListData,
  options: { importDefaultList?: boolean } = {},
): LxMappedPlaylist[] {
  const importDefaultList = options.importDefaultList !== false;
  const playlists: LxMappedPlaylist[] = [];

  const loveSongs = mapSongs(data.loveList);
  playlists.push({
    name: '我喜欢',
    native_playlist_id: LX_NATIVE_IDS.love,
    kind: 'love',
    cover_url: firstCover(loveSongs),
    songs: loveSongs,
  });

  if (importDefaultList) {
    const defaultSongs = mapSongs(data.defaultList);
    playlists.push({
      name: '默认列表',
      native_playlist_id: LX_NATIVE_IDS.default,
      kind: 'default',
      cover_url: firstCover(defaultSongs),
      songs: defaultSongs,
    });
  }

  const userLists = Array.isArray(data.userList) ? data.userList : [];
  for (const userList of userLists) {
    playlists.push(mapUserList(userList));
  }

  return playlists;
}

export function summarizeListData(
  data: LxListData,
  options: { importDefaultList?: boolean } = {},
): LxPlaylistPreview[] {
  return mapListDataToPlaylists(data, options).map((playlist) => ({
    id: playlist.native_playlist_id,
    name: playlist.name,
    songCount: playlist.songs.length,
    kind: playlist.kind,
  }));
}

export function mergeSongsByStableKey(
  existing: CustomPlaylistSong[],
  incoming: CustomPlaylistSong[],
): CustomPlaylistSong[] {
  const map = new Map<string, CustomPlaylistSong>();
  for (const song of existing) {
    map.set(song.stable_key, song);
  }
  for (const song of incoming) {
    map.set(song.stable_key, song);
  }
  return Array.from(map.values());
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function isLxListData(value: unknown): value is LxListData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.defaultList) ||
    Array.isArray(record.loveList) ||
    Array.isArray(record.userList)
  );
}
