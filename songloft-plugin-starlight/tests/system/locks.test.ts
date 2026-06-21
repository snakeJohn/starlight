import { describe, expect, test } from 'vitest';
import { AsyncLockRegistry } from '../../src/system/locks';

describe('AsyncLockRegistry', () => {
  test('duplicate lock acquisition throws while the lock is held', () => {
    const locks = new AsyncLockRegistry();

    const release = locks.acquire('index-refresh', 'index-refresh');

    expect(locks.isLocked('index-refresh')).toBe(true);
    expect(() => locks.acquire('index-refresh', 'index-refresh')).toThrow('index-refresh is already running');

    release();
  });

  test('release allows the same lock to be acquired again', () => {
    const locks = new AsyncLockRegistry();

    const release = locks.acquire('index-refresh', 'index-refresh');
    release();
    const releaseAgain = locks.acquire('index-refresh', 'index-refresh');

    expect(locks.isLocked('index-refresh')).toBe(true);
    releaseAgain();
    expect(locks.isLocked('index-refresh')).toBe(false);
  });
});
