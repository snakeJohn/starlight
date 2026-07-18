import { initAutomationUI } from './automation.js';
import { initDiagnosticsUI } from './diagnostics.js';
import { initMusicUI } from './music.js';
import { initSpeakerUI } from './speaker.js';
import { $, tabs, escapeHtml, setState, state } from './state.js';

const initDomains = [
    { id: 'music', label: '音乐', init: initMusicUI },
    { id: 'speaker', label: '音箱', init: initSpeakerUI },
    { id: 'automation', label: '自动化', init: initAutomationUI },
    { id: 'diagnostics', label: '诊断', init: initDiagnosticsUI },
];

let appBindingsBound = false;

function initialInitStatus() {
    return Object.fromEntries(initDomains.map(domain => [domain.id, { status: 'idle', message: '未开始' }]));
}

function failedDomains(initStatus = state.initStatus || {}) {
    return initDomains.filter(domain => initStatus?.[domain.id]?.status === 'failed');
}

function initSummaryMessage(initStatus) {
    const failed = failedDomains(initStatus);
    if (failed.length) {
        return `${failed.map(domain => domain.label).join('、')} 初始化失败`;
    }
    const pending = initDomains.some(domain => initStatus?.[domain.id]?.status === 'running' || initStatus?.[domain.id]?.status === 'idle');
    return pending ? '初始化中' : '已连接';
}

const navIcons = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16.5 16.5L21 21"/></svg>',
    discover: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>',
    playlists: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3.5" width="10" height="17" rx="3"/><circle cx="12" cy="15" r="2.5"/><circle cx="12" cy="8" r="1"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6"/></svg>',
};

function tabIconMarkup(tab) {
    const svg = navIcons[tab.id];
    if (svg) {
        return `<span class="nav-icon" aria-hidden="true">${svg}</span>`;
    }
    return `<strong class="nav-icon">${escapeHtml(tab.icon)}</strong>`;
}

function renderNavigation() {
    const rail = $('#sideRail');
    const bottom = $('#bottomTabs');
    if (rail) {
        rail.innerHTML = `
            <div class="brand-lockup">
                <div class="brand-mark" aria-hidden="true" title="Starlight"></div>
                <div>
                    <strong>Starlight</strong>
                    <span>Songloft 音乐助手</span>
                </div>
            </div>
            <nav class="rail-tabs" aria-label="主导航">
                ${tabs.map(tab => `
                    <button type="button" class="rail-tab ${tab.id === state.activeTab ? 'active' : ''}" data-tab="${tab.id}">
                        ${tabIconMarkup(tab)}
                        <span>${escapeHtml(tab.label)}</span>
                    </button>
                `).join('')}
            </nav>
            <div class="rail-footer">音源与同步在「设置」</div>
        `;
    }

    if (bottom) {
        bottom.innerHTML = tabs.map(tab => `
            <button type="button" class="bottom-tab ${tab.id === state.activeTab ? 'active' : ''}" data-tab="${tab.id}">
                ${tabIconMarkup(tab)}
                <span>${escapeHtml(tab.label)}</span>
            </button>
        `).join('');
    }
}

function showSubnavPanel(rootSelector, panelAttr, activeKey) {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    root.querySelectorAll(`[${panelAttr}]`).forEach(panel => {
        const key = panel.getAttribute(panelAttr);
        const on = key === activeKey;
        panel.hidden = !on;
        panel.classList.toggle('active', on);
    });
}

function setDiscoverSection(sectionId) {
    const next = sectionId === 'rankings' ? 'rankings' : 'songlists';
    document.querySelectorAll('[data-discover-section]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.discoverSection === next);
    });
    showSubnavPanel('#tab-discover', 'data-discover-panel', next);
}

function setSettingsSection(sectionId) {
    const allowed = new Set(['sync', 'sources', 'automation', 'ai', 'logs']);
    const next = allowed.has(sectionId) ? sectionId : 'sync';
    document.querySelectorAll('[data-settings-section]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.settingsSection === next);
    });
    showSubnavPanel('#tab-settings', 'data-settings-panel', next);
}

function renderActiveTab(tabId) {
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    document.querySelectorAll('[data-tab]').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabId);
    });
}

function activateTab(tabId, options = {}) {
    const next = tabs.some(tab => tab.id === tabId) ? tabId : 'search';
    if (state.activeTab !== next) {
        setState({ activeTab: next });
    }
    renderActiveTab(next);
    if (next === 'discover' && options.discoverSection) {
        setDiscoverSection(options.discoverSection);
    }
    if (next === 'settings' && options.settingsSection) {
        setSettingsSection(options.settingsSection);
    }
}

function bindNavigation() {
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-tab]');
        if (button) {
            activateTab(button.dataset.tab);
            return;
        }

        const discoverBtn = event.target.closest('[data-discover-section]');
        if (discoverBtn) {
            setDiscoverSection(discoverBtn.dataset.discoverSection);
            return;
        }

        const settingsBtn = event.target.closest('[data-settings-section]');
        if (settingsBtn) {
            setSettingsSection(settingsBtn.dataset.settingsSection);
            return;
        }

        const action = event.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'retry-init') {
            runInitializers('failed').catch(error => {
                setState({ message: error.message || '重试失败' });
            });
            return;
        }
        if (action.dataset.action === 'open-logs') {
            activateTab('settings', { settingsSection: 'logs' });
        }
    });
}

function renderStatus() {
    const status = $('#statusStrip');
    if (!status) return;
    const sourceTotal = state.sources.length;
    const sourceEnabled = state.sources.filter(item => item.enabled).length;
    const accountLabel = state.accountId || '未选择账号';
    const deviceLabel = state.deviceName || state.deviceId || '未选择设备';
    const initStatus = Object.keys(state.initStatus || {}).length ? state.initStatus : initialInitStatus();
    const failed = failedDomains(initStatus);
    status.innerHTML = `
        <div class="status-items">
            <span class="status-chip" data-tone="${state.accountId ? 'success' : 'warning'}"><strong>账号</strong>${escapeHtml(accountLabel)}</span>
            <span class="status-chip" data-tone="${state.deviceId ? 'success' : 'warning'}"><strong>设备</strong>${escapeHtml(deviceLabel)}</span>
            <span class="status-chip"><strong>音源</strong>${sourceTotal} / ${sourceEnabled} 启用</span>
        </div>
        <div class="status-side">
            <span class="status-pill">${escapeHtml(state.message || '就绪')}</span>
            ${failed.length ? '<button class="ghost-button compact-icon-button" type="button" data-action="retry-init">重试</button>' : ''}
            ${initStatus.diagnostics?.status === 'failed' ? '<button class="ghost-button compact-icon-button" type="button" data-action="open-logs">日志</button>' : ''}
        </div>
    `;
}

function bindStateRenderers() {
    window.addEventListener('starlight:state', event => {
        if (event.detail?.activeTab) renderActiveTab(event.detail.activeTab);
        renderStatus();
    });
}

async function runInitializers(mode = 'all') {
    const previous = Object.keys(state.initStatus || {}).length ? state.initStatus : initialInitStatus();
    const selected = mode === 'failed' ? failedDomains(previous) : initDomains;
    if (!selected.length) {
        setState({ initStatus: previous, message: initSummaryMessage(previous) });
        return previous;
    }

    const running = { ...previous };
    for (const domain of selected) {
        running[domain.id] = { status: 'running', message: '初始化中' };
    }
    setState({ initStatus: running, message: mode === 'failed' ? '正在重试失败模块' : '初始化中' });

    const results = await Promise.allSettled(selected.map(domain => domain.init()));
    const next = { ...running };
    results.forEach((result, index) => {
        const domain = selected[index];
        if (result.status === 'fulfilled') {
            next[domain.id] = { status: 'success', message: '已连接' };
        } else {
            next[domain.id] = {
                status: 'failed',
                message: result.reason?.message || '初始化失败',
            };
        }
    });
    setState({
        initStatus: next,
        message: initSummaryMessage(next),
    });
    return next;
}

async function boot() {
    renderNavigation();
    renderActiveTab(state.activeTab);
    setDiscoverSection('songlists');
    setSettingsSection('sync');
    if (!appBindingsBound) {
        bindNavigation();
        bindStateRenderers();
        appBindingsBound = true;
    }
    if (!Object.keys(state.initStatus || {}).length) {
        setState({ initStatus: initialInitStatus() });
    }
    renderStatus();
    await runInitializers('all');
}

document.addEventListener('DOMContentLoaded', () => {
    boot().catch(error => {
        setState({ message: error.message || '初始化失败' });
    });
});
