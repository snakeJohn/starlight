import { describe, expect, it, vi } from 'vitest';
import { TaskExecutor } from '../../src/schedule/executor';
import type { ConfigManager } from '../../src/config/manager';
import type { ConversationMonitor } from '../../src/conversation/monitor';
import type { MinaService } from '../../src/service/service';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { ScheduledTask } from '../../src/types';

function createExecutor() {
  const manager = {
    play: vi.fn(async () => true),
  };
  const configManager = {
    getAccounts: vi.fn(async () => [{
      id: 'account-1',
      devices: [{
        device_id: 'speaker-1',
        device_name: '客厅音箱',
        managed: true,
      }],
    }]),
    getConfig: vi.fn(async () => ({ conversation_monitor_enabled: false })),
    saveConfig: vi.fn(async () => {}),
  } as unknown as ConfigManager;
  const minaService = {
    setVolume: vi.fn(async () => true),
  } as unknown as MinaService;
  const playlistManagerMap = {
    getOrCreate: vi.fn(async () => manager),
    get: vi.fn(() => null),
  } as unknown as PlaylistManagerMap;
  const indexingManager = {
    isIndexReady: vi.fn(() => false),
    findPlaylistByName: vi.fn(),
    findSongInPlaylist: vi.fn(),
  };
  const monitor = {
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as ConversationMonitor;

  return {
    executor: new TaskExecutor(
      configManager,
      minaService,
      playlistManagerMap,
      indexingManager as any,
      monitor,
    ),
    manager,
    indexingManager,
  };
}

function task(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 'task-1',
    name: '按 ID 播放歌单',
    enabled: true,
    action: 'play_playlist',
    schedule: { type: 'weekly', time: '08:30', weekdays: [1] },
    target: {
      all_managed: false,
      devices: [{ account_id: 'account-1', device_id: 'speaker-1' }],
    },
    params: {},
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskExecutor', () => {
  it('plays a scheduled playlist by playlist_id without requiring an index lookup', async () => {
    const { executor, manager, indexingManager } = createExecutor();

    const logs = await executor.execute(task({
      params: { playlist_id: 42, play_mode: 'loop' },
    }));

    expect(logs).toEqual([expect.objectContaining({
      success: true,
      message: '播放歌单 #42 成功',
    })]);
    expect(indexingManager.isIndexReady).not.toHaveBeenCalled();
    expect(manager.play).toHaveBeenCalledWith(42, 0, 'loop');
  });
});
