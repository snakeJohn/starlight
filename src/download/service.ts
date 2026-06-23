/// <reference types="@songloft/plugin-sdk" />

import { toRemoteSong } from '../bridge/mapper';
import { postRemoteSongs, type SongloftRemoteSong } from '../bridge/service';
import { PlatformRegistry } from '../music/platforms/registry';
import type { RuntimeManager } from '../music/runtime_manager';
import type { SearchResultSong } from '../music/types';
import { StarlightError } from '../system/errors';
import { sourceDiagnostics } from '../diagnostics/source_logs';

const SETTINGS_KEY = 'starlight:download:settings';
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

interface DownloadFailure {
  message: string;
  attempts?: number;
  code?: string;
}

export class DownloadService {
  private batchTask: BatchTask | null = null;

  constructor(
    private readonly runtimes: RuntimeManager,
    private readonly platforms: PlatformRegistry = new PlatformRegistry(),
  ) {}

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
    const attemptedSources = new Set<string>();
    const failures: DownloadFailure[] = [];

    const directResult = await this.tryDownloadCandidate(song, settings, attemptedSources, failures);
    if (directResult) {
      return directResult;
    }

    for await (const candidate of this.iterDownloadFallbackCandidates(song.title, song.artist, attemptedSources, failures)) {
      const result = await this.tryDownloadCandidate(candidate, settings, attemptedSources, failures);
      if (result) {
        return result;
      }
    }

    throw downloadFallbackError(attemptedSources.size, failures);
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
      { operation: 'download', title: song.title, artist: song.artist },
    );
    if (!url) {
      const attempt = typeof this.runtimes.getLastMusicUrlAttempt === 'function'
        ? this.runtimes.getLastMusicUrlAttempt()
        : { attemptedSources: 0, lastFailure: null };
      const reason = attempt.lastFailure ?? '未找到可用下载源';
      const detail = attempt.attemptedSources > 0
        ? `，已尝试 ${attempt.attemptedSources} 个下载源；最后失败原因：${reason}`
        : '';
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', `下载音源无法解析歌曲地址${detail}`, true, {
        attempts: attempt.attemptedSources,
        lastFailure: reason,
      });
    }

    return url;
  }

  private async tryDownloadCandidate(
    song: SearchResultSong,
    settings: DownloadSettings,
    attemptedSources: Set<string>,
    failures: DownloadFailure[],
  ): Promise<DownloadResult | null> {
    attemptedSources.add(song.source_data.platform);
    try {
      const url = await this.resolveDownloadUrl(song);
      const nativeSong = await this.importDownloadRemoteSong(song, url);
      const songId = numericSongId(nativeSong);
      if (!songId) {
        throw new StarlightError('INTERNAL_ERROR', 'Songloft 未返回可下载的歌曲 ID', true, { upstream: 'songloft_remote_import' });
      }

      const songsApi = songloft.songs as typeof songloft.songs & SongDownloadApi;
      try {
        const result = await songsApi.download(songId, {
          path_template: settings.path_template,
          embed_metadata: settings.embed_metadata,
        });
        if (result?.error || result?.status === 'failed') {
          throw new StarlightError('INTERNAL_ERROR', result.error || 'Songloft 下载失败', true, {
            upstream: 'songloft_download',
            status: result.status || 'failed',
          });
        }

        sourceDiagnostics.record({
          operation: 'download',
          stage: 'native-download',
          status: 'success',
          sourceId: 'songloft',
          sourceName: 'Songloft',
          platform: song.source_data.platform,
          quality: song.source_data.quality,
          title: song.title,
          artist: song.artist,
          message: '下载成功',
        });

        return {
          song_id: songId,
          path: result?.path,
          status: result?.status || 'ok',
        };
      } catch (error) {
        sourceDiagnostics.record({
          operation: 'download',
          stage: 'native-download',
          status: 'failed',
          sourceId: 'songloft',
          sourceName: 'Songloft',
          platform: song.source_data.platform,
          quality: song.source_data.quality,
          title: song.title,
          artist: song.artist,
          message: errorMessage(error),
        });
        throw error;
      }
    } catch (error) {
      failures.push(downloadFailure(error));
      songloft.log.warn(`[DownloadService] Download candidate failed "${song.title}" from ${song.source_data.platform}: ${errorMessage(error)}`);
      return null;
    }
  }

  private async *iterDownloadFallbackCandidates(
    title: string,
    artist: string,
    attemptedSources: Set<string>,
    failures: DownloadFailure[],
  ): AsyncGenerator<SearchResultSong, void, void> {
    const keyword = [title, artist].map((item) => item.trim()).filter(Boolean).join(' ');
    if (!keyword) {
      return;
    }

    for (const platform of this.platforms.all()) {
      attemptedSources.add(platform.id);
      const provider = this.platforms.get(platform.id);
      if (!provider) {
        continue;
      }

      try {
        const result = await provider.search(keyword, 1, 5);
        const candidates = (result.list ?? [])
          .map((candidate) => ({ song: candidate, score: scoreResolvedCandidate(title, artist, candidate) }))
          .filter((candidate) => candidate.score > 0)
          .sort((a, b) => b.score - a.score);

        for (const candidate of candidates) {
          yield candidate.song;
        }
      } catch (error) {
        failures.push(downloadFailure(error));
        songloft.log.warn(`[DownloadService] Download fallback search failed on ${platform.id}: ${errorMessage(error)}`);
      }
    }
  }

  private async importDownloadRemoteSong(song: SearchResultSong, url: string): Promise<SongloftRemoteSong> {
    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const payload = toRemoteSong({ ...song, duration: 0 }, url);
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

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function downloadFailure(error: unknown): DownloadFailure {
  if (error instanceof StarlightError) {
    const attempts = typeof error.details.attempts === 'number' && Number.isFinite(error.details.attempts)
      ? Math.max(0, Math.floor(error.details.attempts))
      : undefined;
    const detailFailure = typeof error.details.lastFailure === 'string' && error.details.lastFailure.trim()
      ? error.details.lastFailure.trim()
      : null;
    return {
      message: detailFailure ?? errorMessage(error),
      ...(attempts && attempts > 0 ? { attempts } : {}),
      code: error.code,
    };
  }

  return { message: errorMessage(error) };
}

function downloadFallbackError(attemptedCount: number, failures: DownloadFailure[]): StarlightError {
  const last = failures.length > 0 ? failures[failures.length - 1] : null;
  const lastFailure = last?.message ?? '未找到可用下载音源';
  const attempts = Math.max(attemptedCount, last?.attempts ?? 0);
  const message = `下载失败，已尝试 ${attempts} 个下载音源；最后失败原因：${lastFailure}`;
  const code = last?.code === 'PLAY_URL_RESOLVE_FAILED' ? 'PLAY_URL_RESOLVE_FAILED' : 'INTERNAL_ERROR';
  return new StarlightError(code, message, true, { attempts, lastFailure });
}

function normalizeSongText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[《》【】[\]（）()\s_\-·,，.。]/g, '');
}

function textMatches(expected: string, actual: string): boolean {
  const normalizedExpected = normalizeSongText(expected);
  const normalizedActual = normalizeSongText(actual);
  return Boolean(
    normalizedExpected
    && normalizedActual
    && (normalizedActual === normalizedExpected
      || normalizedActual.includes(normalizedExpected)
      || normalizedExpected.includes(normalizedActual)),
  );
}

function scoreResolvedCandidate(title: string, artist: string, song: SearchResultSong): number {
  if (!textMatches(title, song.title)) {
    return 0;
  }

  let score = normalizeSongText(title) === normalizeSongText(song.title) ? 100 : 60;
  if (artist.trim()) {
    if (!textMatches(artist, song.artist)) {
      return 0;
    }
    score += normalizeSongText(artist) === normalizeSongText(song.artist) ? 40 : 20;
  }
  return score;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
