import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine, getDefaultVoiceCommands } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage } from '../../src/types';

function message(query: string): ConversationMessage {
  return {
    account_id: 'acc-1',
    device_id: 'speaker-1',
    device_name: '客厅音箱',
    message: { timestamp_ms: Date.now(), response: { answer: [{ question: query }] } },
  };
}

function createEngine(options: {
  aiEnabled?: boolean;
  aiResult?: { action: string; params: Record<string, unknown>; confidence: 'high' | 'medium' | 'low'; rawText: string };
} = {}) {
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: !!options.aiEnabled, api_url: '', api_key: '', model: '', timeout: 6 })),
    getVoiceCommands: vi.fn(async () => getDefaultVoiceCommands()),
    getDevices: vi.fn(async () => [{ device_id: 'speaker-1', play_mode: 'order', volume: 40 }]),
    updateDevice: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ interrupt_tts_hint_enabled: false })),
  } as unknown as ConfigManager;
  const accountManager = { getAccounts: vi.fn(async () => [{ id: 'acc-1' }]) } as unknown as AccountManager;
  const minaService = {
    textToSpeech: vi.fn(async () => true),
    setVolume: vi.fn(async () => true),
    getVolume: vi.fn(async () => 40),
    stopPlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const manager = {
    next: vi.fn(async () => true),
    previous: vi.fn(async () => true),
    setPlayMode: vi.fn(async () => undefined),
    stop: vi.fn(async () => true),
    isPlaying: vi.fn(() => false),
    setOnAdvanceHook: vi.fn(),
    hasPlaylist: vi.fn(() => false),
    prepareForNewPlayback: vi.fn(),
    playStandalone: vi.fn(async () => true),
    play: vi.fn(async () => true),
  };
  const playlistManagerMap = {
    get: vi.fn(() => manager),
    getOrCreate: vi.fn(async () => manager),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    refresh: vi.fn(async () => ({ success: true, playlistCount: 0, songCount: 0 })),
    findSongByName: vi.fn(async () => null),
    findStandaloneSongByName: vi.fn(async () => ({
      id: 8,
      url: 'https://audio.test/voice.mp3',
      title: '声音',
      artist: '许嵩',
    })),
  } as unknown as IndexingManager;
  const aiAnalyzer = options.aiResult ? { analyze: vi.fn(async () => options.aiResult) } : undefined;
  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
    aiAnalyzer as never,
  );
  engine.setEnabled(true);
  return { engine, manager, minaService, indexingManager };
}

describe('VoiceEngine fixed-control priority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plays a song whose title contains 声音 instead of treating it as volume', async () => {
    const { engine, minaService, indexingManager } = createEngine();

    await engine.handleMessage(message('播放歌曲声音'));

    expect(minaService.setVolume).not.toHaveBeenCalled();
    expect(indexingManager.findStandaloneSongByName).toHaveBeenCalled();
  });

  it('lets a high-confidence play_song win over the 下一首 control keyword', async () => {
    const { engine, manager, indexingManager } = createEngine({
      aiEnabled: true,
      aiResult: {
        action: 'play_song',
        params: { name: '七里香', artist: '周杰伦' },
        confidence: 'high',
        rawText: '播放下一首周杰伦',
      },
    });
    vi.mocked(indexingManager.findStandaloneSongByName).mockResolvedValue({
      id: 9,
      url: 'https://audio.test/qilixiang.mp3',
      title: '七里香',
      artist: '周杰伦',
    });

    await engine.handleMessage(message('播放下一首周杰伦'));

    expect(manager.next).not.toHaveBeenCalled();
    expect(indexingManager.findStandaloneSongByName).toHaveBeenCalled();
  });

  it('still applies 循环播放 as a play-mode command when that is the whole utterance', async () => {
    const { engine, manager, indexingManager } = createEngine();

    await engine.handleMessage(message('循环播放'));

    expect(manager.setPlayMode).toHaveBeenCalledWith('loop');
    expect(indexingManager.findStandaloneSongByName).not.toHaveBeenCalled();
  });
});
