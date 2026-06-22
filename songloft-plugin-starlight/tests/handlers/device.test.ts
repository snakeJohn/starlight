import { createRouter } from '@songloft/plugin-sdk';
import type { HTTPRequest, HTTPResponse } from '@songloft/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { registerDeviceHandlers } from '../../src/handlers/device';
import type { AccountManager } from '../../src/account/manager';
import type { ConversationMonitor } from '../../src/conversation/monitor';
import type { MinaService } from '../../src/service/service';

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

describe('registerDeviceHandlers', () => {
  it('refreshes conversation monitoring after a device is marked managed', async () => {
    const router = createRouter();
    const minaService = {
      updateManagedStatus: vi.fn(async () => true),
    } as unknown as MinaService;
    const monitor = {
      refresh: vi.fn(async () => {}),
    } as unknown as ConversationMonitor;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      {} as AccountManager,
      undefined,
      monitor,
    );

    const response = await router.handle(request('POST', '/mina/device/managed', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      managed: true,
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: {
        account_id: 'acc-1',
        device_id: 'dev-1',
        managed: true,
      },
    });
    expect(minaService.updateManagedStatus).toHaveBeenCalledWith('acc-1', 'dev-1', true);
    expect(monitor.refresh).toHaveBeenCalledTimes(1);
  });
});
