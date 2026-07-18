import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';

let loadCustomPlaylists = async () => {};

export function setLxSyncDependencies(dependencies = {}) {
    if (typeof dependencies.loadCustomPlaylists === 'function') {
        loadCustomPlaylists = dependencies.loadCustomPlaylists;
    }
}

function statusText(config) {
    if (!config) return '未连接';
    if (config.connected) {
        const last = config.lastSyncAt ? ` · 上次同步 ${formatTime(config.lastSyncAt)}` : '';
        return `已连接 ${config.username || ''}${last}`.trim();
    }
    return config.username || config.baseUrl ? '已保存，未连接' : '未连接';
}

function formatTime(value) {
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    } catch {
        return value;
    }
}

function formEl() {
    return $('[data-role="lx-sync-form"]');
}

function applyConfigToForm(config) {
    const form = formEl();
    if (!form || !config) return;
    if (form.elements.baseUrl) form.elements.baseUrl.value = config.baseUrl || '';
    if (form.elements.username) form.elements.username.value = config.username || '';
    if (form.elements.conflict) form.elements.conflict.value = config.conflict === 'merge' ? 'merge' : 'replace';
    if (form.elements.importDefaultList) {
        form.elements.importDefaultList.checked = config.importDefaultList !== false;
    }
    // Never refill password.
    if (form.elements.password) form.elements.password.value = '';
}

function setStatus(message, config = state.lxSyncConfig) {
    const statusNode = $('[data-role="lx-sync-status"]');
    const messageNode = $('[data-role="lx-sync-message"]');
    const text = message || statusText(config);
    if (statusNode) statusNode.textContent = text;
    if (messageNode && message) messageNode.textContent = message;
    setState({ lxSyncStatus: text });
}

function renderPreview(preview) {
    const node = $('[data-role="lx-sync-preview-list"]') || $('[data-role="lx-sync-preview"]');
    if (!node) return;
    const playlists = asArray(preview?.playlists);
    if (!playlists.length) {
        node.innerHTML = preview
            ? '<div class="empty-state">服务器上没有可导入的歌单</div>'
            : '';
        return;
    }
    node.innerHTML = playlists.map(playlist => `
        <article class="data-row" data-role="lx-sync-preview-item" data-playlist-id="${escapeHtml(playlist.id || '')}">
            <div class="row-main">
                <strong>${escapeHtml(playlist.name || '未命名')}</strong>
                <span>${Number(playlist.songCount) || 0} 首 · ${escapeHtml(playlist.kind || 'user')}</span>
            </div>
        </article>
    `).join('');
}

export async function loadLxSyncConfig() {
    const config = await api.get('/lx-sync/config');
    setState({ lxSyncConfig: config });
    applyConfigToForm(config);
    setStatus(statusText(config), config);
    return config;
}

function readFormValues() {
    const form = formEl();
    if (!form) {
        return { baseUrl: '', username: '', password: '', conflict: 'replace', importDefaultList: true };
    }
    return {
        baseUrl: form.elements.baseUrl?.value?.trim() || '',
        username: form.elements.username?.value?.trim() || '',
        password: form.elements.password?.value || '',
        conflict: form.elements.conflict?.value === 'merge' ? 'merge' : 'replace',
        importDefaultList: Boolean(form.elements.importDefaultList?.checked),
    };
}

async function saveConfigFromForm() {
    const values = readFormValues();
    const config = await api.put('/lx-sync/config', {
        baseUrl: values.baseUrl,
        username: values.username,
        conflict: values.conflict,
        importDefaultList: values.importDefaultList,
    });
    setState({ lxSyncConfig: config });
    applyConfigToForm(config);
    setStatus('设置已保存', config);
    toast('洛雪同步设置已保存');
    return config;
}

async function connectFromForm() {
    const values = readFormValues();
    if (!values.baseUrl || !values.username || !values.password) {
        throw new Error('请填写服务器地址、用户名和密码');
    }
    // Persist non-secret options first
    await api.put('/lx-sync/config', {
        baseUrl: values.baseUrl,
        username: values.username,
        conflict: values.conflict,
        importDefaultList: values.importDefaultList,
    }).catch(() => {});

    const config = await api.post('/lx-sync/connect', {
        baseUrl: values.baseUrl,
        username: values.username,
        password: values.password,
    });
    setState({ lxSyncConfig: config });
    applyConfigToForm(config);
    setStatus(statusText(config), config);
    toast('洛雪同步已连接');
    return config;
}

async function disconnectLxSync() {
    const config = await api.post('/lx-sync/disconnect');
    setState({ lxSyncConfig: config, lxSyncPreview: null });
    applyConfigToForm(config);
    renderPreview(null);
    setStatus(statusText(config), config);
    toast('已断开洛雪同步');
    return config;
}

async function previewLxSync() {
    const preview = await api.get('/lx-sync/preview');
    setState({ lxSyncPreview: preview });
    renderPreview(preview);
    setStatus(`预览 ${preview?.playlists?.length || 0} 个歌单，共 ${preview?.totalSongs || 0} 首`);
    toast(`预览完成：${preview?.playlists?.length || 0} 个歌单`);
    return preview;
}

async function pullLxSync() {
    const result = await api.post('/lx-sync/pull');
    setState({
        lxSyncConfig: {
            ...(state.lxSyncConfig || {}),
            lastSyncAt: result?.lastSyncAt,
            connected: true,
        },
    });
    setStatus(
        `同步完成：新建 ${result?.playlistsCreated || 0}，更新 ${result?.playlistsUpdated || 0}，歌曲 ${result?.songsImported || 0}`,
    );
    toast(`已同步 ${(result?.playlistsCreated || 0) + (result?.playlistsUpdated || 0)} 个歌单`);
    await loadCustomPlaylists().catch(() => {});
    await loadLxSyncConfig().catch(() => {});
    return result;
}

export function bindLxSync() {
    const panel = $('[data-role="lx-sync-panel"]');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    panel.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button || !panel.contains(button)) return;
        const action = button.dataset.action;
        if (!action || !action.startsWith('lx-sync-')) return;
        button.disabled = true;
        try {
            if (action === 'lx-sync-connect') await connectFromForm();
            if (action === 'lx-sync-disconnect') await disconnectLxSync();
            if (action === 'lx-sync-preview') await previewLxSync();
            if (action === 'lx-sync-pull') await pullLxSync();
            if (action === 'lx-sync-save-config') await saveConfigFromForm();
        } catch (error) {
            toast(error.message || '洛雪同步操作失败', 'error');
            setStatus(error.message || '操作失败');
        } finally {
            button.disabled = false;
        }
    });
}
