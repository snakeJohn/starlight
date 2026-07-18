import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerConfigHandlers } from '../../src/handlers/config';
import type { ConfigManager } from '../../src/config/manager';
import type { ConversationMonitor } from '../../src/conversation/monitor';
import type { Scheduler } from '../../src/schedule/scheduler';
import type { VoiceEngine } from '../../src/voicecmd/engine';
import type { PluginConfig } from '../../src/types';
import { setHostBaseUrl } from '../../src/utils/http';

function request(method: string, path: string, body?: unknown): HTTPRequest {
  return {
    method,
    path,
    query: '',
    headers: {},
    body: body === undefined ? null : JSON.stringify(body),
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

function pluginConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    version: '1.0',
    server_host: '',
    timezone: 'Asia/Shanghai',
    conversation_monitor_enabled: false,
    voice_command_enabled: false,
    scheduled_tasks_enabled: false,
    force_mp3: false,
    external_search_enabled: false,
    external_search_url: '',
    external_search_token: '',
    external_search_playlist_id: '',
    external_search_timeout: 6,
    indicator_light_enabled: true,
    interrupt_tts_hint_enabled: false,
    interrupt_tts_hint_text: '正在搜索，请稍候',
    conversation_poll_interval: 1,
    smart_resume_timeout: 30,
    max_song_index: 10000,
    ai_config: {
      enabled: false,
      api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api_key: '',
      model: 'qwen-flash',
      timeout: 6,
    },
    ...overrides,
  };
}

describe('registerConfigHandlers', () => {
  beforeEach(() => {
    setHostBaseUrl('');
  });

  function createHarness(
    config = pluginConfig({ server_host: '' }),
    options: { onServerHostChange?: (host: string) => void } = {},
  ) {
    const router = createRouter();
    const configManager = {
      getConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => {}),
      getAIConfig: vi.fn(async () => config.ai_config),
      saveAIConfig: vi.fn(async () => {}),
    } as unknown as ConfigManager;
    const monitor = {
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as ConversationMonitor;
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as Scheduler;
    const voiceEngine = {
      setEnabled: vi.fn(),
    } as unknown as VoiceEngine;

    registerConfigHandlers(router, configManager, monitor, scheduler, voiceEngine, options);
    return { router, configManager, monitor, scheduler, voiceEngine };
  }

  it('warns when the Songloft access host is empty', async () => {
    const { router, configManager } = createHarness();

    const response = await router.handle(request('POST', '/config', { timezone: 'Asia/Hong_Kong' }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      warning: 'Songloft 访问地址为空，MIoT 智能音箱将无法播放音乐。请配置局域网或公网可访问地址。',
    });
    expect(configManager.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      server_host: '',
      timezone: 'Asia/Hong_Kong',
    }));
  });

  it('notifies onServerHostChange when server_host is saved', async () => {
    const onServerHostChange = vi.fn();
    const { router } = createHarness(pluginConfig({ server_host: '' }), { onServerHostChange });

    const response = await router.handle(
      request('POST', '/config', { server_host: '192.168.1.50:18191' }),
    );

    expect(response.statusCode).toBe(200);
    expect(onServerHostChange).toHaveBeenCalledWith('http://192.168.1.50:18191');
  });

  it('saves AI config patch including string timeout coercion', async () => {
    const { router, configManager } = createHarness();

    const response = await router.handle(request('PUT', '/config', {
      ai_config: {
        enabled: true,
        api_url: 'https://api.example/v1',
        api_key: 'sk-demo',
        model: 'qwen-flash',
        timeout: '9',
      },
    }));

    expect(response.statusCode).toBe(200);
    expect(configManager.saveAIConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      api_url: 'https://api.example/v1',
      api_key: 'sk-demo',
      model: 'qwen-flash',
      timeout: 9,
    }));
  });

  it('accepts PUT /config so the settings form does not produce a 404 before saving', async () => {
    const { router, configManager, monitor, voiceEngine } = createHarness();

    const response = await router.handle(request('PUT', '/config', {
      server_host: 'http://songloft.test:18191',
      timezone: 'Asia/Hong_Kong',
      conversation_monitor_enabled: true,
      voice_command_enabled: true,
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({ success: true });
    expect(configManager.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      server_host: 'http://songloft.test:18191',
      timezone: 'Asia/Hong_Kong',
      conversation_monitor_enabled: true,
      voice_command_enabled: true,
    }));
    expect(monitor.stop).toHaveBeenCalledTimes(1);
    expect(monitor.start).toHaveBeenCalledTimes(1);
    expect(voiceEngine.setEnabled).toHaveBeenCalledWith(true);
  });

  it('returns runtime tuning fields in GET /config', async () => {
    const { router } = createHarness(pluginConfig({
      external_search_playlist_id: '12',
      external_search_timeout: 9,
      conversation_poll_interval: 2,
      smart_resume_timeout: 45,
      max_song_index: 20000,
    }));

    const response = await router.handle(request('GET', '/config'));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response).data).toEqual(expect.objectContaining({
      external_search_playlist_id: '12',
      external_search_timeout: 9,
      conversation_poll_interval: 2,
      smart_resume_timeout: 45,
      max_song_index: 20000,
    }));
  });

  it('saves clamped runtime tuning fields before restarting conversation monitoring', async () => {
    const events: string[] = [];
    const { router, configManager, monitor } = createHarness(pluginConfig({
      conversation_monitor_enabled: true,
    }));
    vi.mocked(configManager.saveConfig).mockImplementation(async () => {
      events.push('save');
    });
    vi.mocked(monitor.stop).mockImplementation(() => {
      events.push('stop');
    });
    vi.mocked(monitor.start).mockImplementation(() => {
      events.push('start');
    });

    const response = await router.handle(request('PUT', '/config', {
      conversation_monitor_enabled: true,
      conversation_poll_interval: 45,
      smart_resume_timeout: 2,
      max_song_index: 42,
      external_search_playlist_id: '  12  ',
      external_search_timeout: 99,
    }));

    expect(response.statusCode).toBe(200);
    expect(configManager.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      conversation_monitor_enabled: true,
      conversation_poll_interval: 30,
      smart_resume_timeout: 5,
      max_song_index: 1000,
      external_search_playlist_id: '12',
      external_search_timeout: 60,
    }));
    expect(events).toEqual(['save', 'stop', 'start']);
  });
});
