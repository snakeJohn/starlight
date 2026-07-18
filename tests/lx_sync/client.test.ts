import { describe, expect, it } from 'vitest';
import { parseLxListPayload, formatInterval } from '../../src/lx_sync/mapper';

describe('parseLxListPayload', () => {
  it('parses direct ListData', () => {
    const data = parseLxListPayload({
      defaultList: [],
      loveList: [{ id: '1', name: 'A', singer: 'B', source: 'kw', interval: '01:00', meta: {} }],
      userList: [],
    });
    expect(data.loveList).toHaveLength(1);
    expect(data.defaultList).toEqual([]);
  });

  it('parses nested data envelope and string JSON', () => {
    const nested = parseLxListPayload({
      data: { defaultList: [], loveList: [], userList: [{ id: 'u1', name: 'X', list: [] }] },
    });
    expect(nested.userList[0].name).toBe('X');

    const asString = parseLxListPayload(
      JSON.stringify({
        listData: {
          defaultList: [{ id: 'd', name: 'D', singer: 'S', source: 'wy', interval: null, meta: {} }],
          loveList: [],
          userList: [],
        },
      }),
    );
    expect(asString.defaultList).toHaveLength(1);
  });

  it('rejects non-list payloads', () => {
    expect(() => parseLxListPayload({ foo: 1 })).toThrow(/未识别/);
    expect(() => parseLxListPayload('not-json')).toThrow(/invalid JSON/);
  });
});

describe('formatInterval', () => {
  it('formats seconds to mm:ss / hh:mm:ss', () => {
    expect(formatInterval(223)).toBe('03:43');
    expect(formatInterval(3723)).toBe('01:02:03');
    expect(formatInterval(0)).toBeNull();
  });
});
