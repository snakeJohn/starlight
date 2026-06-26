import { api } from '../api.js';
import { $, toast } from '../state.js';

export function renderIndexing(status) {
    $('[data-role="indexing-state"]').textContent = status?.is_refreshing ? '刷新中' : status?.ready ? '已就绪' : '未就绪';
    $('[data-role="index-playlists"]').textContent = String(status?.playlist_count ?? 0);
    $('[data-role="index-songs"]').textContent = String(status?.song_count ?? 0);
    $('[data-role="index-updated"]').textContent = status?.last_refresh_time ? new Date(status.last_refresh_time).toLocaleString() : '-';
}

export async function loadIndexing() {
    renderIndexing(await api.get('/miot/indexing/status'));
}

export async function refreshIndexing() {
    await api.post('/miot/indexing/refresh', {});
    toast('索引刷新已开始');
    await loadIndexing();
}

export function bindIndexingControls() {
    $('[data-action="refresh-index"]')?.addEventListener('click', () => refreshIndexing().catch(error => toast(error.message, 'error')));
}
