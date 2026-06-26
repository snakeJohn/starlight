import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';

const IMPORT_JOB_POLL_INTERVAL_MS = 1200;
const IMPORT_JOB_MAX_POLLS = 300;

function playlistId(playlist) {
    const id = playlist?.id ?? playlist?.playlist_id;
    return id === undefined || id === null ? '' : String(id);
}

function playlistName(playlist) {
    return playlist?.name || playlist?.title || '未命名歌单';
}

function targetNodes() {
    return {
        dialog: $('[data-role="songloft-playlist-target-dialog"]'),
        form: $('[data-role="songloft-playlist-target-form"]'),
        select: $('[data-role="songloft-target-playlist-select"]'),
        filter: $('[data-role="songloft-target-playlist-filter"]'),
        name: $('[data-role="songloft-target-playlist-name"]'),
        count: $('[data-role="songloft-target-song-count"]'),
        refresh: $('[data-action="refresh-songloft-target-playlists"]'),
        cancel: $('[data-action="cancel-songloft-target"]'),
        confirm: $('[data-action="confirm-songloft-target"]'),
    };
}

function selectedTargetPlaylist() {
    return asArray(state.songloftTargetPlaylists)
        .find(playlist => playlistId(playlist) === state.songloftTargetPlaylistId);
}

function renderTargetPlaylists(filterText = '') {
    const { select } = targetNodes();
    if (!select) return;
    const needle = String(filterText || '').trim().toLowerCase();
    const playlists = asArray(state.songloftTargetPlaylists)
        .filter(playlist => {
            if (!needle) return true;
            return playlistName(playlist).toLowerCase().includes(needle);
        });
    select.innerHTML = playlists.length
        ? playlists.map(playlist => `<option value="${escapeHtml(playlistId(playlist))}">${escapeHtml(playlistName(playlist))}</option>`).join('')
        : '<option value="">暂无 Songloft 歌单</option>';

    const currentId = state.songloftTargetPlaylistId;
    const nextId = playlists.some(playlist => playlistId(playlist) === currentId)
        ? currentId
        : playlistId(playlists[0]);
    select.value = nextId;
    const selected = playlists.find(playlist => playlistId(playlist) === nextId);
    setState({
        songloftTargetPlaylistId: nextId,
        songloftTargetPlaylistName: selected ? playlistName(selected) : '',
    });
}

export async function loadSongloftTargetPlaylists() {
    const data = await api.get('/songloft/playlists');
    const playlists = asArray(data);
    setState({ songloftTargetPlaylists: playlists });
    renderTargetPlaylists(targetNodes().filter?.value || '');
    return playlists;
}

export function closeSongloftPlaylistTarget() {
    const { dialog } = targetNodes();
    if (dialog) {
        dialog.hidden = true;
        dialog.setAttribute?.('aria-hidden', 'true');
    }
}

export async function openSongloftPlaylistTarget(songs, options = {}) {
    const pendingSongs = asArray(songs);
    if (!pendingSongs.length) {
        throw new Error('请先选择歌曲');
    }

    const { dialog, name, count } = targetNodes();
    setState({ songloftTargetPendingSongs: pendingSongs });
    if (count) count.textContent = `${pendingSongs.length} 首待加入`;
    if (name) name.value = options.playlistName || '';
    if (options.playlistId) {
        setState({ songloftTargetPlaylistId: String(options.playlistId) });
    }
    await loadSongloftTargetPlaylists();
    if (dialog) {
        dialog.hidden = false;
        dialog.setAttribute?.('aria-hidden', 'false');
    }
    name?.focus?.();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function songloftImportSummary(result) {
    return `已加入歌单：成功 ${result?.added ?? 0} 首${result?.skipped ? `，跳过 ${result.skipped} 首` : ''}`;
}

export async function waitForSongloftImportJob(jobId, options = {}) {
    const id = String(jobId || '').trim();
    if (!id) {
        throw new Error('Songloft 导入任务缺少 ID');
    }

    const intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : IMPORT_JOB_POLL_INTERVAL_MS;
    const maxPolls = Number(options.maxPolls) > 0 ? Number(options.maxPolls) : IMPORT_JOB_MAX_POLLS;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const job = await api.get(`/songloft/playlists/import-jobs/${encodeURIComponent(id)}`);
        if (job?.status === 'done') {
            return job.result;
        }
        if (job?.status === 'failed') {
            throw new Error(job?.error?.message || '歌单导入失败');
        }
        await delay(intervalMs);
    }
    throw new Error('歌单导入超时，请稍后查看歌单结果');
}

function applySongloftImportResult(result, context = {}) {
    const playlist = result?.playlist;
    const nextId = playlistId(playlist) || context.targetPlaylistId || '';
    const nextName = context.newPlaylistName || playlistNameFromResult(playlist) || context.targetPlaylistName || '';
    if (nextId || nextName) {
        setState({
            ...(nextId ? { songloftTargetPlaylistId: nextId } : {}),
            ...(nextName ? { songloftTargetPlaylistName: nextName } : {}),
        });
    }
}

export function trackSongloftImportJob(jobId, context = {}) {
    return waitForSongloftImportJob(jobId)
        .then(result => {
            applySongloftImportResult(result, context);
            toast(songloftImportSummary(result));
            return result;
        })
        .catch(error => {
            toast(error.message || '歌单导入失败', 'error');
            return null;
        });
}

async function importSongsToSongloftPlaylist(payload, context = {}) {
    const started = await api.post('/songloft/playlists/import-songs/jobs', payload);
    if (started?.job_id) {
        toast('已开始加入歌单，正在后台处理');
        void trackSongloftImportJob(started.job_id, context);
        return started;
    }
    applySongloftImportResult(started, context);
    toast(songloftImportSummary(started));
    return started;
}

export async function submitSongloftPlaylistTarget() {
    const { select, name, confirm } = targetNodes();
    const songs = asArray(state.songloftTargetPendingSongs);
    if (!songs.length) {
        throw new Error('没有待加入的歌曲');
    }

    const newPlaylistName = String(name?.value || '').trim();
    const targetPlaylistId = String(select?.value || state.songloftTargetPlaylistId || '').trim();
    if (!newPlaylistName && !targetPlaylistId) {
        throw new Error('请选择或新建歌单');
    }

    if (confirm) confirm.disabled = true;
    try {
        const payload = newPlaylistName
            ? { playlist_name: newPlaylistName, songs }
            : { playlist_id: targetPlaylistId, songs };
        const targetPlaylistName = newPlaylistName || playlistName(selectedTargetPlaylist()) || '';
        const result = await importSongsToSongloftPlaylist(payload, {
            targetPlaylistId,
            targetPlaylistName,
            newPlaylistName,
        });
        setState({
            ...(targetPlaylistId ? { songloftTargetPlaylistId: targetPlaylistId } : {}),
            ...(targetPlaylistName ? { songloftTargetPlaylistName: targetPlaylistName } : {}),
            songloftTargetPendingSongs: [],
        });
        closeSongloftPlaylistTarget();
        return result;
    } finally {
        if (confirm) confirm.disabled = false;
    }
}

function playlistNameFromResult(playlist) {
    return playlist ? playlistName(playlist) : '';
}

export function bindSongloftPlaylistTarget() {
    const { form, filter, select, refresh, cancel } = targetNodes();
    form?.addEventListener('submit', event => {
        event.preventDefault();
        submitSongloftPlaylistTarget().catch(error => toast(error.message, 'error'));
    });
    filter?.addEventListener('input', () => renderTargetPlaylists(filter.value));
    select?.addEventListener('change', () => {
        const selected = asArray(state.songloftTargetPlaylists)
            .find(playlist => playlistId(playlist) === select.value);
        setState({
            songloftTargetPlaylistId: select.value,
            songloftTargetPlaylistName: selected ? playlistName(selected) : '',
        });
    });
    refresh?.addEventListener('click', () => {
        loadSongloftTargetPlaylists().catch(error => toast(error.message, 'error'));
    });
    cancel?.addEventListener('click', () => closeSongloftPlaylistTarget());
}
