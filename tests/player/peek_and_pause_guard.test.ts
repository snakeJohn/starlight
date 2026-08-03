import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import { setHostBaseUrl } from '../../src/utils/http';

const HOST = 'http://songloft.test:18191';

function fakeMina(): MinaService {
  return {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    pausePlayVerified: vi.fn(async () => 'paused' as const),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
}

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigManager {
  return {
    getConfig: vi.fn(async () => ({
      force_mp3: false, server_host: HOST, prefetch_next_song: true, ...overrides,
    })),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;
}

function song(id: number, title: string): PlayerSong {
  return {
    id, type: 'local', title, artist: 'a', album: '', duration: 100,
    file_path: '', url: `${HOST}/api/v1/songs/${id}/play`, cover_path: '', cover_url: '',
    lyric_url: '', file_size: 0, format: 'mp3', bit_rate: 0, sample_rate: 0,
    is_live: false, cache_hash: '',
  };
}

describe('look-ahead must not disturb random playback state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 202 })));
  });

  it('does not pre-fill lyrics for a randomly-guessed next track', async () => {
    // random 模式下「下一首」尚未确定，getNextIndex() 每次调用返回的都不一样。
    // 拿它做前瞻，预取热的是 A、歌词预填的是 B、最终播的是 C —— 三首互不相干，
    // 白花流量还填错歌词。修复后 random 模式只补当前曲。
    const resolved: string[] = [];
    const manager = new PlaylistManager('acc', 'dev', fakeMina(), fakeConfig(), {
      songLyricResolver: async (s: PlayerSong) => {
        resolved.push(s.title);
        return `[00:00.000]${s.title}`;
      },
    });
    const songs = [1, 2, 3, 4].map((n) => ({
      ...song(n, `第${n}首`),
      id: 0,
      lyric_url: '',
      source_data: { platform: 'kw', quality: 'flac', songInfo: { songmid: String(n) } },
    }));

    await manager.playStandalone(songs as never, 0, 'random');
    await new Promise((r) => setTimeout(r, 0));

    expect(resolved, `random 模式不该猜下一首：实际补了 ${resolved.join('/')}`)
      .toEqual(['第1首']);
    manager.cleanup();
  });

  it('skips prefetch in random mode instead of warming the wrong track', async () => {
    // random 模式下「下一首」还没定，预热任何一首都可能是错的：
    // 与其猜，不如不预热。
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new PlaylistManager('acc', 'dev', fakeMina(), fakeConfig());

    await manager.playStandalone([song(1, 'A'), song(2, 'B'), song(3, 'C')], 0, 'random');
    await new Promise((r) => setTimeout(r, 0));

    const prefetches = (fetchMock.mock.calls as unknown as unknown[][]).filter((c) => String(c[0]).includes("prefetch=1"));
    expect(prefetches).toHaveLength(0);
    manager.cleanup();
  });

  it('still prefetches in deterministic modes', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new PlaylistManager('acc', 'dev', fakeMina(), fakeConfig());

    await manager.playStandalone([song(1, 'A'), song(2, 'B')], 0, 'order');
    await new Promise((r) => setTimeout(r, 0));

    const prefetches = (fetchMock.mock.calls as unknown as unknown[][]).filter((c) => String(c[0]).includes("prefetch=1"));
    expect(prefetches.length).toBeGreaterThan(0);
    manager.cleanup();
  });
});

describe('pause() must not fabricate a resumable state', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 202 })));
  });

  it('leaves an idle manager idle instead of flipping it to paused', async () => {
    // /mina/pause 是无条件调用的（浏览器接管时总会发一次）。若空闲管理器也被
    // 翻成 paused，随后 /player/toggle 会误以为「有东西可恢复」而走
    // resumePlayback()，而不是从头 play() 一个歌单。
    const minaService = fakeMina();
    const manager = new PlaylistManager('acc', 'dev', minaService, fakeConfig());

    await expect(manager.pause()).resolves.toBe(true);

    expect(manager.getStatus().state).not.toBe('paused');
    // 本地没有队列不代表物理音箱没有在播放插件外内容。
    expect(minaService.pausePlayVerified).toHaveBeenCalledWith('acc', 'dev');
  });

  it('does not resurrect a stopped manager as paused', async () => {
    const manager = new PlaylistManager('acc', 'dev', fakeMina(), fakeConfig());
    await manager.playStandalone([song(1, 'A')], 0, 'order');
    await manager.stop();
    expect(manager.getStatus().state).toBe('stopped');

    await manager.pause();

    expect(manager.getStatus().state).toBe('stopped');
    manager.cleanup();
  });

  it('still pauses a manager that is actually playing', async () => {
    const minaService = fakeMina();
    const manager = new PlaylistManager('acc', 'dev', minaService, fakeConfig());
    await manager.playStandalone([song(1, 'A')], 0, 'order');

    await expect(manager.pause()).resolves.toBe(true);

    expect(manager.getStatus().state).toBe('paused');
    expect(minaService.pausePlayVerified).toHaveBeenCalledTimes(1);
    manager.cleanup();
  });
});
