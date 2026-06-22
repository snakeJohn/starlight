import type { MusicPlatform, SearchResultSong } from '../types';

export interface SongListSummary {
  id: string;
  name: string;
  cover_url: string;
  play_count: number;
  description: string;
}

export interface LeaderboardBoard {
  id: string;
  name: string;
}

export interface MusicPlatformProvider {
  id: 'kw' | 'kg' | 'tx' | 'wy' | 'mg';
  name: string;
  search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }>;
  songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }>;
  songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string; cover_url?: string }>;
  recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }>;
  leaderboardBoards(): Promise<LeaderboardBoard[]>;
  leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }>;
}

export interface RawSong {
  name?: unknown;
  singer?: unknown;
  album?: unknown;
  duration?: unknown;
  img?: unknown;
  musicId?: unknown;
  songmid?: unknown;
  hash?: unknown;
  copyrightId?: unknown;
  strMediaMid?: unknown;
  albumMid?: unknown;
  albumId?: unknown;
  types?: unknown;
}

export function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

export function numberValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeSong(platform: MusicPlatform, raw: RawSong): SearchResultSong {
  const name = stringValue(raw.name);
  const singer = stringValue(raw.singer);
  const album = stringValue(raw.album);
  const duration = numberValue(raw.duration);
  const musicId = stringValue(raw.musicId);
  const songmid = stringValue(raw.songmid || raw.musicId);

  return {
    title: name,
    artist: singer,
    album,
    duration,
    cover_url: stringValue(raw.img),
    source_data: {
      platform,
      quality: '320k',
      songInfo: {
        source: platform,
        name,
        singer,
        album,
        duration,
        musicId,
        songmid,
        hash: stringValue(raw.hash),
        copyrightId: stringValue(raw.copyrightId),
        strMediaMid: stringValue(raw.strMediaMid),
        albumMid: stringValue(raw.albumMid),
        albumId: stringValue(raw.albumId),
        types: Array.isArray(raw.types) ? raw.types : [],
      },
    },
  };
}

export function normalizeSongListSummary(raw: {
  id?: unknown;
  name?: unknown;
  cover_url?: unknown;
  img?: unknown;
  play_count?: unknown;
  description?: unknown;
  desc?: unknown;
}): SongListSummary {
  return {
    id: stringValue(raw.id),
    name: stringValue(raw.name),
    cover_url: stringValue(raw.cover_url || raw.img),
    play_count: numberValue(raw.play_count),
    description: stringValue(raw.description || raw.desc),
  };
}
