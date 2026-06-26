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

function renderNavigation() {
    const rail = $('#sideRail');
    const bottom = $('#bottomTabs');
    if (rail) {
        rail.innerHTML = `
            <div class="brand-lockup">
                <div class="brand-mark">S</div>
                <div>
                    <strong>Starlight</strong>
                    <span>Songloft 音乐助手</span>
                </div>
            </div>
            <nav class="rail-tabs">
                ${tabs.map(tab => `
                    <button type="button" class="rail-tab ${tab.id === state.activeTab ? 'active' : ''}" data-tab="${tab.id}">
                        <strong>${escapeHtml(tab.icon)}</strong>
                        <span>${escapeHtml(tab.label)}</span>
                    </button>
                `).join('')}
            </nav>
            <div class="rail-footer">LX 音源仅用户导入</div>
        `;
    }

    if (bottom) {
        bottom.innerHTML = tabs.map(tab => `
            <button type="button" class="bottom-tab ${tab.id === state.activeTab ? 'active' : ''}" data-tab="${tab.id}">
                <strong>${escapeHtml(tab.icon)}</strong>
                <span>${escapeHtml(tab.label)}</span>
            </button>
        `).join('');
    }
}

function renderActiveTab(tabId) {
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    document.querySelectorAll('[data-tab]').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabId);
    });
}

function activateTab(tabId) {
    const next = tabs.some(tab => tab.id === tabId) ? tabId : 'search';
    if (state.activeTab !== next) {
        setState({ activeTab: next });
    }
    renderActiveTab(next);
}

function bindNavigation() {
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-tab]');
        if (button) {
            activateTab(button.dataset.tab);
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
            activateTab('logs');
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
