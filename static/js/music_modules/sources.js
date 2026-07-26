import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, $$, escapeHtml, setState, state, toast } from '../state.js';
import { bindPagination, clampPage, pageCount, renderPaginationInto } from './pagination.js';
import { renderListScroller } from './renderers.js';
import { readJavaScriptSourceFiles } from '../zip_sources.js';

const sourcePageSize = 10;
const selectedSourceKeys = new Set();

/** Pending online-import dialog state (client-side only until submit). */
let onlineImportState = {
    url: '',
    busy: false,
};

function sourceIdentity(item) {
    return String(item?.name || item?.filename || item?.id || '').trim();
}

/**
 * Normalize a user-entered online source URL for local validation and identity compare.
 * Mirrors backend identity rules: HTTPS only, drop fragment/default 443, keep query, require .js pathname.
 * @returns {{ sourceUrl: string, pathname: string } | null}
 */
export function normalizeOnlineSourceInput(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname) return null;
    if (!parsed.pathname.toLowerCase().endsWith('.js')) return null;
    parsed.hash = '';
    if (parsed.port === '443') parsed.port = '';
    return {
        sourceUrl: parsed.toString(),
        pathname: parsed.pathname,
    };
}

function hasExistingOnlineSource(sourceUrl) {
    const pools = [state.sources, state.downloadSources];
    for (const pool of pools) {
        for (const source of asArray(pool)) {
            if (String(source?.sourceUrl || '').trim() === sourceUrl) {
                return true;
            }
        }
    }
    return false;
}

function onlineImportNodes() {
    return {
        dialog: $('[data-role="online-source-dialog"]'),
        urlLabel: $('[data-role="online-source-url"]'),
        existingHint: $('[data-role="online-source-existing"]'),
        input: $('[data-role="online-source-input"]'),
        openButton: $('[data-action="open-online-source-import"]'),
        modeButtons: $$('[data-action^="online-import-"]'),
    };
}

function setOnlineImportBusy(busy) {
    onlineImportState.busy = busy;
    const { input, openButton, modeButtons } = onlineImportNodes();
    if (input) input.disabled = busy;
    if (openButton) openButton.disabled = busy;
    modeButtons.forEach((button) => {
        button.disabled = busy;
    });
}

function closeOnlineSourceImportDialog() {
    const { dialog } = onlineImportNodes();
    if (dialog) {
        dialog.hidden = true;
        dialog.setAttribute?.('aria-hidden', 'true');
    }
    onlineImportState = { url: '', busy: false };
    setOnlineImportBusy(false);
}

/**
 * Open confirmation dialog after local format checks. Does not download.
 * @returns {Promise<boolean>} true when dialog opened
 */
export async function openOnlineSourceImportDialog(url) {
    const normalized = normalizeOnlineSourceInput(url);
    if (!normalized) {
        toast('请输入有效的 HTTPS .js 音源地址', 'error');
        return false;
    }

    const { dialog, urlLabel, existingHint } = onlineImportNodes();
    if (!dialog) return false;

    onlineImportState = { url: normalized.sourceUrl, busy: false };
    if (urlLabel) urlLabel.textContent = normalized.sourceUrl;
    if (existingHint) {
        const exists = hasExistingOnlineSource(normalized.sourceUrl);
        existingHint.hidden = !exists;
    }
    dialog.hidden = false;
    dialog.setAttribute?.('aria-hidden', 'false');
    setOnlineImportBusy(false);
    return true;
}

function onlineImportSummary(result) {
    if (!result) return '音源已导入，启用状态已应用';
    if (result.operation === 'updated' && result.contentChanged === false) {
        return '音源内容没有变化，启用状态已更新';
    }
    if (result.operation === 'updated') {
        return '音源已更新，启用状态已应用';
    }
    return '音源已导入，启用状态已应用';
}

/**
 * Submit the pending online import with an enable mode.
 * @param {'playback'|'download'|'both'} mode
 */
export async function submitOnlineSourceImport(mode) {
    if (onlineImportState.busy) return;
    const url = onlineImportState.url;
    if (!url) {
        toast('请先输入在线音源地址', 'error');
        return;
    }
    if (mode !== 'playback' && mode !== 'download' && mode !== 'both') {
        toast('无效的启用模式', 'error');
        return;
    }

    setOnlineImportBusy(true);
    try {
        const result = await api.post('/music/sources/import-url', {
            url,
            enable_mode: mode,
        });
        closeOnlineSourceImportDialog();
        await loadSources(1);
        toast(onlineImportSummary(result));
    } catch (error) {
        setOnlineImportBusy(false);
        toast(error.message || '在线导入失败', 'error');
    }
}

export function bindOnlineSourceImport() {
    $('[data-action="open-online-source-import"]')?.addEventListener('click', async () => {
        if (onlineImportState.busy) return;
        const input = $('[data-role="online-source-input"]');
        const value = input?.value || '';
        await openOnlineSourceImportDialog(value);
    });

    $('[data-role="online-source-input"]')?.addEventListener('keydown', async (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (onlineImportState.busy) return;
        await openOnlineSourceImportDialog(event.currentTarget?.value || '');
    });

    $('[data-role="online-source-dialog"]')?.addEventListener('click', async (event) => {
        const button = event.target.closest?.('button[data-action]');
        if (!button) {
            // Click on backdrop (dialog root) closes without submitting.
            if (event.target === event.currentTarget && !onlineImportState.busy) {
                closeOnlineSourceImportDialog();
            }
            return;
        }

        const action = button.dataset.action;
        if (action === 'online-import-cancel') {
            if (!onlineImportState.busy) closeOnlineSourceImportDialog();
            return;
        }
        if (action === 'online-import-playback') {
            await submitOnlineSourceImport('playback');
            return;
        }
        if (action === 'online-import-download') {
            await submitOnlineSourceImport('download');
            return;
        }
        if (action === 'online-import-both') {
            await submitOnlineSourceImport('both');
        }
    });
}

function sourceMergeKey(item) {
    const stableId = String(item?.id || '').trim().toLowerCase();
    if (stableId) return stableId;

    const filename = String(item?.filename || '').trim().toLowerCase();
    if (filename) return filename;

    return sourceIdentity(item).toLowerCase();
}

export function mergeSourceRows(playbackSources = state.sources, downloadSources = state.downloadSources) {
    const rows = new Map();
    for (const source of asArray(playbackSources)) {
        const key = sourceMergeKey(source);
        if (!key) continue;
        rows.set(key, {
            key,
            title: sourceIdentity(source),
            playback: source,
            download: null,
        });
    }
    for (const source of asArray(downloadSources)) {
        const key = sourceMergeKey(source);
        const existing = rows.get(key);
        if (existing) {
            existing.download = source;
            if (!existing.title) existing.title = sourceIdentity(source);
        } else if (key) {
            rows.set(key, {
                key,
                title: sourceIdentity(source),
                playback: null,
                download: source,
            });
        }
    }
    return Array.from(rows.values()).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

function sourceStateLabel(source) {
    if (!source) return '未导入';
    return source.enabled ? '已启用' : '未启用';
}

function sourceImportSummary(label, result) {
    const imported = asArray(result?.imported).length || (result?.id ? 1 : 0);
    const skipped = asArray(result?.skipped).length;
    const failed = asArray(result?.failed).length;
    return `${label}：导入 ${imported}，跳过 ${skipped}，失败 ${failed}`;
}

function renderSourceSelect(row, selectRole) {
    return `
        <label class="source-check" title="选择音源">
            <input type="checkbox" data-role="${selectRole}" data-source-key="${escapeHtml(row.key)}" ${selectedSourceKeys.has(row.key) ? 'checked' : ''}>
        </label>
    `;
}

function renderSourceButton(source, action, enabledLabel, disabledLabel) {
    if (!source) {
        return `<button type="button" disabled>未导入</button>`;
    }
    const nextEnabled = source.enabled ? 'false' : 'true';
    const label = source.enabled ? disabledLabel : enabledLabel;
    return `<button type="button" class="${source.enabled ? 'selected-action' : ''}" data-action="${action}" data-source-id="${escapeHtml(source.id)}" data-enabled="${nextEnabled}">${label}</button>`;
}

function renderMergedSourceRow(row, selectRole) {
    const playbackId = row.playback?.id || '';
    const downloadId = row.download?.id || '';
    const filename = row.playback?.filename || row.download?.filename || '';
    return `
        <article class="source-row merged-source-row">
            ${renderSourceSelect(row, selectRole)}
            <div class="row-main">
                <strong>${escapeHtml(row.title || filename || row.key)}</strong>
                <span>${escapeHtml(filename)}</span>
                <span class="row-meta">播放：${escapeHtml(sourceStateLabel(row.playback))} · 下载：${escapeHtml(sourceStateLabel(row.download))}</span>
            </div>
            <div class="row-actions">
                ${renderSourceButton(row.playback, 'toggle-playback-source', '播放启用', '播放停用')}
                ${renderSourceButton(row.download, 'toggle-download-source', '下载启用', '下载停用')}
                <button type="button" data-action="delete-source" data-playback-id="${escapeHtml(playbackId)}" data-download-id="${escapeHtml(downloadId)}">删除</button>
            </div>
        </article>
    `;
}

function currentSourceRows() {
    return mergeSourceRows(state.sources, state.downloadSources);
}

function renderMergedSources(page = state.sourcePage || 1) {
    const list = $('[data-role="source-list"]');
    if (!list) return;
    const rows = currentSourceRows();
    const currentPage = clampPage(page, pageCount(rows.length, sourcePageSize));
    const start = (currentPage - 1) * sourcePageSize;
    const pageRows = rows.slice(start, start + sourcePageSize);
    setState({ sourcePage: currentPage });

    list.innerHTML = pageRows.length
        ? renderListScroller(pageRows.map(row => renderMergedSourceRow(row, 'source-check')).join(''), 'source-results-scroll', 'list-stack tight')
        : '<div class="empty-state">暂无音源。请导入自己的 LX 音源 js 或 zip 包后手动启用。</div>';
    renderPaginationInto('source-pagination', { scope: 'source', page: currentPage, total: rows.length, pageSize: sourcePageSize });
}

export async function loadSources(page = state.sourcePage || 1) {
    const [playback, download] = await Promise.all([
        api.get('/music/sources'),
        api.get('/download/sources'),
    ]);
    const sources = asArray(playback);
    const downloadSources = asArray(download);
    setState({ sources, downloadSources });

    const sourceCount = $('[data-role="source-count"]');
    if (sourceCount) {
        const playbackEnabled = sources.filter(item => item.enabled).length;
        const downloadEnabled = downloadSources.filter(item => item.enabled).length;
        sourceCount.textContent = `播放 ${sources.length}/${playbackEnabled} · 下载 ${downloadSources.length}/${downloadEnabled}`;
    }

    renderMergedSources(page);
}

export async function loadDownloadSources() {
    const sources = asArray(await api.get('/download/sources'));
    setState({ downloadSources: sources });
    return sources;
}

async function importSource(file) {
    const payload = { files: await readJavaScriptSourceFiles(file) };
    const [playbackResult, downloadResult] = await Promise.all([
        api.post('/music/sources/import', payload),
        api.post('/download/sources/import', payload),
    ]);
    await loadSources(1);
    toast(`${sourceImportSummary('播放音源', playbackResult)}；${sourceImportSummary('下载音源', downloadResult)}`);
}

export function bindSources() {
    const input = $('[data-role="source-file"]');
    if (input) {
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                await importSource(file);
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                input.value = '';
            }
        });
    }

    bindOnlineSourceImport();

    $('[data-action="refresh-sources"]')?.addEventListener('click', () => {
        loadSources().catch(error => toast(error.message, 'error'));
    });

    $('[data-role="source-batch-actions"]')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        const checks = $$('[data-role="source-check"]', $('[data-role="source-list"]') || document);
        if (action === 'select-source-page') {
            checks.forEach(input => {
                input.checked = true;
                selectedSourceKeys.add(input.dataset.sourceKey);
            });
            return;
        }
        if (action === 'clear-source-selection') {
            selectedSourceKeys.clear();
            checks.forEach(input => { input.checked = false; });
            return;
        }

        const operation = {
            'enable-selected-playback-sources': ['playback', true],
            'disable-selected-playback-sources': ['playback', false],
            'enable-selected-download-sources': ['download', true],
            'disable-selected-download-sources': ['download', false],
        }[action];
        if (!operation) return;

        const [kind, enabled] = operation;
        const rows = currentSourceRows().filter(row => selectedSourceKeys.has(row.key));
        const ids = rows
            .map(row => (kind === 'playback' ? row.playback?.id : row.download?.id))
            .filter(Boolean);
        if (!ids.length) {
            toast(`请先选择已导入的${kind === 'playback' ? '播放' : '下载'}音源`, 'error');
            return;
        }

        button.disabled = true;
        try {
            await api.post(kind === 'playback' ? '/music/sources/batch-toggle' : '/download/sources/batch-toggle', { ids, enabled });
            toast(kind === 'playback' ? '播放音源批量状态已更新' : '下载音源批量状态已更新');
            await loadSources();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="source-list"]')?.addEventListener('change', event => {
        const input = event.target.closest?.('[data-role="source-check"]');
        if (!input) return;
        if (input.checked) selectedSourceKeys.add(input.dataset.sourceKey);
        else selectedSourceKeys.delete(input.dataset.sourceKey);
    });

    $('[data-role="source-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        button.disabled = true;
        try {
            if (button.dataset.action === 'toggle-playback-source') {
                const id = button.dataset.sourceId;
                await api.post('/music/sources/toggle', { id, enabled: button.dataset.enabled === 'true' });
                toast('播放音源状态已更新');
            }
            if (button.dataset.action === 'toggle-download-source') {
                const id = button.dataset.sourceId;
                await api.post('/download/sources/toggle', { id, enabled: button.dataset.enabled === 'true' });
                toast('下载音源状态已更新');
            }
            if (button.dataset.action === 'delete-source') {
                const tasks = [];
                if (button.dataset.playbackId) {
                    tasks.push(api.delete(`/music/sources/${encodeURIComponent(button.dataset.playbackId)}`));
                }
                if (button.dataset.downloadId) {
                    tasks.push(api.delete(`/download/sources/${encodeURIComponent(button.dataset.downloadId)}`));
                }
                await Promise.all(tasks);
                toast('音源已删除');
            }
            await loadSources();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    bindPagination('source-pagination', async page => renderMergedSources(page));
}
