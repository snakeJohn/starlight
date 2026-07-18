import type { CustomPlaylist, CustomPlaylistSong } from '../custom_playlists/types';
import type { LxSongInfo, MusicPlatform, MusicQuality, SearchResultSong } from '../music/types';
import {
  LX_LIST_IDS,
  type LxListData,
  type LxMappedPlaylist,
  type LxMusicInfo,
  type LxMusicInfoMeta,
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

export function formatInterval(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
  return `${mm}:${ss}`;
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
    lxListId: `lx:user:${id}`,
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
    lxListId: LX_LIST_IDS.love,
    kind: 'love',
    cover_url: firstCover(loveSongs),
    songs: loveSongs,
  });

  if (importDefaultList) {
    const defaultSongs = mapSongs(data.defaultList);
    playlists.push({
      name: '默认列表',
      lxListId: LX_LIST_IDS.default,
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
    id: playlist.lxListId,
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

export function isLxListData(value: unknown): value is LxListData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.defaultList) ||
    Array.isArray(record.loveList) ||
    Array.isArray(record.userList)
  );
}

function asMusicArray(value: unknown): LxMusicInfo[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object') as LxMusicInfo[];
}

function asUserListArray(value: unknown): LxUserListInfo[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, unknown>;
      const list = Array.isArray(row.list)
        ? (row.list as LxMusicInfo[])
        : Array.isArray(row.songs)
          ? (row.songs as LxMusicInfo[])
          : [];
      return {
        id: stringField(row.id) || stringField(row.name) || `user_${Math.random().toString(16).slice(2, 8)}`,
        name: stringField(row.name) || '未命名歌单',
        source: typeof row.source === 'string' ? row.source : undefined,
        sourceListId: (row.sourceListId as string | number | undefined) ?? undefined,
        locationUpdateTime: (row.locationUpdateTime as number | null | undefined) ?? null,
        list,
      };
    });
}

/**
 * Accept raw LX Music list JSON / backup envelopes and normalize to ListData.
 *
 * Supported shapes:
 * - `{ defaultList, loveList, userList }`
 * - `{ data: { defaultList, loveList, userList } }`
 * - `{ listData: ... }` / `{ allList: ... }`
 * - stringified JSON of the above
 */
export function parseLxListPayload(raw: unknown): LxListData {
  let value: unknown = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      throw new Error('empty payload');
    }
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new Error('invalid JSON');
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload must be a JSON object');
  }

  const root = value as Record<string, unknown>;
  const candidates: unknown[] = [
    root,
    root.data,
    root.listData,
    root.allList,
    root.list,
    root.playList,
    root.playlist,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (
      Array.isArray(record.defaultList) ||
      Array.isArray(record.loveList) ||
      Array.isArray(record.userList)
    ) {
      return {
        defaultList: asMusicArray(record.defaultList),
        loveList: asMusicArray(record.loveList),
        userList: asUserListArray(record.userList),
        ...(Array.isArray(record.tempList) ? { tempList: asMusicArray(record.tempList) } : {}),
      };
    }
  }

  throw new Error('未识别为洛雪歌单数据（需要 defaultList / loveList / userList）');
}

function songToLxMusic(song: CustomPlaylistSong, index: number): LxMusicInfo {
  const platform = song.source_data?.platform || 'kw';
  const info = (song.source_data?.songInfo || {}) as Record<string, unknown>;
  const id =
    stringishField(info.musicId) ||
    stringishField(info.songId) ||
    stringishField(info.hash) ||
    stringishField(info.songmid) ||
    stringishField(song.native_song_id) ||
    `starlight:${index}:${song.title}`;

  const meta: LxMusicInfoMeta = {
    songId: (info.musicId as string | number | undefined) || (info.songId as string | number | undefined) || id,
    albumName: song.album || stringField(info.album),
    picUrl: song.cover_url || null,
  };
  if (info.hash) meta.hash = String(info.hash);
  if (info.strMediaMid) meta.strMediaMid = String(info.strMediaMid);
  if (info.albumMid) meta.albumMid = String(info.albumMid);
  if (info.copyrightId) meta.copyrightId = String(info.copyrightId);
  if (info.lrcUrl) meta.lrcUrl = String(info.lrcUrl);
  if (info.mrcUrl) meta.mrcUrl = String(info.mrcUrl);
  if (info.trcUrl) meta.trcUrl = String(info.trcUrl);
  if (info.albumId !== undefined) meta.albumId = info.albumId as string | number;
  if (info.songmid) meta.songmid = info.songmid;
  if (info.mid) meta.mid = info.mid;

  return {
    id: String(id),
    name: song.title || '未知歌曲',
    singer: song.artist || '未知歌手',
    source: isOnlinePlatform(String(platform)) ? String(platform) : 'kw',
    interval: formatInterval(song.duration),
    meta,
  };
}

/**
 * Export Starlight custom playlists back to LX Music ListData.
 */
export function mapPlaylistsToListData(
  playlists: CustomPlaylist[],
  options: { playlistIds?: string[] } = {},
): LxListData {
  const filterIds = options.playlistIds?.map((id) => String(id)).filter(Boolean);
  const selected = filterIds?.length
    ? playlists.filter((playlist) => filterIds.includes(playlist.id))
    : playlists;

  const love: LxMusicInfo[] = [];
  const defaults: LxMusicInfo[] = [];
  const userList: LxUserListInfo[] = [];

  for (const playlist of selected) {
    const songs = (playlist.songs || []).map(songToLxMusic);
    const sourceListId = String(playlist.sourceListId || '');
    if (sourceListId === LX_LIST_IDS.love || playlist.name.trim() === '我喜欢') {
      love.push(...songs);
      continue;
    }
    if (sourceListId === LX_LIST_IDS.default || playlist.name.trim() === '默认列表') {
      defaults.push(...songs);
      continue;
    }
    const rawId = sourceListId.startsWith('lx:user:')
      ? sourceListId.slice('lx:user:'.length)
      : playlist.id;
    userList.push({
      id: rawId || playlist.id,
      name: playlist.name || '未命名歌单',
      locationUpdateTime: null,
      list: songs,
    });
  }

  return {
    defaultList: defaults,
    loveList: love,
    userList,
  };
}
