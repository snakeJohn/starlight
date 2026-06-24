import { fetchJson, fetchResolvedUrl, fetchResponse } from '../http';
import type { LeaderboardBoard, MusicPlatformProvider, SongListSummary } from '../types';
import { normalizeSong, normalizeSongListSummary, numberValue, stringValue } from '../types';
import type { SearchResultSong } from '../../types';
import { md5 as md5Hash } from '../../../utils/crypto';

const BOARDS: Array<LeaderboardBoard & { bangid: string }> = [
  { id: 'mg__27553319', name: '新歌榜', bangid: '27553319' },
  { id: 'mg__27186466', name: '热歌榜', bangid: '27186466' },
  { id: 'mg__27553408', name: '原创榜', bangid: '27553408' },
  { id: 'mg__75959118', name: '音乐风向榜', bangid: '75959118' },
  { id: 'mg__23189800', name: '港台榜', bangid: '23189800' },
  { id: 'mg__23189399', name: '内地榜', bangid: '23189399' },
];

function createSignature(time: string, keyword: string): { sign: string; deviceId: string } {
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const signatureMd5 = '6cdc72a439cef99a3418d2a78aa28c73';
  return {
    sign: md5Hash(`${keyword}${signatureMd5}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`),
    deviceId,
  };
}

function headers(keyword = ''): HeadersInit {
  const time = Date.now().toString();
  const signature = createSignature(time, keyword);
  return {
    uiVersion: 'A_music_3.6.1',
    deviceId: signature.deviceId,
    timestamp: time,
    sign: signature.sign,
    channel: '0146921',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
  };
}

function playlistHeaders(): HeadersInit {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    Referer: 'https://m.music.migu.cn/',
  };
}

function singerNames(value: any): string {
  return Array.isArray(value) ? value.map((item) => stringValue(item.name || item.singerName || item)).filter(Boolean).join('、') : stringValue(value);
}

function mapMgSong(item: any): SearchResultSong {
  const img = stringValue(item.img3 || item.img2 || item.img1 || item.img || item.albumImgs?.[0]?.img);
  return normalizeSong('mg', {
    name: item.name || item.songName,
    singer: singerNames(item.singerList || item.singers || item.singer),
    album: item.album || item.albumName,
    duration: item.duration,
    img: img && !/^https?:/.test(img) ? `http://d.musicapp.migu.cn${img}` : img,
    musicId: item.songId || item.id,
    songmid: item.songId || item.id,
    copyrightId: item.copyrightId,
    albumId: item.albumId,
    lrcUrl: item.lrcUrl,
    mrcUrl: item.mrcUrl,
    trcUrl: item.trcUrl,
    types: [],
  });
}

function summarizeMgList(item: any): SongListSummary {
  return normalizeSongListSummary({
    id: item.id || item.resId || item.logEvent?.contentId || item.playlistId,
    name: item.name || item.title || item.txt,
    img: item.musicListPicUrl || item.imageUrl || item.img,
    play_count: item.playNum || item.barList?.[0]?.title,
    desc: item.summary || item.txt2 || item.desc,
  });
}

function parseMiguPlaylistId(value: string): string {
  const text = stringValue(value);
  const queryMatch = text.match(/(?:\?|&)(?:playlistId|id)=(\d+)/);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }
  const pathMatch = text.match(/\/playlist\/(\d+)(?:[/?#]|$)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }
  return /^\d+$/.test(text) ? text : '';
}

async function resolveMiguPlaylistId(value: string): Promise<string> {
  const direct = parseMiguPlaylistId(value);
  if (direct) {
    return direct;
  }
  if (/^https?:\/\//.test(value)) {
    try {
      const response = await fetchResponse(value, {
        headers: {
          ...playlistHeaders(),
          'X-Fetch-No-Redirect': '1',
        },
      });
      const resolved = parseMiguPlaylistId(response.headers.get('location') || '') || parseMiguPlaylistId(response.url);
      if (resolved) {
        return resolved;
      }
    } catch {
      // Fall through to runtime variants that ignore the custom redirect header.
    }
    try {
      const response = await fetchResponse(value, {
        headers: playlistHeaders(),
        redirect: 'manual',
      });
      const resolved = parseMiguPlaylistId(response.headers.get('location') || '') || parseMiguPlaylistId(response.url);
      if (resolved) {
        return resolved;
      }
    } catch {
      // Fall through to the default redirect-following path.
    }
    return parseMiguPlaylistId(await fetchResolvedUrl(value, { headers: playlistHeaders() }));
  }
  return '';
}

async function loadMiguPlaylistInfo(listId: string): Promise<{ name: string; cover_url: string }> {
  try {
    const body = await fetchJson<any>(`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${encodeURIComponent(listId)}`, {
      headers: playlistHeaders(),
    });
    return {
      name: stringValue(body.data?.title || body.data?.name),
      cover_url: stringValue(body.data?.imgItem?.img || body.data?.musicListPicUrl || body.data?.imageUrl || body.data?.img),
    };
  } catch {
    return { name: '', cover_url: '' };
  }
}

export class MiguProvider implements MusicPlatformProvider {
  readonly id = 'mg';
  readonly name = '咪咕音乐';

  async search(keyword: string, page: number, pageSize: number): Promise<{ list: SearchResultSong[]; total: number }> {
    try {
      const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${pageSize}&text=${encodeURIComponent(keyword)}&pageNo=${page}&sort=0&sid=USS`;
      const body = await fetchJson<any>(url, { headers: headers(keyword) });
      const raw = Array.isArray(body.songResultData?.resultList) ? body.songResultData.resultList.flat() : [];
      return {
        list: raw.map(mapMgSong),
        total: numberValue(body.songResultData?.totalCount),
      };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListSearch(keyword: string, page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=1&isCopyright=1&searchSwitch=%7B%22song%22%3A0%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A0%2C%22mvSong%22%3A0%2C%22bestShow%22%3A0%2C%22songlist%22%3A1%2C%22lyricSong%22%3A0%7D&pageSize=${pageSize}&text=${encodeURIComponent(keyword)}&pageNo=${page}&sort=0&sid=USS`;
      const body = await fetchJson<any>(url, { headers: headers(keyword) });
      const list = Array.isArray(body.songListResultData?.result) ? body.songListResultData.result : [];
      return { list: list.map(summarizeMgList), total: numberValue(body.songListResultData?.totalCount) };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async songListDetail(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string; cover_url?: string }> {
    try {
      const listId = await resolveMiguPlaylistId(id);
      if (!listId) {
        throw new Error('migu playlist id resolve failed');
      }
      const songsBody = await fetchJson<any>(`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${encodeURIComponent(listId)}`, {
        headers: playlistHeaders(),
      });
      const info = await loadMiguPlaylistInfo(listId);
      return {
        songs: Array.isArray(songsBody.data?.songList) ? songsBody.data.songList.map(mapMgSong) : [],
        total: numberValue(songsBody.data?.totalCount),
        name: info.name || stringValue(songsBody.data?.title || songsBody.data?.name),
        cover_url: info.cover_url,
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }

  async recommendedSongLists(page: number, pageSize: number): Promise<{ list: SongListSummary[]; total: number }> {
    try {
      const body = await fetchJson<any>(`https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`, {
        headers: headers(),
      });
      const raw = body.data?.contents || body.data?.contentItemList?.[1]?.itemList || [];
      const list = Array.isArray(raw) ? raw.flatMap((item: any) => (Array.isArray(item.contents) ? item.contents : item)) : [];
      return { list: list.slice(0, pageSize).map(summarizeMgList), total: numberValue(body.data?.totalCount || list.length) };
    } catch {
      return { list: [], total: 0 };
    }
  }

  async leaderboardBoards(): Promise<LeaderboardBoard[]> {
    return BOARDS.map(({ id, name }) => ({ id, name }));
  }

  async leaderboardList(id: string, page: number, pageSize: number): Promise<{ songs: SearchResultSong[]; total: number; name: string }> {
    try {
      const columnId = BOARDS.find((board) => board.id === id)?.bangid || id.replace('mg__', '');
      const body = await fetchJson<any>(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=${encodeURIComponent(columnId)}&needAll=0`, {
        headers: headers(),
      });
      const contents = Array.isArray(body.columnInfo?.contents) ? body.columnInfo.contents : [];
      const songs = contents.slice((page - 1) * pageSize, page * pageSize).map((item: any) => mapMgSong(item.objectInfo || item));
      return {
        songs,
        total: contents.length,
        name: BOARDS.find((board) => board.bangid === columnId)?.name || stringValue(body.columnInfo?.columnTitle),
      };
    } catch {
      return { songs: [], total: 0, name: '' };
    }
  }
}
