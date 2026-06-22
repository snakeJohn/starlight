import { fetchJson } from '../http';
import type { LeaderboardBoard, MusicPlatformProvider, SongListSummary } from '../types';
import { normalizeSong, normalizeSongListSummary, numberValue, stringValue } from '../types';
import type { SearchResultSong } from '../../types';

const BOARDS: Array<LeaderboardBoard & { bangid: string }> = [
  { id: 'tx__4', name: '流行指数榜', bangid: '4' },
  { id: 'tx__26', name: '热歌榜', bangid: '26' },
  { id: 'tx__27', name: '新歌榜', bangid: '27' },
  { id: 'tx__62', name: '飙升榜', bangid: '62' },
  { id: 'tx__5', name: '内地榜', bangid: '5' },
  { id: 'tx__3', name: '欧美榜', bangid: '3' },
];

function singerNames(value: any): string {
  return Array.isArray(value) ? value.map((item) => stringValue(item.name || item.title || item)).filter(Boolean).join('、') : stringValue(value);
}

function mapTxSong(item: any): SearchResultSong {
  const albumMid = stringValue(item.album?.mid || item.albumMid);
  return normalizeSong('tx', {
    name: item.name || item.title,
    singer: singerNames(item.singer),
    album: item.album?.name || item.albumName,
    duration: item.interval,
    img: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : '',
    musicId: item.id || item.songId,
    songmid: item.mid || item.songmid,
    strMediaMid: item.file?.media_mid || item.strMediaMid,
    albumMid,
    albumId: item.album?.id || item.albumId,
    types: [],
  });
}

function summarizeTxList(item: any): SongListSummary {
  const basic = item.basic || item;
  return normalizeSongListSummary({
    id: basic.tid || basic.dissid,
    name: basic.title || basic.dissname,
    img: basic.cover?.medium_url || basic.cover?.default_url || basic.imgurl || basic.cover_url_medium,
    play_count: basic.play_cnt || basic.listennum || basic.access_num,
    desc: basic.desc || basic.introduction,
  });
}

function musicuBody(req: Record<string, unknown>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' },
    body: JSON.stringify(req),
  };
}

export class QQMusicProvider implements MusicPlatformProvider {
  readonly id = 'tx';
  readonly name = 'QQ音乐';

  async search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }> {
    try {
      const body = await fetchJson<any>('https://u.y.qq.com/cgi-bin/musicu.fcg', musicuBody({
        comm: { ct: '11', cv: '14090508' },
        req: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicMobile',
          param: { search_type: 0, query: keyword, page_num: page, num_per_page: pageSize, highlight: 0 },
        },
      }));
      const data = body.req?.data || {};
      return {
        list: Array.isArray(data.body?.item_song) ? data.body.item_song.map(mapTxSong) : [],
        total: numberValue(data.meta?.estimate_sum),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const url = `http://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist?page_no=${page - 1}&num_per_page=${pageSize}&format=json&query=${encodeURIComponent(keyword)}&remoteplace=txt.yqq.playlist&inCharset=utf8&outCharset=utf-8`;
      const body = await fetchJson<any>(url, { headers: { Referer: 'http://y.qq.com/portal/search.html' } });
      return {
        list: Array.isArray(body.data?.list) ? body.data.list.map(summarizeTxList) : [],
        total: numberValue(body.data?.sum),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string; cover_url?: string }> {
    try {
      const listId = id.replace(/^.*(?:playlist\/|id=)(\d+).*$/, '$1');
      const url = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${encodeURIComponent(listId)}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`;
      const body = await fetchJson<any>(url, { headers: { Origin: 'https://y.qq.com', Referer: `https://y.qq.com/n/yqq/playsquare/${listId}.html` } });
      const cd = body.cdlist?.[0] || {};
      const rawSongs = Array.isArray(cd.songlist) ? cd.songlist.slice((page - 1) * pageSize, page * pageSize) : [];
      return {
        songs: rawSongs.map(mapTxSong),
        total: numberValue(cd.total_song_num || cd.songnum || cd.songlist?.length),
        name: stringValue(cd.dissname),
        cover_url: stringValue(cd.logo),
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }

  async recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const data = encodeURIComponent(JSON.stringify({
        comm: { cv: 1602, ct: 20 },
        playlist: {
          method: 'get_playlist_by_tag',
          param: { id: 10000000, sin: pageSize * (page - 1), size: pageSize, order: 5, cur_page: page },
          module: 'playlist.PlayListPlazaServer',
        },
      }));
      const body = await fetchJson<any>(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${data}`);
      const list = body.playlist?.data?.v_playlist || [];
      return { list: Array.isArray(list) ? list.map(summarizeTxList) : [], total: numberValue(body.playlist?.data?.total) };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async leaderboardBoards(): Promise<LeaderboardBoard[]> {
    return BOARDS.map(({ id, name }) => ({ id, name }));
  }

  async leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const topid = Number(BOARDS.find((board) => board.id === id)?.bangid || id.replace('tx__', ''));
      const body = await fetchJson<any>('https://u.y.qq.com/cgi-bin/musicu.fcg', musicuBody({
        toplist: { module: 'musicToplist.ToplistInfoServer', method: 'GetDetail', param: { topid, num: pageSize, offset: (page - 1) * pageSize } },
        comm: { uin: 0, format: 'json', ct: 20, cv: 1859 },
      }));
      const songs = body.toplist?.data?.songInfoList || [];
      return {
        songs: Array.isArray(songs) ? songs.map(mapTxSong) : [],
        total: numberValue(body.toplist?.data?.totalNum || songs.length),
        name: BOARDS.find((board) => Number(board.bangid) === topid)?.name || '',
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }
}
