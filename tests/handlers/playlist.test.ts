import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerPlaylistHandlers } from '../../src/handlers/playlist';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';

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

type SongloftPlaylistsStub = {
  getSongs: (playlistId: number, options?: { limit?: number; offset?: number }) => Promise<unknown>;
};

function createHarness() {
  const router = createRouter();
  const play = vi.fn(async () => true);
  const playPlaylistFromSong = vi.fn(async () => true);
  const getStatus = vi.fn(() => ({ current_index: 1 }));
  const playlistManagerMap = {
    get: vi.fn(() => undefined),
    getOrCreate: vi.fn(async () => ({
      play,
      playPlaylistFromSong,
      getStatus,
      getCurrentSong: vi.fn(() => null),
      getCurrentSongForResponse: vi.fn(() => null),
    })),
  } as unknown as PlaylistManagerMap;
  const minaService = {} as MinaService;

  registerPlaylistHandlers(router, playlistManagerMap, minaService);
  return { router, playlistManagerMap, play, playPlaylistFromSong };
}

/** /player/status 从 req.query 读参数，request() 把 query 写死为空串，故单列。 */
function statusRequest(): HTTPRequest {
  return {
    method: 'GET',
    path: '/player/status',
    query: 'account_id=acc-1&device_id=dev-1',
    headers: {},
    body: null,
  } as HTTPRequest;
}

describe('stop failure must not hide the real device state', () => {
  /**
   * 用**真实** PlaylistManager，不用 mock：mock 会把 stopped 与
   * 「设备确认停了」当成一回事，正好复刻要防的那个盲区。
   */
  async function harnessWithRealManager(stopSucceeds: boolean) {
    const { PlaylistManager } = await import('../../src/player/manager');
    const minaService = {
      playURL: vi.fn(async () => true),
      pausePlay: vi.fn(async () => true),
      stopPlay: vi.fn(async () => stopSucceeds),
      resumePlay: vi.fn(async () => true),
      // 设备探针的真实形状：{ data: { info: JSON 字符串 } }，status 1 = 正在播放
      getPlayerStatus: vi.fn(async () => ({
        data: { info: JSON.stringify({ status: 1, volume: 40 }) },
      })),
    } as unknown as MinaService;
    const configManager = {
      getConfig: vi.fn(async () => ({ force_mp3: false, server_host: 'http://songloft.test:18191', prefetch_next_song: false })),
      updateDevice: vi.fn(async () => undefined),
    } as unknown as import('../../src/config/manager').ConfigManager;

    const manager = new PlaylistManager('acc-1', 'dev-1', minaService, configManager);
    const playlistManagerMap = {
      get: vi.fn(() => manager),
      getOrCreate: vi.fn(async () => manager),
    } as unknown as PlaylistManagerMap;

    const router = createRouter();
    registerPlaylistHandlers(router, playlistManagerMap, minaService);
    return { router, manager, minaService };
  }

  const track = {
    id: 1, type: 'local', title: 'A', artist: 'a', album: '', duration: 100,
    file_path: '', url: '/api/v1/songs/1/play', cover_path: '', cover_url: '',
    lyric_url: '', file_size: 0, format: 'mp3', bit_rate: 0, sample_rate: 0,
    is_live: false, cache_hash: '',
  };

  it('lets the real device state through /player/status when the device refused to stop', async () => {
    const { router, manager } = await harnessWithRealManager(false);
    await manager.playStandalone([track] as never, 0, 'order');

    const stopResponse = await router.handle(request('POST', '/player/stop', {
      account_id: 'acc-1', device_id: 'dev-1',
    }));
    expect(parseResponseBody(stopResponse).success).toBe(false);

    // 断言接口真实返回值，而不是内部标记：设备探针仍报 playing，
    // 本地 stopped 不该压制它，否则用户看到 stopped 而音箱还在响，
    // 且这是永久性的，不是缓存过期问题。
    const status = await router.handle(statusRequest());
    expect(parseResponseBody(status).data.state).not.toBe('stopped');
  });

  it('also lets the real state through on the cached branch of /player/status', async () => {
    // /player/status 有两条分支：4 秒缓存命中 与 缓存未命中。
    // 压制规则在两条里各写了一遍，只改一条等于没改——缓存窗口内 bug 照旧。
    const { updateDeviceStatusCache } = await import('../../src/handlers/playlist');
    const { router, manager } = await harnessWithRealManager(false);
    await manager.playStandalone([track] as never, 0, 'order');
    await router.handle(request('POST', '/player/stop', { account_id: 'acc-1', device_id: 'dev-1' }));

    // 预热缓存为「设备仍在播」，让这次状态查询走缓存命中分支
    updateDeviceStatusCache('acc-1', 'dev-1', { state: 'playing', position: 33 });

    const status = await router.handle(statusRequest());
    expect(parseResponseBody(status).data.state).not.toBe('stopped');
  });

  it('suppresses a stale device playing state when the stop actually succeeded', async () => {
    const { router, manager } = await harnessWithRealManager(true);
    await manager.playStandalone([track] as never, 0, 'order');

    const stopResponse = await router.handle(request('POST', '/player/stop', {
      account_id: 'acc-1', device_id: 'dev-1',
    }));
    expect(parseResponseBody(stopResponse).success).toBe(true);

    // 停止成功时保留原有语义：设备残留的 playing 不该翻回来
    const status = await router.handle(statusRequest());
    expect(parseResponseBody(status).data.state).toBe('stopped');
    expect(parseResponseBody(status).data.position).toBe(0);
  });

  it('a queue that finishes naturally after a failed stop still reports stopped', async () => {
    // 重置存在的理由：onSongFinished 会直接把 state 置为 'stopped' 而不经过
    // stop()，因此不会重新给 deviceStopConfirmed 赋值。若上一次失败的 false
    // 残留着，队列正常播完后接口会拒绝上报 stopped，一直显示设备的 playing。
    const { router, manager } = await harnessWithRealManager(false);

    await manager.playStandalone([track] as never, 0, 'order');
    await manager.stop();
    expect(manager.isStopAuthoritative()).toBe(false);

    // 重播，然后让队列自然播完（once 模式播完即结束，走 onSongFinished）
    await manager.playStandalone([track] as never, 0, 'once');
    await (manager as unknown as { onSongFinished(): Promise<void> }).onSongFinished();

    expect(parseResponseBody(await router.handle(statusRequest())).data.state).toBe('stopped');
  });
});

describe('current_song in responses must not leak internal fields', () => {
  it('omits source_data from /player/next and /player/previous', async () => {
    // handler 曾直接回吐 getCurrentSong()，把整个 songInfo 发给前端。
    // 断言的是响应体本身，不是内部投影函数——否则换个 handler 又会漏。
    const { PlaylistManager } = await import('../../src/player/manager');
    const minaService = {
      playURL: vi.fn(async () => true),
      pausePlay: vi.fn(async () => true),
      stopPlay: vi.fn(async () => true),
      resumePlay: vi.fn(async () => true),
      getPlayerStatus: vi.fn(async () => ({ data: { info: JSON.stringify({ status: 1 }) } })),
    } as unknown as MinaService;
    const configManager = {
      getConfig: vi.fn(async () => ({ force_mp3: false, server_host: 'http://songloft.test:18191', prefetch_next_song: false })),
      updateDevice: vi.fn(async () => undefined),
    } as unknown as import('../../src/config/manager').ConfigManager;

    const manager = new PlaylistManager('acc-1', 'dev-1', minaService, configManager);
    const withSource = {
      id: 0, type: 'local', title: '风起天阑', artist: '河图', album: '', duration: 100,
      file_path: '/srv/media/private/风起天阑.flac',
      url: 'https://cdn.example.com/a.mp3',
      cover_path: '', cover_url: '', lyric_url: '', file_size: 0, format: 'mp3',
      bit_rate: 0, sample_rate: 0, is_live: false, cache_hash: '',
      source_data: { platform: 'kw', quality: 'flac', songInfo: { songmid: 'SECRET-MID' } },
    };
    await manager.playStandalone([withSource, { ...withSource, title: '第二首' }] as never, 0, 'order');

    const playlistManagerMap = {
      get: vi.fn(() => manager),
      getOrCreate: vi.fn(async () => manager),
    } as unknown as PlaylistManagerMap;
    const router = createRouter();
    registerPlaylistHandlers(router, playlistManagerMap, minaService);

    for (const route of ['/player/next', '/player/previous']) {
      const response = await router.handle(request('POST', route, {
        account_id: 'acc-1', device_id: 'dev-1',
      }));
      const raw = JSON.stringify(parseResponseBody(response));
      expect(raw, `${route} leaked source_data`).not.toContain('SECRET-MID');
      expect(raw, `${route} leaked source_data`).not.toContain('source_data');
      expect(raw, `${route} leaked file_path`).not.toContain('/srv/media/private');
    }
  });
});

describe('registerPlaylistHandlers input validation', () => {
  it('rejects fractional, negative and overflowing playlist ids before calling the host API', async () => {
    const getSongs = vi.fn(async () => []);
    (songloft.playlists as unknown as SongloftPlaylistsStub).getSongs = getSongs;
    const { router } = createHarness();

    for (const id of ['1.5', '-3', '1e400', 'abc']) {
      const response = await router.handle(request('GET', `/playlists/${id}/songs`));
      expect(parseResponseBody(response)).toEqual({ success: false, error: 'invalid playlist id' });
    }

    expect(getSongs).not.toHaveBeenCalled();
  });

  it('still loads songs for a valid positive playlist id', async () => {
    const getSongs = vi.fn(async () => [{ id: 7, title: 'Song' }]);
    (songloft.playlists as unknown as SongloftPlaylistsStub).getSongs = getSongs;
    const { router } = createHarness();

    const response = await router.handle(request('GET', '/playlists/12/songs'));

    expect(getSongs).toHaveBeenCalledWith(12, { limit: 100000 });
    expect(parseResponseBody(response)).toEqual({ success: true, data: [{ id: 7, title: 'Song' }] });
  });

  it('rejects a fractional playlist_id on /player/play but keeps negative dynamic ids', async () => {
    const { router, play } = createHarness();

    const fractional = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: 1.5,
    }));
    expect(parseResponseBody(fractional)).toEqual({ success: false, error: 'invalid playlist_id' });
    expect(play).not.toHaveBeenCalled();

    const dynamic = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: -2,
    }));
    expect(parseResponseBody(dynamic).success).toBe(true);
    expect(play).toHaveBeenCalledWith(-2, 0, 'order');
  });

  it('targets a fresh playlist song by id and returns its resolved current index', async () => {
    const { router, play, playPlaylistFromSong } = createHarness();

    const response = await router.handle(request('POST', '/player/play', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      playlist_id: 9,
      start_index: 0,
      song_id: 21,
    }));

    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: {
        playlist_id: 9,
        current_index: 1,
      },
    });
    expect(playPlaylistFromSong).toHaveBeenCalledWith(9, 21, 'order', 0);
    expect(play).not.toHaveBeenCalled();
  });
});
