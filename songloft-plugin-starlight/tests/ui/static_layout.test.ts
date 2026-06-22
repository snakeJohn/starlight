import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function indexHtml(): string {
  return readFileSync(resolve(process.cwd(), 'static/index.html'), 'utf8');
}

function appJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/app.js'), 'utf8');
}

function css(): string {
  return readFileSync(resolve(process.cwd(), 'static/css/style.css'), 'utf8');
}

describe('static UI layout copy', () => {
  it('orders music qualities from low to high without changing labels', () => {
    const html = indexHtml();
    const order = ['value="128k"', 'value="320k"', 'value="flac"', 'value="flac24bit"'];
    const positions = order.map((marker) => html.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('uses Chinese playback controls', () => {
    const html = indexHtml();

    expect(html).toContain('>上一首</button>');
    expect(html).toContain('data-action="player-toggle"');
    expect(html).toContain('>暂停播放</button>');
    expect(html).toContain('>停止</button>');
    expect(html).toContain('>下一首</button>');
    expect(html).not.toContain('>Prev</button>');
    expect(html).not.toContain('>Stop</button>');
    expect(html).not.toContain('>Next</button>');
  });

  it('separates playlist import from custom playlist management and explains the target playlist', () => {
    const html = indexHtml();

    expect(html).toContain('<h2>导入歌单</h2>');
    expect(html).toContain('加入目标歌单');
    expect(html).toContain('搜索结果、榜单和歌单详情里的“加入歌单”会保存到这里');
  });

  it('orders songlist management before import and discovery', () => {
    const html = indexHtml();
    const myPlaylists = html.indexOf('<h2>我的歌单</h2>');
    const importPlaylists = html.indexOf('<h2>导入歌单</h2>');
    const searchPlaylists = html.indexOf('<h2>搜索歌单</h2>');

    expect(myPlaylists).toBeGreaterThanOrEqual(0);
    expect(importPlaylists).toBeGreaterThan(myPlaylists);
    expect(searchPlaylists).toBeGreaterThan(importPlaylists);
  });

  it('hides the server host configuration from the settings page', () => {
    const html = indexHtml();

    expect(html).not.toContain('Songloft 访问地址');
    expect(html).not.toContain('小爱音箱访问 Songloft 播放接口用的局域网地址');
    expect(html).not.toContain('data-role="host-url"');
    expect(html).not.toContain('<span>服务器地址</span>');
    expect(html).not.toContain('name="server_host"');
  });

  it('uses an interactive voice command editor instead of a JSON textarea', () => {
    const html = indexHtml();

    expect(html).toContain('data-role="voice-command-list"');
    expect(html).toContain('data-action="add-voice-command"');
    expect(html).not.toContain('data-role="voice-json"');
  });

  it('shows only QR code login in the speaker account panel', () => {
    const html = indexHtml();

    expect(html).toContain('data-auth-panel="qrcode"');
    expect(html).toContain('data-action="qr-start"');
    expect(html).not.toContain('data-auth-mode="password"');
    expect(html).not.toContain('data-auth-mode="token"');
    expect(html).not.toContain('data-role="password-login-form"');
    expect(html).not.toContain('data-role="token-login-form"');
  });

  it('mounts pagination controls for every paged music surface', () => {
    const html = indexHtml();

    expect(html).toContain('data-role="search-pagination"');
    expect(html).toContain('data-role="songlist-pagination"');
    expect(html).toContain('data-role="songlist-detail-pagination"');
    expect(html).toContain('data-role="ranking-pagination"');
  });

  it('replaces the plugin mini player with download source management UI', () => {
    const html = indexHtml();

    expect(html).not.toContain('id="miniPlayer"');
    expect(html).toContain('data-role="download-source-file"');
    expect(html).toContain('data-role="download-source-list"');
    expect(html).toContain('data-role="download-settings-form"');
    expect(html).toContain('data-role="download-progress"');
    expect(html).toContain('下载音源');
  });

  it('hides the top status platform chip', () => {
    const js = appJs();

    expect(js).not.toContain('<strong>平台</strong>');
  });

  it('marks ranking and automation layouts for narrower side panels and wrapping voice rows', () => {
    const html = indexHtml();
    const stylesheet = css();

    expect(html).toContain('split-view ranking-layout');
    expect(html).toContain('two-column automation-layout');
    expect(stylesheet).toContain('.ranking-layout');
    expect(stylesheet).toContain('.automation-layout');
    expect(stylesheet).toContain('repeat(auto-fit');
  });

  it('stacks automation index metrics vertically and allows long values to wrap', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('.automation-layout .metric-grid');
    expect(stylesheet).toContain('grid-template-columns: 1fr');
    expect(stylesheet).toContain('white-space: normal');
  });

  it('adds speaker playback controls to the automation page', () => {
    const html = indexHtml();

    expect(html).toContain('<h2>音箱播放</h2>');
    expect(html).toContain('data-role="automation-player-device"');
    expect(html).toContain('data-action="automation-player-previous"');
    expect(html).toContain('data-action="automation-player-toggle"');
    expect(html).toContain('data-action="automation-player-stop"');
    expect(html).toContain('data-action="automation-player-next"');
    expect(html).toContain('data-action="automation-player-refresh"');
  });

  it('hides advanced settings while keeping voice commands gated by saved conversation monitoring', () => {
    const html = indexHtml();

    expect(html).toContain('name="conversation_monitor_enabled" type="checkbox"');
    expect(html).toContain('name="voice_command_enabled" type="checkbox" disabled');
    expect(html).toContain('name="scheduled_tasks_enabled" type="checkbox"');
    expect(html).toContain('name="force_mp3" type="checkbox"');
    expect(html).not.toContain('name="timezone"');
    expect(html).not.toContain('name="extra_music_api_models"');
    expect(html).not.toContain('额外型号');
    expect(html).not.toContain('外部搜索 URL');
    expect(html).not.toContain('外部搜索 Token');
    expect(html).not.toContain('打断提示');
    expect(html).not.toContain('<span>外部搜索</span>');
    expect(html).not.toContain('<span>保留灯效</span>');
    expect(html).not.toContain('<span>搜索提示</span>');
    expect(html).not.toContain('<legend>AI</legend>');
    expect(html).not.toContain('name="ai_api_key"');
  });
});
