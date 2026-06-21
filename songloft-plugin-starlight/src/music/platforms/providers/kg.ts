import { fetchJson, fetchText } from '../http';
import type { LeaderboardBoard, MusicPlatformProvider, SongListSummary } from '../types';
import { normalizeSong, normalizeSongListSummary, numberValue, stringValue } from '../types';
import type { SearchResultSong } from '../../types';

const BOARDS: Array<LeaderboardBoard & { bangid: string }> = [
  { id: 'kg__8888', name: 'TOP500', bangid: '8888' },
  { id: 'kg__6666', name: '飙升榜', bangid: '6666' },
  { id: 'kg__31308', name: '内地榜', bangid: '31308' },
  { id: 'kg__31310', name: '欧美榜', bangid: '31310' },
  { id: 'kg__33161', name: '古风新歌榜', bangid: '33161' },
];

function singerNames(value: any): string {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item.name || item.singername || item)).filter(Boolean).join('、');
  }
  return stringValue(value);
}

function mapKgSong(item: any): SearchResultSong {
  return normalizeSong('kg', {
    name: item.SongName || item.songname || item.name,
    singer: singerNames(item.Singers || item.singername || item.author_name),
    album: item.AlbumName || item.album_name || item.album,
    duration: item.Duration || numberValue(item.duration) / 1000,
    img: stringValue(item.Image || item.imgurl || item.img || item.album_img).replace('{size}', '400'),
    musicId: item.Audioid || item.audio_id,
    songmid: item.Audioid || item.audio_id,
    hash: item.FileHash || item.hash,
    albumId: item.AlbumID || item.album_id,
    types: [],
  });
}

function summarizeKgList(item: any): SongListSummary {
  return normalizeSongListSummary({
    id: item.specialid ? `id_${item.specialid}` : item.id,
    name: item.specialname || item.name,
    img: item.imgurl || item.img,
    play_count: item.playcount || item.play_count || item.total_play_count,
    desc: item.intro,
  });
}

export class KugouProvider implements MusicPlatformProvider {
  readonly id = 'kg';
  readonly name = '酷狗音乐';

  async search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }> {
    try {
      const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`;
      const body = await fetchJson<any>(url);
      const list = Array.isArray(body.data?.lists) ? body.data.lists : [];
      return { list: list.map(mapKgSong), total: numberValue(body.data?.total) };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const url = `http://msearchretry.kugou.com/api/v3/search/special?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}&showtype=10&filter=0&version=7910&sver=2`;
      const body = await fetchJson<any>(url);
      return {
        list: Array.isArray(body.data?.info) ? body.data.info.map(summarizeKgList) : [],
        total: numberValue(body.data?.total),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const specialId = id.replace(/^id_/, '').replace(/^.*\/(\d+)\.html.*$/, '$1');
      const url = `http://www2.kugou.kugou.com/yueku/v9/special/single/${encodeURIComponent(specialId)}-5-${pageSize}.html`;
      const html = await fetchText(url);
      const listMatch = html.match(/global\.data = (\[.+?\]);/);
      const infoMatch = html.match(/global = {[\s\S]+?name: "(.+?)"[\s\S]+?pic: "(.+?)"[\s\S]+?};/);
      const rawList = listMatch ? JSON.parse(listMatch[1]) : [];
      return {
        songs: Array.isArray(rawList) ? rawList.slice((page - 1) * pageSize, page * pageSize).map(mapKgSong) : [],
        total: Array.isArray(rawList) ? rawList.length : 0,
        name: infoMatch?.[1] || '',
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }

  async recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const url = `http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_ajax=1&cdn=cdn&t=5&c=&p=${page}`;
      const body = await fetchJson<any>(url);
      const list = Array.isArray(body.special_db) ? body.special_db.slice(0, pageSize) : [];
      return { list: list.map(summarizeKgList), total: numberValue(body.total || list.length) };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async leaderboardBoards(): Promise<LeaderboardBoard[]> {
    return BOARDS.map(({ id, name }) => ({ id, name }));
  }

  async leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const rankid = BOARDS.find((board) => board.id === id)?.bangid || id.replace('kg__', '');
      const url = `https://gateway.kugou.com/rank/info/?rankid=${encodeURIComponent(rankid)}&page=${page}&pagesize=${pageSize}&json=true`;
      const body = await fetchJson<any>(url);
      const list = Array.isArray(body.songs?.list) ? body.songs.list : Array.isArray(body.data?.info) ? body.data.info : [];
      return {
        songs: list.map(mapKgSong),
        total: numberValue(body.songs?.total || body.data?.total || list.length),
        name: BOARDS.find((board) => board.bangid === rankid)?.name || '',
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }
}
