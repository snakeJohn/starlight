import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractConversationAnswerText, MinaHTTPClient } from '../../src/mina/client';

function nlpRecord(timestamp: string, question: string) {
  return {
    nlp: JSON.stringify({
      meta: { request_id: `request-${question}`, timestamp },
      response: {
        answer: [{
          domain: 'test', action: 'test', content: { to_speak: '好的' }, intention: { query: question },
        }],
      },
    }),
  };
}

function ubusConversationResponse(records: unknown[]) {
  return {
    code: 0,
    data: {
      code: 0,
      info: JSON.stringify({ result: records }),
    },
  };
}

function conversationClient(): MinaHTTPClient {
  return new MinaHTTPClient({
    user_id: 'user-1',
    device_id: 'client-1',
    services: {
      micoapi: { service_token: 'token', ssecurity: 'security' },
    },
    created_at: '',
    expires_at: '',
  } as never);
}

describe('extractConversationAnswerText', () => {
  it('reads Xiaoai answer text from several response shapes', () => {
    expect(extractConversationAnswerText({
      answers: [{ type: 'TEXT', text: '文本回应' }],
    })).toBe('文本回应');

    expect(extractConversationAnswerText({
      answers: [{ type: 'TTS', tts: { text: 'TTS 回应' } }],
    })).toBe('TTS 回应');

    expect(extractConversationAnswerText({
      answers: [{ type: 'CARD', content: { to_speak: '卡片回应' } }],
    })).toBe('卡片回应');
  });

  it('falls back to record-level answer fields', () => {
    expect(extractConversationAnswerText({
      query: '天气',
      answer: '今天晴',
    })).toBe('今天晴');
  });
});

describe('MinaHTTPClient conversation fetch contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null after every Xiaoai fetch retry fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const client = conversationClient();
    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toBeNull();
  });

  it('skips UBus records whose server timestamp is invalid', async () => {
    const client = conversationClient();
    vi.spyOn(client, 'ubusRequest').mockResolvedValue(ubusConversationResponse([
      nlpRecord('not-a-timestamp', 'bad'),
      nlpRecord('2000garbage', 'partial'),
      nlpRecord('2000', 'good'),
    ]));
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5))
      .resolves.toEqual([expect.objectContaining({ timestamp_ms: 2_000 })]);
  });

  it('returns null when UBus candidates contain no valid server timestamp', async () => {
    const client = conversationClient();
    vi.spyOn(client, 'ubusRequest').mockResolvedValue(ubusConversationResponse([
      nlpRecord('not-a-timestamp', 'bad'),
      { nlp: '{ malformed json' },
    ]));
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toBeNull();
  });

  it('returns null when non-empty UBus results have no candidate message', async () => {
    const client = conversationClient();
    vi.spyOn(client, 'ubusRequest').mockResolvedValue(ubusConversationResponse([{}, { nlp: '' }]));
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toBeNull();
  });

  it('returns null for missing or malformed UBus result shapes', async () => {
    const client = conversationClient();
    vi.spyOn(client, 'ubusRequest')
      .mockResolvedValueOnce({ code: 0, data: { code: 0 } })
      .mockResolvedValueOnce({ code: 0, data: { code: 0, info: JSON.stringify({}) } })
      .mockResolvedValueOnce({ code: 0, data: { code: 0, info: JSON.stringify({ result: null }) } })
      .mockResolvedValueOnce({ code: 0, data: { code: 0, info: JSON.stringify({ result: 'not-an-array' }) } });

    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toBeNull();
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toBeNull();
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toBeNull();
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toBeNull();
  });

  it('returns an empty array only for an actual empty UBus result array', async () => {
    const client = conversationClient();
    vi.spyOn(client, 'ubusRequest').mockResolvedValue(ubusConversationResponse([]));
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5)).resolves.toEqual([]);
  });
});
