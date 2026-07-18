/**
 * One-shot HTML restructure for Starlight UI refactor.
 * New tabs: search | discover | playlists | speaker | settings
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'static/index.html';
const html = readFileSync(path, 'utf8');

function extractPanel(id) {
  const marker = `id="tab-${id}"`;
  const idPos = html.indexOf(marker);
  if (idPos < 0) throw new Error(`panel not found: ${id}`);
  const start = html.lastIndexOf('<section', idPos);
  const next = html.indexOf('<section class="tab-panel', idPos + 10);
  const mainEnd = html.indexOf('</main>', idPos);
  const end = next > idPos && next < mainEnd ? next : mainEnd;
  return html.slice(start, end).trim();
}

function stripOuterSection(panelHtml) {
  const openEnd = panelHtml.indexOf('>');
  const body = panelHtml.slice(openEnd + 1);
  const lastClose = body.lastIndexOf('</section>');
  return body.slice(0, lastClose).trim();
}

function stripPanelHeading(body) {
  return body.replace(/<div class="panel-heading">[\s\S]*?<\/div>\s*/, '').trim();
}

function sliceBetween(source, startNeedle, endNeedle) {
  const s = source.indexOf(startNeedle);
  if (s < 0) throw new Error(`start not found: ${startNeedle.slice(0, 80)}`);
  if (!endNeedle) return source.slice(s).trim();
  const e = source.indexOf(endNeedle, s + startNeedle.length);
  if (e < 0) throw new Error(`end not found: ${endNeedle.slice(0, 80)}`);
  return source.slice(s, e).trim();
}

const searchBody = stripPanelHeading(stripOuterSection(extractPanel('search')));
const speakerBody = stripPanelHeading(stripOuterSection(extractPanel('speaker')));
const songlistsBody = stripPanelHeading(stripOuterSection(extractPanel('songlists')));
const rankingsBody = stripPanelHeading(stripOuterSection(extractPanel('rankings')));
const sourcesBody = stripPanelHeading(stripOuterSection(extractPanel('sources')));
const logsBody = stripPanelHeading(stripOuterSection(extractPanel('logs')));
const automationBody = stripPanelHeading(stripOuterSection(extractPanel('automation')));

const myPlaylistsSection = sliceBetween(
  songlistsBody,
  '<section class="surface-section">',
  '<section class="surface-section lx-sync-panel"',
);

const importSection = sliceBetween(
  songlistsBody,
  '<h2>导入歌单</h2>',
  '<section class="songlist-discovery">',
);
// wrap import back into section
const importFull = songlistsBody.slice(
  songlistsBody.lastIndexOf('<section class="surface-section">', songlistsBody.indexOf('<h2>导入歌单</h2>')),
  songlistsBody.indexOf('<section class="songlist-discovery">'),
).trim();

const discoverySearchSection = sliceBetween(songlistsBody, '<section class="songlist-discovery">');

// automation: extract voice, schedule, drop outer two-column wrappers
const twoColStart = automationBody.indexOf('<div class="two-column automation-layout">');
const aiStart = automationBody.indexOf('<section class="surface-section ai-config-panel"');
const twoColInner = automationBody.slice(
  twoColStart + '<div class="two-column automation-layout">'.length,
  aiStart,
).trim();
// remove trailing </div> that closed two-column
const automationStack = twoColInner.replace(/<\/div>\s*$/, '').trim();

const headEnd = html.indexOf('<header class="status-strip" id="statusStrip"></header>');
const head = html.slice(0, headEnd + '<header class="status-strip" id="statusStrip"></header>'.length);
const tail = html.slice(html.indexOf('</main>'));

const lxSyncFixed = `<section class="surface-section lx-sync-panel" data-role="lx-sync-panel">
                    <div class="section-bar">
                        <div>
                            <h2>洛雪同步</h2>
                            <span class="section-caption">Starlight 作为同步服务器，与本机/局域网 LX 桌面端、移动端互通（无需独立 lxserver）。</span>
                        </div>
                        <span class="status-pill" data-role="lx-sync-status">就绪</span>
                    </div>
                    <form class="lx-sync-form form-stack" data-role="lx-sync-form">
                        <label class="field-row">
                            <span class="field-label">服务器地址</span>
                            <div class="input-with-actions">
                                <input type="text" name="serverAddress" data-role="lx-sync-server-address" readonly placeholder="加载中…">
                                <button class="ghost-button" type="button" data-action="lx-sync-copy-address">复制</button>
                            </div>
                        </label>
                        <label class="field-row">
                            <span class="field-label">同步密钥</span>
                            <div class="input-with-actions">
                                <input type="text" name="password" data-role="lx-sync-password" autocomplete="off" spellcheck="false">
                                <button class="ghost-button" type="button" data-action="lx-sync-copy-password">复制</button>
                                <button class="ghost-button" type="button" data-action="lx-sync-regen-password">重新生成</button>
                            </div>
                        </label>
                        <div class="form-grid-2">
                            <label class="field-row">
                                <span class="field-label">服务名称</span>
                                <input type="text" name="serverName" data-role="lx-sync-server-name" placeholder="Starlight">
                            </label>
                            <label class="checkbox-field field-row-inline">
                                <input type="checkbox" name="enabled" data-role="lx-sync-enabled" checked>
                                <span>启用同步服务</span>
                            </label>
                        </div>
                        <div class="lx-sync-actions row-actions form-actions">
                            <button class="primary-button" type="button" data-action="lx-sync-save-config">保存设置</button>
                            <button class="ghost-button" type="button" data-action="lx-sync-refresh">刷新状态</button>
                        </div>
                    </form>
                    <p class="field-help" data-role="lx-sync-message">在 LX Music 桌面/手机 → 设置 → 同步服务，填入上方地址与密钥即可连接。手机需与 Songloft 同一局域网。</p>
                    <div class="list-stack tight" data-role="lx-sync-device-list">
                        <div class="empty-state">尚未有设备连接。</div>
                    </div>
                </section>`;

const aiFixed = `<section class="surface-section ai-config-panel" data-role="ai-config-panel">
                    <div class="section-bar">
                        <div>
                            <h2>AI 口令分析</h2>
                            <span class="section-caption">启用后优先用 LLM 解析口语指令（高置信度执行，否则回退规则口令）。需先开启语音口令。</span>
                        </div>
                        <span data-role="ai-config-status">未加载</span>
                    </div>
                    <form class="settings-form ai-config-form form-stack" data-role="ai-config-form">
                        <label class="toggle-line" data-role="ai-enabled-toggle">
                            <input name="enabled" type="checkbox" data-role="ai-enabled">
                            <span>启用 AI 分析</span>
                        </label>
                        <p class="field-help" data-role="ai-dependency-hint" hidden>请先在音箱页开启「对话监听」与「语音口令」。</p>
                        <div class="form-stack" data-role="ai-config-fields">
                            <label class="field-row">
                                <span class="field-label">API 地址</span>
                                <input name="api_url" data-role="ai-api-url" type="url" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" autocomplete="off">
                                <small class="field-help">OpenAI 兼容的 base_url（含 /v1）。</small>
                            </label>
                            <label class="field-row">
                                <span class="field-label">API 密钥</span>
                                <input name="api_key" data-role="ai-api-key" type="password" placeholder="API Key" autocomplete="off">
                            </label>
                            <div class="form-grid-2">
                                <label class="field-row">
                                    <span class="field-label">模型</span>
                                    <input name="model" data-role="ai-model" type="text" placeholder="qwen-flash" autocomplete="off">
                                </label>
                                <label class="field-row">
                                    <span class="field-label">超时（秒）</span>
                                    <input name="timeout" data-role="ai-timeout" type="number" min="1" max="30" step="1" value="6">
                                </label>
                            </div>
                        </div>
                        <div class="inline-actions form-actions">
                            <button class="primary-button" type="submit">保存 AI 配置</button>
                            <button class="ghost-button" type="button" data-action="load-ai-config">重新加载</button>
                            <span data-role="ai-config-state">未加载</span>
                        </div>
                    </form>
                    <div class="ai-test-block" data-role="ai-test-block">
                        <div class="section-bar compact-bar">
                            <h2>分析测试</h2>
                        </div>
                        <p class="field-help">仅调用模型解析，不实际控制音箱。需已填写 API 地址与密钥。</p>
                        <div class="input-with-actions">
                            <input type="text" data-role="ai-test-input" placeholder="例如：播放周杰伦的晴天" autocomplete="off" aria-label="测试语句">
                            <button class="ghost-button" type="button" data-action="ai-test">分析</button>
                        </div>
                        <pre class="ai-test-result" data-role="ai-test-result" hidden></pre>
                    </div>
                </section>`;

const mainContent = `            <section class="tab-panel active" id="tab-search">
                <div class="panel-heading">
                    <div>
                        <p class="eyebrow">Music</p>
                        <h1>搜索</h1>
                    </div>
                    <div class="status-pill" data-role="source-count">0 个音源</div>
                </div>
                ${searchBody}
            </section>

            <section class="tab-panel" id="tab-discover">
                <div class="panel-heading">
                    <div>
                        <p class="eyebrow">Browse</p>
                        <h1>发现</h1>
                    </div>
                </div>
                <nav class="page-subnav" data-role="discover-subnav" aria-label="发现子导航">
                    <button type="button" class="page-subnav-item active" data-discover-section="songlists">歌单广场</button>
                    <button type="button" class="page-subnav-item" data-discover-section="rankings">排行榜</button>
                </nav>
                <div class="discover-section active" data-discover-panel="songlists">
                    ${discoverySearchSection}
                </div>
                <div class="discover-section" data-discover-panel="rankings" hidden>
                    ${rankingsBody}
                </div>
            </section>

            <section class="tab-panel" id="tab-playlists">
                <div class="panel-heading">
                    <div>
                        <p class="eyebrow">Library</p>
                        <h1>歌单</h1>
                    </div>
                    <button class="ghost-button" type="button" data-action="refresh-custom-playlists">刷新</button>
                </div>
                ${myPlaylistsSection}
                ${importFull}
            </section>

            <section class="tab-panel" id="tab-speaker">
                <div class="panel-heading">
                    <div>
                        <p class="eyebrow">MIoT</p>
                        <h1>音箱</h1>
                    </div>
                    <button class="ghost-button" type="button" data-action="refresh-speaker">刷新</button>
                </div>
                ${speakerBody}
            </section>

            <section class="tab-panel" id="tab-settings">
                <div class="panel-heading">
                    <div>
                        <p class="eyebrow">System</p>
                        <h1>设置</h1>
                    </div>
                </div>
                <nav class="page-subnav" data-role="settings-subnav" aria-label="设置子导航">
                    <button type="button" class="page-subnav-item active" data-settings-section="sync">洛雪同步</button>
                    <button type="button" class="page-subnav-item" data-settings-section="sources">音源下载</button>
                    <button type="button" class="page-subnav-item" data-settings-section="automation">自动化</button>
                    <button type="button" class="page-subnav-item" data-settings-section="ai">AI 分析</button>
                    <button type="button" class="page-subnav-item" data-settings-section="logs">诊断日志</button>
                </nav>
                <div class="settings-section active" data-settings-panel="sync">
                    ${lxSyncFixed}
                </div>
                <div class="settings-section" data-settings-panel="sources" hidden>
                    ${sourcesBody}
                </div>
                <div class="settings-section" data-settings-panel="automation" hidden>
                    <div class="settings-stack two-column automation-layout">
                        ${automationStack}
                    </div>
                </div>
                <div class="settings-section" data-settings-panel="ai" hidden>
                    ${aiFixed}
                </div>
                <div class="settings-section" data-settings-panel="logs" hidden>
                    ${logsBody}
                </div>
            </section>
`;

const out = `${head}

${mainContent}

        ${tail}`;

writeFileSync(path, out);
console.log('OK', {
  myPlaylists: myPlaylistsSection.includes('我的歌单'),
  import: importFull.includes('导入歌单'),
  discovery: discoverySearchSection.includes('搜索歌单'),
  rankings: rankingsBody.includes('ranking-platform'),
  sources: sourcesBody.includes('source-list'),
  logs: logsBody.includes('source-log-list'),
  voice: automationStack.includes('语音口令'),
  schedule: automationStack.includes('定时任务'),
  lx: lxSyncFixed.includes('lx-sync-password'),
  ai: aiFixed.includes('ai-api-url'),
});
