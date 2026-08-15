import { describe, expect, it, vi } from 'vitest';
import { SleepTimer, detectSleepTimerMode, formatRemaining, parseSongsCount, parseTimeDuration } from '../../src/sleep_timer';

describe('sleep timer parsing', () => {
  it.each([
    ['三十分钟后停止播放', 30],
    ['两个小时后停止', 120],
    ['两个半小时后停止', 150],
    ['一个半小时后停止', 90],
    ['半小时后停止', 30],
    ['1小时30分钟后停止', 90],
    ['一小时三十分钟后停止', 90],
  ])('parses %s', (value, expected) => {
    expect(parseTimeDuration(value)).toBe(expected);
  });

  it('parses Chinese song counts', () => {
    expect(parseSongsCount('再听三首后停止')).toBe(3);
    expect(detectSleepTimerMode('再听三首后停止')).toBe('songs');
  });

  it('rejects non-positive timer values', () => {
    expect(parseTimeDuration('0分钟后停止播放')).toBe(0);
    expect(parseSongsCount('再听零首后停止')).toBe(0);
  });
});

describe('SleepTimer', () => {
  it('expires a time timer once', async () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    const timer = new SleepTimer(expire);
    timer.setTime(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(timer.isActive()).toBe(false);
    vi.useRealTimers();
  });

  it('expires a song timer after the requested advances', () => {
    const expire = vi.fn();
    const timer = new SleepTimer(expire);
    timer.setSongs(2);

    expect(timer.onSongAdvanced()).toBe(false);
    expect(timer.getState()).toMatchObject({ active: true, mode: 'songs', remaining: 1, total: 2 });
    expect(timer.onSongAdvanced()).toBe(true);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(timer.isActive()).toBe(false);
  });

  it('cancels its timeout and clears its state', async () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    const timer = new SleepTimer(expire);
    timer.setTime(1);
    timer.cancel();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(expire).not.toHaveBeenCalled();
    expect(timer.getState()).toMatchObject({ active: false, remaining: 0, total: 0 });
    expect(formatRemaining(timer.getState())).toBe('当前没有定时任务');
    vi.useRealTimers();
  });

  it('ignores an already queued callback from a timer that was reset', () => {
    const expire = vi.fn();
    const callbacks: Array<() => void> = [];
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = vi.fn() as unknown as typeof clearTimeout;

    try {
      const timer = new SleepTimer(expire);
      timer.setTime(1);
      const staleCallback = callbacks[0];
      timer.setTime(2);

      staleCallback();

      expect(expire).not.toHaveBeenCalled();
      expect(timer.getState()).toMatchObject({ active: true, total: 120_000 });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it('does not activate timers with non-positive values', () => {
    const timer = new SleepTimer(vi.fn());
    timer.setTime(0);
    expect(timer.isActive()).toBe(false);
    timer.setSongs(-1);
    expect(timer.isActive()).toBe(false);
  });

  it('contains rejected async expiry callbacks', async () => {
    vi.useFakeTimers();
    const timer = new SleepTimer(async () => { throw new Error('stop failed'); });
    timer.setTime(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(timer.isActive()).toBe(false);
    vi.useRealTimers();
  });
});
