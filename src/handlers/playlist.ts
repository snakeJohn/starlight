// MIoT 智能音箱插件 - 歌单播放 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/playlist_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { PlaylistManagerMap } from '../player/manager';
import { MinaService } from '../service/service';
import { isPlayMode } from '../player/modes';
import type { PlayMode } from '../types';

/** 解析请求体（兼容 Uint8Array 和 string） */
function parseBody(req: HTTPRequest): any {
  if (!req.body) return {};
  try {
    const str = typeof req.body === 'string'
      ? req.body
      : String.fromCharCode.apply(null, Array.from(req.body as Uint8Array));
    return JSON.parse(str);
  } catch {
    return {};
  }
}

/** 设备播放状态缓存（避免多调用方重复查询设备） */
interface DeviceStatusCache {
  volume: number;
  state: string;
  position: number;  // 秒
  duration: number;  // 秒
  timestamp: number;
  volumeLockedUntil: number;  // 用户显式设置音量后锁定期截止时间戳
}
const deviceStatusCache: Map<string, DeviceStatusCache> = new Map();
const DEVICE_STATUS_TTL = 4000; // 4秒缓存，略短于前端5秒轮询间隔

/** 主动更新设备状态缓存（供外部调用，如 playURL 成功后刷新） */
export function updateDeviceStatusCache(accountId: string, deviceId: string, data: Partial<DeviceStatusCache> & { lockVolume?: boolean }): void {
  const key = accountId + ':' + deviceId;
  const existing = deviceStatusCache.get(key);
  deviceStatusCache.set(key, {
    volume: data.volume ?? existing?.volume ?? -1,
    state: data.state ?? existing?.state ?? 'idle',
    position: data.position ?? existing?.position ?? 0,
    duration: data.duration ?? existing?.duration ?? 0,
    timestamp: Date.now(),
    volumeLockedUntil: data.lockVolume ? Date.now() + 10000 : (existing?.volumeLockedUntil ?? 0),
  });
}

/**
 * 注册歌单播放相关路由
 * GET  /playlists            → 获取歌单列表
 * GET  /playlists/:id/songs  → 获取歌单歌曲
 * POST /player/play          → 播放歌单
 * POST /player/stop          → 停止播放
 * POST /player/previous      → 上一首
 * POST /player/next          → 下一首
 * POST /player/mode          → 设置播放模式
 * GET  /player/status        → 获取播放状态
 */
export function registerPlaylistHandlers(
  router: Router,
  playlistManagerMap: PlaylistManagerMap,
  minaService: MinaService,
): void {

  // GET /playlists - 获取歌单列表
  router.get('/playlists', async () => {
    try {
      const playlists = await songloft.playlists.list();
      return jsonResponse({ success: true, data: playlists });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /playlists/:id/songs - 获取歌单歌曲
  router.get('/playlists/:id/songs', async (_req: HTTPRequest, params: Record<string, string>) => {
    try {
      const playlistId = Number(params.id);
      if (!playlistId || isNaN(playlistId)) {
        return jsonResponse({ success: false, error: 'invalid playlist id' });
      }
      const songs = await songloft.playlists.getSongs(playlistId, { limit: 100000 });
      return jsonResponse({ success: true, data: songs });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/play - 播放歌单
  router.post('/player/play', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id, playlist_id, start_index, play_mode } = body;

      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      if (!playlist_id) {
        return jsonResponse({ success: false, error: 'playlist_id is required' });
      }
      const playlistId = Number(playlist_id);
      if (!Number.isFinite(playlistId) || playlistId === 0) {
        return jsonResponse({ success: false, error: 'invalid playlist_id' });
      }
      const startIndex = start_index === undefined || start_index === null ? 0 : Number(start_index);
      if (!Number.isInteger(startIndex) || startIndex < 0) {
        return jsonResponse({ success: false, error: 'start_index must be a non-negative integer' });
      }
      const modeValue = play_mode || 'order';
      if (!isPlayMode(modeValue)) {
        return jsonResponse({ success: false, error: 'invalid play_mode' });
      }

      const manager = await playlistManagerMap.getOrCreate(account_id, device_id);
      const mode: PlayMode = modeValue;
      const ok = await manager.play(playlistId, startIndex, mode);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to start playlist' });
      }

      return jsonResponse({
        success: true,
        data: {
          message: 'playlist started',
          playlist_id: playlistId,
          play_mode: mode,
          current_song: manager.getCurrentSong(),
        },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/stop - 停止播放
  router.post('/player/stop', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const query = parseQuery(req.query);
      const account_id = body.account_id || query.account_id;
      const device_id = body.device_id || query.device_id;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const manager = playlistManagerMap.get(account_id, device_id);
      if (!manager) {
        return jsonResponse({ success: false, error: 'no active playlist for this device' });
      }
      const lastPosition = manager.getStatus().position;
      await manager.stop();
      updateDeviceStatusCache(account_id, device_id, { state: 'stopped', position: lastPosition });
      return jsonResponse({ success: true, data: { message: 'playlist stopped' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/toggle - 切换播放/暂停状态
  router.post('/player/toggle', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const query = parseQuery(req.query);
      const account_id = body.account_id || query.account_id;
      const device_id = body.device_id || query.device_id;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const manager = await playlistManagerMap.getOrCreate(account_id, device_id);
      const status = manager.getStatus();

      if (manager.isPlaying()) {
        // 正在播放，暂停
        const lastPosition = manager.getStatus().position;
        await manager.pause();
        updateDeviceStatusCache(account_id, device_id, { state: 'paused', position: lastPosition });
        return jsonResponse({ success: true, data: { message: 'playlist paused', state: 'paused' } });
      }

      if (!manager.hasPlaylist()) {
        return jsonResponse({ success: false, error: 'no playlist loaded, please select a playlist first' });
      }

      // 检查是否处于 paused 状态，如果是则恢复
      if (status.state === 'paused') {
        const ok = await manager.resumePlayback();
        if (ok) {
          updateDeviceStatusCache(account_id, device_id, { state: 'playing', position: manager.getStatus().position });
          return jsonResponse({
            success: true,
            data: {
              message: 'playlist resumed',
              state: 'playing',
              current_song: manager.getCurrentSong(),
            },
          });
        }
        if (status.playlist_id === 0) {
          const replayed = await manager.replayCurrent();
          if (!replayed) {
            return jsonResponse({ success: false, error: 'failed to resume playback' });
          }
          updateDeviceStatusCache(account_id, device_id, { state: 'playing', position: manager.getStatus().position });
          return jsonResponse({
            success: true,
            data: {
              message: 'playlist resumed',
              state: 'playing',
              current_song: manager.getCurrentSong(),
            },
          });
        }
        // 如果 resumePlayback 失败，普通歌单回退到重新播放
      }

      // 处于 stopped 状态或 resumePlayback 失败，重新播放
      const ok = await manager.play(status.playlist_id, status.current_index, status.play_mode as PlayMode);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to resume playback' });
      }

      updateDeviceStatusCache(account_id, device_id, { state: 'playing', position: 0 });
      return jsonResponse({
        success: true,
        data: {
          message: 'playlist resumed',
          state: 'playing',
          current_song: manager.getCurrentSong(),
        },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/previous - 上一首
  router.post('/player/previous', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const query = parseQuery(req.query);
      const account_id = body.account_id || query.account_id;
      const device_id = body.device_id || query.device_id;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const manager = playlistManagerMap.get(account_id, device_id);
      if (!manager) {
        return jsonResponse({ success: false, error: 'no active playlist for this device' });
      }

      const ok = await manager.previous();
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to play previous' });
      }
      return jsonResponse({ success: true, data: { message: 'playing previous song', current_song: manager.getCurrentSong() } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/next - 下一首
  router.post('/player/next', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const query = parseQuery(req.query);
      const account_id = body.account_id || query.account_id;
      const device_id = body.device_id || query.device_id;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const manager = playlistManagerMap.get(account_id, device_id);
      if (!manager) {
        return jsonResponse({ success: false, error: 'no active playlist for this device' });
      }

      const ok = await manager.next();
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to play next' });
      }
      return jsonResponse({ success: true, data: { message: 'playing next song', current_song: manager.getCurrentSong() } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/mode - 设置播放模式
  router.post('/player/mode', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const query = parseQuery(req.query);
      const account_id = body.account_id || query.account_id;
      const device_id = body.device_id || query.device_id;
      const play_mode = body.play_mode;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }
      if (!play_mode) {
        return jsonResponse({ success: false, error: 'play_mode is required' });
      }
      if (!isPlayMode(play_mode)) {
        return jsonResponse({ success: false, error: 'invalid play_mode' });
      }

      const manager = playlistManagerMap.get(account_id, device_id);
      if (!manager) {
        return jsonResponse({ success: false, error: 'no active playlist for this device' });
      }

      await manager.setPlayMode(play_mode);
      return jsonResponse({ success: true, data: { message: 'play mode set', play_mode } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /player/seek - 跳转播放进度
  router.post('/player/seek', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const query = parseQuery(req.query);
      const account_id = body.account_id || query.account_id;
      const device_id = body.device_id || query.device_id;
      const position = body.position !== undefined ? body.position : query.position;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const targetSeconds = Number(position);
      if (!Number.isFinite(targetSeconds) || targetSeconds < 0) {
        return jsonResponse({ success: false, error: 'position must be a non-negative number' });
      }

      const manager = playlistManagerMap.get(account_id, device_id);
      if (!manager) {
        return jsonResponse({ success: false, error: 'no active playlist for this device' });
      }

      const ok = await manager.seekToPosition(targetSeconds);
      if (!ok) {
        return jsonResponse({ success: false, error: 'seek is not supported by the current speaker playback transport' });
      }

      updateDeviceStatusCache(account_id, device_id, {
        state: 'playing',
        position: targetSeconds,
      });

      return jsonResponse({
        success: true,
        data: {
          message: 'position seeked',
          position: targetSeconds,
          current_song: manager.getCurrentSong(),
        },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /player/status - 获取播放状态（设备真实数据优先，带缓存避免重复查询）
  router.get('/player/status', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const { account_id, device_id } = query;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const manager = await playlistManagerMap.getOrCreate(account_id, device_id);
      const localStatus = manager.getStatus();
      const cacheKey = account_id + ':' + device_id;
      const now = Date.now();

      // 检查设备状态缓存（4秒内直接复用，避免多调用方重复查询设备）
      const cached = deviceStatusCache.get(cacheKey);
      if (cached && (now - cached.timestamp) < DEVICE_STATUS_TTL) {
        const duration = localStatus.duration > 0 ? localStatus.duration : cached.duration;

        // 播放中时用缓存position + 已过时间推算当前位置，避免返回过时进度
        let position = cached.position;
        if (cached.state === 'playing' && duration > 0) {
          const elapsed = (now - cached.timestamp) / 1000;
          position = Math.min(cached.position + elapsed, duration);
        }

        // 设备状态与本地 PlaylistManager 不一致时同步（防止外部操作如"小爱同学停止"后本地定时器仍在跑）
        if (cached.state !== localStatus.state) {
          if (localStatus.state === 'playing' && cached.state === 'paused') {
            manager.suspendForVoiceInteraction();
          } else if (localStatus.state === 'playing' && cached.state === 'stopped') {
            if (manager.isVoiceSuspendStale()) {
              manager.prepareForNewPlayback();
            } else {
              manager.suspendForVoiceInteraction();
            }
          } else if (localStatus.state === 'paused' && cached.state === 'playing') {
            // 本地显示暂停但设备在播放，同步设备状态
            manager.resetAutoNextTimer(cached.position);
          }
        }

        // 设备和本地都是 playing 但定时器被挂起时，重启定时器
        if (localStatus.state === 'playing' && cached.state === 'playing' && manager.isVoiceSuspended()) {
          manager.resetAutoNextTimer(cached.position);
        }

        // 本地已 stop 时，不让设备残留的播放状态覆盖，避免前端进度条跳动
        const reportState = localStatus.state === 'stopped' ? 'stopped' : cached.state;
        const reportPosition = localStatus.state === 'stopped' ? 0 : position;

        return jsonResponse({
          success: true,
          data: { ...localStatus, state: reportState, position: reportPosition, duration, volume: cached.volume },
        });
      }

      // 缓存过期，从设备获取真实播放状态
      let volume = cached?.volume ?? -1;
      let realPosition = localStatus.position;
      let realDuration = localStatus.duration;
      let realState = localStatus.state;
      try {
        const raw = await minaService.getPlayerStatus(account_id, device_id);
        const info = raw?.data?.info;
        if (typeof info === 'string') {
          const parsed = JSON.parse(info);
          if (typeof parsed.volume === 'number') {
            if (!cached?.volumeLockedUntil || Date.now() > cached.volumeLockedUntil) {
              volume = parsed.volume;
            }
          }
          if (parsed.status === 1) realState = 'playing';
          else if (parsed.status === 2) realState = 'paused';
          else if (parsed.status === 0) realState = 'stopped';
          if (parsed.play_song_detail) {
            const d = parsed.play_song_detail;
            if (typeof d.position === 'number') realPosition = Math.floor(d.position / 1000);
            if (typeof d.duration === 'number') realDuration = Math.floor(d.duration / 1000);
          }
        }
      } catch (e: any) {
        songloft.log.warn('[player/status] getPlayerStatus failed: ' + String(e));
      }

      // 本地歌曲 duration（来自文件元数据）比设备报告的更可靠，
      // 设备在 MUSIC 模式（keepLight=true）下经常报告错误的 duration
      if (localStatus.duration > 0) {
        realDuration = localStatus.duration;
      }

      // 更新缓存
      deviceStatusCache.set(cacheKey, { volume, state: realState, position: realPosition, duration: realDuration, timestamp: now, volumeLockedUntil: cached?.volumeLockedUntil ?? 0 });

      // 设备状态与本地不一致时同步（同缓存命中路径逻辑）
      if (realState !== localStatus.state) {
        if (localStatus.state === 'playing' && realState === 'paused') {
          manager.suspendForVoiceInteraction();
        } else if (localStatus.state === 'playing' && realState === 'stopped') {
          if (manager.isVoiceSuspendStale()) {
            manager.prepareForNewPlayback();
          } else {
            manager.suspendForVoiceInteraction();
          }
        } else if (localStatus.state === 'paused' && realState === 'playing') {
          // 本地显示暂停但设备在播放，同步设备状态
          manager.resetAutoNextTimer(realPosition);
        }
      }

      // 设备和本地都是 playing 但定时器被挂起时，重启定时器
      if (localStatus.state === 'playing' && realState === 'playing' && manager.isVoiceSuspended()) {
        manager.resetAutoNextTimer(realPosition);
      }

      // 本地已 stop 时，不让设备残留的播放状态覆盖
      const reportState = localStatus.state === 'stopped' ? 'stopped' : realState;
      const reportPosition = localStatus.state === 'stopped' ? 0 : realPosition;

      return jsonResponse({
        success: true,
        data: { ...localStatus, state: reportState, position: reportPosition, duration: realDuration, volume },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}
