// MIoT 智能音箱插件 - 设备控制 Handler
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/handlers/device_handler.go

import { jsonResponse, parseQuery } from '@songloft/plugin-sdk';
import type { Router, HTTPRequest } from '@songloft/plugin-sdk';
import { MinaService } from '../service/service';
import { AccountManager } from '../account/manager';
import type { ConversationMonitor } from '../conversation/monitor';
import {
  updateDeviceStatusCache,
  getDeviceStatusCache,
  getOrFetchDeviceStatus,
  DEVICE_STATUS_TTL,
} from './playlist';
import type { PlayerSong, PlaylistManagerMap } from '../player/manager';
import { parseVolume } from '../utils/volume';

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

/**
 * 注册设备控制相关路由
 * GET  /mina/devices         → 获取设备列表
 * POST /mina/volume          → 设置音量
 * POST /mina/play-url        → 播放URL
 * POST /mina/pause           → 暂停播放
 * POST /mina/resume          → 恢复播放
 * POST /mina/stop            → 停止播放
 * POST /mina/tts             → TTS 播报
 * GET  /mina/status          → 物理播放状态探针
 * POST /mina/device/managed  → 更新管理状态
 * POST /mina/last_selection  → 记录最后选中设备
 */
export function registerDeviceHandlers(
  router: Router,
  minaService: MinaService,
  accountManager: AccountManager,
  playlistManagerMap?: PlaylistManagerMap,
  conversationMonitor?: ConversationMonitor,
): void {

  // GET /mina/devices - 获取设备列表（按账号分组）
  router.get('/mina/devices', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const accountId = query.account_id;

      if (accountId) {
        const devices = await minaService.getDevices(accountId);
        return jsonResponse({
          success: true,
          data: [{
            account_id: accountId,
            devices,
            last_selected_device_id: (await accountManager.getLastSelectedDevice(accountId)) || '',
          }],
        });
      }

      // 所有账号的设备
      const accounts = await accountManager.getAccounts();
      if (!accounts || accounts.length === 0) {
        // 未配置账号时返回空数组，不报错
        return jsonResponse({ success: true, data: [] });
      }

      const result = [];
      for (const acc of accounts) {
        result.push({
          account_id: acc.id,
          account_name: acc.account,
          devices: await minaService.getDevices(acc.id),
          last_selected_device_id: (await accountManager.getLastSelectedDevice(acc.id)) || '',
        });
      }
      return jsonResponse({ success: true, data: result });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/volume - 设置音量
  router.post('/mina/volume', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id, volume } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      if (volume === undefined || volume === null) {
        return jsonResponse({ success: false, error: 'volume is required' });
      }
      const vol = parseVolume(volume);
      if (vol === null) {
        return jsonResponse({ success: false, error: 'volume must be a number between 0 and 100' });
      }
      const ok = await minaService.setVolume(account_id, device_id, vol);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to set volume' });
      }
      updateDeviceStatusCache(account_id, device_id, { volume: vol, lockVolume: true });
      return jsonResponse({ success: true, data: { message: 'success' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/play-url - 播放URL
  router.post('/mina/play-url', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id, url } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id || !url) {
        return jsonResponse({ success: false, error: 'device_id and url are required' });
      }
      const ok = playlistManagerMap
        ? await (await playlistManagerMap.getOrCreate(account_id, device_id)).playStandalone(
          [urlPlayerSong(url)],
          0,
          'single',
          { autoAdvance: false },
        )
        : await minaService.playURL(account_id, device_id, url);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to play url' });
      }
      updateDeviceStatusCache(account_id, device_id, { state: 'playing', position: 0 });
      return jsonResponse({ success: true, data: { message: 'playing url' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/pause - 暂停播放
  router.post('/mina/pause', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      const ok = await minaService.pausePlay(account_id, device_id);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to pause' });
      }
      updateDeviceStatusCache(account_id, device_id, { state: 'paused' });
      return jsonResponse({ success: true, data: { message: 'paused' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/resume - 恢复播放
  router.post('/mina/resume', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      const ok = await minaService.resumePlay(account_id, device_id);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to resume' });
      }
      updateDeviceStatusCache(account_id, device_id, { state: 'playing' });
      return jsonResponse({ success: true, data: { message: 'resumed' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/stop - 停止播放
  router.post('/mina/stop', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      const ok = await minaService.stopPlay(account_id, device_id);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to stop' });
      }
      updateDeviceStatusCache(account_id, device_id, { state: 'stopped', position: 0 });
      return jsonResponse({ success: true, data: { message: 'stopped' } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/tts - 让音箱播报指定文字（TTS）
  router.post('/mina/tts', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id, text } = body;
      const textLength = typeof text === 'string' ? text.length : 0;
      songloft.log.info(`[/mina/tts] request account_id=${account_id || ''} device_id=${device_id || ''} text_length=${textLength}`);
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id || !text) {
        return jsonResponse({ success: false, error: 'device_id and text are required' });
      }
      const ok = await minaService.textToSpeech(account_id, device_id, text);
      if (!ok) {
        songloft.log.warn(`[/mina/tts] failed account_id=${account_id} device_id=${device_id} text_length=${textLength}`);
        return jsonResponse({ success: false, error: 'failed to play tts' });
      }
      songloft.log.info(`[/mina/tts] success account_id=${account_id} device_id=${device_id} text_length=${textLength}`);
      return jsonResponse({ success: true, data: { message: 'tts playing' } });
    } catch (e: any) {
      songloft.log.error('[/mina/tts] error: ' + String(e));
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // GET /mina/status - 纯物理状态探针（只读，4s 缓存）
  router.get('/mina/status', async (req: HTTPRequest) => {
    try {
      const query = parseQuery(req.query);
      const { account_id, device_id } = query;

      if (!account_id || !device_id) {
        return jsonResponse({ success: false, error: 'account_id and device_id are required' });
      }

      const cached = getDeviceStatusCache(account_id, device_id);
      const now = Date.now();

      if (cached && (now - cached.timestamp) < DEVICE_STATUS_TTL) {
        let position = cached.position;
        if (cached.state === 'playing') {
          const elapsed = (now - cached.timestamp) / 1000;
          position = cached.position + elapsed;
        }
        return jsonResponse({
          success: true,
          data: {
            state: cached.state,
            position,
            volume: cached.volume,
            is_playing: cached.state === 'playing',
          },
        });
      }

      const raw = await getOrFetchDeviceStatus(account_id, device_id, () => minaService.getPlayerStatus(account_id, device_id));
      const info = raw?.data?.info;

      let state = 'unknown';
      let position = 0;
      let volume: number | null = cached?.volume ?? null;

      if (typeof info === 'string') {
        try {
          const parsed = JSON.parse(info);
          if (typeof parsed.volume === 'number') {
            if (!cached?.volumeLockedUntil || now > cached.volumeLockedUntil) {
              volume = parsed.volume;
            }
          }
          if (parsed.status === 1) state = 'playing';
          else if (parsed.status === 2) state = 'paused';
          else if (parsed.status === 0) state = 'stopped';

          if (parsed.play_song_detail) {
            const d = parsed.play_song_detail;
            if (typeof d.position === 'number') position = Math.floor(d.position / 1000);
          }
        } catch (e: any) {
          songloft.log.warn('[/mina/status] parse failed: ' + String(e));
        }
      }

      updateDeviceStatusCache(account_id, device_id, { state, position, volume: volume ?? undefined });

      return jsonResponse({
        success: true,
        data: {
          state,
          position,
          volume,
          is_playing: state === 'playing',
        },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/device/managed - 更新设备管理状态
  router.post('/mina/device/managed', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id, managed } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      const ok = await minaService.updateManagedStatus(account_id, device_id, !!managed);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to update managed status' });
      }
      // 同步刷新监听器设备列表（即使监听器已启动也能立刻发现管理状态变更）
      try {
        await conversationMonitor?.refresh();
      } catch (e) {
        songloft.log.warn('[/mina/device/managed] refresh conversation monitor failed: ' + String(e));
      }
      return jsonResponse({
        success: true,
        data: { message: 'device managed status updated', account_id, device_id, managed: !!managed },
      });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });

  // POST /mina/last_selection - 记录最后选中设备
  router.post('/mina/last_selection', async (req: HTTPRequest) => {
    try {
      const body = parseBody(req);
      const { account_id, device_id } = body;
      if (!account_id) {
        return jsonResponse({ success: false, error: 'account_id is required' });
      }
      if (!device_id) {
        return jsonResponse({ success: false, error: 'device_id is required' });
      }
      const ok = await minaService.updateLastSelection(account_id, device_id);
      if (!ok) {
        return jsonResponse({ success: false, error: 'failed to update last selection' });
      }
      return jsonResponse({ success: true, data: { message: 'last selection updated', account_id, device_id } });
    } catch (e: any) {
      return jsonResponse({ success: false, error: e.message || String(e) });
    }
  });
}

function urlPlayerSong(url: string): PlayerSong {
  return {
    id: 0,
    type: 'remote',
    title: 'URL 播放',
    artist: '',
    album: '',
    duration: 0,
    file_path: '',
    url,
    cover_path: '',
    cover_url: '',
    lyric_url: '',
    file_size: 0,
    format: '',
    bit_rate: 0,
    sample_rate: 0,
    is_live: false,
    cache_hash: '',
  };
}
