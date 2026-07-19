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

function musicSourcesJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/sources.js'), 'utf8');
}

function musicDownloadsJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/downloads.js'), 'utf8');
}

function musicSearchJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/search.js'), 'utf8');
}

function musicSonglistsJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/songlists.js'), 'utf8');
}

function musicRankingsJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/rankings.js'), 'utf8');
}

function musicSongloftLibraryJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/songloft_library.js'), 'utf8');
}

function musicCustomPlaylistsJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/music_modules/custom_playlists.js'), 'utf8');
}

function apiJs(): string {
  return readFileSync(resolve(process.cwd(), 'static/js/api.js'), 'utf8');
}

function css(): string {
  return readFileSync(resolve(process.cwd(), 'static/css/style.css'), 'utf8');
}

/** Slice a top-level tab panel body by id (new 5-tab IA). */
function panelHtml(html: string, id: string): string {
  const marker = `id="tab-${id}"`;
  const pos = html.indexOf(marker);
  if (pos < 0) return '';
  const start = html.lastIndexOf('<section', pos);
  const next = html.indexOf('<section class="tab-panel', pos + 10);
  const end = next > pos ? next : html.indexOf('</main>', pos);
  return html.slice(start, end);
}

function settingsSection(html: string, section: string): string {
  const settings = panelHtml(html, 'settings');
  const start = settings.indexOf(`data-settings-panel="${section}"`);
  if (start < 0) return '';
  const nextMarkers = ['sync', 'sources', 'automation', 'ai', 'logs']
    .filter((s) => s !== section)
    .map((s) => settings.indexOf(`data-settings-panel="${s}"`, start + 1))
    .filter((i) => i > start);
  const end = nextMarkers.length ? Math.min(...nextMarkers) : settings.length;
  return settings.slice(start, end);
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
    expect(html).toContain('data-action="speaker-player-mode-menu"');
    expect(html).toContain('data-action="speaker-player-mode-option"');
    expect(html).toContain('data-action="speaker-player-refresh"');
    expect(html).not.toContain('>Prev</button>');
    expect(html).not.toContain('>Stop</button>');
    expect(html).not.toContain('>Next</button>');
    expect(html).toContain('aria-label="上一首"');
    expect(html).toContain('aria-label="暂停播放"');
    expect(html).toContain('aria-label="停止"');
    expect(html).toContain('aria-label="下一首"');
    expect(speaker).toContain('speaker-player');
    expect(stylesheet).toContain('.speaker-player');
    expect(stylesheet).toContain('.player-status-card');
  });

  it('separates playlist import from custom playlist management and explains the target playlist', () => {
    const html = indexHtml();
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const customPlaylists = musicCustomPlaylistsJs();

    expect(html).toContain('<h2>导入歌单</h2>');
    expect(html).toContain('Songloft 目标歌单');
    expect(html).toContain('搜索结果、榜单和歌单详情里的“加入歌单”会保存到选中的 Songloft 歌单');
    expect(music).toContain("from './music_modules/custom_playlists.js'");
    expect(customPlaylists).toContain("api.post('/custom-playlists/import'");
    expect(customPlaylists).toContain("api.post(`/custom-playlists/${encodeURIComponent(playlistId)}/sync-songloft`)");
    expect(customPlaylists).toContain('data-action="add-selected-custom-playlist-songs"');
  });

  it('orders songlist management before import; discovery lives under Discover', () => {
    const html = indexHtml();
    const playlists = panelHtml(html, 'playlists');
    const discover = panelHtml(html, 'discover');
    const myPlaylists = playlists.indexOf('<h2>我的歌单</h2>');
    const importPlaylists = playlists.indexOf('<h2>导入歌单</h2>');

    expect(myPlaylists).toBeGreaterThanOrEqual(0);
    expect(importPlaylists).toBeGreaterThan(myPlaylists);
    expect(playlists).not.toContain('<h2>搜索歌单</h2>');
    expect(discover).toContain('<h2>搜索歌单</h2>');
    expect(discover).toContain('data-discover-panel="rankings"');
  });

  it('shows the Songloft access host in the speaker settings only', () => {
    const html = indexHtml();
    const speakerHtml = panelHtml(html, 'speaker');
    const settingsHtml = panelHtml(html, 'settings');
    const automationSection = settingsSection(html, 'automation');

    expect(speakerHtml).toContain('Songloft 访问地址');
    expect(speakerHtml).toContain('音箱访问 Songloft 播放接口用的局域网或公网地址');
    expect(speakerHtml).toContain('data-role="server-host-warning"');
    expect(speakerHtml).toContain('name="server_host"');
    expect(automationSection).not.toContain('name="server_host"');
    expect(settingsHtml).toContain('id="tab-settings"');
  });

  it('uses an interactive voice command editor instead of a JSON textarea', () => {
    const html = indexHtml();

    expect(html).toContain('data-role="voice-command-list"');
    expect(html).toContain('data-action="add-voice-command"');
    expect(html).not.toContain('data-role="voice-json"');
  });

  it('exposes AI voice-command analysis settings under Settings', () => {
    const html = indexHtml();
    const stylesheet = readFileSync(resolve(process.cwd(), 'static/css/style.css'), 'utf8');
    const aiSection = settingsSection(html, 'ai');

    expect(aiSection).toContain('data-role="ai-config-panel"');
    expect(aiSection).toContain('data-role="ai-config-form"');
    expect(aiSection).toContain('data-role="ai-api-url"');
    expect(aiSection).toContain('data-role="ai-api-key"');
    expect(aiSection).toContain('data-action="ai-test"');
    expect(aiSection).toContain('AI 口令分析');
    expect(aiSection).toContain('field-row');
    expect(aiSection).toContain('input-with-actions');
    expect(stylesheet).toContain('.ai-config-panel');
    expect(stylesheet).toContain('.form-stack');
    expect(stylesheet).toContain('.input-with-actions');
  });

  it('shows QR, password, and token login modes in the speaker account panel', () => {
    const html = indexHtml();

    expect(html).toContain('data-auth-panel="qrcode"');
    expect(html).toContain('data-action="qr-start"');
    expect(html).toContain('data-auth-mode="password"');
    expect(html).toContain('data-auth-mode="token"');
    expect(html).toContain('data-role="password-login-form"');
    expect(html).toContain('data-role="token-login-form"');
    expect(html).toContain('data-action="auth-tab"');
    expect(html).toContain('data-action="auth-captcha-submit"');
    expect(html).toContain('data-action="auth-verify-submit"');
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
    expect(html).not.toContain('data-action="add-selected-search-to-songloft"');
    expect(html).not.toContain('批量加入SL歌曲库');
    expect(html).not.toContain('加入SL歌单');
    expect(html).toContain('data-action="download-selected-search"');
    expect(html).toContain('data-action="speaker-selected-search"');
    expect(html).toContain('批量推送音箱');
  });

  it('passes the selected quality through search requests', () => {
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const search = musicSearchJs();

    expect(music).toContain("from './music_modules/search.js'");
    expect(search).toContain('quality: query.quality');
  });

  it('adds highest-quality selectors to songlist and ranking pages', () => {
    const html = indexHtml();
    const discover = panelHtml(html, 'discover');

    expect(discover).toContain('data-role="songlist-quality"');
    expect(discover).toContain('<option value="flac24bit" selected>flac24bit</option>');
    expect(discover).toContain('data-role="ranking-quality"');
    expect(discover).toContain('<option value="flac24bit" selected>flac24bit</option>');
  });

  it('passes songlist and ranking quality through detail requests', () => {
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const songlists = musicSonglistsJs();
    const rankings = musicRankingsJs();

    expect(music).toContain("from './music_modules/songlists.js'");
    expect(music).toContain("from './music_modules/rankings.js'");
    expect(songlists).toContain('quality=${encodeURIComponent(context.quality)}');
    expect(songlists).toContain('quality: body.quality || state.songlistQuality');
    expect(rankings).toContain('const quality = $(\'[data-role="ranking-quality"]\')?.value || state.rankingQuality');
  });

  it('defines scroll containers and mobile wrapping for long music lists', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('.list-scroll');
    expect(stylesheet).toContain('max-height');
    expect(stylesheet).toContain('overflow-y: auto');
    expect(stylesheet).toContain('.batch-actions');
    expect(stylesheet).toContain('@media (max-width: 760px)');
  });

  it('allows page scroll chaining after nested list controls reach their edge', () => {
    const stylesheet = css();

    expect(stylesheet).not.toContain('overscroll-behavior: contain');
    expect(stylesheet).toMatch(/\.list-scroll\s*\{[^}]*overscroll-behavior-y:\s*auto/s);
    expect(stylesheet).toMatch(/\.source-log-list\s*\{[^}]*overscroll-behavior-y:\s*auto/s);
  });

  it('keeps download settings and progress at the bottom of merged source management', () => {
    const html = indexHtml();
    const sourcesHtml = settingsSection(html, 'sources');
    const sourcePagination = sourcesHtml.indexOf('data-role="source-pagination"');
    const downloadSettings = sourcesHtml.indexOf('data-role="download-settings-form"');
    const downloadProgress = sourcesHtml.indexOf('data-role="download-progress"');

    expect(html).not.toContain('id="miniPlayer"');
    expect(html).not.toContain('id="tab-download"');
    expect(sourcesHtml).toContain('data-role="download-settings-form"');
    expect(sourcesHtml).toContain('data-role="download-progress"');
    expect(downloadSettings).toBeGreaterThan(sourcePagination);
    expect(downloadProgress).toBeGreaterThan(downloadSettings);
    expect(sourcesHtml).not.toContain('data-role="download-source-file"');
    expect(sourcesHtml).not.toContain('data-role="download-source-list"');
    expect(sourcesHtml).not.toContain('<h2>下载音源</h2>');
  });

  it('merges playback and download source management into one paged selectable control', () => {
    const html = indexHtml();
    const sourcesModule = musicSourcesJs();
    const sourcesHtml = settingsSection(html, 'sources');

    expect(sourcesHtml).toContain('data-action="enable-selected-playback-sources"');
    expect(sourcesHtml).toContain('data-action="disable-selected-playback-sources"');
    expect(sourcesHtml).toContain('data-action="enable-selected-download-sources"');
    expect(sourcesHtml).toContain('data-action="disable-selected-download-sources"');
    expect(sourcesHtml).toContain('data-role="source-pagination"');
    expect(sourcesHtml).toContain('data-role="source-list"');
    expect(sourcesHtml).not.toContain('data-role="download-source-pagination"');
    expect(sourcesModule).toContain('const sourcePageSize = 10');
    expect(sourcesModule).toContain('data-role="${selectRole}"');
    expect(sourcesModule).toContain('mergeSourceRows');
    expect(sourcesModule).toContain("'toggle-playback-source'");
    expect(sourcesModule).toContain("'toggle-download-source'");
    expect(sourcesModule).toContain('/music/sources/batch-toggle');
    expect(sourcesModule).toContain('/download/sources/batch-toggle');
  });

  it('imports zip packages by extracting contained JavaScript source files', () => {
    const sourcesModule = musicSourcesJs();

    expect(sourcesModule).toContain("import { readJavaScriptSourceFiles } from '../zip_sources.js'");
    expect(sourcesModule).toContain('files: await readJavaScriptSourceFiles(file)');
    expect(sourcesModule).toContain('sourceImportSummary');
    expect(sourcesModule).toContain("api.post('/music/sources/import'");
    expect(sourcesModule).toContain("api.post('/download/sources/import'");
  });

  it('hides the top status platform chip', () => {
    const js = appJs();

    expect(js).not.toContain('<strong>平台</strong>');
  });

  it('does not render per-module init chips in the top status strip', () => {
    const js = appJs();

    expect(js).not.toContain('data-domain="${domain.id}"');
    expect(js).not.toContain('${domainChips}');
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
    const speakerHtml = panelHtml(html, 'speaker');
    const automationHtml = settingsSection(html, 'automation');

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
    const speakerHtml = panelHtml(html, 'speaker');

    expect(speakerHtml).toContain('data-action="clear-device-selection"');
    expect(speakerHtml).toContain('取消选择</button>');
  });

  it('provides a visible action to save the current speaker device selection', () => {
    const html = indexHtml();
    const speakerHtml = panelHtml(html, 'speaker');

    expect(speakerHtml).toContain('data-action="save-device-selection"');
    expect(speakerHtml).toContain('保存设备</button>');
  });

  it('integrates speaker settings into the device control panel', () => {
    const html = indexHtml();
    const stylesheet = css();
    const speakerHtml = panelHtml(html, 'speaker');
    const deviceStart = speakerHtml.indexOf('<section class="surface-section speaker-device-panel">');
    const operationsStart = speakerHtml.indexOf('<div class="two-column speaker-operations-layout">');
    const deviceHtml = speakerHtml.slice(deviceStart, operationsStart);

    expect(deviceStart).toBeGreaterThanOrEqual(0);
    expect(deviceHtml).toContain('data-role="speaker-config-form"');
    expect(deviceHtml.indexOf('data-role="speaker-config-form"')).toBeLessThan(deviceHtml.indexOf('data-role="device-list"'));
    expect(deviceHtml).toContain('speaker-device-settings settings-form');
    expect(deviceHtml).toContain('speaker-device-actions');
    expect(speakerHtml).not.toContain('<h2>音箱设置</h2>');
    expect(stylesheet).toContain('.speaker-device-panel');
    expect(stylesheet).toContain('.device-selection-grid');
    expect(stylesheet).toContain('.speaker-device-settings');
    expect(stylesheet).toContain('.speaker-device-actions');
    expect(stylesheet).toContain('grid-template-columns: minmax(0, 0.82fr) minmax(0, 1fr) minmax(0, 0.92fr);');
    expect(stylesheet).not.toContain('grid-template-columns: minmax(150px, 0.82fr) minmax(190px, 1fr) minmax(220px, 0.92fr);');
  });

  it('uses a 5-tab IA: speaker device config stays on speaker; automation/AI/sync under settings', () => {
    const html = indexHtml();
    const stateJs = readFileSync(resolve(process.cwd(), 'static/js/state.js'), 'utf8');
    const speakerHtml = panelHtml(html, 'speaker');
    const automationHtml = settingsSection(html, 'automation');
    const settingsHtml = panelHtml(html, 'settings');

    expect(stateJs).toContain("id: 'settings'");
    expect(stateJs).toContain("id: 'discover'");
    expect(stateJs).toContain("id: 'playlists'");
    expect(stateJs).not.toContain("id: 'songlists'");
    expect(stateJs).not.toContain("id: 'rankings'");
    expect(stateJs).not.toContain("id: 'logs'");
    expect(stateJs).not.toContain("id: 'automation'");
    expect(html).toContain('id="tab-settings"');
    expect(html).toContain('id="tab-discover"');
    expect(html).toContain('id="tab-playlists"');
    expect(html).not.toContain('id="tab-songlists"');
    expect(html).not.toContain('id="tab-rankings"');
    expect(html).not.toContain('id="tab-sources"');
    expect(html).not.toContain('id="tab-logs"');
    expect(html).not.toContain('id="tab-automation"');
    expect(speakerHtml).toContain('data-role="speaker-config-form"');
    expect(speakerHtml).toContain('name="conversation_monitor_enabled" type="checkbox"');
    expect(speakerHtml).toContain('name="voice_command_enabled" type="checkbox" disabled');
    expect(speakerHtml).toContain('name="force_mp3" type="checkbox"');
    expect(speakerHtml).toContain('name="server_host"');
    expect(speakerHtml).not.toContain('name="scheduled_tasks_enabled"');
    expect(automationHtml).toContain('data-role="schedule-config-form"');
    expect(automationHtml).toContain('name="scheduled_tasks_enabled" type="checkbox"');
    expect(automationHtml).toContain('<option value="once">单曲播放</option>');
    expect(automationHtml).toContain('<option value="loop">列表循环</option>');
    expect(automationHtml).not.toContain('<option value="repeat">循环</option>');
    expect(settingsHtml).toContain('data-settings-section="sync"');
    expect(settingsHtml).toContain('data-settings-section="sources"');
    expect(settingsHtml).toContain('data-settings-section="ai"');
    expect(settingsHtml).toContain('data-settings-section="logs"');
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

  it('mounts the persistent speaker player outside the status strip without legacy local player controls', () => {
    const html = indexHtml();
    const js = appJs();
    const speaker = speakerJs();
    const stylesheet = css();

    expect(js).not.toContain('plugin_player');
    expect(js).not.toContain('renderPluginPlayer');
    expect(js).not.toContain('bindPluginPlayerControls');
    expect(stylesheet).not.toContain('.plugin-player');
    expect(html).toContain('class="global-player-bar"');
    expect(html).toContain('data-role="global-player-title"');
    expect(html).toContain('data-role="global-player-cover"');
    expect(html).toContain('data-role="fullscreen-player"');
    expect(html).toContain('data-role="fullscreen-player-lyrics"');
    expect(speaker).toContain('startPlayerStatusPolling');
    expect(stylesheet).toContain('.global-player-bar');
    expect(stylesheet).toContain('bottom: var(--global-player-height);');
  });

  it('uses LX music-style icon buttons and a selectable play mode menu for speaker playback controls', () => {
    const html = indexHtml();
    const stylesheet = css();

    expect(html).toMatch(/<button class="lx-player-button"[^>]*data-action="speaker-player-previous"[\s\S]*?<i class="fas fa-step-backward"/);
    expect(html).toMatch(/<button class="lx-player-button lx-player-main-button speaker-player-toggle"[^>]*data-action="speaker-player-toggle"[\s\S]*?<i class="fas fa-play"[^>]*data-role="speaker-player-play-icon"/);
    expect(html).toMatch(/<button class="lx-player-button"[^>]*data-action="speaker-player-next"[\s\S]*?<i class="fas fa-step-forward"/);
    expect(html).toMatch(/<button class="lx-player-button"[^>]*data-action="speaker-player-stop"[\s\S]*?<i class="fas fa-stop"/);
    expect(html).toMatch(/<button class="lx-player-button"[^>]*data-action="speaker-player-song-list"[\s\S]*?<i class="fas fa-list-ul"/);
    expect(html).toMatch(/<button class="lx-player-button"[^>]*data-action="speaker-player-refresh"[\s\S]*?<i class="fas fa-sync-alt"/);
    expect(html).toContain('data-action="speaker-player-mode-menu"');
    expect(html).toContain('data-action="speaker-player-mode-option" data-mode="loop"');
    expect(html).toContain('data-action="speaker-player-mode-option" data-mode="once"');
    expect(html).toContain('data-action="speaker-player-mode-option" data-mode="single"');
    expect(html).toContain('data-action="speaker-player-mode-option" data-mode="random"');
    expect(html).toContain('data-action="speaker-player-mode-option" data-mode="order"');
    expect(html).toContain('<input type="hidden" data-role="speaker-player-mode" value="loop">');
    expect(html).not.toContain('<select data-role="speaker-player-mode"');
    expect(html).not.toContain('data-action="speaker-player-previous" title="上一首" aria-label="上一首">上一首</button>');
    expect(html).not.toContain('data-action="speaker-player-stop" title="停止" aria-label="停止">停止</button>');
    expect(html).not.toContain('data-action="speaker-player-next" title="下一首" aria-label="下一首">下一首</button>');
    expect(html).not.toContain('data-action="speaker-player-refresh" title="刷新状态" aria-label="刷新状态">刷新</button>');
    expect(stylesheet).toContain('.lx-player-button');
    expect(stylesheet).toContain('.lx-player-main-button');
    expect(stylesheet).toContain('.lx-play-mode-menu');
  });

  it('opens a right-sliding drawer with playlist selector for every player surface', () => {
    const html = indexHtml();
    const stylesheet = css();
    const songListButtons = html.match(/data-action="speaker-player-song-list"/g) || [];

    expect(songListButtons).toHaveLength(3);
    expect(html).toContain('data-role="speaker-song-list-drawer"');
    expect(html).toContain('data-role="speaker-song-list-playlists"');
    expect(html).toContain('data-role="speaker-song-list-songs"');
    expect(html).toContain('data-action="speaker-song-list-refresh"');
    expect(html).toContain('data-action="close-speaker-song-list"');
    expect(html).toContain('aria-label="歌曲列表"');
    expect(stylesheet).toContain('speaker-song-list-drawer');
    expect(stylesheet).toContain('speaker-song-list-panel');
    expect(stylesheet).toContain('speaker-song-list-current-marker');
  });

  it('mounts a playable Songloft playlist browser in the speaker page', () => {
    const html = indexHtml();
    const speakerHtml = panelHtml(html, 'speaker');

    expect(speakerHtml).toContain('speaker-playlist-panel');
    expect(speakerHtml).toContain('data-role="speaker-playlist-select"');
    expect(speakerHtml).toContain('data-role="speaker-playlist-list"');
    expect(speakerHtml).toContain('data-role="speaker-playlist-songs"');
    expect(speakerHtml).toContain('data-action="speaker-playlist-play"');
    expect(speakerHtml).toContain('data-action="speaker-playlist-refresh"');
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
    expect(automation).not.toContain('host-url');
    // AI 口令分析已作为一等能力挂在自动化页（ai_config 模块）
    expect(automation).toContain('ai_config');
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

    expect(html).toContain('aria-label="暂停播放"');
    expect(staticButtonLabels).not.toContain('播放');
    expect(music).not.toContain('>播放</button>');
  });

  it('mounts a 12 hour speaker voice record widget in the speaker page', () => {
    const html = indexHtml();
    const speakerHtml = panelHtml(html, 'speaker');

    expect(speakerHtml).toContain('<h2>语音记录</h2>');
    expect(speakerHtml).toContain('data-role="voice-record-summary"');
    expect(speakerHtml).toContain('data-role="voice-record-list"');
    expect(speakerHtml).toContain('data-action="refresh-voice-records"');
    expect(speakerHtml).toContain('data-action="clear-voice-records"');
    expect(speakerHtml).toContain('12 小时');
  });

  it('mounts Songloft library controls for songs, playlists, and local songs', () => {
    const html = indexHtml();
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const songloftLibrary = musicSongloftLibraryJs();

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
    expect(music).toContain("from './music_modules/songloft_library.js'");
    expect(songloftLibrary).toContain("api.get('/songloft/songs')");
    expect(songloftLibrary).toContain("api.get('/songloft/local-songs')");
    expect(songloftLibrary).toContain("api.get('/songloft/playlists')");
    expect(songloftLibrary).toContain("[data-action=\"view-songloft-playlist\"]");
    expect(songloftLibrary).toContain("api.post('/custom-playlists/import-songloft'");
    expect(songloftLibrary).toContain('import-songloft-playlist-to-custom');
  });

  it('mounts a unified Songloft target playlist dialog', () => {
    const html = indexHtml();
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const state = stateJs();

    expect(html).toContain('data-role="songloft-playlist-target-dialog"');
    expect(html).toContain('data-role="songloft-target-playlist-select"');
    expect(html).toContain('data-role="songloft-target-playlist-filter"');
    expect(html).toContain('data-role="songloft-target-playlist-name"');
    expect(html).toContain('data-action="refresh-songloft-target-playlists"');
    expect(html).toContain('data-action="confirm-songloft-target"');
    expect(html).toContain('data-role="songloft-target-song-count"');
    expect(state).toContain('songloftTargetPlaylistId');
    expect(state).toContain('songloftTargetPlaylistName');
    expect(state).toContain('songloftTargetPlaylists');
    expect(state).toContain('songloftTargetPendingSongs');
    expect(music).toContain("from './music_modules/songloft_playlist_target.js'");
    expect(music).toContain('bindSongloftPlaylistTarget');
    expect(music).toContain('openSongloftPlaylistTarget');
  });

  it('wires unified playlist actions across search, songlists, rankings, and imported playlists', () => {
    const html = indexHtml();
    const music = readFileSync(resolve(process.cwd(), 'static/js/music.js'), 'utf8');
    const renderers = readFileSync(resolve(process.cwd(), 'static/js/music_modules/renderers.js'), 'utf8');
    const search = musicSearchJs();
    const songlists = musicSonglistsJs();
    const rankings = musicRankingsJs();
    const customPlaylists = musicCustomPlaylistsJs();

    expect(html).toContain('data-action="add-selected-search-to-playlist"');
    expect(renderers).toContain('add-to-playlist');
    expect(renderers).not.toContain('add-to-songloft-playlist');
    expect(renderers).toContain('import-songlist-to-playlist');
    expect(music).toContain('if (action === \'add-to-playlist\') await openSongloftPlaylistTarget([song])');
    expect(music).not.toContain('addSongToCustomPlaylist(selectedCustomPlaylistId(), song)');
    expect(search).toContain('add-selected-search-to-playlist');
    expect(search).not.toContain('add-selected-search-to-songloft');
    expect(songlists).toContain('add-selected-songlist-detail-to-playlist');
    expect(songlists).toContain('/songloft/playlists/import-source-songlist');
    expect(rankings).toContain('add-selected-ranking-to-playlist');
    expect(customPlaylists).toContain('add-selected-custom-playlist-songs');
    expect(customPlaylists).toContain('add-custom-playlist-song');
    expect(customPlaylists).not.toContain('add-selected-custom-playlist-songs-to-songloft');
    expect(customPlaylists).not.toContain('add-custom-playlist-song-to-songloft');
    expect(html).not.toContain('加入SL歌曲库');
    expect(html).not.toContain('加入SL歌单');
  });

  it('keeps song row actions from squeezing playlist detail song titles', () => {
    const stylesheet = css();

    expect(stylesheet).toMatch(/\.song-row\.media-row\s*\{[\s\S]*grid-template-columns:\s*48px minmax\(0,\s*1fr\);/);
    expect(stylesheet).toMatch(/\.song-row\.media-row \.row-actions\s*\{[\s\S]*grid-column:\s*2 \/ -1;/);
    expect(stylesheet).toMatch(/\.song-row\.selectable-song-row\s*\{[\s\S]*grid-template-columns:\s*28px 48px minmax\(0,\s*1fr\);/);
    expect(stylesheet).toMatch(/\.song-row\.selectable-song-row \.row-actions\s*\{[\s\S]*grid-column:\s*3 \/ -1;/);
  });

  it('keeps mobile voice records and bottom tabs within the viewport', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('--bottom-tabs-height');
    expect(stylesheet).toContain('padding-bottom: calc(var(--global-player-height) + var(--bottom-tabs-height))');
    expect(stylesheet).toContain('minmax(min(100%, 280px), 1fr)');
    expect(stylesheet).toContain('grid-auto-flow: column;');
    expect(stylesheet).toContain('grid-auto-columns: minmax(0, 1fr);');
    expect(stylesheet).not.toContain('grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))');
    expect(stylesheet).not.toContain('grid-template-columns: repeat(8, minmax(0, 1fr));');
  });

  it('wraps custom playlist detail actions and stacks voice record meta on mobile', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('.custom-playlist-detail-panel .section-bar');
    expect(stylesheet).toContain('.custom-playlist-detail-panel .inline-actions');
    expect(stylesheet).toContain('.voice-record-meta');
    expect(stylesheet).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*\.custom-playlist-detail-panel \.section-bar\s*\{[\s\S]*flex-wrap:\s*wrap/s);
    expect(stylesheet).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*\.custom-playlist-detail-panel \.inline-actions\s*\{[\s\S]*width:\s*100%/s);
    expect(stylesheet).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*\.voice-record-meta\s*\{[\s\S]*flex-direction:\s*column/s);
  });

  it('adds a source diagnostics log section under Settings with filtering and clearing controls', () => {
    const html = indexHtml();
    const state = stateJs();
    const app = appJs();
    const diagnostics = diagnosticsJs();
    const stylesheet = css();
    const logsSection = settingsSection(html, 'logs');

    expect(state).toContain("{ id: 'settings', label: '设置'");
    expect(app).toContain('initDiagnosticsUI');
    expect(app).toContain("settingsSection: 'logs'");
    expect(html).toContain('id="tab-settings"');
    expect(logsSection).toContain('data-role="diagnostics-operation-filter"');
    expect(logsSection).toContain('data-action="refresh-source-logs"');
    expect(logsSection).toContain('data-action="clear-source-logs"');
    expect(logsSection).toContain('data-role="source-log-list"');
    expect(diagnostics).toContain('/diagnostics/source-logs');
    expect(diagnostics).toContain('renderSourceLogs');
    expect(stylesheet).toContain('.source-log-row');
  });

  it('keeps static assets and plugin API requests relative to the Songloft plugin entry path', () => {
    const html = indexHtml();
    const api = apiJs();
    const app = appJs();
    const stylesheet = css();

    expect(html).toContain('href="static/css/style.css"');
    expect(html).toContain('src="static/js/app.js"');
    expect(html).toContain('href="static/icon.png"');
    expect(html).not.toContain('/api/v1/jsplugin/starlight/static/');
    expect(api).toContain("const BASE = 'api'");
    expect(api).not.toContain('/api/v1/jsplugin');
    // Side-rail brand mark uses the plugin icon (not the letter "S").
    expect(app).toContain('class="brand-mark"');
    expect(app).not.toContain('brand-mark" aria-hidden="true">S</div>');
    expect(stylesheet).toContain('url(../icon.png)');
  });

  it('maps Starlight visual tokens to Songloft and Material theme variables', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('--host-surface');
    expect(stylesheet).toContain('--md-sys-color-surface');
    expect(stylesheet).toContain('--md-surface');
    expect(stylesheet).toContain('--host-primary');
    expect(stylesheet).toContain('--md-sys-color-primary');
    expect(stylesheet).toContain('--host-outline');
    expect(stylesheet).toContain('--md-sys-color-outline-variant');
    expect(stylesheet).toContain('--host-on-surface');
    expect(stylesheet).toContain('--md-sys-color-on-surface');
  });

  it('defines layered glass tokens and applies them to shell surfaces and controls', () => {
    const stylesheet = css();

    expect(stylesheet).toContain('--surface-elevated');
    expect(stylesheet).toContain('--surface-control');
    expect(stylesheet).toContain('--hairline');
    expect(stylesheet).toContain('--focus-ring');
    expect(stylesheet).toMatch(/\.side-rail,\s*\.status-strip\s*\{[^}]*background:\s*var\(--surface-elevated\)/s);
    expect(stylesheet).toMatch(/\.bottom-tabs\s*\{[^}]*background:\s*var\(--surface-elevated\)/s);
    expect(stylesheet).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*background:\s*var\(--surface-control\)/s);
    expect(stylesheet).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*border:\s*1px solid var\(--hairline\)/s);
    expect(stylesheet).toMatch(/input:focus,\s*select:focus,\s*textarea:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--focus-ring\)/s);
  });

  it('mounts a 洛雪同步 server panel under Settings with aligned form rows', () => {
    const html = indexHtml();
    const stylesheet = css();
    const syncHtml = settingsSection(html, 'sync');
    const playlistsHtml = panelHtml(html, 'playlists');

    expect(syncHtml).toContain('data-role="lx-sync-panel"');
    expect(syncHtml).toContain('data-role="lx-sync-server-address"');
    expect(syncHtml).toContain('data-role="lx-sync-password"');
    expect(syncHtml).toContain('data-action="lx-sync-copy-address"');
    expect(syncHtml).toContain('data-action="lx-sync-save-config"');
    expect(syncHtml).not.toContain('data-role="lx-sync-payload"');
    expect(syncHtml).not.toContain('data-action="lx-sync-import"');
    expect(syncHtml).not.toContain('data-role="lx-sync-conflict"');
    expect(syncHtml).not.toContain('data-role="lx-sync-import-default"');
    expect(syncHtml).toContain('data-role="lx-sync-status"');
    expect(syncHtml).toContain('data-role="lx-sync-device-list"');
    expect(syncHtml).toContain('洛雪同步');
    expect(syncHtml).toContain('input-with-actions');
    expect(syncHtml).toContain('form-stack');
    expect(playlistsHtml).not.toContain('data-role="lx-sync-panel"');
    expect(stylesheet).toContain('.lx-sync-panel');
    expect(stylesheet).toContain('.page-subnav');
    expect(stylesheet).toContain('prefers-reduced-motion');
    expect(stylesheet).toContain('--radius-lg');
    expect(stylesheet).toContain('backdrop-filter');
  });
});
