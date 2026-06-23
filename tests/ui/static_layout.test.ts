import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function indexHtml(): string {
  return readFileSync(resolve(process.cwd(), 'static/index.html'), 'utf8');
}

function appJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/app.js'), 'utf8');
}

function stateJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/state.js'), 'utf8');
}

function automationJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/automation.js'), 'utf8');
}

function speakerJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/speaker.js'), 'utf8');
}

function diagnosticsJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/diagnostics.js'), 'utf8');
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

  it('renders speaker playback controls in the speaker page only', () => {
    const html = indexHtml();
    const speaker = speakerJs();
    const stylesheet = css();

    expect(html).toContain('speaker-player-panel');
    expect(html).toContain('data-role="speaker-player-device"');
    expect(html).toContain('data-action="speaker-player-previous"');
    expect(html).toContain('data-action="speaker-player-toggle"');
    expect(html).toContain('data-action="speaker-player-stop"');
    expect(html).toContain('data-action="speaker-player-next"');
    expect(html).toContain('data-action="speaker-player-mode"');
    expect(html).toContain('data-action="speaker-player-refresh"');
    expect(html).not.toContain('>Prev</button>');
    expect(html).not.toContain('>Stop</button>');
    expect(html).not.toContain('>Next</button>');
    expect(html).toContain('>上一首</button>');
    expect(html).toContain('>暂停播放</button>');
    expect(html).toContain('>停止</button>');
    expect(html).toContain('>下一首</button>');
    expect(speaker).toContain('speaker-player');
    expect(stylesheet).toContain('.speaker-player');
    expect(stylesheet).toContain('.player-status-card');
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

  it('adds search result clearing, selection, and batch controls', () => {
    const html = indexHtml();

    expect(html).toContain('data-action="clear-search"');
    expect(html).toContain('data-role="search-batch-actions"');
    expect(html).toContain('data-action="select-search-page"');
    expect(html).toContain('data-action="clear-search-selection"');
    expect(html).toContain('data-action="import-selected-search"');
    expect(html).toContain('data-action="add-selected-search-to-playlist"');
    expect(html).toContain('data-action="download-selected-search"');
    expect(html).toContain('data-action="speaker-selected-search"');
    expect(html).toContain('批量推送音箱');
  });

  it('passes the selected quality through search requests', () => {
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');

    expect(music).toContain('quality: query.quality');
  });

  it('adds highest-quality selectors to songlist and ranking pages', () => {
    const html = indexHtml();
    const songlistsStart = html.indexOf('<section class="tab-panel" id="tab-songlists">');
    const rankingsStart = html.indexOf('<section class="tab-panel" id="tab-rankings">');
    const sourcesStart = html.indexOf('<section class="tab-panel" id="tab-sources">');
    const songlistsHtml = html.slice(songlistsStart, rankingsStart);
    const rankingsHtml = html.slice(rankingsStart, sourcesStart);

    expect(songlistsHtml).toContain('data-role="songlist-quality"');
    expect(songlistsHtml).toContain('<option value="flac24bit" selected>flac24bit</option>');
    expect(rankingsHtml).toContain('data-role="ranking-quality"');
    expect(rankingsHtml).toContain('<option value="flac24bit" selected>flac24bit</option>');
  });

  it('passes songlist and ranking quality through detail requests', () => {
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');

    expect(music).toContain('quality=${encodeURIComponent(context.quality)}');
    expect(music).toContain('quality: body.quality || state.songlistQuality');
    expect(music).toContain('const quality = $(\'[data-role="ranking-quality"]\')?.value || state.rankingQuality');
  });

  it('defines scroll containers and mobile wrapping for long music lists', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('.list-scroll');
    expect(stylesheet).toContain('max-height');
    expect(stylesheet).toContain('overflow-y: auto');
    expect(stylesheet).toContain('.batch-actions');
    expect(stylesheet).toContain('@media (max-width: 760px)');
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

  it('stacks moved speaker index metrics vertically and allows long values to wrap', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('.speaker-operations-layout .metric-grid');
    expect(stylesheet).toContain('grid-template-columns: 1fr');
    expect(stylesheet).toContain('white-space: normal');
  });

  it('keeps speaker playback and index controls in the speaker page only', () => {
    const html = indexHtml();
    const speakerStart = html.indexOf('<section class="tab-panel" id="tab-speaker">');
    const songlistsStart = html.indexOf('<section class="tab-panel" id="tab-songlists">');
    const speakerHtml = html.slice(speakerStart, songlistsStart);
    const automationHtml = html.slice(
      html.indexOf('<section class="tab-panel" id="tab-automation">'),
      html.indexOf('<section class="tab-panel" id="tab-settings">') >= 0
        ? html.indexOf('<section class="tab-panel" id="tab-settings">')
        : html.indexOf('</main>'),
    );

    expect(speakerHtml).not.toContain('<h2>音箱控制</h2>');
    expect(speakerHtml).toContain('speaker-player-panel');
    expect(speakerHtml).toContain('<h2>音箱播放</h2>');
    expect(speakerHtml).toContain('<h2>索引</h2>');
    expect(speakerHtml).toContain('data-action="refresh-index"');
    expect(automationHtml).not.toContain('<h2>音箱控制</h2>');
    expect(automationHtml).not.toContain('speaker-player');
    expect(automationHtml).not.toContain('<h2>索引</h2>');
  });

  it('provides a visible action to clear the current speaker device selection', () => {
    const html = indexHtml();
    const speakerStart = html.indexOf('<section class="tab-panel" id="tab-speaker">');
    const songlistsStart = html.indexOf('<section class="tab-panel" id="tab-songlists">');
    const speakerHtml = html.slice(speakerStart, songlistsStart);

    expect(speakerHtml).toContain('data-action="clear-device-selection"');
    expect(speakerHtml).toContain('取消选择</button>');
  });

  it('provides a visible action to save the current speaker device selection', () => {
    const html = indexHtml();
    const speakerStart = html.indexOf('<section class="tab-panel" id="tab-speaker">');
    const songlistsStart = html.indexOf('<section class="tab-panel" id="tab-songlists">');
    const speakerHtml = html.slice(speakerStart, songlistsStart);

    expect(speakerHtml).toContain('data-action="save-device-selection"');
    expect(speakerHtml).toContain('保存设备</button>');
  });

  it('moves visible settings into speaker and automation pages and removes the settings tab', () => {
    const html = indexHtml();
    const stateJs = readFileSync(resolve(process.cwd(), 'static/js/state.js'), 'utf8');
    const speakerStart = html.indexOf('<section class="tab-panel" id="tab-speaker">');
    const songlistsStart = html.indexOf('<section class="tab-panel" id="tab-songlists">');
    const speakerHtml = html.slice(speakerStart, songlistsStart);
    const automationHtml = html.slice(
      html.indexOf('<section class="tab-panel" id="tab-automation">'),
      html.indexOf('</main>'),
    );

    expect(stateJs).not.toContain("id: 'settings'");
    expect(html).not.toContain('id="tab-settings"');
    expect(speakerHtml).toContain('data-role="speaker-config-form"');
    expect(speakerHtml).toContain('name="conversation_monitor_enabled" type="checkbox"');
    expect(speakerHtml).toContain('name="voice_command_enabled" type="checkbox" disabled');
    expect(speakerHtml).toContain('name="force_mp3" type="checkbox"');
    expect(speakerHtml).not.toContain('name="scheduled_tasks_enabled"');
    expect(automationHtml).toContain('data-role="schedule-config-form"');
    expect(automationHtml).toContain('name="scheduled_tasks_enabled" type="checkbox"');
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

  it('does not render local or status-strip player controls', () => {
    const js = appJs();
    const stylesheet = css();

    expect(js).not.toContain('plugin_player');
    expect(js).not.toContain('renderPluginPlayer');
    expect(js).not.toContain('bindPluginPlayerControls');
    expect(js).not.toContain('data-role="global-player"');
    expect(js).not.toContain('data-action="global-player-toggle"');
    expect(stylesheet).not.toContain('.plugin-player');
    expect(stylesheet).not.toContain('.global-player');
  });

  it('does not retain dead handlers for hidden speaker and automation controls', () => {
    const speaker = speakerJs();
    const automation = automationJs();

    expect(speaker).not.toContain('password-login-form');
    expect(speaker).not.toContain('token-login-form');
    expect(speaker).not.toContain('data-auth-mode');
    expect(speaker).not.toContain('volume-form');
    expect(speaker).not.toContain('url-play-form');
    expect(automation).not.toContain('automation-player');
    expect(automation).not.toContain('AutomationPlayer');
  });

  it('does not retain hidden settings field plumbing in automation config code', () => {
    const automation = automationJs();

    expect(automation).not.toContain('timezone');
    expect(automation).not.toContain('external_search_url');
    expect(automation).not.toContain('external_search_token');
    expect(automation).not.toContain('extra_music_api_models');
    expect(automation).not.toContain('indicator_light_enabled');
    expect(automation).not.toContain('interrupt_tts_hint');
    expect(automation).not.toContain('ai_config');
    expect(automation).not.toContain('host-url');
  });

  it('does not retain local player state fields', () => {
    expect(stateJs()).not.toContain('selectedSong');
    expect(readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8')).not.toContain('playbackState');
  });

  it('does not render local playback buttons outside the speaker player', () => {
    const html = indexHtml();
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const staticButtonLabels = Array.from(html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g))
      .map((match) => match[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);

    expect(staticButtonLabels).toContain('暂停播放');
    expect(staticButtonLabels).not.toContain('播放');
    expect(music).not.toContain('>播放</button>');
  });

  it('mounts a 12 hour speaker voice record widget in the speaker page', () => {
    const html = indexHtml();
    const speakerStart = html.indexOf('<section class="tab-panel" id="tab-speaker">');
    const songlistsStart = html.indexOf('<section class="tab-panel" id="tab-songlists">');
    const speakerHtml = html.slice(speakerStart, songlistsStart);

    expect(speakerHtml).toContain('<h2>语音记录</h2>');
    expect(speakerHtml).toContain('data-role="voice-record-summary"');
    expect(speakerHtml).toContain('data-role="voice-record-list"');
    expect(speakerHtml).toContain('data-action="refresh-voice-records"');
    expect(speakerHtml).toContain('data-action="clear-voice-records"');
    expect(speakerHtml).toContain('12 小时');
  });

  it('mounts Songloft library controls for songs, playlists, and local songs', () => {
    const html = indexHtml();

    expect(html).toContain('<h2>Songloft 曲库</h2>');
    expect(html).toContain('data-action="load-songloft-songs"');
    expect(html).toContain('data-action="load-songloft-local-songs"');
    expect(html).toContain('data-action="load-songloft-playlists"');
    expect(html).toContain('data-role="songloft-songs-panel"');
    expect(html).toContain('data-role="songloft-local-songs-panel"');
    expect(html).toContain('data-role="songloft-playlists-panel"');
    expect(html).toContain('data-role="songloft-songs"');
    expect(html).toContain('data-role="songloft-local-songs"');
    expect(html).toContain('data-role="songloft-playlists"');
    expect(html).toContain('data-role="songloft-playlist-songs"');
  });

  it('keeps mobile voice records and bottom tabs within the viewport', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('--bottom-tabs-height');
    expect(stylesheet).toContain('padding-bottom: var(--bottom-tabs-height)');
    expect(stylesheet).toContain('minmax(min(100%, 280px), 1fr)');
    expect(stylesheet).not.toContain('grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))');
  });

  it('adds a source diagnostics log menu with filtering and clearing controls', () => {
    const html = indexHtml();
    const state = stateJs();
    const app = appJs();
    const diagnostics = diagnosticsJs();
    const stylesheet = css();

    expect(state).toContain("{ id: 'logs', label: '日志'");
    expect(app).toContain('initDiagnosticsUI');
    expect(html).toContain('<section class="tab-panel" id="tab-logs">');
    expect(html).toContain('data-role="diagnostics-operation-filter"');
    expect(html).toContain('data-action="refresh-source-logs"');
    expect(html).toContain('data-action="clear-source-logs"');
    expect(html).toContain('data-role="source-log-list"');
    expect(diagnostics).toContain('/diagnostics/source-logs');
    expect(diagnostics).toContain('renderSourceLogs');
    expect(stylesheet).toContain('.source-log-row');
  });
});
