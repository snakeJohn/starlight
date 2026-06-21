import { fetchJson, fetchText } from '../http';
import type { LeaderboardBoard, MusicPlatformProvider, SongListSummary } from '../types';
import { normalizeSong, normalizeSongListSummary, numberValue, stringValue } from '../types';
import type { SearchResultSong } from '../../types';

const BOARDS: Array<LeaderboardBoard & { bangid: string }> = [
  { id: 'kw__93', name: '飙升榜', bangid: '93' },
  { id: 'kw__17', name: '新歌榜', bangid: '17' },
  { id: 'kw__16', name: '热歌榜', bangid: '16' },
  { id: 'kw__158', name: '抖音热歌榜', bangid: '158' },
  { id: 'kw__104', name: '华语榜', bangid: '104' },
  { id: 'kw__22', name: '欧美榜', bangid: '22' },
];

function decodeHtml(value: unknown): string {
  return stringValue(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseKuwoTextJson(text: string): any {
  const normalized = text.replace(/'/g, '"').replace(/([{,])\s*([A-Za-z_][\w]*)\s*:/g, '$1"$2":');
  return JSON.parse(normalized);
}

function mapKwSong(item: any): SearchResultSong {
  const musicRid = stringValue(item.MUSICRID || item.rid || item.id).replace(/^MUSIC_/, '');
  const cover = item.pic || item.albumpic || item.prob_albumpic || (item.web_albumpic_short ? `https://img4.kuwo.cn/star/albumcover/1000${item.web_albumpic_short}` : '');
  return normalizeSong('kw', {
    name: decodeHtml(item.SONGNAME || item.name),
    singer: decodeHtml(item.ARTIST || item.artist),
    album: decodeHtml(item.ALBUM || item.album),
    duration: item.DURATION || item.duration,
    img: cover,
    musicId: musicRid,
    songmid: musicRid,
    albumId: item.ALBUMID || item.albumid,
    types: [],
  });
}

function summarizeKwList(item: any): SongListSummary {
  return normalizeSongListSummary({
    id: item.playlistid || item.id,
    name: decodeHtml(item.name),
    img: item.pic || item.img,
    play_count: item.playcnt || item.listencnt,
    desc: decodeHtml(item.intro || item.desc),
  });
}

export class KuwoProvider implements MusicPlatformProvider {
  readonly id = 'kw';
  readonly name = '酷我音乐';

  async search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }> {
    try {
      const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${pageSize}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
      const body = await fetchJson<any>(url);
      return {
        list: Array.isArray(body.abslist) ? body.abslist.map(mapKwSong) : [],
        total: numberValue(body.TOTAL),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&pn=${page - 1}&rn=${pageSize}&rformat=json&encoding=utf8&ver=mbox&vipver=MUSIC_8.7.7.0_BCS37&plat=pc&devid=28156413&ft=playlist&pay=0&needliveshow=0`;
      const text = await fetchText(url);
      const body = parseKuwoTextJson(text);
      return {
        list: Array.isArray(body.abslist) ? body.abslist.map(summarizeKwList) : [],
        total: numberValue(body.TOTAL),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const listId = id.startsWith('digest-') ? id.split('__')[1] : id.replace(/^.*\/playlist(?:_detail)?\/(\d+).*$/, '$1');
      const url = `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encodeURIComponent(listId)}&pn=${page - 1}&rn=${pageSize}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`;
      const body = await fetchJson<any>(url);
      return {
        songs: Array.isArray(body.musiclist) ? body.musiclist.map(mapKwSong) : [],
        total: numberValue(body.total),
        name: stringValue(body.title),
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }

  async recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const url = `http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&rn=${pageSize}&order=hot`;
      const body = await fetchJson<any>(url);
      const data = body.data || {};
      return {
        list: Array.isArray(data.data) ? data.data.map(summarizeKwList) : [],
        total: numberValue(data.total),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async leaderboardBoards(): Promise<LeaderboardBoard[]> {
    return BOARDS.map(({ id, name }) => ({ id, name }));
  }

  async leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const bangid = BOARDS.find((board) => board.id === id)?.bangid || id.replace('kw__', '');
      const url = `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${page - 1}&rn=${pageSize}&type=bang&data=content&id=${encodeURIComponent(bangid)}&show_copyright_off=0&pcmp4=1&isbang=1`;
      const body = await fetchJson<any>(url);
      const songs = Array.isArray(body.musiclist) ? body.musiclist : Array.isArray(body.list) ? body.list : [];
      return {
        songs: songs.map(mapKwSong),
        total: numberValue(body.num || body.total || songs.length),
        name: BOARDS.find((board) => board.bangid === bangid)?.name || '',
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }
}
