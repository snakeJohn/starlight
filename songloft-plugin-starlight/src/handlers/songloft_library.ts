import type { HTTPResponse, Router } from '@songloft/plugin-sdk';
import { apiError, apiOk } from '../system/response';
import { StarlightError } from '../system/errors';

interface NormalizedList {
  list: unknown[];
  total: number;
}

const LIST_KEYS = ['list', 'items', 'songs', 'playlists'] as const;

async function handle(fn: () => unknown | Promise<unknown>): Promise<HTTPResponse> {
  try {
    return apiOk(await fn());
  } catch (error) {
    return apiError(error);
  }
}

function normalizeList(value: unknown): NormalizedList {
  if (Array.isArray(value)) {
    return { list: value, total: value.length };
  }

  if (!value || typeof value !== 'object') {
    return { list: [], total: 0 };
  }

  const record = value as Record<string, unknown>;
  const list = findList(record);
  return {
    list,
    total: readTotal(record, list.length),
  };
}

function findList(record: Record<string, unknown>): unknown[] {
  for (const key of LIST_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function readTotal(record: Record<string, unknown>, fallback: number): number {
  const value = record.total ?? record.count;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return fallback;
}

function requireId(value: unknown, name = 'id'): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }

  return id;
}

function isLocalSong(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const song = value as Record<string, unknown>;
  if (isTruthyLocalMarker(song.local)) {
    return true;
  }

  if (typeof song.type === 'string') {
    const type = song.type.trim().toLowerCase().replace(/[\s_-]+/g, '');
    return type === 'local' || type === 'localsong' || type === '本地';
  }

  return false;
}

function isTruthyLocalMarker(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }

  if (typeof value === 'string') {
    const marker = value.trim().toLowerCase();
    return marker === 'true' || marker === '1' || marker === 'yes' || marker === 'local';
  }

  return false;
}

export function registerSongloftLibraryHandlers(router: Router): void {
  router.get('/api/songloft/songs', async () => handle(async () => normalizeList(await songloft.songs.list())));

  router.get('/api/songloft/playlists', async () =>
    handle(async () => normalizeList(await songloft.playlists.list())));

  router.get('/api/songloft/playlists/:id/songs', async (_req, params) =>
    handle(async () => normalizeList(await songloft.playlists.getSongs(requireId(params.id)))));

  router.get('/api/songloft/local-songs', async () =>
    handle(async () => {
      const songs = normalizeList(await songloft.songs.list()).list.filter(isLocalSong);
      return {
        list: songs,
        total: songs.length,
      };
    }));
}
