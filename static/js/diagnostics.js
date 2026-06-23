import { api } from './api.js';
import { $, escapeHtml, setState, state, toast } from './state.js';

function statusLabel(status) {
    return status === 'success' ? '成功' : '失败';
}

function operationLabel(operation) {
    return operation === 'download' ? '下载' : '播放';
}

function stageLabel(stage) {
    return stage === 'native-download' ? 'Songloft 下载' : '音源解析';
}

function timeLabel(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function renderSourceLog(log) {
    const title = [log.title, log.artist].filter(Boolean).join(' - ') || '未知歌曲';
    const source = log.sourceName || log.sourceId || 'Starlight';
    return `
        <article class="source-log-row" data-status="${escapeHtml(log.status)}">
            <div class="source-log-main">
                <div class="source-log-title">
                    <strong>${escapeHtml(title)}</strong>
                    <span>${escapeHtml(operationLabel(log.operation))} / ${escapeHtml(stageLabel(log.stage))}</span>
                </div>
                <p>${escapeHtml(log.message || '')}</p>
            </div>
            <div class="source-log-meta">
                <span>${escapeHtml(statusLabel(log.status))}</span>
                <span>${escapeHtml(source)}</span>
                <span>${escapeHtml(log.platform || '-')} · ${escapeHtml(log.quality || '-')}</span>
                <span>${escapeHtml(String(log.durationMs || 0))} ms</span>
                <span>${escapeHtml(timeLabel(log.time))}</span>
            </div>
        </article>
    `;
}

export function renderSourceLogs() {
    const list = $('[data-role="source-log-list"]');
    const total = $('[data-role="source-log-total"]');
    if (total) total.textContent = `${state.sourceLogTotal || state.sourceLogs.length} 条`;
    if (!list) return;
    list.innerHTML = state.sourceLogs.length
        ? state.sourceLogs.map(renderSourceLog).join('')
        : '<div class="empty-state">暂无播放或下载音源日志。</div>';
}

async function loadSourceLogs() {
    const operation = $('[data-role="diagnostics-operation-filter"]')?.value || 'all';
    const status = $('[data-role="diagnostics-status-filter"]')?.value || 'all';
    const params = new URLSearchParams();
    if (operation !== 'all') params.set('operation', operation);
    if (status !== 'all') params.set('status', status);
    params.set('limit', '300');
    const suffix = params.toString();
    const result = await api.get(`/diagnostics/source-logs${suffix ? `?${suffix}` : ''}`);
    setState({
        sourceLogs: Array.isArray(result?.logs) ? result.logs : [],
        sourceLogTotal: Number(result?.total) || 0,
    });
    renderSourceLogs();
}

async function clearSourceLogs() {
    await api.post('/diagnostics/source-logs/clear');
    setState({ sourceLogs: [], sourceLogTotal: 0 });
    renderSourceLogs();
    toast('日志已清空');
}

export function initDiagnosticsUI() {
    $('[data-action="refresh-source-logs"]')?.addEventListener('click', () => {
        loadSourceLogs().catch(error => toast(error.message || '日志刷新失败', 'error'));
    });
    $('[data-action="clear-source-logs"]')?.addEventListener('click', () => {
        clearSourceLogs().catch(error => toast(error.message || '日志清空失败', 'error'));
    });
    $('[data-role="diagnostics-operation-filter"]')?.addEventListener('change', () => {
        loadSourceLogs().catch(error => toast(error.message || '日志刷新失败', 'error'));
    });
    $('[data-role="diagnostics-status-filter"]')?.addEventListener('change', () => {
        loadSourceLogs().catch(error => toast(error.message || '日志刷新失败', 'error'));
    });
    renderSourceLogs();
}
