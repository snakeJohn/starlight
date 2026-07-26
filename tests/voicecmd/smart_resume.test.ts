import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

const commands: VoiceCommand[] = [
  { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
];

function message(query: string, deviceId = 'speaker-1'): ConversationMessage {
  return {
    account_id: 'acc-1',
    device_id: deviceId,
    device_name: '客厅音箱',
    message: {
      timestamp_ms: Date.now(),
      response: {
        answer: [{ question: query }],
      },
    },
  };
}

function createPlaylistManager() {
  return {
    hasPlaylist: vi.fn(() => true),
    isPlaying: vi.fn(() => true),
    suspendForVoiceInteraction: vi.fn(),
    resetAutoNextTimer: vi.fn(),
    resumePlayback: vi.fn(async () => true),
    replayCurrent: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
  };
}

function createEngine(managersByDevice: Record<string, ReturnType<typeof createPlaylistManager>>) {
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: false, api_url: '', api_key: '', model: '', timeout: 6 })),
    getConfig: vi.fn(async () => ({ interrupt_tts_hint_enabled: false, interrupt_tts_hint_text: '' })),
    getVoiceCommands: vi.fn(async () => commands),
    getDevices: vi.fn(async () => Object.keys(managersByDevice).map(device_id => ({ device_id, play_mode: 'order' }))),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    getPlayerStatus: vi.fn(async () => ({ data: { info: JSON.stringify({ status: 0 }) } })),
    textToSpeech: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManagerMap = {
    get: vi.fn((_accountId: string, deviceId: string) => managersByDevice[deviceId] ?? null),
    getOrCreate: vi.fn(async (_accountId: string, deviceId: string) => managersByDevice[deviceId]),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    refresh: vi.fn(async () => ({ success: true, playlistCount: 0, songCount: 0 })),
    findSongByName: vi.fn(async () => null),
    findStandaloneSongByName: vi.fn(async () => null),
  } as unknown as IndexingManager;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
  );
  engine.setEnabled(true);

  return { engine, minaService };
}

describe('VoiceEngine smart resume scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a pending resume per device instead of letting one device cancel another', async () => {
    const speaker1 = createPlaylistManager();
    const speaker2 = createPlaylistManager();
    const { engine } = createEngine({ 'speaker-1': speaker1, 'speaker-2': speaker2 });

    // 两台设备都在播放时被语音打断，各自的恢复任务都要保留
    await engine.handleMessage(message('今天天气怎么样', 'speaker-1'));
    await engine.handleMessage(message('现在几点了', 'speaker-2'));

    await vi.advanceTimersByTimeAsync(3000);

    expect(speaker1.resumePlayback).toHaveBeenCalledTimes(1);
    expect(speaker2.resumePlayback).toHaveBeenCalledTimes(1);
  });

  it('drops pending resumes when the engine is disabled', async () => {
    const speaker1 = createPlaylistManager();
    const { engine, minaService } = createEngine({ 'speaker-1': speaker1 });

    await engine.handleMessage(message('今天天气怎么样'));
    engine.setEnabled(false);

    await vi.advanceTimersByTimeAsync(10000);

    expect(minaService.getPlayerStatus).not.toHaveBeenCalled();
    expect(speaker1.resumePlayback).not.toHaveBeenCalled();
  });

  it('swallows device status errors instead of raising an unhandled rejection', async () => {
    const speaker1 = createPlaylistManager();
    const { engine, minaService } = createEngine({ 'speaker-1': speaker1 });
    vi.mocked(minaService.getPlayerStatus).mockRejectedValue(new Error('network down'));

    await engine.handleMessage(message('今天天气怎么样'));
    await vi.advanceTimersByTimeAsync(3000);

    expect(minaService.getPlayerStatus).toHaveBeenCalledTimes(1);
    expect(speaker1.resumePlayback).not.toHaveBeenCalled();
    expect(speaker1.replayCurrent).not.toHaveBeenCalled();
  });
});
