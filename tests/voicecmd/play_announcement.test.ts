import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

type WaitMode = 'auto' | 'fixed' | 'poll';

function message(query: string): ConversationMessage {
  return {
    account_id: 'acc-1',
    device_id: 'speaker-1',
    device_name: '客厅音箱',
    message: {
      timestamp_ms: Date.now(),
      response: { answer: [{ question: query }] },
    },
  };
}

function playerStatus(status: number): unknown {
  return { data: { info: JSON.stringify({ status }) } };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

function createEngine(options: {
  enabled?: boolean;
  template?: string;
  waitMode?: WaitMode;
  delay?: number;
  standalone?: { id: number; url: string; title: string; artist: string } | null;
  indexedLocations?: Array<{
    playlistId: number;
    playlistName: string;
    songIndex: number;
    songTitle: string;
    artist: string;
    songId?: number;
  } | null>;
} = {}) {
  const commands: VoiceCommand[] = [
    { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
  ];
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: false, api_url: '', api_key: '', model: '', timeout: 6 })),
    getConfig: vi.fn(async () => ({
      interrupt_tts_hint_enabled: false,
      interrupt_tts_hint_text: '',
      play_announcement_enabled: options.enabled ?? true,
      play_announcement_template: options.template ?? '即将播放{artist}的{song}',
      play_announcement_wait_mode: options.waitMode ?? 'fixed',
      play_announcement_delay: options.delay ?? 0,
    })),
    getVoiceCommands: vi.fn(async () => commands),
    getDevices: vi.fn(async () => [{ device_id: 'speaker-1', play_mode: 'order' }]),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    stopPlay: vi.fn(async () => true),
    textToSpeech: vi.fn(async () => true),
    getPlayerStatus: vi.fn(async () => playerStatus(0)),
  } as unknown as MinaService;
  const playlistManager = {
    hasPlaylist: vi.fn(() => false),
    prepareForNewPlayback: vi.fn(),
    playStandalone: vi.fn(async () => true),
    playPlaylistFromSong: vi.fn(async () => true),
    play: vi.fn(async () => true),
    isLastPlayNotFound: vi.fn(() => false),
  };
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const standalone = options.standalone === undefined
    ? { id: 12, url: 'https://audio.test/father.mp3', title: '父亲', artist: '筷子兄弟' }
    : options.standalone;
  const locations = options.indexedLocations ?? [null];
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    findSongByName: vi.fn(async () => locations.shift() ?? null),
    findStandaloneSongByName: vi.fn(async () => standalone),
    refresh: vi.fn(async () => ({ success: true, playlistCount: 1, songCount: 1 })),
  } as unknown as IndexingManager;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
  );
  engine.setEnabled(true);

  return { engine, minaService, playlistManager, indexingManager };
}

describe('VoiceEngine play announcements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces song and artist placeholders before standalone playback', async () => {
    const { engine, minaService, playlistManager } = createEngine({
      template: '现在播放{song}，演唱{artist}',
      waitMode: 'fixed',
      delay: 0,
    });
    let finishTts!: (value: boolean) => void;
    vi.mocked(minaService.textToSpeech).mockImplementation(() => new Promise(resolve => {
      finishTts = resolve;
    }));

    const handled = engine.handleMessage(message('播放歌曲 父亲'));
    await flushMicrotasks();

    expect(minaService.textToSpeech).toHaveBeenCalledWith(
      'acc-1',
      'speaker-1',
      '现在播放父亲，演唱筷子兄弟',
    );
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();

    finishTts(true);
    await handled;

    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('does not announce when the feature is disabled', async () => {
    const { engine, minaService, playlistManager } = createEngine({ enabled: false });

    await engine.handleMessage(message('播放歌曲 父亲'));

    expect(minaService.textToSpeech).not.toHaveBeenCalled();
    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('continues actual playback when TTS rejects', async () => {
    const { engine, minaService, playlistManager } = createEngine();
    vi.mocked(minaService.textToSpeech).mockRejectedValue(new Error('tts unavailable'));

    await expect(engine.handleMessage(message('播放歌曲 父亲'))).resolves.toBeUndefined();

    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);
    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('skips announcement waiting when TTS reports failure', async () => {
    vi.useFakeTimers();
    const { engine, minaService, playlistManager } = createEngine({ waitMode: 'fixed', delay: 10 });
    vi.mocked(minaService.textToSpeech).mockResolvedValue(false);

    const handled = engine.handleMessage(message('播放歌曲 父亲'));
    await flushMicrotasks();

    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);
    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
    await handled;
  });

  it('honors fixed delay zero and caps legacy fixed delays at ten seconds', async () => {
    vi.useFakeTimers();
    const { engine, minaService, playlistManager } = createEngine({ waitMode: 'fixed', delay: 99 });

    const handled = engine.handleMessage(message('播放歌曲 父亲'));
    await flushMicrotasks();
    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await handled;

    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('caps auto estimation so even a huge template reaches playback within fifteen seconds', async () => {
    vi.useFakeTimers();
    const hugeTemplate = '{song}' + '很长'.repeat(40_000) + '{artist}';
    const { engine, minaService, playlistManager } = createEngine({ template: hugeTemplate, waitMode: 'auto' });

    const handled = engine.handleMessage(message('播放歌曲 父亲'));
    await flushMicrotasks();
    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await handled;

    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('does not treat the speaker still being idle as the announcement finishing', async () => {
    vi.useFakeTimers();
    const { engine, minaService, playlistManager } = createEngine({ waitMode: 'poll' });
    vi.mocked(minaService.getPlayerStatus).mockResolvedValue(playerStatus(0));

    const handled = engine.handleMessage(message('播放歌曲 父亲'));
    await flushMicrotasks();
    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(14_500);
    await handled;

    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('caps status polling and starts playback after fifteen seconds when the device stays busy', async () => {
    vi.useFakeTimers();
    const { engine, minaService, playlistManager } = createEngine({ waitMode: 'poll' });
    vi.mocked(minaService.getPlayerStatus).mockResolvedValue(playerStatus(1));

    const handled = engine.handleMessage(message('播放歌曲 父亲'));
    await flushMicrotasks();
    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(playlistManager.playStandalone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await handled;

    expect(minaService.getPlayerStatus).toHaveBeenCalled();
    expect(playlistManager.playStandalone).toHaveBeenCalledTimes(1);
  });

  it('announces only once when a stale indexed transport retries within the command', async () => {
    const oldLocation = {
      playlistId: 10,
      playlistName: '旧歌单',
      songIndex: 2,
      songTitle: '父亲',
      artist: '筷子兄弟',
    };
    const newLocation = { ...oldLocation, playlistId: 11, playlistName: '新歌单' };
    const { engine, minaService, playlistManager } = createEngine({
      standalone: null,
      indexedLocations: [oldLocation, newLocation],
    });
    playlistManager.play.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    playlistManager.isLastPlayNotFound.mockReturnValue(true);

    await engine.handleMessage(message('播放歌曲 父亲'));

    expect(playlistManager.play).toHaveBeenCalledTimes(2);
    expect(minaService.textToSpeech).toHaveBeenCalledTimes(1);
  });

  it('uses the host song id for indexed voice playback', async () => {
    const location = {
      playlistId: 10,
      playlistName: '夜间歌单',
      songIndex: 2,
      songId: 31,
      songTitle: '父亲',
      artist: '筷子兄弟',
    };
    const { engine, playlistManager } = createEngine({
      standalone: null,
      indexedLocations: [location],
    });

    await engine.handleMessage(message('播放歌曲 父亲'));

    expect(playlistManager.playPlaylistFromSong).toHaveBeenCalledWith(10, 31, 'order', 2);
    expect(playlistManager.play).not.toHaveBeenCalled();
  });

  it('announces the download fallback after stream-first playback fails', async () => {
    const { engine, minaService, playlistManager } = createEngine({ standalone: null });
    const resolved = { id: 'stream-id', title: '流媒体歌曲', artist: '流媒体歌手', source: 'kw' };
    const downloaded = { id: 31, title: '下载歌曲', artist: '本地歌手', url: 'https://audio.test/local.mp3' };
    const internal = engine as any;
    internal.bridgeService = {
      resolveSearchSong: vi.fn(async () => resolved),
      playOnSpeaker: vi.fn(async () => ({})),
    };
    internal.downloadService = { downloadSong: vi.fn(async () => ({ song_id: 31 })) };
    internal.loadSongloftLibrarySongById = vi.fn(async () => downloaded);
    internal.downloadResolvedSongToLibrary = vi.fn(async () => downloaded);

    await engine.handleMessage(message('播放歌曲 流媒体歌曲'));

    expect(minaService.textToSpeech).toHaveBeenNthCalledWith(1, 'acc-1', 'speaker-1', '即将播放流媒体歌手的流媒体歌曲');
    expect(minaService.textToSpeech).toHaveBeenNthCalledWith(2, 'acc-1', 'speaker-1', '即将播放本地歌手的下载歌曲');
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([downloaded], 0, 'single', { autoAdvance: false });
  });
});
