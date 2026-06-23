import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { CustomPlaylistService } from '../../src/custom_playlists/service';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlatformRegistry } from '../../src/music/platforms/registry';
import type { MusicPlatformProvider } from '../../src/music/platforms/types';
import type { SearchResultSong } from '../../src/music/types';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

const kgSong = {
  title: '为龙',
  artist: '河图',
  album: '为龙',
  duration: 260,
  cover_url: '',
  source_data: {
    platform: 'kg',
    quality: '320k',
    songInfo: { source: 'kg', name: '为龙', singer: '河图', album: '为龙', duration: 260, hash: 'hash-1' },
  },
} satisfies SearchResultSong;

function message(query: string): ConversationMessage {
  return {
    account_id: 'acc-1',
    device_id: 'dev-1',
    device_name: 'Speaker',
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
    getDevices: vi.fn(async () => [{ device_id: 'dev-1', play_mode: 'order' }]),
  } as unknown as ConfigManager;
  const accountManager = {
    getAccounts: vi.fn(async () => [{ id: 'acc-1' }]),
  } as unknown as AccountManager;
  const minaService = {
    textToSpeech: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManagerMap = {
    get: vi.fn(() => null),
    getOrCreate: vi.fn(),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    refresh: vi.fn(async () => ({ success: true, songCount: 1, playlistCount: 1 })),
  } as unknown as IndexingManager;
  const customPlaylistService = {
    create: vi.fn(async () => ({ id: 'custom_1', name: '古风', songs: [] })),
    addSong: vi.fn(async () => ({ id: 'custom_1', name: '古风', songs: [kgSong] })),
  } as unknown as CustomPlaylistService;
  const provider = {
    id: 'kg',
    name: '酷狗',
    search: vi.fn(async () => ({ list: [kgSong], total: 1 })),
  } as unknown as MusicPlatformProvider;
  const platforms = {
    all: vi.fn(() => [{ id: 'kg', name: '酷狗' }]),
    get: vi.fn((id: string) => (id === 'kg' ? provider : null)),
  } as unknown as PlatformRegistry;

  const engine = new VoiceEngine(
    configManager,
    accountManager,
    minaService,
    playlistManagerMap,
    indexingManager,
    undefined,
    undefined,
    customPlaylistService,
    platforms,
  );
  engine.setEnabled(true);

  return { engine, customPlaylistService, indexingManager, minaService, provider, platforms };
}

describe('VoiceEngine custom playlists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates custom playlists from voice commands', async () => {
    const { engine, customPlaylistService, indexingManager, minaService } = createEngine([
      { type: 'create_playlist', keywords: ['创建歌单'], enabled: true },
    ]);

    await engine.handleMessage(message('创建歌单 古风'));

    expect(customPlaylistService.create).toHaveBeenCalledWith('古风');
    expect(indexingManager.refresh).toHaveBeenCalledTimes(1);
    expect(minaService.textToSpeech).toHaveBeenCalledWith('acc-1', 'dev-1', '已创建歌单：古风');
  });

  it('adds searched songs into target playlists with a source name hint', async () => {
    const { engine, customPlaylistService, indexingManager, minaService, provider } = createEngine([
      { type: 'add_song_to_playlist', keywords: ['把'], enabled: true },
    ]);

    await engine.handleMessage(message('把为龙 河图 酷狗 加到古风'));

    expect(provider.search).toHaveBeenCalledWith('为龙 河图', 1, 5);
    expect(customPlaylistService.addSong).toHaveBeenCalledWith('古风', kgSong);
    expect(indexingManager.refresh).toHaveBeenCalledTimes(1);
    expect(minaService.textToSpeech).toHaveBeenCalledWith('acc-1', 'dev-1', '已加入歌单：古风');
  });

  it('speaks a concise reason when the source name is unknown', async () => {
    const { engine, customPlaylistService, minaService, provider } = createEngine([
      { type: 'add_song_to_playlist', keywords: ['把'], enabled: true },
    ]);

    await engine.handleMessage(message('把为龙 河图 火星 加到古风'));

    expect(provider.search).not.toHaveBeenCalled();
    expect(customPlaylistService.addSong).not.toHaveBeenCalled();
    expect(minaService.textToSpeech).toHaveBeenCalledWith('acc-1', 'dev-1', '未找到音源');
  });
});
