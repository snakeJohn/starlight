import type { PlayMode } from '../types';

const PLAY_MODES = new Set<PlayMode>(['order', 'random', 'single', 'loop']);

export function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === 'string' && PLAY_MODES.has(value as PlayMode);
}

export function normalizePlayMode(value: unknown, fallback: PlayMode): PlayMode {
  return isPlayMode(value) ? value : fallback;
}
