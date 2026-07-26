import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAnalyzer } from '../../src/voicecmd/ai_analyzer';
import type { AIConfig } from '../../src/types';

const config: AIConfig = {
  enabled: true,
  api_url: 'https://ai.test/v1',
  api_key: 'test-key',
  model: 'test-model',
  timeout: 6,
};

function mockCompletion(content: string): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
  })) as unknown as typeof fetch;
}

describe('AIAnalyzer response parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a clean JSON body', async () => {
    mockCompletion('{"action":"stop","params":{},"confidence":"high","rawText":"暂停"}');

    const result = await new AIAnalyzer().analyze('暂停', config);

    expect(result).toEqual({ action: 'stop', params: {}, confidence: 'high', rawText: '暂停' });
  });

  it('parses JSON that is followed by extra commentary', async () => {
    // 模型经常在 JSON 后面再补一句说明，兜底解析不能因此整条丢弃
    mockCompletion(
      '<think>先判断意图</think>\n'
      + '{"action":"play_song","params":{"name":"晴天","artist":"周杰伦"},"confidence":"high","rawText":"晴天"}\n'
      + '以上就是解析结果。',
    );

    const result = await new AIAnalyzer().analyze('播放周杰伦的晴天', config);

    expect(result?.action).toBe('play_song');
    expect(result?.params).toEqual({ name: '晴天', artist: '周杰伦' });
    expect(result?.confidence).toBe('high');
  });

  it('returns null when the response carries no JSON at all', async () => {
    mockCompletion('我不太明白你的意思');

    const result = await new AIAnalyzer().analyze('随便说点什么', config);

    expect(result).toBeNull();
  });
});
