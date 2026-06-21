import { fetchJson } from '../http';
import type { LeaderboardBoard, MusicPlatformProvider, SongListSummary } from '../types';
import { normalizeSong, normalizeSongListSummary, numberValue, stringValue } from '../types';
import type { SearchResultSong } from '../../types';

const BOARDS: Array<LeaderboardBoard & { bangid: string }> = [
  { id: 'wy__19723756', name: '飙升榜', bangid: '19723756' },
  { id: 'wy__3779629', name: '新歌榜', bangid: '3779629' },
  { id: 'wy__2884035', name: '原创榜', bangid: '2884035' },
  { id: 'wy__3778678', name: '热歌榜', bangid: '3778678' },
  { id: 'wy__991319590', name: '说唱榜', bangid: '991319590' },
  { id: 'wy__1978921795', name: '电音榜', bangid: '1978921795' },
];

function form(data: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' },
    body: new URLSearchParams(Object.entries(data).map(([key, value]) => [key, String(value)])).toString(),
  };
}

function singerNames(value: any): string {
  return Array.isArray(value) ? value.map((item) => stringValue(item.name || item)).filter(Boolean).join('、') : stringValue(value);
}

function mapWySong(item: any): SearchResultSong {
  const song = item.baseInfo?.simpleSongData || item;
  return normalizeSong('wy', {
    name: song.name,
    singer: singerNames(song.ar || song.artists),
    album: song.al?.name || song.album?.name,
    duration: numberValue(song.dt || song.duration) / 1000,
    img: song.al?.picUrl || song.album?.picUrl,
    musicId: song.id,
    songmid: song.id,
    albumId: song.al?.id || song.album?.id,
    types: [],
  });
}

function summarizeWyList(item: any): SongListSummary {
  return normalizeSongListSummary({
    id: item.id,
    name: item.name,
    img: item.coverImgUrl,
    play_count: item.playCount,
    desc: item.description,
  });
}

export class NeteaseProvider implements MusicPlatformProvider {
  readonly id = 'wy';
  readonly name = '网易云音乐';

  async search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }> {
    try {
      const body = await fetchJson<any>('https://music.163.com/api/search/get/web', form({
        s: keyword,
        type: 1,
        offset: pageSize * (page - 1),
        limit: pageSize,
      }));
      return {
        list: Array.isArray(body.result?.songs) ? body.result.songs.map(mapWySong) : [],
        total: numberValue(body.result?.songCount),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const body = await fetchJson<any>('https://music.163.com/api/search/get/web', form({
        s: keyword,
        type: 1000,
        offset: pageSize * (page - 1),
        limit: pageSize,
      }));
      return {
        list: Array.isArray(body.result?.playlists) ? body.result.playlists.map(summarizeWyList) : [],
        total: numberValue(body.result?.playlistCount),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const listId = id.replace(/^.*(?:\?|&)id=(\d+).*$/, '$1');
      const body = await fetchJson<any>(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(listId)}&n=${pageSize}&s=8`);
      const tracks = Array.isArray(body.playlist?.tracks) ? body.playlist.tracks.slice((page - 1) * pageSize, page * pageSize) : [];
      return {
        songs: tracks.map(mapWySong),
        total: numberValue(body.playlist?.trackCount || body.playlist?.trackIds?.length),
        name: stringValue(body.playlist?.name),
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }

  async recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const body = await fetchJson<any>(`https://music.163.com/api/playlist/list?cat=%E5%85%A8%E9%83%A8&order=hot&offset=${pageSize * (page - 1)}&limit=${pageSize}`);
      return {
        list: Array.isArray(body.playlists) ? body.playlists.map(summarizeWyList) : [],
        total: numberValue(body.total),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async leaderboardBoards(): Promise<LeaderboardBoard[]> {
    return BOARDS.map(({ id, name }) => ({ id, name }));
  }

  async leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    const bangid = BOARDS.find((board) => board.id === id)?.bangid || id.replace('wy__', '');
    return this.songListDetail(bangid, page, pageSize).then((result) => ({
      ...result,
      name: BOARDS.find((board) => board.bangid === bangid)?.name || result.name,
    }));
  }
}
