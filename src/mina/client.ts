// MIoT 智能音箱插件 - Mina HTTP 客户端
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/pkg/mina/mina_client.go
// 设备控制 API 客户端：设备列表、播放控制、音量、TTS、对话记录

import { CookieJar } from '../utils/cookie';
import { fetchWithRedirects } from '../utils/http';
import { generateDeviceId } from '../utils/crypto';
import { isPollDebug } from '../utils/debug';
import {
  MINA_API_BASE_URL,
  MINA_SID,
  XIAOMI_IO_SID,
  SERVICE_TOKEN_VALID_HOURS,
  MAX_RETRIES,
  formatUserAgent,
  formatLatestAskUrl,
  shouldUseMinaForAsk,
  needUsePlayMusicAPI,
  getTTSCommand,
} from './constants';
import { MiIOClient } from './miio_client';
import type { XiaomiTokenInfo, MinaDevice, AskMessage } from '../types';
import type { DeviceInfoRaw, DeviceListResponse, UbusResponse, NlpResultData, NlpInfoData, NlpDetail, ConversationData, MusicSearchResponse } from './models';

const DEFAULT_MUSIC_AUDIO_ID = '1732418460076477549';
const MUSIC_CP_ID = '355454500';
const PLAY_STATUS_PLAYING = 1;
const PAUSE_VERIFY_ATTEMPTS = 2;
const PAUSE_VERIFY_DELAY_MS = 700;

type UbusQueueKind = 'default' | 'conversation';

interface UbusQueueEntry {
  kind: UbusQueueKind;
  canceled: boolean;
  done: Promise<void>;
  cancelPromise: Promise<void>;
  release(): void;
  cancel(): void;
}

export type PauseVerificationResult = 'paused' | 'stopped' | 'failed';

function parseSafePositiveTimestamp(value: unknown): number | null {
  const timestamp = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  // Xiaomi conversation APIs have returned both second- and millisecond-epoch
  // values. Normalize short second-based stamps to ms so UI "recent" filters
  // and since= query params (local Date.now() ms) do not drop every record.
  const asInt = Math.trunc(timestamp);
  if (!Number.isSafeInteger(asInt)) {
    return null;
  }
  // < 1e12 ≈ before 2001-09 in ms, but is a valid ~2001+ second timestamp.
  return asInt < 1_000_000_000_000 ? asInt * 1000 : asInt;
}

export interface PlayMetadata {
  title: string;
  artist?: string;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const direct = stringValue(value);
    if (direct) return direct;

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const nested = firstText(
        record.text,
        record.to_speak,
        record.toSpeak,
        record.displayText,
        record.display_text,
        record.answer,
        record.content,
      );
      if (nested) return nested;
    }
  }

  return '';
}

/** Starlight-hardened conversation answer extraction (broader than TTS-only). */
export function extractConversationAnswerText(record: unknown): string {
  if (!record || typeof record !== 'object') return '';

  const item = record as Record<string, unknown>;
  const answers = Array.isArray(item.answers) ? item.answers : [];
  for (const answer of answers) {
    if (!answer || typeof answer !== 'object') continue;
    const ans = answer as Record<string, unknown>;
    const tts = ans.tts && typeof ans.tts === 'object' ? ans.tts as Record<string, unknown> : {};
    const text = firstText(
      tts.text,
      ans.text,
      ans.content,
      ans.displayText,
      ans.display_text,
      ans.answer,
      ans.value,
    );
    if (text) return text;
  }

  return firstText(item.answer, item.text, item.content, item.displayText, item.display_text);
}

/**
 * MinaHTTPClient - 小爱音箱 API 客户端
 * 提供设备控制、播放管理、对话记录获取等功能
 */
export class MinaHTTPClient {
  private tokenInfo: XiaomiTokenInfo;
  private userAgent: string;
  private onTokenExpired?: () => Promise<boolean>;
  private ubusQueues: Map<string, UbusQueueEntry> = new Map();
  /** Conversation requests need an explicit release path on hosts without AbortController. */
  private ubusConversationQueues: Map<string, UbusQueueEntry> = new Map();
  private latestConversationQueueKeys: Map<string, string> = new Map();
  /** Latest poll generation per device; cancellation invalidates every stale continuation. */
  private conversationPollGenerations: Map<string, number> = new Map();
  private latestConversationPollIds: Map<string, string> = new Map();
  private conversationPollSequence = 0;
  private conversationQueueSequence = 0;
  private mediaOperationGenerations: Map<string, number> = new Map();

  constructor(tokenInfo: XiaomiTokenInfo, onTokenExpired?: () => Promise<boolean>) {
    this.tokenInfo = tokenInfo;
    this.userAgent = formatUserAgent(tokenInfo.device_id);
    this.onTokenExpired = onTokenExpired;
  }

  /**
   * 从手动输入的 token 创建客户端
   */
  static fromManualToken(userId: string, serviceToken: string, ssecurity = ''): MinaHTTPClient {
    const deviceId = generateDeviceId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SERVICE_TOKEN_VALID_HOURS * 3600 * 1000);

    const tokenInfo: XiaomiTokenInfo = {
      user_id: userId,
      device_id: deviceId,
      services: {
        [MINA_SID]: {
          service_token: serviceToken,
          ssecurity,
          expires_at: expiresAt.getTime(),
        },
      },
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    return new MinaHTTPClient(tokenInfo);
  }

  /** 获取当前 token 信息 */
  getTokenInfo(): XiaomiTokenInfo {
    return this.tokenInfo;
  }

  /** 更新 token 信息（用于 token 刷新后同步） */
  updateTokenInfo(newInfo: XiaomiTokenInfo): void {
    this.tokenInfo = newInfo;
    this.userAgent = formatUserAgent(newInfo.device_id);
  }

  /** 设置 token 过期回调 */
  setOnTokenExpired(fn: () => Promise<boolean>): void {
    this.onTokenExpired = fn;
  }

  /** 检查 token 是否有效 */
  isTokenValid(): boolean {
    if (!this.tokenInfo || !this.tokenInfo.user_id) return false;
    const svc = this.tokenInfo.services[MINA_SID];
    if (!svc || !svc.service_token) return false;
    if (svc.expires_at && Date.now() > svc.expires_at) return false;
    return true;
  }

  // ===== 设备相关 =====

  /**
   * 获取设备列表
   */
  async getDeviceList(): Promise<MinaDevice[]> {
    const apiUrl = `${MINA_API_BASE_URL}/admin/v2/device_list?master=1`;
    const result = await this.doGetRequest<DeviceListResponse>(apiUrl);
    // data 偶尔会是 null/对象（账号无设备或上游异常），非数组时直接返回空列表，避免 .map 抛错
    if (!result || result.code !== 0 || !Array.isArray(result.data)) {
      return [];
    }

    return result.data.map((d: DeviceInfoRaw) => ({
      deviceID: d.deviceID,
      name: d.name,
      miotDID: d.miotDID,
      model: d.model,
      hardware: d.hardware,
      alias: d.alias,
      presence: d.presence,
    }));
  }

  // ===== 播放控制 =====

  /**
   * 播放音乐 URL（根据设备型号自动选择方法）
   * @param deviceId - 设备 ID
   * @param url - 音频 URL
   * @param hardware - 设备硬件型号（用于选择播放方法）
   * @param extraModels - 用户自定义的额外 Music API 型号列表
   * @param lyricsMode - 触屏歌词模式：仅在 Music API 播放路径上启用，
   *   逐首搜小米曲库匹配真实 audioID（搜不到回退 customAudioId），使触屏音箱显示歌词。
   *   参考 xiaomusic：player_play_music 有兼容性风险，非兼容型号仍走 player_play_url。
   */
  async playByUrl(deviceId: string, url: string, hardware = '', extraModels?: string[], keepLight = false, customAudioId?: string, lyricsMode?: { enabled: boolean; songName?: string; metadata?: PlayMetadata }): Promise<boolean> {
    const useMusicAPI = hardware ? needUsePlayMusicAPI(hardware, extraModels) : false;
    if (useMusicAPI) {
      const fallbackAudioId = customAudioId || DEFAULT_MUSIC_AUDIO_ID;
      if (lyricsMode?.enabled) {
        const audioId = await this.searchAudioId(lyricsMode.metadata || lyricsMode.songName || '', fallbackAudioId);
        const displayName = this.formatPlayMetadataForLog(lyricsMode.metadata || lyricsMode.songName || '');
        songloft.log.info(`[MinaClient] touchscreen lyrics selected audioID=${audioId} fallbackAudioID=${fallbackAudioId} song=${displayName}`);
        // xiaomusic 的 continue_play 通过 _type=1 设置 audio_type=MUSIC；这是触屏歌词/封面的前提。
        const ok = await this.playByMusicURL(deviceId, url, true, audioId, 'play-music:lyrics');
        if (ok) {
          return true;
        }

        if (audioId !== fallbackAudioId) {
          songloft.log.warn(`[MinaClient] searched audioID failed, retrying default audioID=${fallbackAudioId} in touchscreen lyrics mode`);
          const defaultLyricsOK = await this.playByMusicURL(deviceId, url, true, fallbackAudioId, 'play-music:lyrics-default');
          if (defaultLyricsOK) {
            return true;
          }
        }

        songloft.log.warn('[MinaClient] playByMusicURL failed in touchscreen lyrics mode, retrying normal Music API playback');
        const normalMusicOK = await this.playByMusicURL(deviceId, url, keepLight, fallbackAudioId, 'play-music:fallback');
        if (normalMusicOK) {
          return true;
        }

        songloft.log.warn(`[MinaClient] Music API fallback failed hardware=${hardware || 'unknown'}, trying player_play_url`);
        return this.playURL(deviceId, url, keepLight);
      }

      // 兼容型号（LX05/LX06/L15A 等）优先 player_play_music；部分固件/格式下会失败，
      // 必须回退 player_play_url，否则表现为「口令已识别但音箱完全无反应」。
      const musicOK = await this.playByMusicURL(deviceId, url, keepLight, fallbackAudioId, 'play-music');
      if (musicOK) {
        return true;
      }
      songloft.log.warn(`[MinaClient] player_play_music failed hardware=${hardware || 'unknown'}, falling back to player_play_url`);
      return this.playURL(deviceId, url, keepLight);
    }
    return this.playURL(deviceId, url, keepLight);
  }

  /**
   * 搜索小米官方曲库匹配歌曲，返回真实 audioID（供触屏音箱拉取歌词/封面）
   * 参照 xiaomusic _get_audio_id：按「歌名完全相等 + 歌手包含匹配」精确命中
   * @param target - 歌曲信息；字符串参数兼容旧的「歌名-歌手」格式
   * @param fallbackAudioId - 默认封面/歌词 ID；无结果或失败时返回
   * @returns 匹配到的 audioID；无结果或失败返回 fallbackAudioId
   */
  async searchAudioId(target: string | PlayMetadata, fallbackAudioId = DEFAULT_MUSIC_AUDIO_ID): Promise<string> {
    let audioId = fallbackAudioId || DEFAULT_MUSIC_AUDIO_ID;
    const parsed = this.normalizePlayMetadata(target);
    const query = parsed.artist ? `${parsed.title}-${parsed.artist}` : parsed.title;
    if (!query) {
      songloft.log.info('[MinaClient] searchAudioId empty name, using default audioID');
      return audioId;
    }

    const params: Record<string, string> = {
      query,
      queryType: '1',
      offset: '0',
      count: '6',
      // xiaomusic 用的是毫秒时间戳 int(time.time() * 1000)，Date.now() 本身即毫秒，不能再乘 1000
      timestamp: String(Date.now()),
      requestId: this.generateRequestId(),
    };
    const body = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const result = await this.doPostRequest<MusicSearchResponse>(
      `${MINA_API_BASE_URL}/music/search`,
      body,
      '',
      this.preserveMusicSearchIDStrings,
    );
    const songList = result?.data?.songList;
    // 上游偶尔把 songList 返成对象/null，必须先判数组，否则 slice 抛错会中断整条播放链路
    if (!Array.isArray(songList) || songList.length === 0) {
      songloft.log.info(`[MinaClient] searchAudioId no match for: ${query}, using default audioID=${audioId}`);
      return audioId;
    }

    const selectedReason = 'first-result';

    const candidates = songList.slice(0, 6).map((song, index) => ({
      index,
      audioID: song.audioID || '',
      songID: song.songID || '',
      name: song.name || '',
      artist: song.artist?.name || '',
    }));
    songloft.log.info(`[MinaClient] searchAudioId candidates query=${query} fallbackAudioID=${fallbackAudioId} candidates=${this.summarizeForLog(candidates, 1200)}`);
    songloft.log.info(`[MinaClient] searchAudioId rawSongs query=${query} resultCode=${result?.code ?? 'unknown'} rawSongs=${this.summarizeForLog(songList.slice(0, 6), 4000)}`);

    audioId = songList[0].audioID || audioId;

    const targetSong = parsed.title;
    let firstArtist = parsed.artist;
    if (firstArtist) {
      for (const sep of [';', '；', ',', '，', '&', '、', '/']) {
        firstArtist = firstArtist.split(sep).join('|');
      }
      firstArtist = firstArtist.split('|')[0].trim();
    }

    for (const song of songList) {
      const sName = song.name || '';
      const sArtist = song.artist?.name || '';
      if (targetSong.toLowerCase() === sName.toLowerCase()) {
        if (!firstArtist || sArtist.toLowerCase().includes(firstArtist.toLowerCase())) {
          audioId = song.audioID || audioId;
          break;
        }
      }
    }

    songloft.log.info(`[MinaClient] searchAudioId selected query=${query} audioID=${audioId} reason=${selectedReason} targetSong=${targetSong} targetArtist=${firstArtist || ''}`);
    return audioId;
  }

  private normalizePlayMetadata(target: string | PlayMetadata): PlayMetadata {
    if (typeof target !== 'string') {
      return {
        title: (target.title || '').trim(),
        artist: (target.artist || '').trim(),
      };
    }

    const query = (target || '').trim();
    const dashIdx = query.lastIndexOf('-');
    if (dashIdx < 0) {
      return { title: query, artist: '' };
    }
    return {
      title: query.slice(0, dashIdx).trim(),
      artist: query.slice(dashIdx + 1).trim(),
    };
  }

  private formatPlayMetadataForLog(target: string | PlayMetadata): string {
    const metadata = this.normalizePlayMetadata(target);
    return metadata.artist ? `${metadata.title}-${metadata.artist}` : metadata.title;
  }

  /**
   * 使用 player_play_url 播放 URL
   */
  async playURL(deviceId: string, url: string, keepLight = false): Promise<boolean> {
    this.beginMediaOperation(deviceId);
    const message = { url, type: keepLight ? 1 : 2, media: 'app_ios' };
    const result = await this.ubusRequest(deviceId, 'player_play_url', 'mediaplayer', message, 'play-url');
    return this.isDeviceResultOK(result, 'player_play_url');
  }

  /**
   * 使用 player_play_music 播放 URL（用于部分设备型号）
   */
  async playByMusicURL(deviceId: string, audioUrl: string, keepLight = false, customAudioId?: string, logLabel = 'play-music'): Promise<boolean> {
    this.beginMediaOperation(deviceId);
    // 默认封面
    const audioId = customAudioId || DEFAULT_MUSIC_AUDIO_ID;

    const music = {
      payload: {
        audio_type: keepLight ? 'MUSIC' : '',
        audio_items: [{
          item_id: {
            audio_id: audioId,
            cp: {
              album_id: '-1',
              episode_index: 0,
              id: MUSIC_CP_ID,
              name: 'xiaowei',
            },
          },
          stream: { url: audioUrl },
        }],
        list_params: {
          listId: '-1',
          loadmore_offset: 0,
          origin: 'xiaowei',
          type: 'MUSIC',
        },
      },
      play_behavior: 'REPLACE_ALL',
    };

    const message = {
      startaudioid: audioId,
      music: JSON.stringify(music),
    };

    const result = await this.ubusRequest(deviceId, 'player_play_music', 'mediaplayer', message, logLabel);
    return this.isDeviceResultOK(result, 'player_play_music');
  }

  private async playerOperation(deviceId: string, action: 'play' | 'pause' | 'stop'): Promise<boolean> {
    const message = { action, media: 'app_ios' };
    const result = await this.ubusRequest(
      deviceId,
      'player_play_operation',
      'mediaplayer',
      message,
      'play-op:' + action,
    );
    return this.isDeviceResultOK(result, 'player_play_operation:' + action);
  }

  private beginMediaOperation(deviceId: string): number {
    const generation = (this.mediaOperationGenerations.get(deviceId) ?? 0) + 1;
    this.mediaOperationGenerations.set(deviceId, generation);
    return generation;
  }

  private isMediaOperationCurrent(deviceId: string, generation: number): boolean {
    return this.mediaOperationGenerations.get(deviceId) === generation;
  }

  /**
   * 播放操作（play）
   */
  async playerPlay(deviceId: string): Promise<boolean> {
    this.beginMediaOperation(deviceId);
    return this.playerOperation(deviceId, 'play');
  }

  /**
   * 暂停播放
   */
  async playerPause(deviceId: string): Promise<boolean> {
    this.beginMediaOperation(deviceId);
    return this.playerOperation(deviceId, 'pause');
  }

  async playerPauseVerified(deviceId: string): Promise<PauseVerificationResult> {
    const generation = this.beginMediaOperation(deviceId);
    await this.playerOperation(deviceId, 'pause');
    if (!this.isMediaOperationCurrent(deviceId, generation)) return 'failed';

    for (let attempt = 0; attempt < PAUSE_VERIFY_ATTEMPTS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, PAUSE_VERIFY_DELAY_MS));
      if (!this.isMediaOperationCurrent(deviceId, generation)) return 'failed';

      const status = await this.readPlayStatus(deviceId);
      if (!this.isMediaOperationCurrent(deviceId, generation)) return 'failed';
      if (status < 0) {
        songloft.log.warn(`[MinaClient] pause verification returned unknown status device=${deviceId}`);
        return 'failed';
      }
      if (status !== PLAY_STATUS_PLAYING) {
        return 'paused';
      }
    }

    if (!this.isMediaOperationCurrent(deviceId, generation)) return 'failed';
    songloft.log.warn(`[MinaClient] pause ignored by device=${deviceId} (still playing), escalating to stop`);
    if (await this.playerOperation(deviceId, 'stop')) {
      return 'stopped';
    }
    return 'failed';
  }

  /**
   * 恢复播放
   */
  async playerResume(deviceId: string): Promise<boolean> {
    this.beginMediaOperation(deviceId);
    return this.playerOperation(deviceId, 'play');
  }

  /**
   * 停止播放
   */
  async playerStop(deviceId: string): Promise<boolean> {
    const generation = this.beginMediaOperation(deviceId);
    // 部分小爱音箱型号单独调用 stop 不会真正停止播放，先暂停再停止
    await this.playerOperation(deviceId, 'pause');
    if (!this.isMediaOperationCurrent(deviceId, generation)) return false;
    return this.playerOperation(deviceId, 'stop');
  }

  async readPlayStatus(deviceId: string): Promise<number> {
    const result = await this.getPlayerStatus(deviceId);
    const info = result && typeof result.data === 'object' && result.data !== null
      ? (result.data as Record<string, unknown>).info
      : undefined;
    if (typeof info !== 'string') return -1;

    try {
      const parsed = JSON.parse(info) as Record<string, unknown>;
      return typeof parsed.status === 'number' && Number.isFinite(parsed.status) ? parsed.status : -1;
    } catch {
      return -1;
    }
  }

  // ===== 音量 =====

  /**
   * 设置音量 (0-100)
   */
  async setVolume(deviceId: string, volume: number): Promise<boolean> {
    const v = Math.max(0, Math.min(100, Math.floor(volume)));
    const message = { volume: v };
    return (await this.ubusRequest(deviceId, 'player_set_volume', 'mediaplayer', message)) !== null;
  }

  /**
   * 获取音量
   */
  async getVolume(deviceId: string): Promise<number> {
    const result = await this.getPlayerStatus(deviceId);
    if (result && typeof result.data === 'object' && result.data !== null) {
      const data = result.data as Record<string, unknown>;
      const info = data['info'];
      if (typeof info === 'string') {
        try {
          const parsed = JSON.parse(info);
          if (typeof parsed.volume === 'number') {
            return parsed.volume;
          }
        } catch {}
      }
    }
    return -1;
  }

  // ===== TTS =====

  /**
   * 文字转语音
   *
   * 优先走 mibrain/text_to_speech（多数固件真正的语音播报入口），
   * 失败再回退到旧的 mediaplayer/player_play_tts（部分老设备）。
   */
  async textToSpeech(deviceId: string, text: string, options?: { hardware?: string; miotDID?: string }): Promise<boolean> {
    const textLength = text.length;
    const hardware = options?.hardware || '';
    const miotDID = options?.miotDID || '';
    const ttsCommand = getTTSCommand(hardware);

    if (ttsCommand) {
      if (miotDID && this.hasXiaomiIOToken()) {
        try {
          songloft.log.info(`[MinaClient] textToSpeech using MiIO TTS command hardware=${hardware} did=${miotDID} command=${ttsCommand} text_length=${textLength}`);
          const ok = await new MiIOClient(this.tokenInfo).textToSpeechByCommand(miotDID, ttsCommand, text);
          if (ok) {
            return true;
          }
          songloft.log.warn(`[MinaClient] MiIO TTS command failed, falling back to Mina UBus hardware=${hardware} device=${deviceId}`);
        } catch (e) {
          songloft.log.warn(`[MinaClient] MiIO TTS command error, falling back to Mina UBus hardware=${hardware} device=${deviceId}: ${String(e)}`);
        }
      } else {
        songloft.log.warn(`[MinaClient] MiIO TTS command unavailable hardware=${hardware} did=${miotDID || ''} has_xiaomiio=${this.hasXiaomiIOToken()}`);
      }
    }

    const message = { text };
    songloft.log.info(`[MinaClient] textToSpeech start device=${deviceId} hardware=${hardware} text_length=${textLength}`);

    const mibrainResult = await this.ubusRequest(deviceId, 'text_to_speech', 'mibrain', message, 'tts:mibrain');
    if (mibrainResult !== null) {
      songloft.log.info(`[MinaClient] textToSpeech success endpoint=mibrain/text_to_speech device=${deviceId} code=${mibrainResult.code}`);
      return true;
    }
    songloft.log.warn(`[MinaClient] text_to_speech/mibrain failed, falling back to player_play_tts/mediaplayer device=${deviceId}`);

    const fallbackResult = await this.ubusRequest(deviceId, 'player_play_tts', 'mediaplayer', message, 'tts:mediaplayer');
    if (fallbackResult !== null) {
      songloft.log.info(`[MinaClient] textToSpeech success endpoint=mediaplayer/player_play_tts device=${deviceId} code=${fallbackResult.code}`);
      return true;
    }

    songloft.log.warn(`[MinaClient] textToSpeech failed on all endpoints device=${deviceId} text_length=${textLength}`);
    return false;
  }

  private hasXiaomiIOToken(): boolean {
    const service = this.tokenInfo.services[XIAOMI_IO_SID];
    return !!(service && service.service_token && service.ssecurity && (!service.expires_at || service.expires_at > Date.now()));
  }

  // ===== 对话记录 =====

  /**
   * 获取最新对话记录（自动选择获取方式）
   * @param deviceId - 设备 ID
   * @param hardware - 设备硬件型号
   * @param limit - 记录数量限制（默认2）
   */
  async getLatestAskFromXiaoai(
    deviceId: string,
    hardware: string,
    limit = 2,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<AskMessage[] | null> {
    const pollGeneration = (this.conversationPollGenerations.get(deviceId) ?? 0) + 1;
    this.conversationPollGenerations.set(deviceId, pollGeneration);
    const pollRequestId = requestId || `conversation-${++this.conversationPollSequence}`;
    this.latestConversationPollIds.set(deviceId, pollRequestId);
    const useUbusFirst = shouldUseMinaForAsk(hardware);
    if (isPollDebug()) {
      songloft.log.info(
        `[ConversationMonitor] getLatestAskFromXiaoai deviceId=${deviceId} hardware=${hardware || '(empty)'} limit=${limit} path=${useUbusFirst ? 'ubus' : 'xiaoai'}`,
      );
    }

    try {
      // 部分设备（如 M01）优先 ubus
      if (useUbusFirst) {
        const ubusResult = await this.getLatestAskByUbus(deviceId, signal, pollRequestId);
        if (!this.isConversationPollCurrent(deviceId, pollGeneration, signal)) {
          return null;
        }
        if (ubusResult !== null) {
          return ubusResult;
        }
        songloft.log.warn(`[ConversationMonitor] getLatestAskByUbus failed for ${deviceId}, trying xiaoai API fallback`);
      }

      // 与 Go 版一致：在循环外部生成时间戳，重试时复用相同 URL
      const timestamp = Date.now();
      const apiUrl = formatLatestAskUrl(hardware || '', timestamp, limit);
      if (isPollDebug()) songloft.log.info(`[ConversationMonitor] getLatestAskFromXiaoai apiUrl=${apiUrl}`);

      // 大多数设备通过 xiaoai API 获取
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const messages = await this.doGetLatestAskFromXiaoai(deviceId, apiUrl, signal);
        if (!this.isConversationPollCurrent(deviceId, pollGeneration, signal)) {
          return null;
        }
        if (messages !== null) {
          return messages;
        }
        if (attempt + 1 < MAX_RETRIES) {
          songloft.log.warn(`[ConversationMonitor] getLatestAskFromXiaoai attempt=${attempt} failed, retrying...`);
        }
      }

      // xiaoai 失败时对非 ubus 优先设备再试 ubus（部分触屏/新固件 API 异常）
      if (!useUbusFirst) {
        const ubusFallback = await this.getLatestAskByUbus(deviceId, signal, pollRequestId);
        if (!this.isConversationPollCurrent(deviceId, pollGeneration, signal)) {
          return null;
        }
        if (ubusFallback !== null) {
          songloft.log.info(`[ConversationMonitor] xiaoai failed, ubus fallback ok count=${ubusFallback.length}`);
          return ubusFallback;
        }
      }

      songloft.log.warn(`[ConversationMonitor] getLatestAskFromXiaoai all paths failed device=${deviceId} hardware=${hardware || '(empty)'}`);
      return null;
    } finally {
      if (this.latestConversationPollIds.get(deviceId) === pollRequestId) {
        this.latestConversationPollIds.delete(deviceId);
      }
    }
  }

  // ===== 播放状态 =====

  /**
   * 获取播放器状态
   */
  async getPlayerStatus(deviceId: string): Promise<UbusResponse | null> {
    return this.ubusRequest(deviceId, 'player_get_play_status', 'mediaplayer', {});
  }

  /**
   * 验证 Token 有效性（通过调用 API）
   *
   * 直接判定底层响应：token 有效时 device_list 返回 code=0（即使账号名下没有
   * 任何设备也是 code=0，返回 true）；token 失效时 doGetRequest 遇 401 返回 null，
   * 返回 false。
   *
   * 不能复用 getDeviceList()：它把 401/网络失败兜底成空数组 []，而 `[] !== null`
   * 恒为 true，会让失效 token 被误判为有效——token 过期后刷新链条持续「假成功」、
   * 既不提示重登又持续 401（参考 songloft-plugin-miot #57）。
   */
  async validateToken(): Promise<boolean> {
    try {
      const apiUrl = `${MINA_API_BASE_URL}/admin/v2/device_list?master=1`;
      const result = await this.doGetRequest<DeviceListResponse>(apiUrl);
      return result !== null && result.code === 0;
    } catch {
      return false;
    }
  }

  // ===== 内部方法 =====

  /**
   * 构建 API 请求的 Cookie 字符串
   */
  private buildApiCookies(): string {
    const svc = this.tokenInfo.services[MINA_SID];
    if (!svc) return '';

    return [
      `userId=${this.tokenInfo.user_id}`,
      `serviceToken=${svc.service_token}`,
      `channel=MI_APP_STORE`,
    ].join('; ');
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'app_ios_';
    for (let i = 0; i < 30; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  /**
   * 执行 UBus 请求
   */
  async ubusRequest(
    deviceId: string,
    method: string,
    path: string,
    message: Record<string, unknown>,
    logLabel = '',
    signal?: AbortSignal,
    queueKind: UbusQueueKind = 'default',
    queueOwnerId = '',
  ): Promise<UbusResponse | null> {
    const previous = this.ubusQueues.get(deviceId);
    const entry = this.createUbusQueueEntry(queueKind);
    const conversationQueueKey = queueKind === 'conversation'
      ? this.makeConversationQueueKey(deviceId, queueOwnerId || `entry-${++this.conversationQueueSequence}`)
      : '';
    this.ubusQueues.set(deviceId, entry);
    if (queueKind === 'conversation') {
      this.ubusConversationQueues.set(conversationQueueKey, entry);
      this.latestConversationQueueKeys.set(deviceId, conversationQueueKey);
    }

    let abortListener: (() => void) | undefined;
    if (signal) {
      abortListener = () => entry.cancel();
      if (signal.aborted) {
        entry.cancel();
      } else if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', abortListener);
      }
    }

    if (previous) {
      if (logLabel) {
        songloft.log.info(`[MinaClient] ${logLabel} waiting for previous ubus request device=${deviceId}`);
      }
      const canceledWhileWaiting = await Promise.race([
        previous.done.then(() => false),
        entry.cancelPromise.then(() => true),
      ]);
      if (canceledWhileWaiting) {
        if (abortListener && typeof signal?.removeEventListener === 'function') {
          signal.removeEventListener('abort', abortListener);
        }
        if (this.ubusQueues.get(deviceId) === entry) {
          this.ubusQueues.delete(deviceId);
        }
        if (conversationQueueKey && this.ubusConversationQueues.get(conversationQueueKey) === entry) {
          this.ubusConversationQueues.delete(conversationQueueKey);
        }
        if (conversationQueueKey && this.latestConversationQueueKeys.get(deviceId) === conversationQueueKey) {
          this.latestConversationQueueKeys.delete(deviceId);
        }
        return null;
      }
    }

    if (entry.canceled) {
      if (abortListener && typeof signal?.removeEventListener === 'function') {
        signal.removeEventListener('abort', abortListener);
      }
      if (this.ubusQueues.get(deviceId) === entry) {
        this.ubusQueues.delete(deviceId);
      }
      if (conversationQueueKey && this.ubusConversationQueues.get(conversationQueueKey) === entry) {
        this.ubusConversationQueues.delete(conversationQueueKey);
      }
      if (conversationQueueKey && this.latestConversationQueueKeys.get(deviceId) === conversationQueueKey) {
        this.latestConversationQueueKeys.delete(deviceId);
      }
      return null;
    }

    try {
      // The cancellation branch makes the caller return promptly even when the
      // host fetch implementation ignores AbortSignal. The underlying request
      // may still settle later, but its result is intentionally discarded.
      const request = this.doUbusRequest(deviceId, method, path, message, logLabel, signal);
      return await Promise.race([
        request,
        entry.cancelPromise.then(() => null),
      ]);
    } finally {
      if (abortListener && typeof signal?.removeEventListener === 'function') {
        signal.removeEventListener('abort', abortListener);
      }
      entry.release();
      if (this.ubusQueues.get(deviceId) === entry) {
        this.ubusQueues.delete(deviceId);
      }
      if (conversationQueueKey && this.ubusConversationQueues.get(conversationQueueKey) === entry) {
        this.ubusConversationQueues.delete(conversationQueueKey);
      }
      if (conversationQueueKey && this.latestConversationQueueKeys.get(deviceId) === conversationQueueKey) {
        this.latestConversationQueueKeys.delete(deviceId);
      }
    }
  }

  /**
   * Release the current conversation UBus slot. This is used by the monitor's
   * timeout path when AbortController is unavailable in the host runtime.
   */
  cancelConversationPoll(deviceId: string, pollRequestId?: string): void {
    const latestPollId = this.latestConversationPollIds.get(deviceId);
    const targetPollId = pollRequestId || latestPollId;
    if (!pollRequestId || pollRequestId === latestPollId) {
      this.conversationPollGenerations.set(
        deviceId,
        (this.conversationPollGenerations.get(deviceId) ?? 0) + 1,
      );
    }
    const queueKey = targetPollId
      ? this.makeConversationQueueKey(deviceId, targetPollId)
      : this.latestConversationQueueKeys.get(deviceId);
    const entry = queueKey ? this.ubusConversationQueues.get(queueKey) : undefined;
    if (!entry) return;
    entry.cancel();
  }

  private makeConversationQueueKey(deviceId: string, pollRequestId: string): string {
    return `${deviceId}\u0000${pollRequestId}`;
  }

  private isConversationPollCurrent(deviceId: string, generation: number, signal?: AbortSignal): boolean {
    return !signal?.aborted && this.conversationPollGenerations.get(deviceId) === generation;
  }

  private createUbusQueueEntry(kind: UbusQueueKind): UbusQueueEntry {
    let resolveDone!: () => void;
    let resolveCancel!: () => void;
    let released = false;
    let canceled = false;
    const entry: UbusQueueEntry = {
      kind,
      get canceled() {
        return canceled;
      },
      set canceled(value: boolean) {
        canceled = value;
      },
      done: new Promise<void>(resolve => { resolveDone = resolve; }),
      cancelPromise: new Promise<void>(resolve => { resolveCancel = resolve; }),
      release: () => {
        if (released) return;
        released = true;
        resolveDone();
      },
      cancel: () => {
        if (canceled) return;
        canceled = true;
        resolveCancel();
        entry.release();
      },
    };
    return entry;
  }

  private async doUbusRequest(deviceId: string, method: string, path: string, message: Record<string, unknown>, logLabel = '', signal?: AbortSignal): Promise<UbusResponse | null> {
    const apiUrl = `${MINA_API_BASE_URL}/remote/ubus`;
    const requestId = this.generateRequestId();

    const formParams: Record<string, string> = {
      deviceId,
      method,
      path,
      message: JSON.stringify(message),
      requestId,
    };

    const body = Object.entries(formParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    if (logLabel) {
      songloft.log.info(`[MinaClient] ${logLabel} ubus request device=${deviceId} path=${path} method=${method} request_id=${requestId} message=${this.summarizeUbusMessageForLog(message)}`);
    }

    const result = await this.doPostRequest<UbusResponse>(apiUrl, body, logLabel, undefined, signal);

    // 如果401并且有回调，尝试刷新
    if (result === null) {
      if (logLabel) {
        songloft.log.warn(`[MinaClient] ${logLabel} ubus request returned null device=${deviceId} path=${path} method=${method}`);
      }
      return null;
    }

    // 检查响应码
    if (result.code !== 0) {
      if (logLabel) {
        songloft.log.warn(`[MinaClient] ${logLabel} ubus non-zero code=${result.code} message=${result.message || ''} data=${this.summarizeForLog(result.data)}`);
      }
      return null;
    }

    if (logLabel) {
      songloft.log.info(`[MinaClient] ${logLabel} ubus success code=${result.code} message=${result.message || ''} data=${this.summarizeForLog(result.data)}`);
    }
    return result;
  }

  private isDeviceResultOK(result: UbusResponse | null, action: string): boolean {
    if (result === null) {
      songloft.log.warn(`[MinaClient] ${action} returned null`);
      return false;
    }

    const data = result.data;
    if (data && typeof data === 'object' && 'code' in data) {
      const code = Number((data as Record<string, unknown>).code);
      if (!Number.isNaN(code) && code !== 0) {
        songloft.log.warn(`[MinaClient] ${action} device returned code=${code} data=${this.summarizeForLog(data)}`);
        return false;
      }
    }

    return true;
  }

  private summarizeForLog(value: unknown, maxLength = 600): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    try {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return text.length > maxLength ? text.slice(0, maxLength) + '...(truncated)' : text;
    } catch {
      return String(value);
    }
  }

  private summarizeUbusMessageForLog(message: Record<string, unknown>): string {
    const summary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(message)) {
      if (key === 'text' && typeof value === 'string') {
        summary.text_length = value.length;
      } else if (key === 'url' && typeof value === 'string') {
        summary.url_length = value.length;
      } else if (key === 'music' && typeof value === 'string') {
        summary.music_length = value.length;
      } else {
        summary[key] = value;
      }
    }
    return this.summarizeForLog(summary);
  }

  /**
   * 执行 GET 请求（带401重试）
   */
  private async doGetRequest<T>(url: string): Promise<T | null> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Cookie': this.buildApiCookies(),
    };

    let response: any;
    try {
      const fetchResult = await fetchWithRedirects(url, { method: 'GET', headers }, new CookieJar(), 0);
      response = fetchResult.response;
    } catch {
      return null;
    }

    // 401 处理
    if (response.status === 401) {
      if (this.onTokenExpired) {
        const refreshed = await this.onTokenExpired();
        if (refreshed) {
          // 重试
          headers['Cookie'] = this.buildApiCookies();
          try {
            const retryResult = await fetchWithRedirects(url, { method: 'GET', headers }, new CookieJar(), 0);
            response = retryResult.response;
          } catch {
            return null;
          }
          if (response.status === 401) return null;
        } else {
          return null;
        }
      } else {
        return null;
      }
    }

    try {
      const text = response.text() as string;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /**
   * 执行 POST 请求（带401重试）
   */
  private async doPostRequest<T>(url: string, body: string, logLabel = '', transformResponseText?: (text: string) => string, signal?: AbortSignal): Promise<T | null> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': this.buildApiCookies(),
    };

    let response: any;
    try {
      const fetchResult = await fetchWithRedirects(url, { method: 'POST', headers, body, signal }, new CookieJar(), 0);
      response = fetchResult.response;
      if (logLabel) {
        songloft.log.info(`[MinaClient] ${logLabel} HTTP POST status=${response.status}`);
      }
    } catch (e) {
      if (logLabel) {
        songloft.log.warn(`[MinaClient] ${logLabel} HTTP POST fetch failed: ${String(e)}`);
      }
      return null;
    }

    // 401 处理
    if (response.status === 401) {
      if (logLabel) {
        songloft.log.warn(`[MinaClient] ${logLabel} HTTP POST got 401, refreshing token`);
      }
      if (this.onTokenExpired) {
        const refreshed = await this.onTokenExpired();
        if (refreshed) {
          // 重试
          headers['Cookie'] = this.buildApiCookies();
          try {
            const retryResult = await fetchWithRedirects(url, { method: 'POST', headers, body, signal }, new CookieJar(), 0);
            response = retryResult.response;
            if (logLabel) {
              songloft.log.info(`[MinaClient] ${logLabel} HTTP POST retry status=${response.status}`);
            }
          } catch (e) {
            if (logLabel) {
              songloft.log.warn(`[MinaClient] ${logLabel} HTTP POST retry failed: ${String(e)}`);
            }
            return null;
          }
          if (response.status === 401) {
            if (logLabel) {
              songloft.log.warn(`[MinaClient] ${logLabel} HTTP POST still 401 after token refresh`);
            }
            return null;
          }
        } else {
          if (logLabel) {
            songloft.log.warn(`[MinaClient] ${logLabel} token refresh failed`);
          }
          return null;
        }
      } else {
        if (logLabel) {
          songloft.log.warn(`[MinaClient] ${logLabel} no token refresh callback`);
        }
        return null;
      }
    }

    try {
      const text = response.text() as string;
      if (logLabel) {
        songloft.log.info(`[MinaClient] ${logLabel} HTTP POST response=${this.summarizeForLog(text)}`);
      }
      return JSON.parse(transformResponseText ? transformResponseText(text) : text) as T;
    } catch (e) {
      if (logLabel) {
        songloft.log.warn(`[MinaClient] ${logLabel} HTTP POST parse failed: ${String(e)}`);
      }
      return null;
    }
  }

  private preserveMusicSearchIDStrings(text: string): string {
    return text.replace(/"(audioID|songID)"\s*:\s*(-?\d+)/g, '"$1":"$2"');
  }

  /**
   * 通过 xiaoai API 获取对话记录
   *
   * Songloft v2.11.0：`X-Fetch-No-Redirect` 会被严格遵守。对话 API 偶发 302 时，
   * maxRedirects=0 会直接抛 "Too many redirects" 导致永远基线未建立。
   * 这里允许少量重定向，同时保留监听器传入的 AbortSignal。
   */
  private async doGetLatestAskFromXiaoai(deviceId: string, apiUrl: string, signal?: AbortSignal): Promise<AskMessage[] | null> {
    const cookie = this.buildApiCookies();
    if (!cookie) {
      songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai missing micoapi cookie device=${deviceId}`);
      return null;
    }

    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Cookie': cookie + `; deviceId=${deviceId}`,
    };

    let response: any;
    try {
      // Allow a few redirects (v2.11 honors X-Fetch-No-Redirect). Miot used 0 but
      // older hosts often auto-followed; v2.11 does not.
      const fetchResult = await fetchWithRedirects(apiUrl, { method: 'GET', headers, signal }, new CookieJar(), 5);
      response = fetchResult.response;
    } catch (e) {
      songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai fetch error: ${String(e)}`);
      return null;
    }

    if (isPollDebug()) {
      songloft.log.info(`[ConversationMonitor] doGetLatestAskFromXiaoai status=${response.status} device=${deviceId}`);
    }

    if (response.status === 401) {
      songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai 401 token expired device=${deviceId}`);
      if (this.onTokenExpired) {
        await this.onTokenExpired();
      }
      return null;
    }

    if (response.status !== 200) {
      const bodyPreview = String(response.text?.() ?? '').substring(0, 200);
      songloft.log.warn(
        `[ConversationMonitor] doGetLatestAskFromXiaoai unexpected status=${response.status} device=${deviceId} body=${bodyPreview}`,
      );
      return null;
    }

    try {
      const text = response.text() as string;
      if (isPollDebug()) {
        songloft.log.info(
          `[ConversationMonitor] doGetLatestAskFromXiaoai raw response (${text.length} chars): ${text.substring(0, 500)}`,
        );
      }

      const result = JSON.parse(text) as Record<string, unknown>;
      // Real error envelope: code present and non-zero → failure (null).
      // Missing/undefined code is treated as success path (miot is looser); still try data.
      if (result.code !== undefined && result.code !== null && Number(result.code) !== 0) {
        songloft.log.warn(
          `[ConversationMonitor] doGetLatestAskFromXiaoai response code=${String(result.code)} message=${String(result.message ?? result.msg ?? '')}`,
        );
        return null;
      }

      // data 通常是 JSON 字符串；也可能已是对象；空/缺失视为成功空对话 []
      const rawData = result['data'];
      if (rawData === undefined || rawData === null || rawData === '') {
        if (isPollDebug()) songloft.log.info(`[ConversationMonitor] doGetLatestAskFromXiaoai data field is empty/null → []`);
        return [];
      }

      let dataObj: ConversationData;
      if (typeof rawData === 'string') {
        dataObj = JSON.parse(rawData) as ConversationData;
      } else if (typeof rawData === 'object') {
        dataObj = rawData as ConversationData;
      } else {
        songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai data field has unexpected type=${typeof rawData}`);
        return null;
      }

      if (!Array.isArray(dataObj.records)) {
        songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai records field is missing or malformed keys=${Object.keys(dataObj || {}).join(',')}`);
        return null;
      }
      if (dataObj.records.length === 0) {
        if (isPollDebug()) songloft.log.info(`[ConversationMonitor] doGetLatestAskFromXiaoai records empty → []`);
        return [];
      }

      // 转换为 AskMessage 格式（与 WASM 版一致；Starlight 用更稳健的 answer 提取）
      const messages: AskMessage[] = [];
      for (const record of dataObj.records) {
        const timestamp = parseSafePositiveTimestamp(record.time);
        if (timestamp === null) {
          songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai skip record with invalid timestamp device=${deviceId} raw=${String(record.time)}`);
          continue;
        }
        const answerText = extractConversationAnswerText(record);
        messages.push({
          timestamp_ms: timestamp,
          response: {
            answer: [{
              question: record.query,
              content: answerText,
            }],
          },
        });
      }
      if (isPollDebug()) {
        songloft.log.info(`[ConversationMonitor] doGetLatestAskFromXiaoai parsed ${messages.length}/${dataObj.records.length} messages`);
      }
      // Non-empty records but all timestamps invalid → null (cannot safely prime).
      // Empty records already returned [] above.
      return messages.length > 0 ? messages : null;
    } catch (e) {
      songloft.log.warn(`[ConversationMonitor] doGetLatestAskFromXiaoai parse error: ${String(e)}`);
      return null;
    }
  }

  /**
   * 通过 UBus nlp_result_get 获取对话记录
   * 用于不支持 xiaoai API 的设备（如 M01）
   */
  private async getLatestAskByUbus(deviceId: string, signal?: AbortSignal, pollRequestId = ''): Promise<AskMessage[] | null> {
    try {
      const result = await this.ubusRequest(
        deviceId,
        'nlp_result_get',
        'mibrain',
        {},
        '',
        signal,
        'conversation',
        pollRequestId,
      );
      if (!result || !result.data) return null;

      const data = result.data as NlpResultData;
      if (data.code !== 0) return null;
      if (!data.info) return null;

      const infoData = JSON.parse(data.info) as NlpInfoData;
      if (!Array.isArray(infoData.result)) return null;
      if (infoData.result.length === 0) return [];

      const messages: AskMessage[] = [];

      for (const item of infoData.result) {
        if (!item.nlp) continue;

        try {
          const nlp = JSON.parse(item.nlp) as NlpDetail;
          const timestamp = parseSafePositiveTimestamp(nlp.meta?.timestamp);
          if (timestamp === null) {
            songloft.log.warn(`[ConversationMonitor] getLatestAskByUbus skip record with invalid timestamp device=${deviceId} raw=${String(nlp.meta?.timestamp)}`);
            continue;
          }

          // 转换为 AskMessage 格式（与 WASM 版一致）
          messages.push({
            request_id: nlp.meta.request_id,
            timestamp_ms: timestamp,
            response: {
              answer: nlp.response.answer.map(ans => ({
                domain: ans.domain,
                action: ans.action,
                content: ans.content.to_speak,
                question: ans.intention.query,
              })),
            },
          });
        } catch {
          continue;
        }
      }

      return messages.length > 0 ? messages : null;
    } catch {
      return null;
    }
  }
}

