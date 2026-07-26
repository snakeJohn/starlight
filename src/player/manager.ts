// MIoT 智能音箱插件 - 歌单播放管理器
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/player/playlist_manager.go
// 管理播放状态机、播放模式切换、自动切歌

/// <reference types="@songloft/plugin-sdk" />

import { ConfigManager } from '../config/manager';
import { MinaService } from '../service/service';
import { URLBuilder } from './url_builder';
import { getHostBaseUrl, setHostBaseUrl, callHostAPI } from '../utils/http';
import { fetchWithTimeout } from '../utils/fetch_timeout';
import type { PlayState, PlayMode, PlayerStatus } from '../types';
import { sourceDiagnostics } from '../diagnostics/source_logs';

// ===== 歌曲类型 =====

/** 歌曲信息（从宿主API返回） */
export interface PlayerSong {
  id: number;
  type: string;       // "local" | "remote" | "radio"
  title: string;
  artist: string;
  album: string;
  duration: number;   // 秒
  file_path: string;
  url: string;
  cover_path: string;
  cover_url: string;
  lyric_url: string;  // 歌词URL（后端统一端点）
  /** 内联 LRC 歌词：没有宿主歌曲 ID（外部音源直推）时的兜底，播放后异步补齐 */
  lyric_text?: string;
  /**
   * 音源信息，仅用于按需解析歌词。
   * 不会出现在 getStatus() 的 queue 投影里（那里是显式字段列表），
   * 所以放在这里不会让 5 秒轮询驮上整个 songInfo。
   */
  source_data?: {
    platform: string;
    quality: string;
    songInfo: Record<string, unknown>;
  };
  file_size: number;
  format: string;
  bit_rate: number;
  sample_rate: number;
  is_live: boolean;
  cache_hash: string;
}

export interface DynamicPlaylistOptions {
  dynamicPlaylistLoader?: (playlistId: number) => Promise<PlayerSong[] | null>;
  dynamicSongResolver?: (song: PlayerSong) => Promise<PlayerSong | null>;
  /**
   * 解析单曲歌词（返回规范化后的 LRC，取不到返回空串）。
   * 由 PlaylistManager 在切歌时按需调用——歌词补全必须由持有队列的一方驱动，
   * 放在建队列的一侧只能补到最初那几首，之后自动切歌就再也补不上了。
   */
  songLyricResolver?: (song: PlayerSong) => Promise<string>;
}

export interface PlayStandaloneOptions {
  autoAdvance?: boolean;
}

/** 预热请求超时：宿主只回 202，不应为它等太久 */
const PREFETCH_TIMEOUT_MS = 5000;

/** 切歌偏移允许范围（秒），与设置页保持一致 */
const MAX_TRANSITION_OFFSET_SEC = 30;

/** 两个地址是否同源（按 origin 比较，避免前缀域名误判） */
function isSameOrigin(url: string, base: string): boolean {
  if (!base) return false;
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** 把配置里的切歌偏移收敛到 [-30, +30]，非法值按 0 处理 */
function normalizeTransitionOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-MAX_TRANSITION_OFFSET_SEC, Math.min(MAX_TRANSITION_OFFSET_SEC, value));
}

function recordSpeakerPlaybackDiagnostic(
  song: PlayerSong,
  status: 'success' | 'failed',
  message: string,
  durationMs = 0,
): void {
  sourceDiagnostics.record({
    operation: 'playback',
    stage: 'speaker-play',
    status,
    sourceId: 'miot',
    sourceName: '小爱音箱',
    platform: song.type || 'remote',
    quality: song.format || '',
    title: song.title,
    artist: song.artist,
    durationMs,
    message,
  });
}

function isLoopbackPlaybackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname.startsWith('127.')
      || hostname === '::1'
      || hostname === '[::1]'
      || hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

function safePlaybackUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('access_token')) {
      parsed.searchParams.set('access_token', '[redacted]');
    }
    return parsed.toString();
  } catch {
    return url.replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function firstString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return '';
}

function firstNumber(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value > 0) return value;
  }
  return 0;
}

function isLocalSongRecord(record: Record<string, unknown>): boolean {
  if (record.local === true || record.local === 1) {
    return true;
  }
  const marker = readString(record.local).toLowerCase();
  if (marker === 'true' || marker === '1' || marker === 'yes' || marker === 'local') {
    return true;
  }
  const type = readString(record.type).toLowerCase().replace(/[\s_-]+/g, '');
  return type === 'local' || type === 'localsong' || type === '本地';
}

function songListFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) {
    return [];
  }
  for (const key of ['list', 'items', 'songs', 'data']) {
    const list = value[key];
    if (Array.isArray(list)) {
      return list.filter(isRecord);
    }
  }
  return [];
}

function normalizePlayerSongs(value: unknown): PlayerSong[] {
  return songListFrom(value)
    .map((record) => {
      const id = firstNumber(record, 'id', 'song_id', 'songId');
      const title = firstString(record, 'title', 'name', 'songName', 'song_name') || '未知歌曲';
      const url = firstString(record, 'url', 'play_url', 'playUrl') || (id > 0 ? `/api/v1/songs/${id}/play` : '');
      const type = isLocalSongRecord(record) ? 'local' : (firstString(record, 'type') || 'remote');
      return {
        id,
        type,
        title,
        artist: firstString(record, 'artist', 'singer', 'author', 'singerName') || '未知歌手',
        album: firstString(record, 'album', 'albumName'),
        duration: firstNumber(record, 'duration'),
        file_path: firstString(record, 'file_path', 'filePath'),
        url,
        cover_path: firstString(record, 'cover_path', 'coverPath'),
        cover_url: firstString(record, 'cover_url', 'coverUrl', 'picUrl', 'img'),
        // 宿主列表接口不一定回填 lyric_url，有歌曲 ID 时回落到统一歌词端点
        lyric_url: firstString(record, 'lyric_url', 'lyricUrl') || (id > 0 ? `/api/v1/songs/${id}/lyric` : ''),
        file_size: firstNumber(record, 'file_size', 'fileSize'),
        format: firstString(record, 'format'),
        bit_rate: firstNumber(record, 'bit_rate', 'bitRate'),
        sample_rate: firstNumber(record, 'sample_rate', 'sampleRate'),
        is_live: record.is_live === true || record.isLive === true,
        cache_hash: firstString(record, 'cache_hash', 'cacheHash'),
      };
    })
    .filter(song => Boolean(song.url));
}

// ===== PlaylistManager - 单设备播放管理器 =====

/**
 * PlaylistManager - 管理单个设备的歌单播放
 * 实现播放状态机、播放模式切换、定时切歌
 */
export class PlaylistManager {
  private accountId: string;
  private deviceId: string;
  private minaService: MinaService;
  private configManager: ConfigManager;

  private state: PlayState = 'idle';
  private playMode: PlayMode = 'order';
  private playlistId: number = 0;
  private songs: PlayerSong[] = [];
  private currentIndex: number = 0;
  private checkTimer: any = null;       // 定时器ID（基于歌曲时长的切歌定时器）
  private playStartTimeMs: number = 0;  // 当前歌曲开始播放的时间戳(ms)（playing 时相对墙钟）
  /** 暂停时冻结的已播秒数；>0 表示处于暂停且恢复时以此为进度基准 */
  private pausedElapsedSec: number = 0;
  private randomPlayed: Set<number> = new Set(); // 随机模式已播放索引
  private voiceSuspendedAt: number = 0; // suspendForVoiceInteraction 首次调用时间戳
  private autoAdvance = true;
  /** 正在解析歌词的歌曲，避免来回切歌时重复发起 */
  private readonly lyricFillInFlight = new Set<PlayerSong>();
  /**
   * 设备是否确认已停止。
   *
   * 与 state='stopped' 分开记：本地停止有两层含义——「不再自动推歌」和
   * 「设备确实不响了」。设备拒绝 stop 时前者成立、后者不成立，而
   * /player/status 有条「本地 stopped 就压制设备状态」的规则，如果只看 state，
   * 一次失败的 stop 会让接口永久谎报 stopped，连设备探针明确回 playing 都盖掉。
   */
  private deviceStopConfirmed = true;
  private _lastLoadNotFound: boolean = false; // 上次 loadPlaylistSongs 失败是否因歌单不存在(ID 过期)

  constructor(
    accountId: string,
    deviceId: string,
    minaService: MinaService,
    configManager: ConfigManager,
    private readonly dynamicOptions: DynamicPlaylistOptions = {},
  ) {
    this.accountId = accountId;
    this.deviceId = deviceId;
    this.minaService = minaService;
    this.configManager = configManager;
  }

  // ===== 公开方法 =====

  /**
   * 播放歌单
   * @param playlistId - 歌单ID
   * @param startIndex - 起始歌曲索引（默认0）
   * @param mode - 播放模式（默认order）
   * @param opts.randomStart - 忽略 startIndex，加载歌单后随机挑一首作为起点
   * @returns 是否成功
   */
  async play(playlistId: number, startIndex?: number, mode?: PlayMode, opts?: { randomStart?: boolean }): Promise<boolean> {
    // 立即停止定时器和重置状态，防止 loadPlaylistSongs 期间旧定时器触发 onSongFinished
    this.stopCheckTimer();
    this.state = 'idle';
    this.playStartTimeMs = 0;
    // Drop any frozen pause progress; it belongs to the previous song.
    this.pausedElapsedSec = 0;
    this._lastLoadNotFound = false;

    // 加载歌单歌曲
    const loaded = await this.loadPlaylistSongs(playlistId);
    if (!loaded) {
      songloft.log.error('[PlaylistManager] Failed to load playlist songs: ' + playlistId);
      return false;
    }

    if (this.songs.length === 0) {
      songloft.log.warn('[PlaylistManager] Playlist is empty: ' + playlistId);
      return false;
    }

    // 设置播放参数
    this.playlistId = playlistId;
    if (opts?.randomStart && this.songs.length > 0) {
      this.currentIndex = Math.floor(Math.random() * this.songs.length);
    } else {
      this.currentIndex = (startIndex !== undefined && startIndex >= 0 && startIndex < this.songs.length)
        ? startIndex : 0;
    }
    this.playMode = mode || 'order';
    this.autoAdvance = true;
    this.randomPlayed = new Set();

    // 开始播放当前歌曲
    const ok = await this.playCurrent();
    if (!ok) {
      songloft.log.error('[PlaylistManager] Failed to play current song');
      return false;
    }

    // 持久化播放状态到设备配置
    await this.persistState();

    songloft.log.info(`[PlaylistManager] Playlist started id=${playlistId} index=${this.currentIndex} mode=${this.playMode} total=${this.songs.length}`);
    return true;
  }

  /**
   * 上次播放失败是否因歌单 ID 已失效（歌单不存在）。
   * 用于上层在扫描导致 auto-create 歌单 ID 变化后，刷新索引并重试。
   */
  isLastPlayNotFound(): boolean {
    return this._lastLoadNotFound;
  }

  /**
   * 播放临时歌曲队列。
   * 用于搜索结果单曲推送或手动 URL 播放，不依赖 Songloft 歌单。
   */
  async playStandalone(
    songs: PlayerSong[],
    startIndex = 0,
    mode: PlayMode = 'single',
    options: PlayStandaloneOptions = {},
  ): Promise<boolean> {
    this.stopCheckTimer();
    this.clearVoiceSuspend();
    this.state = 'idle';
    this.playStartTimeMs = 0;
    this.pausedElapsedSec = 0;

    if (!songs.length) {
      songloft.log.warn('[PlaylistManager] Empty standalone song queue');
      return false;
    }

    this.songs = songs;
    this.playlistId = 0;
    this.currentIndex = startIndex >= 0 && startIndex < songs.length ? startIndex : 0;
    this.playMode = mode;
    this.autoAdvance = options.autoAdvance !== false;
    this.randomPlayed = new Set();

    const ok = await this.playCurrent();
    if (!ok) {
      songloft.log.error('[PlaylistManager] Failed to play standalone song');
      return false;
    }

    songloft.log.info(`[PlaylistManager] Standalone queue started index=${this.currentIndex} mode=${this.playMode} total=${this.songs.length}`);
    return true;
  }

  /**
   * 暂停播放（保持状态，可恢复）
   * 冻结已播秒数，恢复时用它重建时间基准，避免把暂停墙钟时间算进进度。
   */
  /**
   * @returns 物理设备是否确实暂停成功。
   *
   * `minaService.pausePlay()` 契约上返回 boolean 且**不抛异常**：账号无客户端、
   * 请求失败、设备拒绝都只是返回 false。以前这里丢掉了返回值，于是设备还在响、
   * 上层却一路上报 paused —— 切到浏览器后两端同时出声，且状态缓存也在说谎。
   *
   * 无论设备暂停成败，定时器和内部状态都要落到 paused：定时器不清的话，
   * 本地还会继续把下一首推给一台我们已经控制不住的音箱，只会更糟。
   */
  async pause(): Promise<boolean> {
    this.stopCheckTimer();
    this.clearVoiceSuspend();

    if (this.state === 'playing' && this.playStartTimeMs > 0) {
      const elapsed = (Date.now() - this.playStartTimeMs) / 1000;
      const song = this.getCurrentSong();
      const capped = song && song.duration > 0 ? Math.min(elapsed, song.duration) : Math.max(0, elapsed);
      this.pausedElapsedSec = Math.max(0, capped);
    } else if (this.state !== 'paused') {
      this.pausedElapsedSec = 0;
    }

    this.state = 'paused';
    // playStartTimeMs 在暂停期间不参与进度计算；恢复时按 pausedElapsedSec 重置

    // 调用设备暂停
    let devicePaused = true;
    if (this.accountId && this.deviceId) {
      devicePaused = await this.minaService.pausePlay(this.accountId, this.deviceId);
      if (!devicePaused) {
        songloft.log.warn(
          `[PlaylistManager] Device refused to pause account=${this.accountId} device=${this.deviceId}; speaker may still be audible`,
        );
      }
    }

    songloft.log.info(`[PlaylistManager] Playback paused at ${this.pausedElapsedSec.toFixed(1)}s`);
    return devicePaused;
  }

  /**
   * 停止播放
   */
  /** @returns 物理设备是否确实停止成功（与 pause() 同理，stopPlay 返回 boolean 而非抛错）。 */
  async stop(): Promise<boolean> {
    this.stopCheckTimer();
    this.clearVoiceSuspend();
    this.state = 'stopped';
    this.playStartTimeMs = 0;
    this.pausedElapsedSec = 0;

    let deviceStopped = true;
    if (this.accountId && this.deviceId) {
      deviceStopped = await this.minaService.stopPlay(this.accountId, this.deviceId);
      if (!deviceStopped) {
        songloft.log.warn(
          `[PlaylistManager] Device refused to stop account=${this.accountId} device=${this.deviceId}; speaker may still be audible`,
        );
      }
    }
    this.deviceStopConfirmed = deviceStopped;

    songloft.log.info('[PlaylistManager] Playback stopped');
    return deviceStopped;
  }

  /**
   * 本地 stopped 是否可信到足以压制设备上报的状态。
   *
   * 只有「本地已停」且「设备确认停了」时才为 true。停止失败时返回 false，
   * 让真实设备状态透出来——否则用户会看到 stopped 而音箱还在响。
   */
  isStopAuthoritative(): boolean {
    return this.state === 'stopped' && this.deviceStopConfirmed;
  }

  /**
   * 下一首
   * @returns 是否成功
   */
  async next(): Promise<boolean> {
    this.stopCheckTimer();
    if (this.songs.length === 0) {
      songloft.log.warn('[PlaylistManager] No playlist loaded for next');
      return false;
    }

    const nextIdx = this.getNextIndex();
    if (nextIdx < 0) {
      songloft.log.info('[PlaylistManager] No next song, stopping');
      await this.stop();
      return false;
    }

    this.currentIndex = nextIdx;
    const ok = await this.playCurrent();
    if (ok) {
      await this.persistState();
    }
    return ok;
  }

  /**
   * 上一首
   * @returns 是否成功
   */
  async previous(): Promise<boolean> {
    this.stopCheckTimer();
    if (this.songs.length === 0) {
      songloft.log.warn('[PlaylistManager] No playlist loaded for previous');
      return false;
    }

    const prevIdx = this.getPreviousIndex();
    if (prevIdx < 0) {
      songloft.log.info('[PlaylistManager] No previous song');
      return false;
    }

    this.currentIndex = prevIdx;
    const ok = await this.playCurrent();
    if (ok) {
      await this.persistState();
    }
    return ok;
  }

  /**
   * 设置播放模式
   */
  async setPlayMode(mode: PlayMode): Promise<void> {
    this.playMode = mode;

    // 切换到随机模式时重置已播放记录
    if (mode === 'random') {
      this.randomPlayed = new Set();
    }

    // 持久化到设备配置
    try {
      await this.configManager.updateDevice(this.accountId, this.deviceId, {
        play_mode: mode,
      });
    } catch (e) {
      songloft.log.warn('[PlaylistManager] Failed to save play mode: ' + String(e));
    }

    songloft.log.info('[PlaylistManager] Play mode set to ' + mode);
  }

  /**
   * 获取播放状态
   */
  getStatus(): PlayerStatus {
    let currentSong: PlayerStatus['current_song'];
    let duration = 0;
    if (this.currentIndex >= 0 && this.currentIndex < this.songs.length) {
      const song = this.songs[this.currentIndex];
      currentSong = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        cover_url: song.cover_url,
        lyric_url: song.lyric_url,
        // 内联歌词只随当前歌曲下发，避免整条队列重复携带大段 LRC 文本
        ...(song.lyric_text ? { lyric_text: song.lyric_text } : {}),
      };
      duration = song.duration;
    }

    // Cap queue size while keeping the active item inside the returned window.
    const queueLimit = 200;
    const maxOffset = Math.max(0, this.songs.length - queueLimit);
    const queueOffset = Math.max(0, Math.min(this.currentIndex - Math.floor(queueLimit / 2), maxOffset));
    const queue = this.songs.slice(queueOffset, queueOffset + queueLimit).map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      url: song.url,
      cover_url: song.cover_url,
      lyric_url: song.lyric_url,
    }));

    return {
      state: this.state,
      play_mode: this.playMode,
      playlist_id: this.playlistId,
      current_index: this.currentIndex,
      current_song: currentSong,
      queue,
      queue_offset: queueOffset,
      position: this.getPosition(),
      duration: duration,
      is_playing: this.state === 'playing',
      can_seek: false,
      seek_strategy: 'unsupported',
    };
  }

  /**
   * 获取当前歌曲
   */
  getCurrentSong(): PlayerSong | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.songs.length) {
      return this.songs[this.currentIndex];
    }
    return null;
  }

  /**
   * 是否有播放列表
   */
  hasPlaylist(): boolean {
    return this.songs.length > 0;
  }

  /**
   * 是否正在播放
   */
  isPlaying(): boolean {
    return this.state === 'playing';
  }

  /**
   * 恢复播放（使用 play 接口继续，不重发 URL）
   * 用于语音命令（如调音量）中断 URL 播放后恢复
   * 同时重置切歌定时器以补偿暂停时间
   */
  async resumePlayback(): Promise<boolean> {
    if ((this.state !== 'playing' && this.state !== 'paused') || this.songs.length === 0) {
      return false;
    }

    this.stopCheckTimer();

    const ok = await this.minaService.resumePlay(this.accountId, this.deviceId);
    if (!ok) {
      songloft.log.warn('[PlaylistManager] resumePlay failed');
      return false;
    }

    const song = this.getCurrentSong();
    // 从暂停恢复：用冻结的已播秒数重建时间基准，避免暂停墙钟时间吞掉 remaining
    if (this.state === 'paused') {
      const elapsedSec = Math.max(0, this.pausedElapsedSec);
      this.playStartTimeMs = Date.now() - elapsedSec * 1000;
      this.pausedElapsedSec = 0;
    }

    this.state = 'playing';

    if (this.autoAdvance && song && song.duration > 0 && this.playStartTimeMs > 0) {
      const elapsedSec = (Date.now() - this.playStartTimeMs) / 1000;
      const remaining = song.duration - elapsedSec;
      if (remaining > 0) {
        this.startCheckTimer(remaining);
        songloft.log.info(`[PlaylistManager] Timer reset after resume: remaining=${remaining.toFixed(1)}s`);
      } else {
        // 已到/超过曲尾：立即触发切歌
        songloft.log.info(`[PlaylistManager] Resume at/after end (remaining=${remaining.toFixed(1)}s), advancing now`);
        this.startCheckTimer(0.1);
      }
    }

    return true;
  }

  /**
   * 获取当前播放位置（秒）
   */
  getPosition(): number {
    const song = this.getCurrentSong();
    const cap = (sec: number): number => {
      if (song && song.duration > 0 && sec > song.duration) return song.duration;
      return Math.max(0, sec);
    };

    if (this.state === 'paused') {
      return cap(this.pausedElapsedSec);
    }
    if (this.state !== 'playing' || this.playStartTimeMs === 0) {
      return 0;
    }
    return cap((Date.now() - this.playStartTimeMs) / 1000);
  }

  /**
   * 清理定时器
   */
  cleanup(): void {
    this.stopCheckTimer();
  }

  /**
   * 准备播放新内容：立即清除定时器并重置状态
   * 用于 VoiceEngine 在 interruptBroadcast 之前调用，
   * 防止搜索/加载期间旧定时器触发 onSongFinished
   */
  prepareForNewPlayback(): void {
    this.stopCheckTimer();
    this.clearVoiceSuspend();
    this.state = 'idle';
    this.playStartTimeMs = 0;
    this.pausedElapsedSec = 0;
  }

  /**
   * 挂起播放：停止切歌定时器但保持 playing 状态
   * 用于语音交互打断时，防止定时器在 AI 响应期间触发 onSongFinished，
   * 同时保持状态为 playing 以便后续 resumePlayback() 恢复。
   */
  suspendForVoiceInteraction(): void {
    this.stopCheckTimer();
    if (this.voiceSuspendedAt === 0) {
      this.voiceSuspendedAt = Date.now();
    }
  }

  isVoiceSuspended(): boolean {
    return this.voiceSuspendedAt > 0;
  }

  isVoiceSuspendStale(): boolean {
    return this.voiceSuspendedAt > 0 && (Date.now() - this.voiceSuspendedAt) > 60000;
  }

  private clearVoiceSuspend(): void {
    this.voiceSuspendedAt = 0;
  }

  /**
   * 仅重置切歌定时器（不发送任何设备命令）
   * 用于设备已自动恢复播放的场景，避免多余的 play 命令导致歌曲从头播放
   * @param devicePositionSec - 设备实际播放位置（秒），优先使用；未提供时回退到挂钟时间
   */
  /**
   * 是否仍允许用设备进度校准本地自动切歌定时器。
   * 仅用于播放刚开始的缓冲修正；接近曲尾时不允许设备端小进度回拨定时器，
   * 否则部分音箱循环拉同一 URL 时会把自动下一首无限推迟。
   */
  canCalibrateAutoNextTimer(devicePositionSec: number): boolean {
    const song = this.getCurrentSong();
    if (this.state !== 'playing' || !song || song.duration <= 0 || this.playStartTimeMs <= 0) {
      return false;
    }

    const elapsedSec = (Date.now() - this.playStartTimeMs) / 1000;
    const remainingSec = song.duration - elapsedSec;
    if (remainingSec <= 15 || elapsedSec >= Math.max(45, song.duration * 0.5)) {
      return false;
    }

    // 播放一段时间后设备又回到开头，通常表示音箱在重拉同一首，不应用它重置自动切歌。
    if (elapsedSec > 15 && devicePositionSec < 3) {
      return false;
    }

    return true;
  }

  resetAutoNextTimer(devicePositionSec?: number): void {
    this.stopCheckTimer();
    this.clearVoiceSuspend();
    if (!this.autoAdvance) return;
    const song = this.getCurrentSong();
    if (!song || song.duration <= 0) return;

    let remaining: number;
    if (typeof devicePositionSec === 'number' && devicePositionSec >= 0) {
      remaining = song.duration - devicePositionSec;
      this.playStartTimeMs = Date.now() - devicePositionSec * 1000;
    } else if (this.playStartTimeMs > 0) {
      const elapsedSec = (Date.now() - this.playStartTimeMs) / 1000;
      remaining = song.duration - elapsedSec;
    } else {
      return;
    }

    if (remaining > 0) {
      this.startCheckTimer(remaining);
      songloft.log.info(`[PlaylistManager] Timer reset: remaining=${remaining.toFixed(1)}s`);
    } else {
      // 校准后已到/超过曲尾：立即触发切歌，避免定时器被清掉后卡死
      songloft.log.info(`[PlaylistManager] Timer reset with remaining<=0 (${remaining.toFixed(1)}s), advancing now`);
      this.startCheckTimer(0.1);
    }
  }

  /**
   * 重新推送当前歌曲 URL 到设备（用于语音打断后恢复）
   * 与 resumePlayback() 不同，这里重新发送 URL 而非简单 resume，
   * 因为被语音唤醒打断后设备的 URL 播放状态已被清除。
   */
  async replayCurrent(): Promise<boolean> {
    return this.playCurrent();
  }

  /**
   * 当前 MIoT URL 播放通道没有确认可用的设备级 seek。
   * 不通过重播同一 URL 和改写本地时间来伪造成功，避免 UI 与音箱真实播放错位。
   */
  async seekToPosition(_targetSeconds: number): Promise<boolean> {
    songloft.log.warn('[PlaylistManager] seekToPosition: unsupported by current MIoT URL playback transport');
    return false;
  }

  /**
   * 使用已有歌曲列表初始化播放列表（恢复用）
   */
  initWithSongs(songs: PlayerSong[], startIndex: number, playMode: PlayMode, playlistId: number): void {
    this.songs = songs;
    this.currentIndex = (startIndex >= 0 && startIndex < songs.length) ? startIndex : 0;
    this.playMode = playMode;
    this.playlistId = playlistId;
    this.state = 'idle';
    this.playStartTimeMs = 0;
    this.pausedElapsedSec = 0;
    this.autoAdvance = true;
    this.randomPlayed = new Set();
  }

  // ===== 私有方法 =====

  /**
   * 加载歌单歌曲（通过宿主API桥接）
   * 首次失败会短暂重试一次，缓解宿主桥接瞬时抖动导致的「口令已识别但歌单打不开」。
   */
  private async loadPlaylistSongs(playlistId: number): Promise<boolean> {
    const attempt = async (retry: boolean): Promise<boolean> => {
      try {
        if (playlistId < 0 && this.dynamicOptions.dynamicPlaylistLoader) {
          const songs = await this.dynamicOptions.dynamicPlaylistLoader(playlistId);
          if (!songs || !Array.isArray(songs)) {
            songloft.log.error(`[PlaylistManager] Dynamic playlist loader returned invalid songs: ${playlistId}${retry ? ' (retry)' : ''}`);
            return false;
          }
          this.songs = songs;
          return songs.length > 0;
        }

        // 使用 songloft.playlists.getSongs 桥接调用（与 Go WASM 版本的 hostFunctions.CallRouter 等价）
        // 这样不需要 hostBaseUrl 和 pluginToken，直接通过内部桥接访问数据库
        const songs = normalizePlayerSongs(await songloft.playlists.getSongs(playlistId, { limit: 100000 }));
        songloft.log.info(`[PlaylistManager] loadPlaylistSongs playlistId=${playlistId} returned=${songs.length}${retry ? ' (retry)' : ''}`);
        if (songs.length === 0) {
          return false;
        }
        this.songs = songs;
        return true;
      } catch (e) {
        songloft.log.error(`[PlaylistManager] Failed to load playlist songs playlistId=${playlistId}${retry ? ' (retry)' : ''}: ${String(e)}`);
        return false;
      }
    };

    if (await attempt(false)) {
      return true;
    }

    songloft.log.warn(`[PlaylistManager] loadPlaylistSongs empty or failed, retrying in 500ms playlistId=${playlistId}`);
    await new Promise(r => setTimeout(r, 500));
    if (await attempt(true)) {
      return true;
    }

    // retry 后仍为空/失败：区分「歌单不存在(ID 过期)」与「歌单存在但为空」
    try {
      const pl = await songloft.playlists.getById(playlistId);
      if (!pl) {
        this._lastLoadNotFound = true;
        songloft.log.warn(`[PlaylistManager] playlist ${playlistId} not found (stale ID), signaling caller to refresh index`);
      }
    } catch (e) {
      songloft.log.warn(`[PlaylistManager] getById check failed playlistId=${playlistId}: ${String(e)}`);
    }
    songloft.log.error('[PlaylistManager] Bridge returned invalid songs data for playlist: ' + playlistId);
    return false;
  }

  /**
   * 播放当前索引的歌曲
   */
  private async playCurrent(): Promise<boolean> {
    let attempts = 0;
    while (attempts < this.songs.length) {
      const result = await this.playCurrentOnce();
      if (result === 'played') {
        return true;
      }
      if (result !== 'unplayable') {
        return false;
      }

      const currentSong = this.songs[this.currentIndex];
      if (currentSong?.type !== 'dynamic') {
        return false;
      }

      const nextIdx = this.getNextIndex();
      if (nextIdx < 0 || nextIdx === this.currentIndex) {
        return false;
      }
      songloft.log.warn('[PlaylistManager] Skip unplayable dynamic song: ' + currentSong.title);
      this.currentIndex = nextIdx;
      attempts += 1;
    }
    return false;
  }

  private async playCurrentOnce(): Promise<'played' | 'unplayable' | 'failed'> {
    if (this.currentIndex < 0 || this.currentIndex >= this.songs.length) {
      songloft.log.error('[PlaylistManager] Invalid current index: ' + this.currentIndex);
      return 'failed';
    }

    this.stopCheckTimer();

    const song = this.songs[this.currentIndex];
    if (!song.url && song.type === 'dynamic' && this.dynamicOptions.dynamicSongResolver) {
      const resolved = await this.dynamicOptions.dynamicSongResolver(song);
      if (resolved?.url) {
        Object.assign(song, resolved);
      }
    }

    const config = await this.configManager.getConfig();
    if (config.server_host) {
      setHostBaseUrl(config.server_host);
    }
    const serverHost = getHostBaseUrl();
    if (!serverHost) {
      const message = 'Songloft 访问地址未配置，MIoT 智能音箱无法访问歌曲播放地址。请在插件设置中填写局域网或公网可访问地址。';
      songloft.log.error('[PlaylistManager] ' + message);
      recordSpeakerPlaybackDiagnostic(song, 'failed', message);
      return 'failed';
    }
    if (isLoopbackPlaybackUrl(serverHost)) {
      const message = `Songloft 访问地址是本地回环地址，音箱无法访问：${safePlaybackUrl(serverHost)}`;
      songloft.log.error('[PlaylistManager] ' + message);
      recordSpeakerPlaybackDiagnostic(song, 'failed', message);
      return 'failed';
    }
    const forceMp3 = !!config.force_mp3;

    // 构造播放URL
    const songURL = await URLBuilder.buildSongURL(song, { forceMp3 });
    if (!songURL) {
      songloft.log.error('[PlaylistManager] Failed to build song URL: ' + song.title);
      return 'unplayable';
    }

    songloft.log.info(`[PlaylistManager] Playing song index=${this.currentIndex} title=${song.title} artist=${song.artist} duration=${song.duration}`);

    if (isLoopbackPlaybackUrl(songURL)) {
      const message = `播放地址是本地回环地址，音箱无法访问：${safePlaybackUrl(songURL)}`;
      songloft.log.error('[PlaylistManager] ' + message);
      recordSpeakerPlaybackDiagnostic(song, 'failed', message);
      return 'failed';
    }

    // 调用小爱音箱播放
    const startedAt = Date.now();
    const ok = await this.minaService.playURL(this.accountId, this.deviceId, songURL, {
      title: song.title || '',
      artist: song.artist || '',
    });
    if (!ok) {
      const message = `音箱接口未接受播放 URL：${safePlaybackUrl(songURL)}`;
      songloft.log.error('[PlaylistManager] Failed to play URL on device');
      recordSpeakerPlaybackDiagnostic(song, 'failed', message, Date.now() - startedAt);
      return 'failed';
    }
    recordSpeakerPlaybackDiagnostic(
      song,
      'success',
      `音箱接口已接受播放 URL：${safePlaybackUrl(songURL)}`,
      Date.now() - startedAt,
    );

    this.clearVoiceSuspend();
    this.state = 'playing';
    this.playStartTimeMs = Date.now();
    this.pausedElapsedSec = 0;
    // 重新播起来了，上一次 stop 失败的标记不该再影响后续状态上报。
    // 放在这里是因为所有播放入口最终都会走到 playCurrentOnce。
    this.deviceStopConfirmed = true;

    // 如果歌曲时长有效，注册定时器播放下一首
    if (this.autoAdvance && song.duration > 0) {
      // 切歌偏移用于补偿音箱缓冲差异：正数延后、负数提前。
      // 下限 1 秒，避免偏移大于曲长时立刻触发切歌。
      this.startCheckTimer(Math.max(1, song.duration + normalizeTransitionOffset(config.song_transition_offset)));
    } else if (!this.autoAdvance) {
      songloft.log.info('[PlaylistManager] Auto-next timer disabled for standalone playback');
    } else {
      songloft.log.warn('[PlaylistManager] Song duration invalid, no auto-next timer: ' + song.duration);
    }

    if (config.prefetch_next_song !== false) {
      this.prefetchNextSong(forceMp3);
    }

    // 每次切歌都补一次：只在建队列时补的话，队列靠后的歌永远等不到歌词。
    this.fillLyricsAround();

    return 'played';
  }

  /**
   * 为当前曲（及下一曲）按需补内联歌词。
   *
   * 只覆盖「当前 + 下一首」两首，所以不需要对长队列做截断——不像一次性批量补全，
   * 那样要么截断、要么对整个队列发请求。已有 lyric_url 或 lyric_text 的直接跳过。
   * 结果写回 this.songs 里的对象本身，getStatus() 下一次轮询就能带出去。
   */
  private fillLyricsAround(): void {
    const resolve = this.dynamicOptions.songLyricResolver;
    if (!resolve) return;

    const targets: PlayerSong[] = [];
    const current = this.getCurrentSong();
    if (current) targets.push(current);

    if (this.songs.length > 1 && this.playMode !== 'single') {
      const nextIdx = this.getNextIndex();
      if (nextIdx >= 0 && nextIdx !== this.currentIndex) {
        targets.push(this.songs[nextIdx]);
      }
    }

    for (const song of targets) {
      if (!song || song.lyric_url || song.lyric_text || !song.source_data) {
        continue;
      }
      // 打标记避免同一首歌被反复解析（切歌来回跳时会重复进入本函数）
      if (this.lyricFillInFlight.has(song)) continue;
      this.lyricFillInFlight.add(song);

      void resolve(song)
        .then((lyric) => {
          if (lyric) song.lyric_text = lyric;
        })
        .catch((e) => {
          songloft.log.info('[PlaylistManager] lyric fill skipped: ' + String(e));
        })
        .finally(() => {
          this.lyricFillInFlight.delete(song);
        });
    }
  }

  /**
   * 预热下一首：让宿主提前准备好音频（转码/缓存），减少切歌时的冷启动。
   * 宿主对 `?prefetch=1` 返回 202 且不回传音频体，所以这里只发不读。
   *
   * 严格 best-effort：不 await、不改任何播放状态、失败只记日志。
   * 播放命令此时已被音箱接受，预取绝不能反过来影响它。
   */
  private prefetchNextSong(forceMp3: boolean): void {
    if (!this.autoAdvance || this.songs.length < 2) {
      return;
    }

    // 单曲循环时下一首就是当前曲，宿主已在放，无需预热。
    const nextIndex = this.playMode === 'single' ? -1 : this.getNextIndex();
    if (nextIndex < 0 || nextIndex === this.currentIndex) {
      return;
    }

    const nextSong = this.songs[nextIndex];
    if (!nextSong?.url) {
      return;
    }

    void (async () => {
      try {
        const url = await URLBuilder.buildSongURL(nextSong, { forceMp3 });
        // 外部音源直链由对方 CDN 提供，预热无意义也不该替用户打对方流量。
        // 按 origin 比较而不是字符串前缀：前缀匹配会把 host 的近似域名
        // （如 songloft.test.evil.com）误判成同源。
        if (!url || !isSameOrigin(url, getHostBaseUrl())) {
          return;
        }
        await fetchWithTimeout(url + (url.includes('?') ? '&' : '?') + 'prefetch=1', {
          method: 'GET',
          timeoutMs: PREFETCH_TIMEOUT_MS,
        });
      } catch (e) {
        songloft.log.info('[PlaylistManager] prefetch next song skipped: ' + String(e));
      }
    })();
  }

  /**
   * 获取下一首索引（根据播放模式）
   * @returns 下一首索引，-1表示没有下一首
   */
  private getNextIndex(): number {
    const len = this.songs.length;
    if (len === 0) return -1;

    switch (this.playMode) {
      case 'order':
      case 'once':
        // 顺序播放：到末尾停止
        if (this.currentIndex < len - 1) {
          return this.currentIndex + 1;
        }
        return -1; // 没有下一首

      case 'loop':
        // 列表循环
        return (this.currentIndex + 1) % len;

      case 'single':
        // 单曲循环：一直播放当前歌曲
        return this.currentIndex;

      case 'random':
        // 随机播放：避免重复直到全部播完
        this.randomPlayed.add(this.currentIndex);

        // 如果所有歌曲都播放过了，重置
        if (this.randomPlayed.size >= len) {
          this.randomPlayed = new Set();
        }

        // 找到未播放的歌曲
        const unplayed: number[] = [];
        for (let i = 0; i < len; i++) {
          if (!this.randomPlayed.has(i)) {
            unplayed.push(i);
          }
        }

        if (unplayed.length === 0) {
          return Math.floor(Math.random() * len);
        }

        return unplayed[Math.floor(Math.random() * unplayed.length)];

      default:
        return -1;
    }
  }

  /**
   * 获取上一首索引
   * @returns 上一首索引，-1表示没有上一首
   */
  private getPreviousIndex(): number {
    const len = this.songs.length;
    if (len === 0) return -1;

    switch (this.playMode) {
      case 'order':
      case 'once':
        // 顺序播放：到第一首停止
        if (this.currentIndex > 0) {
          return this.currentIndex - 1;
        }
        return -1;

      case 'loop':
        // 列表循环：第一首回到最后一首
        if (this.currentIndex > 0) {
          return this.currentIndex - 1;
        }
        return len - 1;

      case 'single':
        // 单曲循环：重复当前
        return this.currentIndex;

      case 'random':
        // 随机模式：简单返回前一首
        if (this.currentIndex > 0) {
          return this.currentIndex - 1;
        }
        return len - 1;

      default:
        if (this.currentIndex > 0) {
          return this.currentIndex - 1;
        }
        return -1;
    }
  }

  /**
   * 启动切歌定时器（基于歌曲时长）
   * @param durationSec - 歌曲时长（秒）
   */
  private startCheckTimer(durationSec: number): void {
    this.stopCheckTimer();

    const delayMs = Math.floor(durationSec * 1000);
    songloft.log.info('[PlaylistManager] Timer registered delayMs=' + delayMs);

    this.checkTimer = setTimeout(() => {
      this.onSongFinished().catch(e => {
        songloft.log.error('[PlaylistManager] onSongFinished error: ' + String(e));
      });
    }, delayMs);
  }

  /**
   * 停止定时器
   */
  private stopCheckTimer(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * 歌曲播放结束回调
   * 设备超时(code=3012) 等瞬时失败时：重试当前曲 → 仍失败则跳下一首 → 再失败才停止。
   */
  private async onSongFinished(): Promise<void> {
    if (this.state !== 'playing') {
      songloft.log.info('[PlaylistManager] Not playing, skip auto-next');
      return;
    }

    // 通知后端当前歌曲播放完成（触发 JS 插件播放事件广播）
    const finishedSong = this.songs[this.currentIndex];
    if (finishedSong && finishedSong.id > 0) {
      callHostAPI('POST', `/api/v1/songs/${finishedSong.id}/played?source=miot`).catch(e => {
        songloft.log.warn('[PlaylistManager] songPlayed notify failed: ' + String(e));
      });
    }

    if (this.playMode === 'once') {
      songloft.log.info('[PlaylistManager] Once mode complete, stopping');
      this.state = 'stopped';
      this.playStartTimeMs = 0;
      return;
    }

    const nextIdx = this.getNextIndex();
    if (nextIdx < 0) {
      songloft.log.info('[PlaylistManager] No next song, playback complete');
      this.state = 'stopped';
      this.playStartTimeMs = 0;
      return;
    }

    this.currentIndex = nextIdx;
    const ok = await this.playCurrent();
    if (ok) {
      await this.persistState();
      return;
    }

    // 第一次失败（常见于设备超时 code=3012），等 3 秒重试当前歌曲
    const retryIndex = this.currentIndex;
    songloft.log.warn('[PlaylistManager] Auto-next play failed, retrying in 3s');
    await new Promise(r => setTimeout(r, 3000));
    if (this.state !== 'playing' || this.currentIndex !== retryIndex) {
      return;
    }

    const retryOk = await this.playCurrent();
    if (retryOk) {
      await this.persistState();
      return;
    }

    // 重试仍失败，尝试跳到下一首
    const skipIdx = this.getNextIndex();
    if (skipIdx >= 0 && skipIdx !== this.currentIndex) {
      songloft.log.warn('[PlaylistManager] Retry failed, skipping to next song');
      this.currentIndex = skipIdx;
      const skipOk = await this.playCurrent();
      if (skipOk) {
        await this.persistState();
        return;
      }
    }

    songloft.log.error('[PlaylistManager] Auto-next failed after retry, stopping');
    this.state = 'stopped';
    this.playStartTimeMs = 0;
  }

  /**
   * 持久化播放状态到设备配置
   */
  private async persistState(): Promise<void> {
    try {
      await this.configManager.updateDevice(this.accountId, this.deviceId, {
        playlist_id: this.playlistId,
        current_song_index: this.currentIndex,
        play_mode: this.playMode,
      });
    } catch (e) {
      songloft.log.warn('[PlaylistManager] Failed to persist state: ' + String(e));
    }
  }
}

// ===== PlaylistManagerMap - 多设备播放管理器集合 =====

/**
 * PlaylistManagerMap - 管理多个设备的播放管理器实例
 * key格式: "accountId:deviceId"
 */
export class PlaylistManagerMap {
  private managers: Map<string, PlaylistManager> = new Map();
  private minaService: MinaService;
  private configManager: ConfigManager;
  private dynamicOptions: DynamicPlaylistOptions = {};

  constructor(minaService: MinaService, configManager: ConfigManager) {
    this.minaService = minaService;
    this.configManager = configManager;
  }

  setDynamicPlaylistOptions(options: DynamicPlaylistOptions): void {
    this.dynamicOptions = options;
  }

  /**
   * 获取或创建播放管理器
   * 若设备配置中存有 playlistId，则自动恢复播放列表（不自动开始播放）
   */
  async getOrCreate(accountId: string, deviceId: string): Promise<PlaylistManager> {
    const key = this.makeKey(accountId, deviceId);
    const existing = this.managers.get(key);
    if (existing) {
      return existing;
    }

    // 创建新的播放管理器
    const manager = new PlaylistManager(accountId, deviceId, this.minaService, this.configManager, this.dynamicOptions);
    this.managers.set(key, manager);

    // 尝试从配置中恢复播放列表状态（不自动播放）
    await this.restoreFromConfig(manager, accountId, deviceId);

    return manager;
  }

  /**
   * 获取指定设备的管理器（不存在返回null）
   */
  get(accountId: string, deviceId: string): PlaylistManager | null {
    const key = this.makeKey(accountId, deviceId);
    return this.managers.get(key) ?? null;
  }

  /**
   * 移除管理器
   */
  remove(accountId: string, deviceId: string): void {
    const key = this.makeKey(accountId, deviceId);
    const manager = this.managers.get(key);
    if (manager) {
      manager.cleanup();
    }
    this.managers.delete(key);
  }

  /**
   * 清理所有管理器
   */
  cleanup(): void {
    for (const manager of this.managers.values()) {
      manager.cleanup();
    }
    this.managers.clear();
  }

  /**
   * 获取所有管理器的设备Key列表
   */
  keys(): string[] {
    return Array.from(this.managers.keys());
  }

  // ===== 内部方法 =====

  private makeKey(accountId: string, deviceId: string): string {
    return accountId + ':' + deviceId;
  }

  /**
   * 从配置中恢复播放列表（不自动播放）
   */
  private async restoreFromConfig(manager: PlaylistManager, accountId: string, deviceId: string): Promise<void> {
    try {
      const devices = await this.configManager.getDevices(accountId);
      const devCfg = devices.find(d => d.device_id === deviceId);
      if (!devCfg || !devCfg.playlist_id || devCfg.playlist_id <= 0) {
        return;
      }

      // 使用 songloft.playlists.getSongs 桥接调用加载歌单歌曲
      let songs: PlayerSong[] = [];
      try {
        if (devCfg.playlist_id < 0 && this.dynamicOptions.dynamicPlaylistLoader) {
          const result = await this.dynamicOptions.dynamicPlaylistLoader(devCfg.playlist_id);
          if (result && Array.isArray(result)) {
            songs = result;
          }
        } else {
          songs = normalizePlayerSongs(await songloft.playlists.getSongs(devCfg.playlist_id, { limit: 100000 }));
        }
      } catch (e) {
        songloft.log.warn('[PlaylistManagerMap] Failed to load songs via bridge: ' + String(e));
      }

      if (songs.length > 0) {
        const startIndex = devCfg.current_song_index || 0;
        const playMode = (devCfg.play_mode || 'order') as PlayMode;
        manager.initWithSongs(songs, startIndex, playMode, devCfg.playlist_id);
        songloft.log.info(`[PlaylistManagerMap] Restored playlist from config playlistId=${devCfg.playlist_id} index=${startIndex} mode=${playMode}`);
      }
    } catch (e) {
      songloft.log.warn('[PlaylistManagerMap] Failed to restore playlist from config: ' + String(e));
    }
  }
}
