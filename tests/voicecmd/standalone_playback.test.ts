import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

function message(query: string, accountId = 'acc-1'): ConversationMessage {
  return {
    account_id: accountId,
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

function createEngine(commands: VoiceCommand[], options?: {
  accounts?: Array<{ id: string }>;
  devicesByAccount?: Record<string, Array<{ device_id: string; play_mode?: string }>>;
}) {
  const configManager = {
    getAIConfig: vi.fn(async () => ({ enabled: false, api_url: '', api_key: '', model: '', timeout: 6 })),
    getConfig: vi.fn(async () => ({ interrupt_tts_hint_enabled: false, interrupt_tts_hint_text: '' })),
    getVoiceCommands: vi.fn(async () => commands),
    getDevices: vi.fn(async (accountId: string) =>
      options?.devicesByAccount?.[accountId] ?? [{ device_id: 'speaker-1', play_mode: 'order' }]),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => options?.accounts ?? [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    playURL: vi.fn(async () => true),
    pausePlay: vi.fn(async () => true),
    stopPlay: vi.fn(async () => true),
    textToSpeech: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManager = {
    hasPlaylist: vi.fn(() => false),
    prepareForNewPlayback: vi.fn(),
    playStandalone: vi.fn(async () => true),
  };
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(async () => playlistManager),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => true),
    findSongByName: vi.fn(async () => null),
    findStandaloneSongByName: vi.fn(async () => ({
      id: 12,
      url: 'https://audio.test/father.mp3',
      title: '父亲',
      artist: '筷子兄弟',
    })),
  } as unknown as IndexingManager;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
  );
  engine.setEnabled(true);

  return { engine, minaService, playlistManager, playlistManagerMap };
}

describe('VoiceEngine standalone playback queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plays standalone indexed songs through PlaylistManager so pause can control them later', async () => {
    const { engine, minaService, playlistManager, playlistManagerMap } = createEngine([
      { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
    ]);

    await engine.handleMessage(message('播放歌曲 父亲'));

    expect(playlistManagerMap.getOrCreate).toHaveBeenCalledWith('acc-1', 'speaker-1');
    expect(playlistManager.playStandalone).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 12,
        type: 'remote',
        title: '父亲',
        artist: '筷子兄弟',
        url: 'https://audio.test/father.mp3',
      }),
    ], 0, 'single', { autoAdvance: false });
    expect(minaService.playURL).not.toHaveBeenCalled();
  });

  it('uses the account id from the conversation message instead of a stale device reverse lookup', async () => {
    const { engine, playlistManagerMap } = createEngine([
      { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
    ], {
      accounts: [{ id: 'acc-stale' }, { id: 'acc-real' }],
      devicesByAccount: {
        'acc-stale': [{ device_id: 'speaker-1', play_mode: 'order' }],
        'acc-real': [{ device_id: 'speaker-1', play_mode: 'order' }],
      },
    });

    await engine.handleMessage(message('播放歌曲 父亲', 'acc-real'));

    expect(playlistManagerMap.getOrCreate).toHaveBeenCalledWith('acc-real', 'speaker-1');
    expect(playlistManagerMap.getOrCreate).not.toHaveBeenCalledWith('acc-stale', 'speaker-1');
  });
});
