/// <reference types="@songloft/plugin-sdk" />

import { toRemoteSong } from '../bridge/mapper';
import { postRemoteSongs, type SongloftRemoteSong } from '../bridge/service';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SearchResultSong } from '../music/types';
import { StarlightError } from '../system/errors';

const SETTINGS_KEY = 'starlight:download:settings';
const STARLIGHT_PLUGIN_ENTRY_PATH = 'starlight';
const DEFAULT_SETTINGS: DownloadSettings = {
  path_template: 'downloads/{artist}-{album}/{title}',
  embed_metadata: true,
  download_interval: 0,
};

export interface DownloadSettings {
  path_template: string;
  embed_metadata: boolean;
  download_interval: number;
}

export type DownloadSettingsPatch = Partial<DownloadSettings>;

export interface DownloadResult {
  song_id: number;
  path?: string;
  status: string;
  error?: string;
}

export interface BatchDownloadProgress {
  active: boolean;
  current: number;
  total: number;
  done: boolean;
  success: number;
  failed: number;
  results: DownloadResult[];
}

interface BatchTask {
  current: number;
  total: number;
  done: boolean;
  results: DownloadResult[];
}

interface SongDownloadApi {
  download(songId: number, options: { path_template: string; embed_metadata: boolean }): Promise<{ path?: string; status?: string; error?: string } | null>;
}

export class DownloadService {
  private batchTask: BatchTask | null = null;

  constructor(private readonly runtimes: RuntimeManager) {}

  async getSettings(): Promise<DownloadSettings> {
    const raw = await songloft.storage.get(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }

    const parsed = typeof raw === 'string' ? safeJson(raw) : raw;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_SETTINGS };
    }

    return normalizeSettings(parsed as Partial<DownloadSettings>);
  }

  async saveSettings(patch: DownloadSettingsPatch): Promise<DownloadSettings> {
    const current = await this.getSettings();
    const next = normalizeSettings({ ...current, ...patch });
    await songloft.storage.set(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  async downloadSong(song: SearchResultSong): Promise<DownloadResult> {
    const settings = await this.getSettings();
    await this.resolveDownloadUrl(song);
    const nativeSong = await this.importDownloadRemoteSong(song);
    const songId = numericSongId(nativeSong);
    if (!songId) {
      throw new StarlightError('INTERNAL_ERROR', 'Songloft 未返回可下载的歌曲 ID', true, { upstream: 'songloft_remote_import' });
    }

    const songsApi = songloft.songs as typeof songloft.songs & SongDownloadApi;
    const result = await songsApi.download(songId, {
      path_template: settings.path_template,
      embed_metadata: settings.embed_metadata,
    });

    return {
      song_id: songId,
      path: result?.path,
      status: result?.status || 'ok',
      ...(result?.error ? { error: result.error } : {}),
    };
  }

  async startBatch(songs: SearchResultSong[]): Promise<{ started: true; total: number }> {
    if (!Array.isArray(songs) || songs.length === 0) {
      throw new StarlightError('BAD_REQUEST', 'songs must be a non-empty array');
    }

    const task: BatchTask = { current: 0, total: songs.length, done: false, results: [] };
    this.batchTask = task;
    this.runBatch(task, songs).catch((error) => {
      songloft.log.warn(`[DownloadService] batch download stopped: ${String(error)}`);
      task.done = true;
    });

    return { started: true, total: songs.length };
  }

  getBatchProgress(): BatchDownloadProgress {
    if (!this.batchTask) {
      return { active: false, current: 0, total: 0, done: true, success: 0, failed: 0, results: [] };
    }

    const success = this.batchTask.results.filter((result) => result.status === 'ok').length;
    const failed = this.batchTask.results.filter((result) => result.status === 'failed').length;
    return {
      active: true,
      current: this.batchTask.current,
      total: this.batchTask.total,
      done: this.batchTask.done,
      success,
      failed,
      results: [...this.batchTask.results],
    };
  }

  clearBatch(): { ok: true } {
    this.batchTask = null;
    return { ok: true };
  }

  private async resolveDownloadUrl(song: SearchResultSong): Promise<string> {
    const url = await this.runtimes.getMusicUrl(
      song.source_data.platform,
      song.source_data.quality,
      song.source_data.songInfo,
    );
    if (!url) {
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', '下载音源无法解析歌曲地址', true);
    }

    return url;
  }

  private async importDownloadRemoteSong(song: SearchResultSong): Promise<SongloftRemoteSong> {
    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const payload = toRemoteSong(song, '', {
      pluginEntryPath: STARLIGHT_PLUGIN_ENTRY_PATH,
      sourceData: downloadSourceData(song),
      dedupKey: '',
    });
    const imported = await postRemoteSongs(host, token, [payload]);
    if (!imported.ok) {
      throw new StarlightError('INTERNAL_ERROR', `导入下载歌曲失败: ${imported.status}${imported.body ? ` ${imported.body}` : ''}`, true, {
        upstream: 'songloft_remote_import',
        status: imported.status,
        ...(imported.body ? { body: imported.body } : {}),
      });
    }

    const first = imported.songs[0];
    if (!first) {
      throw new StarlightError('INTERNAL_ERROR', '导入下载歌曲失败: Songloft 未返回歌曲记录', true, {
        upstream: 'songloft_remote_import',
      });
    }

    return first;
  }

  private async runBatch(task: BatchTask, songs: SearchResultSong[]): Promise<void> {
    const settings = await this.getSettings();
    for (let index = 0; index < songs.length; index += 1) {
      if (this.batchTask !== task) {
        return;
      }

      task.current = index + 1;
      try {
        task.results.push(await this.downloadSong(songs[index]));
      } catch (error) {
        task.results.push({
          song_id: 0,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (index < songs.length - 1 && settings.download_interval > 0) {
        await sleep(settings.download_interval * 1000);
      }
    }

    task.done = true;
  }
}

function normalizeSettings(value: Partial<DownloadSettings>): DownloadSettings {
  const pathTemplate = typeof value.path_template === 'string' && value.path_template.trim()
    ? value.path_template.trim()
    : DEFAULT_SETTINGS.path_template;
  const interval = typeof value.download_interval === 'number' && Number.isFinite(value.download_interval) && value.download_interval >= 0
    ? Math.floor(value.download_interval)
    : DEFAULT_SETTINGS.download_interval;

  return {
    path_template: pathTemplate,
    embed_metadata: typeof value.embed_metadata === 'boolean' ? value.embed_metadata : DEFAULT_SETTINGS.embed_metadata,
    download_interval: interval,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function numericSongId(song: SongloftRemoteSong): number {
  const id = Number(song.id);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function downloadSourceData(song: SearchResultSong): SearchResultSong['source_data'] & { starlight: { purpose: 'download' } } {
  return {
    ...song.source_data,
    starlight: { purpose: 'download' },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
