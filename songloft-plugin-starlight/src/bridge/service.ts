/// <reference types="@songloft/plugin-sdk" />

import { StarlightError } from '../system/errors';
import { PlatformRegistry } from '../music/platforms/registry';
import { RuntimeManager } from '../music/runtime_manager';
import type { SearchResultSong } from '../music/types';
import { toRemoteSong, type RemoteSongPayload } from './mapper';
import { MinaService } from '../service/service';

export class BridgeService {
  constructor(
    private readonly platforms: PlatformRegistry,
    private readonly runtimes: RuntimeManager,
    private readonly minaService: MinaService,
  ) {}

  async previewUrl(song: SearchResultSong): Promise<string> {
    const url = await this.runtimes.getMusicUrl(
      song.source_data.platform,
      song.source_data.quality,
      song.source_data.songInfo,
    );
    if (!url) {
      throw new StarlightError('PLAY_URL_RESOLVE_FAILED', '无法解析播放 URL', true);
    }

    return url;
  }

  async importSongs(songs: SearchResultSong[]): Promise<{ total: number; payloads: RemoteSongPayload[] }> {
    if (songs.length === 0) {
      return { total: 0, payloads: [] };
    }

    const payloads: RemoteSongPayload[] = [];
    for (const song of songs) {
      const url = await this.previewUrl(song);
      payloads.push(toRemoteSong(song, url));
    }

    const token = await songloft.plugin.getToken();
    const host = await songloft.plugin.getHostUrl();
    const response = await fetch(`${host}/api/v1/songs/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payloads),
    });
    if (!response.ok) {
      throw new StarlightError('INTERNAL_ERROR', `导入 Songloft 歌曲失败: ${response.status}`, true, {
        upstream: 'songloft_remote_import',
        status: response.status,
      });
    }

    return { total: payloads.length, payloads };
  }

  async playOnSpeaker(accountId: string, deviceId: string, song: SearchResultSong): Promise<{ url: string }> {
    const url = await this.previewUrl(song);
    const played = await this.minaService.playURL(accountId, deviceId, url);
    if (!played) {
      throw new StarlightError('DEVICE_OFFLINE', '音箱播放 URL 失败', true);
    }

    return { url };
  }

  async externalSearch(keyword: string): Promise<SearchResultSong | null> {
    for (const platform of this.platforms.all()) {
      const provider = this.platforms.get(platform.id);
      if (!provider) {
        continue;
      }

      try {
        const result = await provider.search(keyword, 1, 5);
        const first = result.list[0];
        if (first) {
          return first;
        }
      } catch (error) {
        songloft.log.warn(`[BridgeService] External search provider ${platform.id} failed: ${sanitizeProviderError(error)}`);
      }
    }

    return null;
  }
}

function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}
