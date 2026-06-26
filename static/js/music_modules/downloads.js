import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, setState, toast } from '../state.js';
import { renderDownloadProgressMarkup } from './renderers.js';

let downloadProgressTimer = null;

function setControlDisabled(control, disabled) {
    if (control) control.disabled = disabled;
}

export function applyDownloadSettings(settings) {
    const form = $('[data-role="download-settings-form"]');
    if (!form || !settings) return;
    form.elements.path_template.value = settings.path_template || 'downloads/{artist}-{album}/{title}';
    form.elements.download_interval.value = String(settings.download_interval ?? 0);
    form.elements.embed_metadata.checked = settings.embed_metadata !== false;
}

export async function loadDownloadSettings() {
    const settings = await api.get('/download/settings');
    setState({ downloadSettings: settings });
    applyDownloadSettings(settings);
    return settings;
}

function renderDownloadProgress(progress) {
    const node = $('[data-role="download-progress"]');
    if (!node) return;
    node.innerHTML = renderDownloadProgressMarkup(progress);
}

function stopDownloadProgressPolling() {
    if (!downloadProgressTimer) return;
    window?.clearInterval?.(downloadProgressTimer);
    downloadProgressTimer = null;
}

function startDownloadProgressPolling() {
    if (downloadProgressTimer || typeof window?.setInterval !== 'function') return;
    downloadProgressTimer = window.setInterval(() => {
        loadDownloadProgress().catch(error => {
            stopDownloadProgressPolling();
            toast(error.message, 'error');
        });
    }, 2000);
}

export async function loadDownloadProgress() {
    const progress = await api.get('/download/batch/progress');
    setState({ downloadProgress: progress });
    renderDownloadProgress(progress);
    if (progress?.active && !progress.done) {
        startDownloadProgressPolling();
    } else if (progress?.done) {
        stopDownloadProgressPolling();
    }
    return progress;
}

export async function downloadSong(song) {
    const result = await api.post('/download/song', { song });
    toast(result?.started ? '已开始下载 1 首歌曲，可在下载进度中查看' : (result?.path ? `下载完成：${result.path}` : '下载任务已完成'));
    await loadDownloadProgress().catch(() => {});
    if (result?.started) startDownloadProgressPolling();
    return result;
}

export async function downloadSongs(songs) {
    const selectedSongs = asArray(songs);
    if (!selectedSongs.length) {
        throw new Error('请先选择歌曲');
    }
    const result = selectedSongs.length === 1
        ? await downloadSong(selectedSongs[0])
        : await api.post('/download/batch', { songs: selectedSongs });
    if (selectedSongs.length > 1) {
        toast(`已开始下载 ${selectedSongs.length} 首歌曲`);
        await loadDownloadProgress().catch(() => {});
        startDownloadProgressPolling();
    }
    return result;
}

export function bindDownloads() {
    $('[data-action="refresh-download-settings"]')?.addEventListener('click', () => {
        loadDownloadSettings().catch(error => toast(error.message, 'error'));
    });
    $('[data-action="refresh-download-progress"]')?.addEventListener('click', () => {
        loadDownloadProgress().catch(error => toast(error.message, 'error'));
    });
    $('[data-action="clear-download-progress"]')?.addEventListener('click', async () => {
        try {
            await api.post('/download/batch/clear');
            await loadDownloadProgress();
            toast('下载进度已清空');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="download-settings-form"]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        const body = Object.fromEntries(new FormData(form).entries());
        body.embed_metadata = Boolean(form.elements.embed_metadata?.checked);
        body.download_interval = Number(body.download_interval || 0);
        setControlDisabled(button, true);
        try {
            const settings = await api.post('/download/settings', body);
            setState({ downloadSettings: settings });
            applyDownloadSettings(settings);
            toast('下载设置已保存');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setControlDisabled(button, false);
        }
    });
}
