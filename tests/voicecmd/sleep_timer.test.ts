import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceEngine } from '../../src/voicecmd/engine';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { IndexingManager } from '../../src/indexing/manager';
import type { PlaylistManagerMap } from '../../src/player/manager';
import type { MinaService } from '../../src/service/service';
import type { ConversationMessage, VoiceCommand } from '../../src/types';

function message(query: string, deviceId = 'speaker-1'): ConversationMessage {
  return { account_id: 'acc-1', device_id: deviceId, device_name: '客厅音箱', message: { timestamp_ms: Date.now(), response: { answer: [{ question: query }] } } };
}

function createEngine(commands: VoiceCommand[], aiEnabled = false, aiResult?: { action: string; params: Record<string, unknown>; confidence: 'high' | 'medium' | 'low'; rawText: string }) {
  const configManager = { getAIConfig: vi.fn(async () => ({ enabled: aiEnabled })), getVoiceCommands: vi.fn(async () => commands) } as unknown as ConfigManager;
  const accountManager = { getAccounts: vi.fn(async () => [{ id: 'acc-1' }]) } as unknown as AccountManager;
  const minaService = { textToSpeech: vi.fn(async () => true) } as unknown as MinaService;
  let onAdvance: (() => boolean) | undefined;
  const manager = {
    stop: vi.fn(async () => true),
    setOnAdvanceHook: vi.fn((hook: (() => boolean) | undefined) => { onAdvance = hook; }),
    isPlaying: vi.fn(() => true),
    suspendForVoiceInteraction: vi.fn(),
    resumePlayback: vi.fn(async () => true),
    replayCurrent: vi.fn(async () => true),
  };
  const playlistManagerMap = { get: vi.fn(() => manager), getOrCreate: vi.fn(async () => manager) } as unknown as PlaylistManagerMap;
  const indexingManager = { isIndexReady: vi.fn(() => true) } as unknown as IndexingManager;
  const aiAnalyzer = aiResult ? { analyze: vi.fn(async () => aiResult) } : undefined;
  const engine = new VoiceEngine(configManager, accountManager, minaService, playlistManagerMap, indexingManager, aiAnalyzer as never);
  engine.setEnabled(true);
  return { engine, manager, minaService, playlistManagerMap, advance: () => onAdvance?.() };
}

describe('VoiceEngine sleep timer commands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('matches a timer command before the builtin stop substring', async () => {
    const { engine, manager, minaService } = createEngine([
      { type: 'sleep_timer', keywords: ['小时后停止播放', '分钟后停止播放'], enabled: true },
      { type: 'stop', keywords: ['停止播放'], enabled: true },
    ]);
    await engine.handleMessage(message('两个小时后停止播放'));
    expect(manager.stop).not.toHaveBeenCalled();
    expect(minaService.textToSpeech).toHaveBeenCalledWith('acc-1', 'speaker-1', '好的，2小时后将停止播放');
    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: true, mode: 'time' });
  });

  it('cancels an active timer and clears the advance hook', async () => {
    const { engine, manager, minaService } = createEngine([
      { type: 'sleep_timer', keywords: ['分钟后停止'], enabled: true },
      { type: 'cancel_sleep_timer', keywords: ['取消定时'], enabled: true },
    ]);
    await engine.handleMessage(message('30分钟后停止'));
    await engine.handleMessage(message('取消定时'));

    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: false });
    expect(manager.setOnAdvanceHook).toHaveBeenLastCalledWith(undefined);
    expect(minaService.textToSpeech).toHaveBeenLastCalledWith('acc-1', 'speaker-1', '已取消定时停止');
  });

  it('reports the remaining timer state', async () => {
    const { engine, minaService } = createEngine([
      { type: 'sleep_timer', keywords: ['分钟后停止'], enabled: true },
      { type: 'query_sleep_timer', keywords: ['还剩多久'], enabled: true },
    ]);
    await engine.handleMessage(message('30分钟后停止'));
    await engine.handleMessage(message('还剩多久'));

    expect(minaService.textToSpeech).toHaveBeenLastCalledWith('acc-1', 'speaker-1', '还剩30分钟后停止');
  });

  it('stops after song-count advances and removes the advance hook', async () => {
    const { engine, manager, advance } = createEngine([
      { type: 'sleep_timer', keywords: ['首后停止'], enabled: true },
    ]);
    await engine.handleMessage(message('再听两首后停止'));

    expect(advance()).toBe(false);
    expect(advance()).toBe(true);
    await Promise.resolve();
    expect(manager.stop).toHaveBeenCalledTimes(1);
    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: false });
    expect(manager.setOnAdvanceHook).toHaveBeenLastCalledWith(undefined);
  });

  it('clears a timer and its advance hook on direct stop', async () => {
    const { engine, manager } = createEngine([
      { type: 'sleep_timer', keywords: ['首后停止'], enabled: true },
      { type: 'stop', keywords: ['停止播放'], enabled: true },
    ]);
    await engine.handleMessage(message('再听两首后停止'));
    await engine.handleMessage(message('停止播放'));

    expect(manager.stop).toHaveBeenCalledTimes(1);
    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: false });
    expect(manager.setOnAdvanceHook).toHaveBeenLastCalledWith(undefined);
  });

  it('cleans timers for every device when disabled', async () => {
    const { engine, manager } = createEngine([
      { type: 'sleep_timer', keywords: ['分钟后停止'], enabled: true },
    ]);
    await engine.handleMessage(message('30分钟后停止'));
    engine.setEnabled(false);

    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: false });
    expect(manager.setOnAdvanceHook).toHaveBeenLastCalledWith(undefined);
  });

  it('keeps timers isolated by device when another device stops', async () => {
    const { engine, manager, playlistManagerMap } = createEngine([
      { type: 'sleep_timer', keywords: ['分钟后停止'], enabled: true },
      { type: 'stop', keywords: ['停止播放'], enabled: true },
    ]);
    const secondManager = { stop: vi.fn(async () => true), setOnAdvanceHook: vi.fn(), isPlaying: vi.fn(() => true) };
    vi.mocked(playlistManagerMap.get).mockImplementation((_accountId, deviceId) => deviceId === 'speaker-2' ? secondManager as never : manager as never);
    vi.mocked(playlistManagerMap.getOrCreate).mockImplementation(async (_accountId, deviceId) => deviceId === 'speaker-2' ? secondManager as never : manager as never);

    await engine.handleMessage(message('30分钟后停止', 'speaker-1'));
    await engine.handleMessage(message('停止播放', 'speaker-2'));

    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: true, mode: 'time' });
    expect(secondManager.stop).toHaveBeenCalledTimes(1);
  });

  it('sets a timer from high-confidence AI duration parameters', async () => {
    const { engine, minaService } = createEngine([], true, {
      action: 'sleep_timer', params: { duration: 45 }, confidence: 'high', rawText: '45分钟后休息',
    });
    await engine.handleMessage(message('四十五分钟后休息'));

    expect(engine.getSleepTimerState('acc-1', 'speaker-1')).toMatchObject({ active: true, mode: 'time', total: 2_700_000 });
    expect(minaService.textToSpeech).toHaveBeenCalledWith('acc-1', 'speaker-1', '好的，45分钟后将停止播放');
  });

  it('schedules smart resume after setting a timer while music is playing', async () => {
    const { engine, manager } = createEngine([
      { type: 'sleep_timer', keywords: ['分钟后停止'], enabled: true },
    ]);

    await engine.handleMessage(message('30分钟后停止'));

    expect(manager.suspendForVoiceInteraction).toHaveBeenCalledTimes(1);
  });

  it('attaches the songs-timer hook when the player manager is created for the timer', async () => {
    const { engine, manager, playlistManagerMap } = createEngine([
      { type: 'sleep_timer', keywords: ['首后停止'], enabled: true },
    ]);
    vi.mocked(playlistManagerMap.get).mockReturnValue(null);

    await engine.handleMessage(message('再听两首后停止'));

    expect(playlistManagerMap.getOrCreate).toHaveBeenCalledWith('acc-1', 'speaker-1');
    expect(manager.setOnAdvanceHook).toHaveBeenCalled();
  });
});
