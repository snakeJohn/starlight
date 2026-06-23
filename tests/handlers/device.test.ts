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
  it('rejects non-finite volume values before calling Mina service', async () => {
    const router = createRouter();
    const minaService = {
      setVolume: vi.fn(async () => true),
    } as unknown as MinaService;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      {} as AccountManager,
    );

    const response = await router.handle(request('POST', '/mina/volume', {
      account_id: 'acc-1',
      device_id: 'dev-1',
      volume: 'loud',
    }));

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: false,
      error: 'volume must be a number between 0 and 100',
    });
    expect(minaService.setVolume).not.toHaveBeenCalled();
  });

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

  it('includes the last selected device when listing devices for one account', async () => {
    const router = createRouter();
    const minaService = {
      getDevices: vi.fn(async () => [{ device_id: 'dev-1', name: '客厅音箱' }]),
    } as unknown as MinaService;
    const accountManager = {
      getLastSelectedDevice: vi.fn(async () => 'dev-1'),
    } as unknown as AccountManager;

    (registerDeviceHandlers as unknown as (...args: unknown[]) => void)(
      router,
      minaService,
      accountManager,
    );

    const response = await router.handle({
      ...request('GET', '/mina/devices'),
      query: 'account_id=acc-1',
    });

    expect(response.statusCode).toBe(200);
    expect(parseResponseBody(response)).toMatchObject({
      success: true,
      data: [{
        account_id: 'acc-1',
        last_selected_device_id: 'dev-1',
      }],
    });
  });
});
