import { describe, expect, it } from 'vitest';
import { getZonedParts } from '../../src/utils/timezone';

describe('getZonedParts', () => {
  it('derives calendar parts for a fixed UTC instant in Asia/Shanghai', () => {
    // 2026-01-01 00:30 UTC → 2026-01-01 08:30 Asia/Shanghai
    const date = new Date('2026-01-01T00:30:00.000Z');
    const parts = getZonedParts(date, 'Asia/Shanghai');
    expect(parts.dateStr).toBe('2026-01-01');
    expect(parts.timeStr).toBe('08:30');
    expect(parts.weekday).toBe(4); // Thursday
  });

  it('differs from UTC when zone is America/Los_Angeles', () => {
    const date = new Date('2026-01-01T08:00:00.000Z');
    const la = getZonedParts(date, 'America/Los_Angeles');
    // 2026-01-01 00:00 PST
    expect(la.dateStr).toBe('2026-01-01');
    expect(la.timeStr).toBe('00:00');
  });

  it('falls back to host local for invalid timezone', () => {
    const date = new Date('2026-06-15T12:00:00.000Z');
    const parts = getZonedParts(date, 'Not/A_Zone');
    expect(parts.timeStr).toMatch(/^\d{2}:\d{2}$/);
    expect(parts.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
