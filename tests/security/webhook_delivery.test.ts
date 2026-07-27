import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationMonitor } from '../../src/conversation/monitor';
import type { AccountManager } from '../../src/account/manager';
import type { ConfigManager } from '../../src/config/manager';
import type { WebhookConfig } from '../../src/types';

/**
 * Webhook 地址在投递前必须重新校验。
 *
 * 注册时的校验（handlers/conversation.ts）只挡住新地址；在 URL 规则收紧之前
 * 存下来的条目仍会被长期投递，等于留一条常驻 SSRF 通道进宿主内网。
 */
function monitorWith(webhooks: WebhookConfig[]): ConversationMonitor {
  const accountManager = {
    getAccounts: vi.fn(async () => []),
    getManagedDevices: vi.fn(async () => []),
    getMinaClient: vi.fn(() => null),
  } as unknown as AccountManager;
  const configManager = {
    getWebhooks: vi.fn(async () => webhooks),
    getConfig: vi.fn(async () => ({ conversation_poll_interval: 1 })),
  } as unknown as ConfigManager;
  return new ConversationMonitor(accountManager, configManager);
}

/** triggerWebhooks 是私有的，测试直接取用它——这是被测行为的入口。 */
function deliver(monitor: ConversationMonitor): Promise<void> {
  return (monitor as unknown as {
    triggerWebhooks(a: string, d: string, n: string, m: unknown[]): Promise<void>;
  }).triggerWebhooks('acc', 'dev', '音箱', [{ message: { timestamp_ms: 1 } }]);
}

describe('webhook delivery re-validates the stored URL', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refuses to POST to a loopback address stored before the rules tightened', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await deliver(monitorWith([
      { id: 'w1', name: 'hook', url: 'http://127.0.0.1:8080/hook', created_at: '' } as WebhookConfig,
    ]));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses non-dotted-quad loopback forms too', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await deliver(monitorWith([
      { id: 'w2', name: 'hook', url: 'http://2130706433/hook', created_at: '' } as WebhookConfig,
      { id: 'w3', name: 'hook', url: 'http://169.254.169.254/latest/meta-data', created_at: '' } as WebhookConfig,
    ]));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still delivers to a public https endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await deliver(monitorWith([
      { id: 'w4', name: 'hook', url: 'https://hooks.example.com/x', created_at: '' } as WebhookConfig,
    ]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls as unknown as unknown[][])[0][0])).toContain('hooks.example.com');
  });

  it('rejects a plain-http hostname so DNS cannot redirect the request into an internal HTTP service', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await deliver(monitorWith([
      { id: 'w-http', name: 'hook', url: 'http://hooks.example.com/x', created_at: '' } as WebhookConfig,
    ]));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('disables automatic redirects so every destination remains subject to validation', async () => {
    const warn = vi.spyOn(songloft.log, 'warn');
    const fetchMock = vi.fn(async () => new Response('', {
      status: 307,
      headers: { Location: 'http://169.254.169.254/latest/meta-data' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await deliver(monitorWith([
      { id: 'w-redirect', name: 'hook', url: 'https://hooks.example.com/x', created_at: '' } as WebhookConfig,
    ]));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/x',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Webhook failed'));
  });

  it('treats a non-2xx reply as a failure instead of logging success', async () => {
    // 只 await fetch 而不看 response.ok 时，接收端 500 也会打印「Webhook sent」。
    const warn = vi.spyOn(songloft.log, 'warn');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));

    await deliver(monitorWith([
      { id: 'w5', name: 'hook', url: 'https://hooks.example.com/x', created_at: '' } as WebhookConfig,
    ]));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Webhook failed'));
  });
});
