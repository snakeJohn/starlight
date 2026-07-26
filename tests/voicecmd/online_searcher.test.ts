import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineSearcher } from '../../src/voicecmd/online_searcher';
import type { ConfigManager } from '../../src/config/manager';
import type { MinaService } from '../../src/service/service';

const SEARCH_URL = 'https://search.test/api/topone';

function createConfigManager(): ConfigManager {
  return {
    getConfig: vi.fn(async () => ({
      external_search_enabled: true,
      external_search_url: SEARCH_URL,
      external_search_token: 'search-token',
      server_host: 'http://host.test:58091',
    })),
  } as unknown as ConfigManager;
}

const searchResponse = {
  code: 0,
  msg: 'ok',
  data: {
    title: '深海',
    artist: '凤凰传奇',
    album: '',
    duration: 200,
    cover_url: '',
    url: 'https://audio.test/deep-sea.mp3',
  },
};

describe('OnlineSearcher remote import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a hanging remote import instead of waiting forever', async () => {
    globalThis.fetch = vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
      if (String(input) === SEARCH_URL) {
        return { ok: true, status: 200, text: async () => JSON.stringify(searchResponse) } as unknown as Response;
      }
      // /api/v1/songs/remote 永不响应，只有被中止时才结束
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const minaService = { playURL: vi.fn(async () => true) } as unknown as MinaService;
    const searcher = new OnlineSearcher(createConfigManager());

    const played = searcher.searchAndPlay('深海', null, 'acc-1', 'dev-1', minaService);
    await vi.advanceTimersByTimeAsync(30000);

    await expect(played).resolves.toBe(false);
    expect(minaService.playURL).not.toHaveBeenCalled();
  });
});
