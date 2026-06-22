import { initAutomationUI } from './automation.js';
import { initMusicUI } from './music.js';
import { initSpeakerUI } from './speaker.js';
import { $, tabs, escapeHtml, setState, state } from './state.js';

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
        if (!button) return;
        activateTab(button.dataset.tab);
    });
}

function renderStatus() {
    const status = $('#statusStrip');
    if (!status) return;
    const sourceTotal = state.sources.length;
    const sourceEnabled = state.sources.filter(item => item.enabled).length;
    const accountLabel = state.accountId || '未选择账号';
    const deviceLabel = state.deviceName || state.deviceId || '未选择设备';
    const paused = state.playbackState === 'paused';
    const playerTitle = state.playerSongTitle || '暂无播放';
    const playerMeta = state.playerSongMeta || deviceLabel;
    status.innerHTML = `
        <div class="status-items">
            <span class="status-chip" data-tone="${state.accountId ? 'success' : 'warning'}"><strong>账号</strong>${escapeHtml(accountLabel)}</span>
            <span class="status-chip" data-tone="${state.deviceId ? 'success' : 'warning'}"><strong>设备</strong>${escapeHtml(deviceLabel)}</span>
            <span class="status-chip"><strong>音源</strong>${sourceTotal} / ${sourceEnabled} 启用</span>
        </div>
        <div class="status-side">
            <div class="global-player" data-role="global-player">
                <span class="global-player-info">
                    <strong>${escapeHtml(playerTitle)}</strong>
                    <span>${escapeHtml(playerMeta)}</span>
                </span>
                <button class="icon-button compact-icon-button" type="button" data-action="global-player-previous" title="上一首" aria-label="上一首">上一首</button>
                <button class="icon-button compact-icon-button" type="button" data-action="global-player-toggle" title="${paused ? '继续播放' : '暂停播放'}" aria-label="${paused ? '继续播放' : '暂停播放'}">${paused ? '继续播放' : '暂停播放'}</button>
                <button class="icon-button compact-icon-button" type="button" data-action="global-player-next" title="下一首" aria-label="下一首">下一首</button>
            </div>
            <span class="status-pill">${escapeHtml(state.message || '就绪')}</span>
        </div>
    `;
}

function bindStateRenderers() {
    window.addEventListener('starlight:state', event => {
        if (event.detail?.activeTab) renderActiveTab(event.detail.activeTab);
        renderStatus();
    });
}

async function boot() {
    renderNavigation();
    renderActiveTab(state.activeTab);
    bindNavigation();
    bindStateRenderers();
    renderStatus();

    const results = await Promise.allSettled([
        initMusicUI(),
        initSpeakerUI(),
        initAutomationUI(),
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
        setState({ message: failed.reason?.message || '初始化存在错误' });
    } else {
        setState({ message: '已连接' });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    boot().catch(error => {
        setState({ message: error.message || '初始化失败' });
    });
});
