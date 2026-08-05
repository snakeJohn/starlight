import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractConversationAnswerText, MinaHTTPClient } from '../../src/mina/client';

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

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

function directConversationResponse(records: unknown[]): Response {
  return new Response(JSON.stringify({
    code: 0,
    data: JSON.stringify({ records }),
  }), { status: 200 });
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

  it('releases a cancelled conversation UBus slot before the old request settles', async () => {
    const client = conversationClient();
    let releaseFirst!: (response: unknown) => void;
    const firstResponse = new Promise<unknown>(resolve => {
      releaseFirst = resolve;
    });
    const doPostRequest = vi.spyOn(client as any, 'doPostRequest')
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(ubusConversationResponse([]));

    const first = client.ubusRequest(
      'dev-1',
      'nlp_result_get',
      'mibrain',
      {},
      '',
      undefined,
      'conversation',
    );
    await flushMicrotasks();

    client.cancelConversationPoll('dev-1');
    const second = client.ubusRequest(
      'dev-1',
      'nlp_result_get',
      'mibrain',
      {},
      '',
      undefined,
      'conversation',
    );

    await expect(second).resolves.toEqual(ubusConversationResponse([]));
    expect(doPostRequest).toHaveBeenCalledTimes(2);

    // The timed-out request may finish later, but it must not retain the queue
    // or affect the result of the subsequent poll.
    releaseFirst(ubusConversationResponse([nlpRecord('1', 'old')]));
    await expect(first).resolves.toBeNull();
  });

  it('cancels the matching conversation UBus request when a newer poll is already queued', async () => {
    const client = conversationClient();
    let releaseFirst!: (response: unknown) => void;
    const firstResponse = new Promise<unknown>(resolve => {
      releaseFirst = resolve;
    });
    const emptyResponse = ubusConversationResponse([]);
    const doPostRequest = vi.spyOn(client as any, 'doPostRequest')
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(emptyResponse);

    const first = client.ubusRequest(
      'dev-1',
      'nlp_result_get',
      'mibrain',
      {},
      '',
      undefined,
      'conversation',
      'poll-a',
    );
    await flushMicrotasks();
    const second = client.ubusRequest(
      'dev-1',
      'nlp_result_get',
      'mibrain',
      {},
      '',
      undefined,
      'conversation',
      'poll-b',
    );
    await flushMicrotasks();

    client.cancelConversationPoll('dev-1', 'poll-a');
    releaseFirst(ubusConversationResponse([nlpRecord('1', 'late')]));

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toEqual(emptyResponse);
    expect(doPostRequest).toHaveBeenCalledTimes(2);
  });

  it('does not run Xiaoai fallback when an older M01 poll is cancelled behind a newer poll', async () => {
    const client = conversationClient();
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    let releaseFirst!: (response: unknown) => void;
    const firstResponse = new Promise<unknown>(resolve => {
      releaseFirst = resolve;
    });
    const emptyResponse = ubusConversationResponse([]);
    const doPostRequest = vi.spyOn(client as any, 'doPostRequest')
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(emptyResponse);

    const first = client.getLatestAskFromXiaoai('dev-1', 'M01', 5, undefined, 'poll-a');
    await flushMicrotasks();
    const second = client.getLatestAskFromXiaoai('dev-1', 'M01', 5, undefined, 'poll-b');
    await flushMicrotasks();

    client.cancelConversationPoll('dev-1', 'poll-a');
    releaseFirst(ubusConversationResponse([nlpRecord('1', 'late')]));

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(doPostRequest).toHaveBeenCalledTimes(2);
  });

  it('does not run Xiaoai fallback after a cancelled M01 UBus poll', async () => {
    const client = conversationClient();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    let releaseFirst!: (response: unknown) => void;
    const firstResponse = new Promise<unknown>(resolve => {
      releaseFirst = resolve;
    });
    vi.spyOn(client as any, 'doPostRequest').mockReturnValue(firstResponse);

    const first = client.getLatestAskFromXiaoai('dev-1', 'M01', 5);
    await flushMicrotasks();
    client.cancelConversationPoll('dev-1');

    await expect(first).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    releaseFirst(ubusConversationResponse([nlpRecord('1', 'late')]));
  });

  it('does not retry or run UBus fallback after a cancelled direct Xiaoai poll', async () => {
    const client = conversationClient();
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>(resolve => {
      releaseFirst = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(firstResponse);
    vi.stubGlobal('fetch', fetchMock);
    const ubusSpy = vi.spyOn(client, 'ubusRequest').mockResolvedValue(null);

    const first = client.getLatestAskFromXiaoai('dev-1', 'LX06', 5);
    await flushMicrotasks();
    client.cancelConversationPoll('dev-1');
    releaseFirst(new Response('', { status: 500 }));

    await expect(first).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ubusSpy).not.toHaveBeenCalled();
  });

  it('skips direct Xiaoai records whose server timestamp is invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => directConversationResponse([
      { time: 'NaN', query: 'bad-string', answers: [] },
      { time: null, query: 'bad-null', answers: [] },
      { time: 0, query: 'bad-zero', answers: [] },
      { time: -1, query: 'bad-negative', answers: [] },
      { time: Number.MAX_SAFE_INTEGER + 1, query: 'bad-unsafe', answers: [] },
      // second-epoch stamps are normalized to ms (2_000 → 2_000_000)
      { time: 2_000, query: 'good-seconds', answers: [] },
      { time: 1_700_000_000_000, query: 'good-ms', answers: [] },
    ])));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toEqual([
      expect.objectContaining({
        timestamp_ms: 2_000_000,
        response: { answer: [expect.objectContaining({ question: 'good-seconds' })] },
      }),
      expect.objectContaining({
        timestamp_ms: 1_700_000_000_000,
        response: { answer: [expect.objectContaining({ question: 'good-ms' })] },
      }),
    ]);
  });

  it('returns null when a non-empty direct Xiaoai batch has only invalid timestamps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => directConversationResponse([
      { time: 'Infinity', query: 'bad-string', answers: [] },
      { time: null, query: 'bad-null', answers: [] },
      { time: 0, query: 'bad-zero', answers: [] },
    ])));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toBeNull();
  });

  it('returns an empty array for an actual empty direct Xiaoai batch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => directConversationResponse([])));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toEqual([]);
  });

  it('returns null for an HTTP-200 Xiaoai error envelope instead of an empty batch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 500,
      message: 'conversation service unavailable',
      data: '',
    }), { status: 200 })));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toBeNull();
  });

  it('returns an empty array when data is empty/missing with code 0 (successful empty conversation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: '',
    }), { status: 200 })));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toEqual([]);
  });

  it('returns an empty array when data is null with code 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: null,
    }), { status: 200 })));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toEqual([]);
  });

  it('parses successfully when code is missing but data is a valid records string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: JSON.stringify({
        records: [
          { time: 3_000, query: 'no-code-ok', answers: [] },
        ],
      }),
    }), { status: 200 })));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toEqual([
      expect.objectContaining({
        timestamp_ms: 3_000_000,
        response: { answer: [expect.objectContaining({ question: 'no-code-ok' })] },
      }),
    ]);
  });

  it('accepts data already parsed as an object with records', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        records: [
          { time: 4_000, query: 'object-data', answers: [] },
        ],
      },
    }), { status: 200 })));
    const client = conversationClient();

    await expect(client.getLatestAskFromXiaoai('dev-1', 'LX06', 5)).resolves.toEqual([
      expect.objectContaining({
        timestamp_ms: 4_000_000,
        response: { answer: [expect.objectContaining({ question: 'object-data' })] },
      }),
    ]);
  });

  it('skips UBus records whose server timestamp is invalid', async () => {
    const client = conversationClient();
    vi.spyOn(client, 'ubusRequest').mockResolvedValue(ubusConversationResponse([
      nlpRecord('not-a-timestamp', 'bad'),
      nlpRecord('2000garbage', 'partial'),
      nlpRecord('2000', 'good'),
    ]));
    await expect(client.getLatestAskFromXiaoai('dev-1', 'M01', 5))
      .resolves.toEqual([expect.objectContaining({ timestamp_ms: 2_000_000 })]);
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
