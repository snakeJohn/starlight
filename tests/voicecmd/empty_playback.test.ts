import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine, getDefaultVoiceCommands } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

function message(query: string): ConversationMessage {
  return {
    account_id: 'acc-1',
    device_id: 'speaker-1',
    device_name: '客厅音箱',
    message: {
      timestamp_ms: Date.now(),
      response: {
        answer: [{ question: query }],
      },
    },
  };
}

function createEngine(commands: VoiceCommand[]) {
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: false, api_url: '', api_key: '', model: '', timeout: 6 })),
    getVoiceCommands: vi.fn(async () => commands),
    getDevices: vi.fn(async () => [{ device_id: 'speaker-1', play_mode: 'order' }]),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    stopPlay: vi.fn(async () => true),
    textToSpeech: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManager = {
    hasPlaylist: vi.fn(() => true),
    isPlaying: vi.fn(() => true),
    next: vi.fn(async () => true),
    prepareForNewPlayback: vi.fn(),
    resumePlayback: vi.fn(async () => true),
    replayCurrent: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
  };
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    searchPlaylist: vi.fn(() => []),
    findPlaylistByName: vi.fn(() => null),
    findSongByName: vi.fn(async () => null),
  } as unknown as IndexingManager;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
  );
  engine.setEnabled(true);

  return { engine, playlistManager, minaService, indexingManager };
}

describe('VoiceEngine empty playback commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not skip to next song when play song has no song name', async () => {
    const { engine, playlistManager, minaService, indexingManager } = createEngine([
      { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
    ]);

    await engine.handleMessage(message('播放歌曲'));

    expect(playlistManager.next).not.toHaveBeenCalled();
    expect(playlistManager.prepareForNewPlayback).not.toHaveBeenCalled();
    expect(minaService.stopPlay).not.toHaveBeenCalled();
    expect(indexingManager.findSongByName).not.toHaveBeenCalled();
  });

  it('does not skip to next song when play playlist has no playlist name and a queue exists', async () => {
    const { engine, playlistManager, minaService, indexingManager } = createEngine([
      { type: 'play_playlist', keywords: ['播放歌单'], enabled: true },
    ]);

    await engine.handleMessage(message('播放歌单'));

    expect(playlistManager.next).not.toHaveBeenCalled();
    expect(playlistManager.prepareForNewPlayback).not.toHaveBeenCalled();
    expect(minaService.stopPlay).not.toHaveBeenCalled();
    expect(indexingManager.searchPlaylist).not.toHaveBeenCalled();
  });

  it('treats "闭嘴" as a default stop playback command', async () => {
    const { engine, playlistManager } = createEngine(getDefaultVoiceCommands());

    await engine.handleMessage(message('闭嘴'));

    expect(playlistManager.stop).toHaveBeenCalledTimes(1);
    expect(playlistManager.replayCurrent).not.toHaveBeenCalled();
  });
});
