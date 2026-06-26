// MIoT 智能音箱插件 - URL构造器
// 翻译自 Go 源码: plugins/songloft-plugin-xiaomi/player/url_builder.go

import { getHostBaseUrl } from '../utils/http';

/**
 * URL构造器 - 构造歌曲和封面的播放URL
 */
export class URLBuilder {
  /**
   * 构造歌曲播放URL（带access_token认证）
   *
   * 新架构(2026):后端 MarshalJSON 已统一处理 song.url 字段:
   * - 所有类型(local/remote/radio): /api/v1/songs/{id}/play
   *
   * @param song 歌曲对象（需要 id 和 url 字段）
   * @param options.forceMp3 是否追加 format=mp3 强制服务端转码
   * @returns 播放 URL（相对路径会自动附加 access_token）
   */
  static async buildSongURL(song: {
    id?: number;
    url?: string;
  }, options?: { forceMp3?: boolean }): Promise<string> {
    const songUrl = song.url || '';

    if (!songUrl) {
      return '';
    }

    // 外部 URL 直接返回
    if (songUrl.startsWith('http://') || songUrl.startsWith('https://')) {
      return songUrl;
    }

    // 相对路径（/api/v1/songs/{id}/play）需要附加 access_token
    const serverHost = getHostBaseUrl();
    const accessToken = await songloft.plugin.getToken();
    const separator = songUrl.includes('?') ? '&' : '?';
    let url = serverHost + songUrl + separator + 'access_token=' + accessToken;
    if (options?.forceMp3) {
      url += '&format=mp3';
    }
    return url;
  }
}
