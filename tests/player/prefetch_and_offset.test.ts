import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistManager, type PlayerSong } from '../../src/player/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';
import { setHostBaseUrl } from '../../src/utils/http';

const HOST = 'http://songloft.test:18191';

function hostSong(id: number, title: string, duration: number): PlayerSong {
  return {
    id,
    type: 'local',
    title,
    artist: '歌手',
    album: '',
    duration,
    file_path: '',
    url: `/api/v1/songs/${id}/play`,
    cover_path: '',
    cover_url: '',
    lyric_url: '',
    file_size: 0,
    format: 'mp3',
    bit_rate: 0,
    sample_rate: 0,
    is_live: false,
    cache_hash: '',
  };
}

function createManager(config: Record<string, unknown> = {}, dynamicOptions: Record<string, unknown> = {}) {
  const minaService = {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    pausePlayVerified: vi.fn(async () => 'paused' as const),
    stopPlay: vi.fn(async () => true),
    resumePlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const configManager = {
    getConfig: vi.fn(async () => ({ force_mp3: false, server_host: HOST, ...config })),
    updateDevice: vi.fn(async () => undefined),
  } as unknown as ConfigManager;

  return {
    manager: new PlaylistManager('acc', 'dev', minaService, configManager, dynamicOptions),
    minaService,
  };
}

/** Collect the URLs passed to fetch, so prefetch traffic can be asserted on. */
function stubFetch() {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('', { status: 202 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

/** Let the fire-and-forget prefetch promise settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('auto-next timer offset', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
  });

  it('delays the auto-next timer by a positive song_transition_offset', async () => {
    stubFetch();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { manager } = createManager({ song_transition_offset: 5, prefetch_next_song: false });

    await manager.playStandalone([hostSong(1, '第一首', 100)], 0, 'order');

    // 100s duration + 5s offset → 105_000ms
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(105_000);
    manager.cleanup();
  });

  it('advances earlier for a negative offset and never drops below 1s', async () => {
    stubFetch();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { manager } = createManager({ song_transition_offset: -30, prefetch_next_song: false });

    // Duration shorter than the offset would otherwise yield a non-positive delay.
    await manager.playStandalone([hostSong(1, '短曲', 10)], 0, 'order');

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(1_000);
    expect(delays).not.toContain(0);
    manager.cleanup();
  });

  it('ignores an out-of-range or non-numeric offset', async () => {
    stubFetch();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { manager } = createManager({ song_transition_offset: 'nonsense', prefetch_next_song: false });

    await manager.playStandalone([hostSong(1, '第一首', 100)], 0, 'order');

    expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(100_000);
    manager.cleanup();
  });

  it('keeps the transition offset after pause and resume', async () => {
    vi.useFakeTimers();
    try {
      stubFetch();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const { manager } = createManager({ song_transition_offset: 5, prefetch_next_song: false });

      await manager.playStandalone([hostSong(1, '第一首', 100)], 0, 'order');
      await vi.advanceTimersByTimeAsync(10_000);
      await manager.pause();
      setTimeoutSpy.mockClear();

      await manager.resumePlayback();

      expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(95_000);
      manager.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not double-count positive offset time elapsed before pausing', async () => {
    vi.useFakeTimers();
    try {
      stubFetch();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const { manager } = createManager({ song_transition_offset: 5, prefetch_next_song: false });

      await manager.playStandalone([hostSong(1, '第一首', 100)], 0, 'order');
      await vi.advanceTimersByTimeAsync(103_000);
      await manager.pause();
      setTimeoutSpy.mockClear();

      await manager.resumePlayback();

      expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(2_000);
      manager.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores transition offset for pause progress when auto-advance is disabled', async () => {
    vi.useFakeTimers();
    try {
      stubFetch();
      const { manager } = createManager({ song_transition_offset: -30, prefetch_next_song: false });

      await manager.playStandalone(
        [hostSong(1, '独立单曲', 100)],
        0,
        'single',
        { autoAdvance: false },
      );
      await vi.advanceTimersByTimeAsync(80_000);
      await manager.pause();

      expect(manager.getPosition()).toBe(80);
      manager.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the transition offset when device progress recalibrates the timer', async () => {
    stubFetch();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { manager } = createManager({ song_transition_offset: 5, prefetch_next_song: false });

    await manager.playStandalone([hostSong(1, '第一首', 100)], 0, 'order');
    setTimeoutSpy.mockClear();
    manager.resetAutoNextTimer(10);

    expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(95_000);
    manager.cleanup();
  });
});

describe('on-demand lyric fill', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
  });

  function sourceSong(id: number, title: string): PlayerSong {
    // 无宿主歌曲 ID（外部音源直推），只能靠内联歌词
    return {
      ...hostSong(id, title, 100),
      id: 0,
      url: `https://cdn.example.com/${id}.mp3`,
      lyric_url: '',
      source_data: { platform: 'kw', quality: 'flac', songInfo: { songmid: String(id) } },
    };
  }

  it('fills lyrics for a song deep in the queue, not just the first few', async () => {
    // 回归：歌词补全曾只在建队列时做且截断为前 3 首，
    // 第 4 首及以后即使正常播放也永远拿不到歌词。
    stubFetch();
    const resolved: string[] = [];
    const songs = [1, 2, 3, 4, 5].map((n) => sourceSong(n, `第${n}首`));
    const { manager } = createManager({}, {
      songLyricResolver: async (song: PlayerSong) => {
        resolved.push(song.title);
        return `[00:00.000]${song.title} 的歌词`;
      },
    });

    // 直接从第 4 首开始播
    await manager.playStandalone(songs, 3, 'order');
    await flush();

    expect(resolved).toContain('第4首');
    expect(songs[3].lyric_text).toBe('[00:00.000]第4首 的歌词');
    manager.cleanup();
  });

  it('skips songs that already have a lyric reference', async () => {
    stubFetch();
    const resolved: string[] = [];
    const withUrl = { ...sourceSong(1, '有歌词端点'), lyric_url: '/api/v1/songs/1/lyric' };
    const { manager } = createManager({}, {
      songLyricResolver: async (song: PlayerSong) => {
        resolved.push(song.title);
        return '[00:00.000]x';
      },
    });

    await manager.playStandalone([withUrl], 0, 'order');
    await flush();

    expect(resolved).not.toContain('有歌词端点');
    manager.cleanup();
  });

  it('keeps playback successful when lyric resolution throws', async () => {
    stubFetch();
    const { manager, minaService } = createManager({}, {
      songLyricResolver: async () => { throw new Error('provider down'); },
    });

    const ok = await manager.playStandalone([sourceSong(1, '第一首')], 0, 'order');
    await flush();

    expect(ok).toBe(true);
    expect(minaService.playURL).toHaveBeenCalledTimes(1);
    manager.cleanup();
  });
});

describe('next-song prefetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setHostBaseUrl(HOST);
    (globalThis as unknown as { songloft: { plugin: { getToken: () => Promise<string> } } })
      .songloft.plugin.getToken = async () => 'tok';
  });

  it('warms the next track on the host with prefetch=1', async () => {
    const calls = stubFetch();
    const { manager } = createManager();

    await manager.playStandalone([hostSong(1, '第一首', 100), hostSong(2, '第二首', 100)], 0, 'order');
    await flush();

    const prefetched = calls.filter((url) => url.includes('prefetch=1'));
    expect(prefetched).toHaveLength(1);
    // The NEXT song, not the one currently playing.
    expect(prefetched[0]).toContain('/api/v1/songs/2/play');
    manager.cleanup();
  });

  it('does not prefetch in single-song-repeat mode', async () => {
    const calls = stubFetch();
    const { manager } = createManager();

    await manager.playStandalone([hostSong(1, '第一首', 100), hostSong(2, '第二首', 100)], 0, 'single');
    await flush();

    expect(calls.filter((url) => url.includes('prefetch=1'))).toHaveLength(0);
    manager.cleanup();
  });

  it('does not prefetch external source streams', async () => {
    const calls = stubFetch();
    const { manager } = createManager();
    const external: PlayerSong = { ...hostSong(2, '外链', 100), url: 'https://cdn.example.com/a.mp3' };

    await manager.playStandalone([hostSong(1, '第一首', 100), external], 0, 'order');
    await flush();

    // Warming somebody else's CDN would spend the user's bandwidth for nothing.
    expect(calls.filter((url) => url.includes('prefetch=1'))).toHaveLength(0);
    manager.cleanup();
  });

  it('can be turned off', async () => {
    const calls = stubFetch();
    const { manager } = createManager({ prefetch_next_song: false });

    await manager.playStandalone([hostSong(1, '第一首', 100), hostSong(2, '第二首', 100)], 0, 'order');
    await flush();

    expect(calls.filter((url) => url.includes('prefetch=1'))).toHaveLength(0);
    manager.cleanup();
  });

  it('keeps playback successful when the prefetch request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { manager, minaService } = createManager();

    const ok = await manager.playStandalone([hostSong(1, '第一首', 100), hostSong(2, '第二首', 100)], 0, 'order');
    await flush();

    expect(ok).toBe(true);
    expect(minaService.playURL).toHaveBeenCalledTimes(1);
    manager.cleanup();
  });
});
