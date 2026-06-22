import { fetchJson, fetchText } from '../http';
import type { LeaderboardBoard, MusicPlatformProvider, SongListSummary } from '../types';
import { normalizeSong, normalizeSongListSummary, numberValue, stringValue } from '../types';
import type { SearchResultSong } from '../../types';
import { md5 as md5Hash } from '../../../utils/crypto';

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

function kgAuthorNames(value: any): string {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item.author_name || item.name || item.singername || item)).filter(Boolean).join('、');
  }
  return stringValue(value);
}

function kgImage(item: any): string {
  return stringValue(
    item.Image
    || item.imgurl
    || item.img
    || item.image
    || item.cover
    || item.album_img
    || item.album_sizable_cover
    || item.trans_param?.union_cover,
  ).replace('{size}', '400');
}

function sizeLabel(bytes: unknown): string {
  const value = numberValue(bytes);
  if (value <= 0) return '';
  const mb = value / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)}MB`;
}

function kgTypes(item: any): Array<{ type: string; size?: string; hash?: string }> {
  const types: Array<{ type: string; size?: string; hash?: string }> = [];
  if (numberValue(item.filesize) > 0) types.push({ type: '128k', size: sizeLabel(item.filesize), hash: stringValue(item.hash) });
  if (numberValue(item['320filesize'] || item.filesize_320) > 0) {
    types.push({ type: '320k', size: sizeLabel(item['320filesize'] || item.filesize_320), hash: stringValue(item['320hash'] || item.hash_320) });
  }
  if (numberValue(item.sqfilesize || item.filesize_flac) > 0) {
    types.push({ type: 'flac', size: sizeLabel(item.sqfilesize || item.filesize_flac), hash: stringValue(item.sqhash || item.hash_flac) });
  }
  if (numberValue(item.filesize_high) > 0) types.push({ type: 'flac24bit', size: sizeLabel(item.filesize_high), hash: stringValue(item.hash_high) });
  return types;
}

function kgDuration(item: any): number {
  const duration = item.Duration ?? item.duration;
  const value = numberValue(duration);
  return value > 10000 ? Math.round(value / 1000) : value;
}

function kgFilenameParts(value: unknown): { singer: string; name: string } {
  const filename = stringValue(value);
  const match = filename.match(/^\s*(.+?)\s+-\s+(.+?)\s*$/);
  return {
    singer: match?.[1] || '',
    name: match?.[2] || filename,
  };
}

function mapKgSong(item: any): SearchResultSong {
  const filename = kgFilenameParts(item.filename);
  return normalizeSong('kg', {
    name: item.SongName || item.songname || item.name || filename.name,
    singer: singerNames(item.Singers || item.singername || item.author_name) || kgAuthorNames(item.authors) || filename.singer,
    album: item.AlbumName || item.album_name || item.album || item.remark,
    duration: kgDuration(item),
    img: kgImage(item),
    musicId: item.Audioid || item.audio_id,
    songmid: item.Audioid || item.audio_id,
    hash: item.FileHash || item.hash,
    albumId: item.AlbumID || item.album_id,
    types: kgTypes(item),
  });
}

function kgSignature(params: string, platform = 'android', body = ''): string {
  const key = platform === 'web' ? 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt' : 'OIlwieks28dk2k092lksi2UIkp';
  return md5Hash(`${key}${params.split('&').sort().join('')}${body}${key}`);
}

function kgGcid(value: string): string {
  return value.match(/gcid_\w+/)?.[0] || '';
}

async function decodeKgGcid(gcid: string): Promise<string> {
  const params = 'dfid=-&appid=1005&mid=0&clientver=20109&clienttime=640612895&uuid=-';
  const payload = { ret_info: 1, data: [{ id: gcid, id_type: 2 }] };
  const body = JSON.stringify(payload);
  const result = await fetchJson<any>(`https://t.kugou.com/v1/songlist/batch_decode?${params}&signature=${kgSignature(params, 'android', body)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0 Mobile Safari/537.36',
      Referer: 'https://m.kugou.com/',
    },
    body,
  });
  return stringValue(result.list?.[0]?.global_collection_id || result.data?.list?.[0]?.global_collection_id);
}

async function loadKgGlobalInfo(globalId: string): Promise<any> {
  const params = `appid=1058&specialid=0&global_specialid=${globalId}&format=jsonp&srcappid=2919&clientver=20000&clienttime=1586163242519&mid=1586163242519&uuid=1586163242519&dfid=-`;
  const result = await fetchJson<any>(`https://mobiles.kugou.com/api/v5/special/info_v2?${params}&signature=${kgSignature(params, 'web')}`, {
    headers: {
      mid: '1586163242519',
      Referer: 'https://m3ws.kugou.com/share/index.php',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      dfid: '-',
      clienttime: '1586163242519',
    },
  });
  return result.data || result;
}

async function loadKgGlobalSongs(globalId: string, page: number, pageSize: number): Promise<any[]> {
  const params = `appid=1058&global_specialid=${globalId}&specialid=0&plat=0&version=8000&page=${page}&pagesize=${pageSize}&srcappid=2919&clientver=20000&clienttime=1586163263991&mid=1586163263991&uuid=1586163263991&dfid=-`;
  const result = await fetchJson<any>(`https://mobiles.kugou.com/api/v5/special/song_v2?${params}&signature=${kgSignature(params, 'web')}`, {
    headers: {
      mid: '1586163263991',
      Referer: 'https://m3ws.kugou.com/share/index.php',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
      dfid: '-',
      clienttime: '1586163263991',
    },
  });
  return Array.isArray(result.info) ? result.info : Array.isArray(result.data?.info) ? result.data.info : [];
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

  async songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string; cover_url?: string }> {
    try {
      const gcid = kgGcid(id);
      if (gcid) {
        const globalId = await decodeKgGcid(gcid);
        const [info, songs] = await Promise.all([
          loadKgGlobalInfo(globalId),
          loadKgGlobalSongs(globalId, page, pageSize),
        ]);
        return {
          songs: songs.map(mapKgSong),
          total: numberValue(info.songcount || info.total || songs.length),
          name: stringValue(info.specialname || info.name),
          cover_url: kgImage(info),
        };
      }
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
      const url = `http://mobilecdnbj.kugou.com/api/v3/rank/song?version=9108&ranktype=1&plat=0&pagesize=${pageSize}&area_code=1&page=${page}&rankid=${encodeURIComponent(rankid)}&with_res_tag=0&show_portrait_mv=1`;
      const body = await fetchJson<any>(url);
      const list = Array.isArray(body.data?.info) ? body.data.info : Array.isArray(body.songs?.list) ? body.songs.list : [];
      return {
        songs: list.map(mapKgSong),
        total: numberValue(body.data?.total || body.songs?.total || list.length),
        name: BOARDS.find((board) => board.bangid === rankid)?.name || '',
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }
}
