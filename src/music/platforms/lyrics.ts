import pako, { inflate as namedPakoInflate } from 'pako';
import { fetchBytes, fetchJson, fetchText } from './http';
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
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8');
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

function optionalSongField(songInfo: LxSongInfo, keys: Array<keyof LxSongInfo>): string {
  for (const key of keys) {
    const value = stringValue(songInfo[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function bytesToString(bytes: Uint8Array, encoding = 'utf-8'): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      return new TextDecoder().decode(bytes);
    }
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(Array.from(bytes)).toString();
  }
  return String(bytes);
}

function base64ToBytes(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  if (typeof atob === 'function') {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64');
  }
  return new Uint8Array();
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(Array.from(bytes)).toString('base64');
  }
  return '';
}

function byteRange(bytes: Uint8Array, start: number, end?: number): Uint8Array {
  const length = bytes.length;
  const begin = start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
  const finish = end === undefined
    ? length
    : end < 0 ? Math.max(length + end, 0) : Math.min(end, length);
  const size = Math.max(finish - begin, 0);
  const output = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    output[index] = bytes[begin + index];
  }
  return output;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const inflate = typeof pako?.inflate === 'function' ? pako.inflate : namedPakoInflate;
  return new Uint8Array(inflate(bytes));
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

function neteaseMsLabel(timeMs: number): string {
  if (Number.isNaN(timeMs)) return '';
  let current = timeMs;
  const ms = current % 1000;
  current /= 1000;
  const minute = String(Math.trunc(current / 60)).padStart(2, '0');
  current %= 60;
  const second = String(Math.trunc(current)).padStart(2, '0');
  return `[${minute}:${second}.${ms}]`;
}

function neteaseYrcHeaderLines(value: string): string[] | null {
  const text = value.trim().replace(/\r/g, '');
  if (!text) return null;
  return text.split('\n').map((line) => {
    if (!/^{"/.test(line)) return line;
    try {
      const info = JSON.parse(line);
      const timeTag = neteaseMsLabel(Number(info.t));
      const content = Array.isArray(info.c) ? info.c.map((item: { tx?: unknown }) => stringValue(item.tx)).join('') : '';
      return timeTag ? `${timeTag}${content}` : '';
    } catch {
      return '';
    }
  });
}

function neteaseParseYrcLines(lines: string[]): { lyric: string; lxlyric: string } {
  const lrcLines: string[] = [];
  const lxLyricLines: string[] = [];
  const lineTime = /^\[(\d+),\d+]/;
  const wordTimeAll = /(\(\d+,\d+,\d+\))/g;
  const wordTime = /\(\d+,\d+,\d+\)/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const result = lineTime.exec(line);
    if (!result) {
      if (line.startsWith('[offset')) {
        lrcLines.push(line);
        lxLyricLines.push(line);
      }
      continue;
    }

    const startMsTime = Number(result[1]);
    const startTimeStr = neteaseMsLabel(startMsTime);
    if (!startTimeStr) continue;
    const words = line.replace(lineTime, '');
    lrcLines.push(`${startTimeStr}${words.replace(wordTimeAll, '')}`);

    const times = words.match(wordTimeAll);
    if (!times) continue;
    const timeTags = times.map((time) => {
      const match = /\((\d+),(\d+),\d+\)/.exec(time);
      if (!match) return '';
      return `<${Math.max(Number(match[1]) - startMsTime, 0)},${match[2]}>`;
    });
    const wordArray = words.split(wordTime);
    wordArray.shift();
    lxLyricLines.push(`${startTimeStr}${timeTags.map((time, index) => `${time}${wordArray[index] || ''}`).join('')}`);
  }

  return {
    lyric: lrcLines.join('\n'),
    lxlyric: lxLyricLines.join('\n'),
  };
}

function neteaseIntervalMs(interval: string): number {
  if (!interval) return 0;
  const normalized = interval.includes('.') ? interval : `${interval}.0`;
  const parts = normalized.split(/:|\./);
  while (parts.length < 3) parts.unshift('0');
  const [minute, second, ms] = parts;
  return Number(minute) * 3600000 + Number(second) * 1000 + Number(ms);
}

function fixNeteaseExtendedTimeTags(source: string, target: string): string {
  let sourceLines = source.split('\n');
  const targetLines = target.split('\n');
  const timeRxp = /^\[([\d:.]+)]/;
  let deferred: string[] = [];
  const fixed: string[] = [];

  for (const line of targetLines) {
    const result = timeRxp.exec(line);
    if (!result) continue;
    const words = line.replace(timeRxp, '');
    if (!words.trim()) continue;
    const targetTime = neteaseIntervalMs(result[1]);

    while (sourceLines.length) {
      const sourceLine = sourceLines.shift() || '';
      const sourceResult = timeRxp.exec(sourceLine);
      if (!sourceResult) continue;
      const sourceTime = neteaseIntervalMs(sourceResult[1]);
      if (Math.abs(targetTime - sourceTime) < 100) {
        const fixedLine = line.replace(timeRxp, sourceResult[0]).trim();
        if (fixedLine) fixed.push(fixedLine);
        break;
      }
      deferred.push(sourceLine);
    }
    sourceLines = [...deferred, ...sourceLines];
    deferred = [];
  }

  return fixed.join('\n');
}

function parseNeteaseLyrics(body: any): MusicLyricResult {
  const yrc = stringValue(body.yrc?.lyric);
  const ytlrc = stringValue(body.ytlrc?.lyric);
  const yrlrc = stringValue(body.yromalrc?.lyric);
  const lrc = fixNeteaseTimeLabel(stringValue(body.lrc?.lyric));
  const tlrc = fixNeteaseTimeLabel(stringValue(body.tlyric?.lyric));
  const rlrc = fixNeteaseTimeLabel(stringValue(body.romalrc?.lyric));

  if (yrc) {
    const yrcLines = neteaseYrcHeaderLines(yrc);
    if (yrcLines) {
      const parsed = neteaseParseYrcLines(yrcLines);
      const result = lyricResult('', '', '', '');
      const timeRxp = /^\[[\d:.]+]/;
      const headers = yrcLines.filter((line) => timeRxp.test(line)).join('\n');
      result.lyric = `${headers}\n${parsed.lyric}`.trim();
      result.lxlyric = parsed.lxlyric;
      const translatedLines = ytlrc ? neteaseYrcHeaderLines(ytlrc) : null;
      if (translatedLines) {
        result.tlyric = fixNeteaseExtendedTimeTags(parsed.lyric, translatedLines.join('\n'));
      }
      const romanLines = yrlrc ? neteaseYrcHeaderLines(yrlrc) : null;
      if (romanLines) {
        result.rlyric = fixNeteaseExtendedTimeTags(parsed.lyric, romanLines.join('\n'));
      }
      return result;
    }
  }

  return lyricResult(lrc, tlrc, rlrc);
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
  const result = parseNeteaseLyrics(body);
  if (!result.lyric) {
    throw new Error('网易云音乐歌词获取失败');
  }
  return result;
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

const KUWO_LYRIC_KEY = new TextEncoder().encode('yeelion');
const KUWO_WORD_TIME_ALL = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/g;
const KUWO_EXIST_TIME = /\[\d{1,2}:.*\d{1,4}]/;

function kuwoXor(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes[index] ^ KUWO_LYRIC_KEY[index % KUWO_LYRIC_KEY.length];
  }
  return output;
}

function buildKuwoNewlyricParams(songmid: string, isGetLyricx = true): string {
  const params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${songmid}${isGetLyricx ? '&lrcx=1' : ''}`;
  const bytes = new TextEncoder().encode(params);
  return bytesToBase64(kuwoXor(bytes));
}

async function decodeKuwoNewlyric(raw: Uint8Array, isGetLyricx = true): Promise<string> {
  if (bytesToString(byteRange(raw, 0, 10)) !== 'tp=content') {
    return '';
  }
  let bodyOffset = -1;
  for (let index = 0; index <= raw.length - 4; index += 1) {
    if (raw[index] === 13 && raw[index + 1] === 10 && raw[index + 2] === 13 && raw[index + 3] === 10) {
      bodyOffset = index + 4;
      break;
    }
  }
  if (bodyOffset < 0) {
    return '';
  }

  const inflated = await inflateZlib(byteRange(raw, bodyOffset));
  const lyricBytes = isGetLyricx ? kuwoXor(base64ToBytes(bytesToString(inflated))) : inflated;
  return bytesToString(lyricBytes, 'gb18030');
}

type KuwoLrcEntry = { time: string; text: string };

function sortKuwoNewlyricEntries(entries: KuwoLrcEntry[]): { lrc: KuwoLrcEntry[]; lrcT: KuwoLrcEntry[] } {
  const lrcSet = new Set<string>();
  const lrc: KuwoLrcEntry[] = [];
  const lrcT: KuwoLrcEntry[] = [];
  let isLyricx = false;

  for (const item of entries) {
    if (lrcSet.has(item.time)) {
      if (lrc.length < 2) {
        continue;
      }
      const translated = lrc.pop();
      if (translated) {
        translated.time = lrc[lrc.length - 1]?.time || item.time;
        lrcT.push(translated);
      }
      lrc.push(item);
    } else {
      lrc.push(item);
      lrcSet.add(item.time);
    }
    if (!isLyricx && /^<-?\d+,-?\d+>/.test(item.text)) {
      isLyricx = true;
    }
  }

  if (!isLyricx && lrcT.length > lrc.length * 0.3 && lrc.length - lrcT.length > 6) {
    throw new Error('Get lyric failed');
  }

  return { lrc, lrcT };
}

function transformKuwoNewlyric(tags: string[], entries: KuwoLrcEntry[]): string {
  return `${tags.join('\n')}\n${entries.map((entry) => `[${entry.time}]${entry.text}\n`).join('')}`.trim();
}

function kuwoWordInfo(offset: number, offset2: number, rawStart: string, rawEnd: string, previous?: { startTime: number; endTime: number; timeStr: string; newTimeStr?: string }): { startTime: number; endTime: number; timeStr: string; newTimeStr?: string } {
  const left = Number(rawStart);
  const right = Number(rawEnd);
  const safeOffset = offset || 1;
  const safeOffset2 = offset2 || 1;
  const startTime = Math.abs((left + right) / (safeOffset * 2));
  const result = {
    startTime,
    endTime: Math.abs((left - right) / (safeOffset2 * 2)) + startTime,
    timeStr: `<${startTime},${Math.abs((left - right) / (safeOffset2 * 2))}>`,
  };

  if (previous && startTime < previous.endTime) {
    previous.endTime = startTime;
    if (previous.startTime > previous.endTime) {
      previous.startTime = previous.endTime;
    }
    previous.newTimeStr = `<${previous.startTime},${previous.endTime - previous.startTime}>`;
  }
  return result;
}

function parseKuwoWordLyric(lrc: string): string {
  const lines: string[] = [];
  const tags: string[] = [];
  let offset = 1;
  let offset2 = 1;
  let isOk = true;
  const wordLine = /^(\[\d{1,2}:.*\d{1,4}])\s*(\S+(?:\s+\S+)*)?\s*/;
  const tagLine = /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*]/;
  const wordTime = /<(-?\d+),(-?\d+)(?:,-?\d+)?>/;

  for (const rawLine of lrc.split(/\r\n|\r|\n/)) {
    if (!isOk) {
      throw new Error('Get lyric failed');
    }
    if (rawLine.length < 6) {
      continue;
    }
    const line = rawLine.trim();
    const wordResult = wordLine.exec(line);
    if (wordResult) {
      const time = wordResult[1];
      let words = wordResult[2] || '';
      const wordTimes = words.match(KUWO_WORD_TIME_ALL);
      if (!wordTimes) {
        continue;
      }
      let previous: { startTime: number; endTime: number; timeStr: string; newTimeStr?: string } | undefined;
      for (const timeStr of wordTimes) {
        const timeResult = wordTime.exec(timeStr);
        if (!timeResult) {
          continue;
        }
        const wordInfo = kuwoWordInfo(offset, offset2, timeResult[1], timeResult[2], previous);
        words = words.replace(timeStr, wordInfo.timeStr);
        if (previous?.newTimeStr) {
          words = words.replace(previous.timeStr, previous.newTimeStr);
        }
        previous = wordInfo;
      }
      lines.push(`${time}${words}`);
      continue;
    }

    const tagResult = tagLine.exec(line);
    if (!tagResult) {
      continue;
    }
    if (tagResult[1] === 'kuwo') {
      const content = tagResult[2].includes('][') ? tagResult[2].slice(0, tagResult[2].indexOf('][')) : tagResult[2];
      const value = parseInt(content, 8);
      offset = Math.trunc(value / 10);
      offset2 = Math.trunc(value % 10);
      if (offset === 0 || Number.isNaN(offset) || offset2 === 0 || Number.isNaN(offset2)) {
        isOk = false;
      }
    } else {
      tags.push(line);
    }
  }

  if (!lines.length) {
    return '';
  }
  return `${tags.length ? `${tags.join('\n')}\n` : ''}${lines.join('\n')}`;
}

function parseKuwoNewlyric(text: string): MusicLyricResult {
  const tags: string[] = [];
  const entries: KuwoLrcEntry[] = [];
  const timeLine = /^\[([\d:.]*)]/;
  const tagLine = /\[(ver|ti|ar|al|offset|by|kuwo):\s*(\S+(?:\s+\S+)*)\s*]/;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    const timeResult = timeLine.exec(line);
    if (timeResult) {
      let time = timeResult[1];
      if (/\.\d\d$/.test(time)) {
        time += '0';
      }
      entries.push({
        time,
        text: line.replace(timeLine, '').trim(),
      });
      continue;
    }
    if (tagLine.test(line)) {
      tags.push(line);
    }
  }

  const sorted = sortKuwoNewlyricEntries(entries);
  let lyric = transformKuwoNewlyric(tags, sorted.lrc);
  let tlyric = sorted.lrcT.length ? transformKuwoNewlyric(tags, sorted.lrcT) : '';
  let lxlyric = '';
  try {
    lxlyric = parseKuwoWordLyric(lyric);
  } catch {
    lxlyric = '';
  }
  lyric = lyric.replace(KUWO_WORD_TIME_ALL, '');
  tlyric = tlyric.replace(KUWO_WORD_TIME_ALL, '');

  if (!KUWO_EXIST_TIME.test(lyric)) {
    throw new Error('Get lyric failed');
  }
  return lyricResult(decodeHtml(lyric), decodeHtml(tlyric), '', decodeHtml(lxlyric));
}

async function resolveKwNewLyric(songmid: string): Promise<MusicLyricResult> {
  const raw = await fetchBytes(`http://newlyric.kuwo.cn/newlyric.lrc?${buildKuwoNewlyricParams(songmid, true)}`);
  const text = await decodeKuwoNewlyric(raw, true);
  if (!text) {
    throw new Error('酷我音乐歌词获取失败');
  }
  return parseKuwoNewlyric(text);
}

function parseKwLegacyLyricBody(songInfo: LxSongInfo, body: any): MusicLyricResult {
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

async function resolveKwLegacyLyric(songInfo: LxSongInfo, songmid: string): Promise<MusicLyricResult> {
  const encodedSongmid = encodeURIComponent(songmid);
  const endpoints = [
    `https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${encodedSongmid}&httpsStatus=1&reqId=starlight&plat=web_www&from=lrc`,
    `http://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${encodedSongmid}&httpsStatus=1&reqId=starlight&plat=web_www&from=lrc`,
    `https://kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${encodedSongmid}&httpsStatus=1&reqId=starlight&plat=web_www&from=lrc`,
    `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodedSongmid}`,
    `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodedSongmid}`,
    `https://www.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodedSongmid}`,
    `http://www.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodedSongmid}`,
  ];
  let lastError: unknown;
  for (const url of endpoints) {
    try {
      return parseKwLegacyLyricBody(songInfo, await fetchJson<any>(url, {
        headers: {
          Referer: 'https://www.kuwo.cn/',
          'User-Agent': 'Mozilla/5.0',
        },
      }));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('酷我音乐歌词获取失败');
}

async function resolveKwLyric(songInfo: LxSongInfo): Promise<MusicLyricResult> {
  const songmid = optionalSongField(songInfo, ['songmid', 'musicId']);
  if (!songmid) {
    throw new Error('酷我音乐缺少 songmid');
  }
  try {
    return await resolveKwNewLyric(songmid);
  } catch {
    // Fall through to JSON endpoints; Songloft's plugin fetch runtime may not expose raw binary responses.
  }
  try {
    return await resolveKwLegacyLyric(songInfo, songmid);
  } catch {
    throw new Error('酷我音乐歌词获取失败');
  }
}

function kugouHeaders(): HeadersInit {
  return {
    'KG-RC': '1',
    'KG-THash': 'expand_search_manager.cpp:852736169:451',
    'User-Agent': 'KuGou2012-9020-ExpandSearchManager',
  };
}

const KUGOU_KRC_KEY = new Uint8Array([0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]);

async function decodeKugouKrc(content: string): Promise<MusicLyricResult> {
  const encrypted = byteRange(base64ToBytes(content), 4);
  for (let index = 0; index < encrypted.length; index += 1) {
    encrypted[index] = encrypted[index] ^ KUGOU_KRC_KEY[index % KUGOU_KRC_KEY.length];
  }
  const inflated = await inflateZlib(encrypted);
  return parseKugouKrc(bytesToString(inflated));
}

function kugouMsLabel(timeMs: number): string {
  let current = timeMs;
  const ms = current % 1000;
  current /= 1000;
  const minute = String(Math.trunc(current / 60)).padStart(2, '0');
  current %= 60;
  const second = String(Math.trunc(current)).padStart(2, '0');
  return `${minute}:${second}.${ms}`;
}

function kugouLanguageLine(value: unknown): string {
  return Array.isArray(value) ? value.map((part) => stringValue(part)).join('') : stringValue(value);
}

function parseKugouKrc(text: string): MusicLyricResult {
  let value = text.replace(/\r/g, '');
  value = value.replace(/^.*\[id:\$\w+]\n/, '');
  const trans = value.match(/\[language:([\w=\\/+]+)]/);
  let rlyric: unknown[] | null = null;
  let tlyric: unknown[] | null = null;
  if (trans) {
    value = value.replace(/\[language:[\w=\\/+]+]\n/, '');
    const json = JSON.parse(base64ToUtf8(trans[1]));
    for (const item of Array.isArray(json.content) ? json.content : []) {
      if (item.type === 0) {
        rlyric = item.lyricContent;
      } else if (item.type === 1) {
        tlyric = item.lyricContent;
      }
    }
  }

  let index = 0;
  const lxlyric = decodeHtml(value.replace(/\[((\d+),\d+)].*/g, (line) => {
    const result = line.match(/\[((\d+),\d+)].*/);
    if (!result) return line;
    const time = kugouMsLabel(Number(result[2]));
    if (rlyric) rlyric[index] = `[${time}]${kugouLanguageLine(rlyric[index])}`;
    if (tlyric) tlyric[index] = `[${time}]${kugouLanguageLine(tlyric[index])}`;
    index += 1;
    return line.replace(result[1], time);
  }).replace(/<(\d+,\d+),\d+>/g, '<$1>'));

  return lyricResult(
    lxlyric.replace(/<\d+,\d+>/g, ''),
    decodeHtml(tlyric ? tlyric.join('\n') : ''),
    decodeHtml(rlyric ? rlyric.join('\n') : ''),
    lxlyric,
  );
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
  const fmt = candidate.krctype === 1 && candidate.contenttype !== 1 ? 'krc' : 'lrc';
  const body = await fetchJson<any>(`http://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=${fmt}&charset=utf8`, {
    headers: kugouHeaders(),
  });
  if (body.fmt === 'krc') {
    return decodeKugouKrc(stringValue(body.content));
  }
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
