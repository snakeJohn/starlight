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
    indicator_light_enabled: true,
    interrupt_tts_hint_enabled: false,
    interrupt_tts_hint_text: '正在搜索，请稍候',
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

  it('does not warn about loopback when Songloft host is auto-detected and no server_host is configured', async () => {
    const router = createRouter();
    const config = pluginConfig({ server_host: '' });
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

    registerConfigHandlers(router, configManager, monitor, scheduler, voiceEngine);

    const response = await router.handle(request('POST', '/config', { timezone: 'Asia/Hong_Kong' }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toEqual({ success: true });
    expect(configManager.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      server_host: '',
      timezone: 'Asia/Hong_Kong',
    }));
  });
});
