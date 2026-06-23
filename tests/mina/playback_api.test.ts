import { describe, expect, it } from 'vitest';
import { needUsePlayMusicAPI } from '../../src/mina/constants';

describe('MIoT playback API model detection', () => {
  it('uses the Music API for Xiaoai Pro LX06 devices', () => {
    expect(needUsePlayMusicAPI('LX06')).toBe(true);
  });
});
