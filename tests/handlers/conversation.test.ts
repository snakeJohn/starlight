import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerConversationHandlers } from '../../src/handlers/conversation';
import type { ConversationMonitor } from '../../src/conversation/monitor';
import type { ConfigManager } from '../../src/config/manager';

function request(method: string, path: string, query = ''): HTTPRequest {
  return {
    method,
    path,
    query,
    headers: {},
    body: null,
  } as HTTPRequest;
}

function parseResponseBody(response: HTTPResponse): any {
  const body = response.body;
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
  return JSON.parse(text);
}

describe('registerConversationHandlers', () => {
  it('clears cached speaker conversation messages', async () => {
    const router = createRouter();
    const monitor = {
      getMessages: vi.fn(() => []),
      getStatus: vi.fn(async () => ({
        is_enabled: true,
        device_count: 1,
        devices: [],
        webhook_count: 0,
        message_count: 3,
      })),
      clearMessages: vi.fn(() => 3),
    } as unknown as ConversationMonitor;
    const configManager = {
      getWebhooks: vi.fn(async () => []),
      addWebhook: vi.fn(async () => {}),
      removeWebhook: vi.fn(async () => {}),
    } as unknown as ConfigManager;
    registerConversationHandlers(router, monitor, configManager);

    const response = await router.handle(request('POST', '/conversation/messages/clear'));

    expect(response.statusCode).toBe(200);
    expect(monitor.clearMessages).toHaveBeenCalledTimes(1);
    expect(parseResponseBody(response)).toEqual({
      success: true,
      data: { cleared: 3 },
    });
  });
});
