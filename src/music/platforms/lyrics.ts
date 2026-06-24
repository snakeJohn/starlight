import { fetchJson, fetchText } from './http';
import type { LxSongInfo, MusicPlatform } from '../types';
import { stringValue } from './types';
import { neteaseEapiRequest } from './netease_eapi';

export interface MusicLyricResult {
  lyric: string;
  tlyric?: string;
  rlyric?: string;
  lxlyric?: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code) || 0))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function base64ToUtf8(value: string): string {
  if (!value) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8');
  }
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }
  return value;
}

function lyricResult(lyric = '', tlyric = '', rlyric = '', lxlyric = ''): MusicLyricResult {
  return { lyric, tlyric, rlyric, lxlyric };
}

function requireSongField(songInfo: LxSongInfo, key: keyof LxSongInfo, message: string): string {
  const value = stringValue(songInfo[key]);
  if (!value) {
    throw new Error(message);
  }
  return value;
}

async function resolveTxLyric(songInfo: LxSongInfo): Promise<MusicLyricResult> {
  const songmid = requireSongField(songInfo, 'songmid', 'QQ 音乐缺少 songmid');
  const body = await fetchJson<any>(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`, {
    headers: {
      Referer: 'https://y.qq.com/portal/player.html',
    },
  });
  const lyric = decodeHtml(base64ToUtf8(stringValue(body.lyric)));
  if (!lyric) {
    throw new Error('QQ 音乐歌词获取失败');
  }
  return lyricResult(
    lyric,
    decodeHtml(base64ToUtf8(stringValue(body.trans))),
  );
}

function fixNeteaseTimeLabel(value: string): string {
  return value.replace(/\[(\d{2}:\d{2}):(\d{2,3})]/g, (_match, mmss, sub) => `[${mmss}.${sub}]`);
}

async function resolveWyLyric(songInfo: LxSongInfo): Promise<MusicLyricResult> {
  const songId = requireSongField(songInfo, 'songmid', '网易云音乐缺少 songmid');
  const body = await neteaseEapiRequest<any>('/api/song/lyric/v1', {
    id: songId,
    cp: false,
    tv: 0,
    lv: 0,
    rv: 0,
    kv: 0,
    yv: 0,
    ytv: 0,
    yrv: 0,
  });
  const lyric = fixNeteaseTimeLabel(stringValue(body.lrc?.lyric));
  if (!lyric) {
    throw new Error('网易云音乐歌词获取失败');
  }
  return lyricResult(
    lyric,
    fixNeteaseTimeLabel(stringValue(body.tlyric?.lyric)),
    fixNeteaseTimeLabel(stringValue(body.romalrc?.lyric)),
  );
}

function kuwoTimeLabel(value: number): string {
  const total = Number.isFinite(value) ? value : 0;
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, '0');
  return `${String(minutes).padStart(2, '0')}:${seconds}`;
}

function normalizeKuwoGroups(rawList: any[]): Array<{ time: number; lyric: string; translation: string }> {
  const groups: Array<{ time: number; lyric: string; translation: string }> = [];
  const groupMap = new Map<string, { time: number; lyric: string; translation: string }>();
  for (const item of rawList) {
    const time = Number(item?.time ?? item?.t ?? 0);
    const lineLyric = stringValue(item?.lineLyric || item?.line || item?.text);
    if (!lineLyric) continue;
    const key = time.toFixed(2);
    const existing = groupMap.get(key);
    if (!existing) {
      const group = { time, lyric: lineLyric, translation: '' };
      groupMap.set(key, group);
      groups.push(group);
      continue;
    }
    if (!existing.translation) {
      existing.translation = lineLyric;
    }
  }
  return groups;
}

function renderKuwoLrc(tags: string[], entries: Array<{ time: number; text: string }>): string {
  const head = tags.join('\n');
  const body = entries.map((entry) => `[${kuwoTimeLabel(entry.time)}]${entry.text}`).join('\n');
  return `${head}\n${body}`.trim();
}

async function resolveKwLyric(songInfo: LxSongInfo): Promise<MusicLyricResult> {
  const songmid = requireSongField(songInfo, 'songmid', '酷我音乐缺少 songmid');
  const body = await fetchJson<any>(`http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(songmid)}`);
  const info = body.data?.songinfo || {};
  const groups = normalizeKuwoGroups(Array.isArray(body.data?.lrclist) ? body.data.lrclist : []);
  if (!groups.length) {
    throw new Error('酷我音乐歌词获取失败');
  }
  const tags = [
    `[ti:${stringValue(info.songName || songInfo.name)}]`,
    `[ar:${stringValue(info.artist || songInfo.singer)}]`,
    `[al:${stringValue(info.album || songInfo.album)}]`,
    '[by:]',
    '[offset:0]',
  ];
  return lyricResult(
    renderKuwoLrc(tags, groups.map((entry) => ({ time: entry.time, text: entry.lyric }))),
    groups.some((entry) => entry.translation)
      ? renderKuwoLrc(tags, groups.filter((entry) => entry.translation).map((entry) => ({ time: entry.time, text: entry.translation })))
      : '',
  );
}

function kugouHeaders(): HeadersInit {
  return {
    'KG-RC': '1',
    'KG-THash': 'expand_search_manager.cpp:852736169:451',
    'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
  };
}

async function resolveKgLyric(songInfo: LxSongInfo): Promise<MusicLyricResult> {
  const name = requireSongField(songInfo, 'name', '酷狗音乐缺少歌曲名');
  const hash = requireSongField(songInfo, 'hash', '酷狗音乐缺少 hash');
  const duration = Math.max(0, Math.round(Number(songInfo.duration) || 0));
  const search = await fetchJson<any>(`http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(name)}&hash=${encodeURIComponent(hash)}&timelength=${duration}&lrctxt=1`, {
    headers: kugouHeaders(),
  });
  const candidate = search.candidates?.[0];
  if (!candidate?.id || !candidate?.accesskey) {
    throw new Error('酷狗音乐歌词获取失败');
  }
  const body = await fetchJson<any>(`http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`, {
    headers: kugouHeaders(),
  });
  const lyric = base64ToUtf8(stringValue(body.content));
  if (!lyric) {
    throw new Error('酷狗音乐歌词获取失败');
  }
  return lyricResult(lyric);
}

type MiguLyricInfo = LxSongInfo & {
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
};

function miguHeaders(): HeadersInit {
  return {
    Referer: 'https://app.c.nf.migu.cn/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36',
    channel: '0146921',
  };
}

function miguLongToBytes(value: bigint): Buffer {
  const result = Buffer.alloc(8);
  let current = value;
  for (let index = 0; index < 8; index += 1) {
    result[index] = Number(current & 0xFFn);
    current >>= 8n;
  }
  return result;
}

const MRC_DELTA = 2654435769n;
const MRC_KEY = [
  27303562373562475n,
  18014862372307051n,
  22799692160172081n,
  34058940340699235n,
  30962724186095721n,
  27303523720101991n,
  27303523720101998n,
  31244139033526382n,
  28992395054481524n,
];
const MRC_MAX = 9223372036854775807n;
const MRC_MIN = -9223372036854775808n;

function miguSignedLong(value: bigint): bigint {
  if (value > MRC_MAX) return miguSignedLong(value - (1n << 64n));
  if (value < MRC_MIN) return miguSignedLong(value + (1n << 64n));
  return value;
}

function miguBigintArray(data: string): bigint[] {
  const length = Math.floor(data.length / 16);
  const result: bigint[] = [];
  for (let index = 0; index < length; index += 1) {
    result.push(miguSignedLong(BigInt(`0x${data.substring(index * 16, index * 16 + 16)}`)));
  }
  return result;
}

function miguTeaDecrypt(data: bigint[], key: bigint[]): bigint[] {
  const length = data.length;
  const lengthBigint = BigInt(length);
  if (length < 1) return data;
  let previous = data[0];
  let sum = miguSignedLong((6n + (52n / lengthBigint)) * MRC_DELTA);
  while (sum !== 0n) {
    const offset = miguSignedLong(3n & miguSignedLong(sum >> 2n));
    let cursor = lengthBigint;
    while (true) {
      cursor -= 1n;
      if (cursor <= 0n) break;
      const left = data[Number(cursor - 1n)];
      const currentIndex = Number(cursor);
      previous = miguSignedLong(data[currentIndex] - (
        miguSignedLong(miguSignedLong(previous ^ sum) + miguSignedLong(left ^ key[Number(miguSignedLong(miguSignedLong(3n & cursor) ^ offset))]))
          ^ miguSignedLong(miguSignedLong(miguSignedLong(left >> 5n) ^ miguSignedLong(previous << 2n)) + miguSignedLong(miguSignedLong(previous >> 3n) ^ miguSignedLong(left << 4n)))
      ));
      data[currentIndex] = previous;
    }
    const tail = data[length - 1];
    previous = miguSignedLong(data[0] - miguSignedLong(
      miguSignedLong(miguSignedLong(key[Number(miguSignedLong(offset))] ^ tail) + miguSignedLong(previous ^ sum))
        ^ miguSignedLong(miguSignedLong(miguSignedLong(tail >> 5n) ^ miguSignedLong(previous << 2n)) + miguSignedLong(miguSignedLong(previous >> 3n) ^ miguSignedLong(tail << 4n))),
    ));
    data[0] = previous;
    sum = miguSignedLong(sum - MRC_DELTA);
  }
  return data;
}

function decryptMiguMrc(data: string): string {
  if (!data || data.length < 32) return data;
  return miguTeaDecrypt(miguBigintArray(data), MRC_KEY)
    .map((item) => miguLongToBytes(item).toString('utf16le'))
    .join('');
}

function parseMiguMrc(value: string): MusicLyricResult {
  const lines = value.replace(/\r/g, '').split('\n');
  const lyricLines: string[] = [];
  const lxLyricLines: string[] = [];
  for (const line of lines) {
    const match = /^\s*\[(\d+),\d+\](.*)$/.exec(line);
    if (!match) continue;
    const startTime = Number(match[1]);
    const minute = String(Math.floor(startTime / 1000 / 60)).padStart(2, '0');
    const second = String(Math.floor((startTime / 1000) % 60)).padStart(2, '0');
    const millisecond = String(startTime % 1000);
    const timeLabel = `[${minute}:${second}.${millisecond}]`;
    const words = match[2];
    lyricLines.push(`${timeLabel}${words.replace(/(\(\d+,\d+\))/g, '')}`);

    const tags = [...words.matchAll(/\((\d+),(\d+)\)/g)];
    if (!tags.length) continue;
    const segments = words.split(/\(\d+,\d+\)/g);
    const lxLine = tags.map((tag, index) => {
      const offset = Math.max(Number(tag[1]) - startTime, 0);
      return `<${offset},${tag[2]}>${segments[index + 1] || ''}`;
    }).join('');
    lxLyricLines.push(`${timeLabel}${lxLine}`);
  }
  return lyricResult(lyricLines.join('\n'), '', '', lxLyricLines.join('\n'));
}

async function loadMiguLyricInfo(songInfo: LxSongInfo): Promise<MiguLyricInfo> {
  if (stringValue(songInfo.mrcUrl) || stringValue(songInfo.lrcUrl)) {
    return songInfo as MiguLyricInfo;
  }
  const copyrightId = requireSongField(songInfo, 'copyrightId', '咪咕音乐缺少 copyrightId');
  const body = await fetchJson<any>('https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2', {
    method: 'POST',
    headers: {
      ...miguHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ resourceId: copyrightId }).toString(),
  });
  const info = Array.isArray(body.resource) ? body.resource[0] : Array.isArray(body.data?.resource) ? body.data.resource[0] : null;
  if (!info) {
    throw new Error('咪咕音乐歌词获取失败');
  }
  return {
    ...songInfo,
    lrcUrl: stringValue(info.lrcUrl),
    mrcUrl: stringValue(info.mrcUrl),
    trcUrl: stringValue(info.trcUrl),
  };
}

function normalizeMiguLrc(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/^\[(\d+):(\d+)\.(\d+)]/m.test(trimmed)) {
    return trimmed;
  }
  let currentTime = 0;
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('@'))
    .map((line) => {
      const minutes = String(Math.floor(currentTime / 60)).padStart(2, '0');
      const seconds = String(currentTime % 60).padStart(2, '0');
      currentTime += 3;
      return `[${minutes}:${seconds}.00]${line}`;
    })
    .join('\n');
}

async function resolveMgLyric(songInfo: LxSongInfo): Promise<MusicLyricResult> {
  const lyricInfo = await loadMiguLyricInfo(songInfo);
  let result: MusicLyricResult | null = null;
  if (lyricInfo.mrcUrl) {
    const text = await fetchText(lyricInfo.mrcUrl, { headers: miguHeaders() });
    result = parseMiguMrc(decryptMiguMrc(text));
  } else if (lyricInfo.lrcUrl) {
    result = lyricResult(normalizeMiguLrc(await fetchText(lyricInfo.lrcUrl, { headers: miguHeaders() })));
  }
  if (!result?.lyric) {
    throw new Error('咪咕音乐歌词获取失败');
  }
  if (lyricInfo.trcUrl) {
    result.tlyric = await fetchText(lyricInfo.trcUrl, { headers: miguHeaders() }).catch(() => result?.tlyric || '');
  }
  return result;
}

export async function resolveMusicLyric(platform: MusicPlatform, songInfo: LxSongInfo): Promise<MusicLyricResult> {
  switch (platform) {
    case 'tx':
      return resolveTxLyric(songInfo);
    case 'wy':
      return resolveWyLyric(songInfo);
    case 'kw':
      return resolveKwLyric(songInfo);
    case 'kg':
      return resolveKgLyric(songInfo);
    case 'mg':
      return resolveMgLyric(songInfo);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}
