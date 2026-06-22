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
    status.innerHTML = `
        <div class="status-items">
            <span class="status-chip" data-tone="${state.accountId ? 'success' : 'warning'}"><strong>账号</strong>${escapeHtml(accountLabel)}</span>
            <span class="status-chip" data-tone="${state.deviceId ? 'success' : 'warning'}"><strong>设备</strong>${escapeHtml(deviceLabel)}</span>
            <span class="status-chip"><strong>音源</strong>${sourceTotal} / ${sourceEnabled} 启用</span>
        </div>
        <span class="status-pill">${escapeHtml(state.message || '就绪')}</span>
    `;
}

function renderMiniPlayer() {
    const player = $('#miniPlayer');
    if (!player || player.dataset.lockedByPreview === 'true') return;
    player.innerHTML = `
        <div class="now-playing">
            <strong>${state.selectedSong ? escapeHtml(state.selectedSong.title || state.selectedSong.name) : '待播放'}</strong>
            <span>${state.deviceId ? `设备 ${escapeHtml(state.deviceName || state.deviceId)}` : '选择设备后可推送搜索结果到音箱'}</span>
        </div>
        <span class="status-pill">${escapeHtml(state.quality || '320k')}</span>
    `;
}

function bindStateRenderers() {
    window.addEventListener('starlight:state', event => {
        if (event.detail?.activeTab) renderActiveTab(event.detail.activeTab);
        renderStatus();
        renderMiniPlayer();
    });
}

function markPreviewPlayer() {
    const player = $('#miniPlayer');
    if (!player) return;
    const observer = new MutationObserver(() => {
        player.dataset.lockedByPreview = player.querySelector('audio') ? 'true' : 'false';
    });
    observer.observe(player, { childList: true, subtree: true });
}

async function boot() {
    renderNavigation();
    renderActiveTab(state.activeTab);
    bindNavigation();
    bindStateRenderers();
    markPreviewPlayer();
    renderStatus();
    renderMiniPlayer();

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
