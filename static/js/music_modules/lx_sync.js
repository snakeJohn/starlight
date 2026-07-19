import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';

/** Status poll interval while the settings/sync panel is relevant. */
const LX_SYNC_POLL_MS = 5000;

let pollTimer = null;
let pollInFlight = false;
/** When true, skip overwriting the password field so the user can edit safely. */
let passwordFocused = false;

function formatTime(value) {
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    } catch {
        return value;
    }
}

function statusText(config) {
    if (!config) return '就绪';
    if (config.enabled === false) return '已关闭';
    const bits = [];
    if (config.connectedCount > 0) bits.push(`在线 ${config.connectedCount}`);
    if (config.lastSyncAt) bits.push(`上次同步 ${formatTime(config.lastSyncAt)}`);
    else if (config.devices?.length) bits.push(`已授权 ${config.devices.length} 台设备`);
    return bits.length ? bits.join(' · ') : '等待客户端连接';
}

function formEl() {
    return $('[data-role="lx-sync-form"]');
}

function applyConfigToForm(config, { preservePassword = false } = {}) {
    const form = formEl();
    if (!form || !config) return;
    const addressInput = $('[data-role="lx-sync-server-address"]');
    if (addressInput) addressInput.value = config.serverAddress || '';
    const passwordInput = $('[data-role="lx-sync-password"]');
    if (passwordInput && !(preservePassword && passwordFocused)) {
        passwordInput.value = config.password || '';
    }
    if (form.elements.serverName && document.activeElement !== form.elements.serverName) {
        form.elements.serverName.value = config.serverName || 'Starlight';
    }
    if (form.elements.enabled && document.activeElement !== form.elements.enabled) {
        form.elements.enabled.checked = config.enabled !== false;
    }
}

function setStatus(message, config = state.lxSyncConfig) {
    const statusNode = $('[data-role="lx-sync-status"]');
    const messageNode = $('[data-role="lx-sync-message"]');
    const text = message || statusText(config);
    if (statusNode) statusNode.textContent = text;
    if (messageNode && message) messageNode.textContent = message;
    setState({ lxSyncStatus: text });
}

function renderDevices(config) {
    const node = $('[data-role="lx-sync-device-list"]');
    if (!node) return;
    const devices = asArray(config?.devices);
    if (!devices.length) {
        node.innerHTML = '<div class="empty-state">尚未有设备连接。用 LX 桌面或手机连接后将显示在此。</div>';
        return;
    }
    node.innerHTML = devices.map(device => `
        <article class="data-row" data-role="lx-sync-device-item">
            <div class="row-main">
                <strong>${escapeHtml(device.deviceName || '未知设备')}</strong>
                <span>${device.isMobile ? '移动端' : '桌面端'} · 上次 ${formatTime(device.lastConnectDate || '')}</span>
            </div>
        </article>
    `).join('');
}

/**
 * Soft refresh: updates status, devices, connected count without clobbering
 * in-progress password edits.
 */
export async function loadLxSyncConfig({ quiet = false } = {}) {
    const config = await api.get('/lx-sync/config');
    setState({ lxSyncConfig: config });
    applyConfigToForm(config, { preservePassword: quiet });
    renderDevices(config);
    setStatus(statusText(config), config);
    return config;
}

function stopLxSyncPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function startLxSyncPolling() {
    stopLxSyncPolling();
    pollTimer = window.setInterval(async () => {
        if (pollInFlight) return;
        // Only poll when sync panel is visible (settings tab + sync section).
        const settingsTab = document.getElementById('tab-settings');
        const syncPanel = document.querySelector('[data-settings-panel="sync"]');
        if (!settingsTab?.classList.contains('active')) return;
        if (syncPanel?.hidden) return;

        pollInFlight = true;
        try {
            await loadLxSyncConfig({ quiet: true });
        } catch {
            // Quiet poll — avoid toast spam when host is briefly busy.
        } finally {
            pollInFlight = false;
        }
    }, LX_SYNC_POLL_MS);
}

function readOptions() {
    const form = formEl();
    if (!form) {
        return { enabled: true, serverName: 'Starlight', password: '' };
    }
    return {
        enabled: Boolean(form.elements.enabled?.checked),
        serverName: form.elements.serverName?.value?.trim() || 'Starlight',
        password: form.elements.password?.value?.trim() || '',
    };
}

async function saveConfigFromForm(extra = {}) {
    const options = { ...readOptions(), ...extra };
    const config = await api.put('/lx-sync/config', options);
    setState({ lxSyncConfig: config });
    applyConfigToForm(config);
    renderDevices(config);
    setStatus('设置已保存', config);
    toast('洛雪同步设置已保存');
    return config;
}

async function copyText(text, label) {
    if (!text) {
        toast(`没有可复制的${label}`, 'error');
        return;
    }
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        toast(`已复制${label}`);
    } catch {
        toast(`复制${label}失败`, 'error');
    }
}

async function exportSongloftToLx() {
    const result = await api.post('/lx-sync/export-from-songloft', {});
    const total = Number(result?.total || 0);
    const peers = Number(result?.pushed_to_peers || 0);
    const errCount = Array.isArray(result?.errors) ? result.errors.length : 0;
    const msg = errCount
        ? `已导出 ${total} 个歌单到洛雪（${errCount} 个失败）；已推送 ${peers} 台在线设备`
        : `已导出 ${total} 个 Songloft 歌单到洛雪；已推送 ${peers} 台在线设备`;
    toast(msg);
    setStatus(msg);
    await loadLxSyncConfig({ quiet: true });
    return result;
}

export function bindLxSync() {
    const panel = $('[data-role="lx-sync-panel"]');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    const passwordInput = $('[data-role="lx-sync-password"]');
    passwordInput?.addEventListener('focus', () => { passwordFocused = true; });
    passwordInput?.addEventListener('blur', () => { passwordFocused = false; });

    panel.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button || !panel.contains(button)) return;
        const action = button.dataset.action;
        if (!action || !action.startsWith('lx-sync-')) return;
        button.disabled = true;
        try {
            if (action === 'lx-sync-save-config') await saveConfigFromForm();
            if (action === 'lx-sync-refresh') {
                await loadLxSyncConfig();
                toast('状态已刷新');
            }
            if (action === 'lx-sync-copy-address') {
                const address = $('[data-role="lx-sync-server-address"]')?.value || state.lxSyncConfig?.serverAddress || '';
                await copyText(address, '服务器地址');
            }
            if (action === 'lx-sync-copy-password') {
                const password = $('[data-role="lx-sync-password"]')?.value || state.lxSyncConfig?.password || '';
                await copyText(password, '同步密钥');
            }
            if (action === 'lx-sync-export-from-songloft') {
                await exportSongloftToLx();
            }
            if (action === 'lx-sync-regen-password') {
                // Only rotate the key — do not re-submit the old password from the form.
                const options = readOptions();
                const config = await api.put('/lx-sync/config', {
                    enabled: options.enabled,
                    serverName: options.serverName,
                    regeneratePassword: true,
                });
                setState({ lxSyncConfig: config });
                applyConfigToForm(config);
                renderDevices(config);
                setStatus(
                    '密钥已更新。请复制新密钥到洛雪，关闭同步后再重新启用连接（会要求重新输入密钥）。',
                    config,
                );
                toast('已重新生成密钥，请在洛雪中重新填写并连接');
            }
        } catch (error) {
            toast(error.message || '洛雪同步操作失败', 'error');
            setStatus(error.message || '操作失败');
        } finally {
            button.disabled = false;
        }
    });

    startLxSyncPolling();
}
