import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerDeviceHandlers } from '../../src/handlers/device';
import type { AccountManager } from '../../src/account/manager';
import type { ConversationMonitor } from '../../src/conversation/monitor';
import type { MinaService } from '../../src/service/service';
import {
  DEVICE_STATUS_TTL,
  getDeviceStatusCache,
  updateDeviceStatusCache,
} from '../../src/handlers/playlist';

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

describe('registerDeviceHandlers', () => {
  it('routes /mina/pause through PlaylistManager so the auto-advance timer stops', async () => {
    // 只调 minaService.pausePlay() 会让管理器停在 playing、切歌定时器继续跑，
    // 于是切到浏览器后音箱会在下一首到点时自己重新出声。
    const router = createRouter();
    const minaService = {
      pausePlay: vi.fn(async () => true),
    } as unknown as MinaService;
    const manager = { pause: vi.fn(async () => undefined) };
    const playlistManagerMap = {
      getOrCreate: vi.fn(async () => manager),
    };

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      {} as AccountManager,
      playlistManagerMap,
    );

    const response = await router.handle(request('POST', '/mina/pause', {
      account_id: 'acc-1',
      device_id: 'dev-1',
    }));

    expect(parseResponseBody(response).success).toBe(true);
    expect(playlistManagerMap.getOrCreate).toHaveBeenCalledWith('acc-1', 'dev-1');
    expect(manager.pause).toHaveBeenCalledTimes(1);
    // manager.pause() 内部会停设备，handler 不该再自己调一次
    expect(minaService.pausePlay).not.toHaveBeenCalled();
  });

  it('falls back to a bare device pause when no PlaylistManagerMap is wired', async () => {
    const router = createRouter();
    const minaService = {
      pausePlay: vi.fn(async () => true),
    } as unknown as MinaService;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      {} as AccountManager,
    );

    const response = await router.handle(request('POST', '/mina/pause', {
      account_id: 'acc-1',
      device_id: 'dev-1',
    }));

    expect(parseResponseBody(response).success).toBe(true);
    expect(minaService.pausePlay).toHaveBeenCalledWith('acc-1', 'dev-1');
  });

  it('rejects non-finite volume values before calling Mina service', async () => {
    const router = createRouter();
    const minaService = {
      setVolume: vi.fn(async () => true),
    } as unknown as MinaService;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      {} as AccountManager,
    );

    const response = await router.handle(request('POST', '/mina/volume', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      volume: 'loud',
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: false,
      error: 'volume must be a number between 0 and 100',
    });
    expect(minaService.setVolume).not.toHaveBeenCalled();
  });

  it('refreshes conversation monitoring after a device is marked managed', async () => {
    const router = createRouter();
    const minaService = {
      updateManagedStatus: vi.fn(async () => true),
    } as unknown as MinaService;
    const monitor = {
      refresh: vi.fn(async () => {}),
    } as unknown as ConversationMonitor;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      {} as AccountManager,
      undefined,
      monitor,
    );

    const response = await router.handle(request('POST', '/mina/device/managed', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      managed: true,
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: {
        account_id: 'acc-1',
        device_id: 'dev-1',
        managed: true,
      },
    });
    expect(minaService.updateManagedStatus).toHaveBeenCalledWith('acc-1', 'dev-1', true);
    expect(monitor.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the shared device status cache when the speaker payload cannot be parsed', async () => {
    vi.useFakeTimers();
    try {
      const router = createRouter();
      const minaService = {
        getPlayerStatus: vi.fn(async () => ({ data: { info: 'not-json' } })),
      } as unknown as MinaService;

      (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
        router,
        minaService,
        {} as AccountManager,
      );

      updateDeviceStatusCache('acc-cache', 'dev-cache', { state: 'playing', position: 42, volume: 30 });
      vi.advanceTimersByTime(DEVICE_STATUS_TTL + 1000);

      const response = await router.handle({
        ...request('GET', '/mina/status'),
        query: 'account_id=acc-cache&device_id=dev-cache',
      });

      expect(response.statusCode).toBe(200);
      expect(parseResponseBody(response).data.state).toBe('unknown');
      // /player/status 读同一份缓存，unknown/0 一旦写入会把前端进度条清零
      expect(getDeviceStatusCache('acc-cache', 'dev-cache')).toMatchObject({
        state: 'playing',
        position: 42,
        volume: 30,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes the last selected device when listing devices for one account', async () => {
    const router = createRouter();
    const minaService = {
      getDevices: vi.fn(async () => [{ device_id: 'dev-1', name: '客厅音箱' }]),
    } as unknown as MinaService;
    const accountManager = {
      getLastSelectedDevice: vi.fn(async () => 'dev-1'),
    } as unknown as AccountManager;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      accountManager,
    );

    const response = await router.handle({
      ...request('GET', '/mina/devices'),
      query: 'account_id=acc-1',
    });

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: [{
        account_id: 'acc-1',
        last_selected_device_id: 'dev-1',
      }],
    });
  });
});
