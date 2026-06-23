import { describe, expect, test } from 'vitest';
import { StarlightError } from '../../src/system/errors';
import { AsyncLockRegistry } from '../../src/system/locks';

describe('AsyncLockRegistry', () => {
  test('duplicate lock acquisition throws while the lock is held', () => {
    const locks = new AsyncLockRegistry();

    const release = locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING');

    expect(locks.isLocked('index-refresh')).toBe(true);
    expect(() => locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING')).toThrow(StarlightError);
    expect(() => locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING')).toThrow(
      expect.objectContaining({
        code: 'INDEX_REFRESH_RUNNING',
        message: 'index-refresh is already running',
      }),
    );

    release();
  });

  test('release allows the same lock to be acquired again', () => {
    const locks = new AsyncLockRegistry();

    const release = locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING');
    release();
    const releaseAgain = locks.acquire('index-refresh', 'INDEX_REFRESH_RUNNING');

    expect(locks.isLocked('index-refresh')).toBe(true);
    releaseAgain();
    expect(locks.isLocked('index-refresh')).toBe(false);
  });

  test('stale release does not clear a newer lock after clear and reacquire', () => {
    const locks = new AsyncLockRegistry();

    const r1 = locks.acquire('x', 'SCHEDULE_LOCKED');
    locks.clear();
    const r2 = locks.acquire('x', 'SCHEDULE_LOCKED');
    r1();

    expect(locks.isLocked('x')).toBe(true);
    r2();
    expect(locks.isLocked('x')).toBe(false);
  });
});
