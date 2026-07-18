import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';

let loadCustomPlaylists = async () => {};

export function setLxSyncDependencies(dependencies = {}) {
    if (typeof dependencies.loadCustomPlaylists === 'function') {
        loadCustomPlaylists = dependencies.loadCustomPlaylists;
    }
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

function statusText(config) {
    if (!config) return '就绪';
    const bits = [];
    if (config.lastImportAt) bits.push(`上次导入 ${formatTime(config.lastImportAt)}`);
    if (config.lastExportAt) bits.push(`上次导出 ${formatTime(config.lastExportAt)}`);
    return bits.length ? bits.join(' · ') : '就绪';
}

function formEl() {
    return $('[data-role="lx-sync-form"]');
}

function payloadEl() {
    return $('[data-role="lx-sync-payload"]');
}

function applyConfigToForm(config) {
    const form = formEl();
    if (!form || !config) return;
    if (form.elements.conflict) form.elements.conflict.value = config.conflict === 'merge' ? 'merge' : 'replace';
    if (form.elements.importDefaultList) {
        form.elements.importDefaultList.checked = config.importDefaultList !== false;
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

function renderPreview(preview) {
    const node = $('[data-role="lx-sync-preview-list"]');
    if (!node) return;
    const playlists = asArray(preview?.playlists);
    if (!playlists.length) {
        node.innerHTML = preview
            ? '<div class="empty-state">JSON 中没有可导入的歌单</div>'
            : '<div class="empty-state">粘贴 JSON 或选择文件后可预览歌单摘要。</div>';
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

function readOptions() {
    const form = formEl();
    if (!form) {
        return { conflict: 'replace', importDefaultList: true };
    }
    return {
        conflict: form.elements.conflict?.value === 'merge' ? 'merge' : 'replace',
        importDefaultList: Boolean(form.elements.importDefaultList?.checked),
    };
}

async function readPayloadText() {
    const textarea = payloadEl();
    const text = textarea?.value?.trim() || '';
    if (text) return text;

    const fileInput = $('[data-role="lx-sync-file"]');
    const file = fileInput?.files?.[0];
    if (file) {
        const content = await file.text();
        if (textarea) textarea.value = content;
        return content.trim();
    }
    throw new Error('请粘贴洛雪列表 JSON，或选择 .json 文件');
}

async function saveConfigFromForm() {
    const options = readOptions();
    const config = await api.put('/lx-sync/config', options);
    setState({ lxSyncConfig: config });
    applyConfigToForm(config);
    setStatus('设置已保存', config);
    toast('洛雪同步设置已保存');
    return config;
}

async function previewLxSync() {
    const options = readOptions();
    await api.put('/lx-sync/config', options).catch(() => {});
    const payload = await readPayloadText();
    const preview = await api.post('/lx-sync/preview', {
        listData: payload,
        ...options,
    });
    setState({ lxSyncPreview: preview });
    renderPreview(preview);
    setStatus(`预览 ${preview?.playlists?.length || 0} 个歌单，共 ${preview?.totalSongs || 0} 首`);
    toast(`预览完成：${preview?.playlists?.length || 0} 个歌单`);
    return preview;
}

async function importLxSync() {
    const options = readOptions();
    await api.put('/lx-sync/config', options).catch(() => {});
    const payload = await readPayloadText();
    const result = await api.post('/lx-sync/import', {
        listData: payload,
        ...options,
    });
    setState({
        lxSyncConfig: {
            ...(state.lxSyncConfig || {}),
            lastImportAt: result?.lastImportAt,
            conflict: options.conflict,
            importDefaultList: options.importDefaultList,
        },
    });
    setStatus(
        `导入完成：新建 ${result?.playlistsCreated || 0}，更新 ${result?.playlistsUpdated || 0}，歌曲 ${result?.songsImported || 0}`,
    );
    toast(`已导入 ${(result?.playlistsCreated || 0) + (result?.playlistsUpdated || 0)} 个歌单`);
    await loadCustomPlaylists().catch(() => {});
    await loadLxSyncConfig().catch(() => {});
    return result;
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function exportLxSync() {
    const result = await api.post('/lx-sync/export', {});
    const listData = result?.listData || result;
    downloadJson(`lx-list-${new Date().toISOString().slice(0, 10)}.json`, listData);
    const textarea = payloadEl();
    if (textarea) {
        textarea.value = JSON.stringify(listData, null, 2);
    }
    setState({
        lxSyncConfig: {
            ...(state.lxSyncConfig || {}),
            lastExportAt: result?.lastExportAt,
        },
    });
    setStatus(`导出完成 · ${formatTime(result?.lastExportAt || new Date().toISOString())}`);
    toast('已导出洛雪列表 JSON');
    await loadLxSyncConfig().catch(() => {});
    return result;
}

export function bindLxSync() {
    const panel = $('[data-role="lx-sync-panel"]');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    const fileInput = $('[data-role="lx-sync-file"]');
    if (fileInput && fileInput.dataset.bound !== '1') {
        fileInput.dataset.bound = '1';
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const textarea = payloadEl();
                if (textarea) textarea.value = text;
                toast(`已载入文件：${file.name}`);
            } catch (error) {
                toast(error.message || '读取文件失败', 'error');
            }
        });
    }

    panel.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button || !panel.contains(button)) return;
        const action = button.dataset.action;
        if (!action || !action.startsWith('lx-sync-')) return;
        button.disabled = true;
        try {
            if (action === 'lx-sync-preview') await previewLxSync();
            if (action === 'lx-sync-import' || action === 'lx-sync-pull') await importLxSync();
            if (action === 'lx-sync-export') await exportLxSync();
            if (action === 'lx-sync-save-config') await saveConfigFromForm();
        } catch (error) {
            toast(error.message || '洛雪同步操作失败', 'error');
            setStatus(error.message || '操作失败');
        } finally {
            button.disabled = false;
        }
    });
}
