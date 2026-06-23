import { api } from './api.js';
import { authenticateSongloftResourceUrl } from './auth.js';
import { $, $$, durationLabel, escapeHtml, selectedDevicePayload, setState, state, toast } from './state.js';

const platformSelectRoles = [
    'platform-select',
    'songlist-platform',
    'ranking-platform',
    'custom-playlist-import-platform',
];

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.list)) return value.list;
    if (Array.isArray(value?.songs)) return value.songs;
    if (Array.isArray(value?.data)) return value.data;
    return [];
}

function resultCount(value) {
    return value?.total ?? value?.list?.length ?? asArray(value).length ?? 0;
}

const builtinPlatformNames = {
    kw: '酷我',
    kg: '酷狗',
    tx: 'QQ 音乐',
    mg: '咪咕',
    wy: '网易云',
};

const pageSizes = {
    search: 20,
    songlist: 20,
    songlistDetail: 20,
    ranking: 20,
    customPlaylistDetail: 20,
};

let artworkFallbackInstalled = false;
let downloadProgressTimer = null;

export function musicPageSize(scope) {
    return pageSizes[scope] || 20;
}

export function sourceDisplayName(id) {
    return state.platforms.find(item => item.id === id)?.name || builtinPlatformNames[id] || id || '未知';
}

function platformName(id) {
    return sourceDisplayName(id);
}

function clampPage(page, totalPages) {
    const value = Number(page);
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(1, Math.floor(value)), Math.max(1, totalPages));
}

function pageCount(total, pageSize) {
    return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / Math.max(1, Number(pageSize) || 1)));
}

export function renderPagination({ scope, page, total, pageSize }) {
    const totalPages = pageCount(total, pageSize);
    const currentPage = clampPage(page, totalPages);
    const escapedScope = escapeHtml(scope);
    return `
        <nav class="pagination-bar" data-pagination="${escapedScope}" data-page="${currentPage}" data-total-pages="${totalPages}">
            <button type="button" data-page-action="prev"${currentPage <= 1 ? ' disabled' : ''}>上一页</button>
            <span>第 ${currentPage} / ${totalPages} 页</span>
            <button type="button" data-page-action="next"${currentPage >= totalPages ? ' disabled' : ''}>下一页</button>
            <label>
                <span>指定页</span>
                <input data-role="${escapedScope}-page-input" type="number" min="1" max="${totalPages}" value="${currentPage}">
            </label>
            <button type="button" data-page-action="jump">跳转</button>
        </nav>
    `;
}

function renderPaginationInto(role, options) {
    const node = $(`[data-role="${role}"]`);
    if (!node) return;
    node.innerHTML = renderPagination(options);
}

function clearPagination(role) {
    const node = $(`[data-role="${role}"]`);
    if (node) node.innerHTML = '';
}

function pageFromPagination(root, action) {
    const current = Number(root.dataset.page || 1);
    const totalPages = Number(root.dataset.totalPages || 1);
    if (action === 'prev') return clampPage(current - 1, totalPages);
    if (action === 'next') return clampPage(current + 1, totalPages);
    const input = root.querySelector(`[data-role="${root.dataset.pagination}-page-input"]`);
    return clampPage(input?.value || current, totalPages);
}

function bindPagination(role, loadPage) {
    const host = $(`[data-role="${role}"]`);
    if (!host) return;
    host.addEventListener('click', async event => {
        const button = event.target.closest('[data-page-action]');
        if (!button || button.disabled) return;
        const root = button.closest('[data-pagination]');
        if (!root) return;
        button.disabled = true;
        try {
            await loadPage(pageFromPagination(root, button.dataset.pageAction));
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
    host.addEventListener('keydown', async event => {
        if (event.key !== 'Enter' || !event.target.matches('input[data-role$="-page-input"]')) return;
        event.preventDefault();
        const root = event.target.closest('[data-pagination]');
        if (!root) return;
        try {
            await loadPage(pageFromPagination(root, 'jump'));
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

function songTitle(song) {
    return song?.title || song?.name || song?.songName || '未知歌曲';
}

function songArtist(song) {
    const artist = song?.artist || song?.singer || song?.author || song?.singerName;
    if (Array.isArray(artist)) return artist.map(item => item.name || item).join(', ');
    return artist || '未知歌手';
}

function songAlbum(song) {
    return song?.album || song?.albumName || '未知专辑';
}

function songloftTypeLabel(song) {
    const type = String(song?.type || '').trim().toLowerCase();
    if (type === 'local') return '本地';
    if (type === 'remote') return '网络';
    if (type === 'radio') return '电台';
    return type || 'Songloft';
}

function sourceMeta(song) {
    const data = song?.source_data || {};
    return [data.platform && platformName(data.platform), data.quality, durationLabel(song?.duration)]
        .filter(Boolean)
        .join(' · ');
}

function decodeHtmlEntities(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

export function cleanDisplayText(value) {
    return decodeHtmlEntities(value)
        .replace(/\\\\u003c/gi, '<')
        .replace(/\\\\u003e/gi, '>')
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function firstText(...values) {
    for (const value of values) {
        const text = cleanDisplayText(value);
        if (text) return text;
    }
    return '';
}

function normalizeCoverUrl(value) {
    const url = cleanDisplayText(value).replace('{size}', '400');
    if (!url) return '';
    if (/^(https?:)?\/\//i.test(url)) return authenticateSongloftResourceUrl(url);
    if (/^(data:image\/|blob:)/i.test(url)) return url;
    if (url.startsWith('/')) return authenticateSongloftResourceUrl(url);
    return '';
}

export function mediaCoverUrl(item = {}) {
    const sourceData = item?.source_data || {};
    const songInfo = sourceData.songInfo || {};
    const candidates = [
        item.cover_url,
        item.coverUrl,
        item.picUrl,
        item.pic_url,
        item.imgurl,
        item.imgUrl,
        item.album_img,
        item.album_sizable_cover,
        item.albumPic,
        item.img,
        item.pic,
        item.cover,
        item.image,
        sourceData.cover_url,
        sourceData.coverUrl,
        sourceData.picUrl,
        sourceData.pic_url,
        sourceData.imgurl,
        sourceData.imgUrl,
        sourceData.album_img,
        sourceData.album_sizable_cover,
        sourceData.albumPic,
        sourceData.img,
        sourceData.pic,
        sourceData.cover,
        sourceData.image,
        songInfo.cover_url,
        songInfo.coverUrl,
        songInfo.picUrl,
        songInfo.pic_url,
        songInfo.imgurl,
        songInfo.imgUrl,
        songInfo.album_img,
        songInfo.album_sizable_cover,
        songInfo.albumPic,
        songInfo.img,
        songInfo.pic,
        songInfo.cover,
        songInfo.image,
    ];
    for (const candidate of candidates) {
        const cover = normalizeCoverUrl(candidate);
        if (cover) return cover;
    }
    return '';
}

function renderArtwork(item, alt) {
    const cover = mediaCoverUrl(item);
    if (cover) {
        return `<img class="media-artwork" src="${escapeHtml(cover)}" alt="" title="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="media-artwork media-artwork-placeholder" aria-hidden="true">♪</span>`;
}

function installArtworkFallback() {
    if (artworkFallbackInstalled || typeof document === 'undefined') return;
    artworkFallbackInstalled = true;
    document.addEventListener('error', event => {
        const image = event.target;
        if (!image?.matches?.('img.media-artwork')) return;
        const placeholder = document.createElement('span');
        placeholder.className = 'media-artwork media-artwork-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '♪';
        image.replaceWith(placeholder);
    }, true);
}

function actionButton(action, index, text) {
    return `<button type="button" data-action="${action}" data-index="${index}">${text}</button>`;
}

function customPlaylistAction(index) {
    return actionButton('add-to-playlist', index, '加入歌单');
}

function renderSongCheckbox(index, options = {}) {
    if (!options.selectable) return '';
    const role = options.checkboxRole || 'song-check';
    const label = options.checkboxLabel || '选择歌曲';
    return `
            <label class="song-check" title="${escapeHtml(label)}">
                <input type="checkbox" data-role="${escapeHtml(role)}" data-index="${index}">
            </label>`;
}

export function renderListScroller(innerHtml, extraClass = '', stackClass = 'list-stack') {
    const className = ['list-scroll', extraClass].filter(Boolean).join(' ');
    return `<div class="${escapeHtml(className)}"><div class="${escapeHtml(stackClass)}">${innerHtml}</div></div>`;
}

export function renderSongRow(song, index, extraActions = '', options = {}) {
    const selectable = Boolean(options.selectable);
    return `
        <article class="song-row media-row${selectable ? ' selectable-song-row' : ''}">
            ${renderSongCheckbox(index, options)}
            ${renderArtwork(song, songTitle(song))}
            <div class="row-main">
                <strong>${escapeHtml(songTitle(song))}</strong>
                <span>${escapeHtml(songArtist(song))} · ${escapeHtml(songAlbum(song))}</span>
                <span class="row-meta">${escapeHtml(sourceMeta(song))}</span>
            </div>
            <div class="row-actions">
                ${actionButton('import', index, '导入 Songloft 歌曲库')}
                ${actionButton('download', index, '下载')}
                ${actionButton('speaker', index, '推送音箱')}
                ${customPlaylistAction(index)}
                ${extraActions}
            </div>
        </article>
    `;
}

function updatePlatformSelects() {
    for (const role of platformSelectRoles) {
        const select = $(`[data-role="${role}"]`);
        if (!select) continue;
        select.innerHTML = state.platforms
            .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`)
            .join('');
        if (state.platform && state.platforms.some(item => item.id === state.platform)) {
            select.value = state.platform;
        }
    }
}

async function loadPlatforms() {
    const platforms = asArray(await api.get('/music/platforms'));
    setState({ platforms, platform: platforms[0]?.id || state.platform || 'kw' });
    updatePlatformSelects();
}

async function loadSources() {
    const sources = asArray(await api.get('/music/sources'));
    setState({ sources });

    const sourceCount = $('[data-role="source-count"]');
    if (sourceCount) {
        const enabled = sources.filter(item => item.enabled).length;
        sourceCount.textContent = `${sources.length} 个音源 · ${enabled} 已启用`;
    }

    const list = $('[data-role="source-list"]');
    if (!list) return;
    list.innerHTML = sources.length
        ? sources.map(item => `
            <article class="source-row">
                <div class="row-main">
                    <strong>${escapeHtml(item.name || item.filename || item.id)}</strong>
                    <span>${escapeHtml(item.id)} · ${item.enabled ? '已启用' : '未启用'}</span>
                </div>
                <button type="button" data-action="toggle-source" data-source-id="${escapeHtml(item.id)}" data-enabled="${item.enabled ? 'false' : 'true'}">${item.enabled ? '停用' : '启用'}</button>
                <button type="button" data-action="delete-source" data-source-id="${escapeHtml(item.id)}">删除</button>
            </article>
        `).join('')
        : '<div class="empty-state">暂无音源。请导入自己的 LX 音源 js 或 zip 包后手动启用。</div>';
}

async function importSource(file) {
    const content = await file.text();
    await api.post('/music/sources/import', { filename: file.name, content });
    await loadSources();
    toast('音源已导入，按需手动启用');
}

function renderSourceRows(sources, { toggleAction, deleteAction }) {
    return sources.map(item => `
        <article class="source-row">
            <div class="row-main">
                <strong>${escapeHtml(item.name || item.filename || item.id)}</strong>
                <span>${escapeHtml(item.id)} · ${item.enabled ? '已启用' : '未启用'}</span>
            </div>
            <button type="button" data-action="${toggleAction}" data-source-id="${escapeHtml(item.id)}" data-enabled="${item.enabled ? 'false' : 'true'}">${item.enabled ? '停用' : '启用'}</button>
            <button type="button" data-action="${deleteAction}" data-source-id="${escapeHtml(item.id)}">删除</button>
        </article>
    `).join('');
}

async function loadDownloadSources() {
    const sources = asArray(await api.get('/download/sources'));
    setState({ downloadSources: sources });

    const list = $('[data-role="download-source-list"]');
    if (!list) return sources;
    list.innerHTML = sources.length
        ? renderSourceRows(sources, { toggleAction: 'toggle-download-source', deleteAction: 'delete-download-source' })
        : '<div class="empty-state">暂无下载音源。请导入专用下载音源后手动启用，播放音源不会用于下载。</div>';
    return sources;
}

async function importDownloadSource(file) {
    const content = await file.text();
    await api.post('/download/sources/import', { filename: file.name, content });
    await loadDownloadSources();
    toast('下载音源已导入，按需手动启用');
}

function applyDownloadSettings(settings) {
    const form = $('[data-role="download-settings-form"]');
    if (!form || !settings) return;
    form.elements.path_template.value = settings.path_template || 'downloads/{artist}-{album}/{title}';
    form.elements.download_interval.value = String(settings.download_interval ?? 0);
    form.elements.embed_metadata.checked = settings.embed_metadata !== false;
}

async function loadDownloadSettings() {
    const settings = await api.get('/download/settings');
    setState({ downloadSettings: settings });
    applyDownloadSettings(settings);
    return settings;
}

export function renderDownloadProgressMarkup(progress) {
    if (!progress?.active) {
        return '<div class="empty-state">暂无下载任务。</div>';
    }

    const current = Number(progress.current) || 0;
    const total = Number(progress.total) || 0;
    const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0;
    const rows = asArray(progress.results).slice(-8).map(result => `
        <div class="download-progress-row">
            <span>${escapeHtml(result.status === 'failed' ? '失败' : '完成')}</span>
            <strong>${escapeHtml(result.path || result.error || `Song #${result.song_id || '-'}`)}</strong>
        </div>
    `).join('');
    return `
        <div class="download-progress-bar" aria-label="下载进度 ${percent}%">
            <div class="download-progress-track">
                <span class="download-progress-fill" style="width: ${percent}%"></span>
            </div>
            <strong>${percent}%</strong>
        </div>
        <div class="metric-grid">
            <div><span>进度</span><strong>${current}/${total}</strong></div>
            <div><span>成功</span><strong>${Number(progress.success) || 0}</strong></div>
            <div><span>失败</span><strong>${Number(progress.failed) || 0}</strong></div>
        </div>
        <div class="list-stack tight">${rows || '<div class="empty-state">任务已开始，等待第一首完成。</div>'}</div>
    `;
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

async function loadDownloadProgress() {
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

async function downloadSongs(songs) {
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

async function importSongs(songs, options = {}) {
    const result = await api.post('/bridge/songs/import', { songs });
    if (!options.silent) {
        toast(`已导入 ${result?.total ?? songs.length} 首歌曲`);
    }
    return result;
}

export async function downloadSong(song) {
    const result = await api.post('/download/song', { song });
    toast(result?.started ? '已开始下载 1 首歌曲，可在下载进度中查看' : (result?.path ? `下载完成：${result.path}` : '下载任务已完成'));
    await loadDownloadProgress().catch(() => {});
    if (result?.started) startDownloadProgressPolling();
    return result;
}

async function playOnSpeaker(song) {
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先在音箱页选择账号和设备');
    }
    const result = await api.post('/bridge/play-url', { ...payload, song });
    toast('已推送到音箱');
    return result;
}

async function playResolvedSongOnSpeaker(song) {
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先在音箱页选择账号和设备');
    }
    const result = await api.post('/bridge/play-resolved-url', {
        ...payload,
        title: songTitle(song),
        artist: songArtist(song),
    });
    toast('已推送到音箱');
    return result;
}

export async function playSonglistOnSpeaker(songs) {
    if (!songs?.length) {
        throw new Error('歌单没有可播放歌曲');
    }
    await importSongs(songs);
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先在音箱页选择账号和设备');
    }
    const result = await api.post('/bridge/play-songlist', { ...payload, songs });
    toast('已推送到音箱');
    return result;
}

export async function playSongloftSongOnSpeaker(song) {
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先在音箱页选择账号和设备');
    }
    const result = await api.post('/songloft/player/song', { ...payload, song });
    setState({ playbackState: 'playing' });
    toast('Songloft 歌曲已推送到音箱');
    return result;
}

export async function addSongToCustomPlaylist(playlistId, song) {
    if (!playlistId) {
        throw new Error('请先选择歌单');
    }
    const result = await api.post(`/custom-playlists/${encodeURIComponent(playlistId)}/songs`, { song });
    toast('已加入歌单');
    await loadCustomPlaylists().catch(error => toast(error.message, 'error'));
    return result;
}

export async function addSelectedSongsToCustomPlaylist(playlistId, songs) {
    if (!playlistId) {
        throw new Error('请先选择歌单');
    }
    const selectedSongs = asArray(songs);
    if (!selectedSongs.length) {
        throw new Error('请先选择歌曲');
    }
    const results = [];
    for (const song of selectedSongs) {
        results.push(await api.post(`/custom-playlists/${encodeURIComponent(playlistId)}/songs`, { song }));
    }
    toast(`已加入 ${selectedSongs.length} 首歌曲`);
    await loadCustomPlaylists().catch(error => toast(error.message, 'error'));
    return results;
}

async function createCustomPlaylist(name) {
    const result = await api.post('/custom-playlists', { name });
    toast('歌单已创建');
    await loadCustomPlaylists();
    return result;
}

export async function importCustomPlaylistFromSource(sourceId, listId) {
    const result = await api.post('/custom-playlists/import', { source_id: sourceId, id: listId });
    toast('歌单已导入');
    await loadCustomPlaylists();
    return result;
}

export async function favoriteSongListFromSource(sourceId, listId) {
    return importCustomPlaylistFromSource(sourceId, listId);
}

export async function refreshCustomPlaylist(playlistId) {
    const result = await api.post(`/custom-playlists/${encodeURIComponent(playlistId)}/refresh`);
    toast('歌单已刷新');
    await loadCustomPlaylists();
    return result;
}

export async function syncCustomPlaylistToSongloft(playlistId) {
    const result = await api.post(`/custom-playlists/${encodeURIComponent(playlistId)}/sync-songloft`);
    toast(`已同步 ${result?.total ?? 0} 首到 Songloft 歌单${result?.skipped ? `，跳过 ${result.skipped} 首` : ''}`);
    await loadCustomPlaylists().catch(error => toast(error.message, 'error'));
    return result;
}

export function nextCustomPlaylistDetailId(currentId, playlistId) {
    return currentId === playlistId ? '' : playlistId;
}

function nativePlaylistId(playlist) {
    const id = Number(playlist?.native_playlist_id);
    return Number.isFinite(id) && id !== 0 ? id : 0;
}

export function customPlaylistPlayableId(playlist) {
    const nativeId = nativePlaylistId(playlist);
    if (nativeId) return nativeId;
    const index = (state.customPlaylists || []).findIndex(item => item.id === playlist?.id);
    return index >= 0 ? -100000 - index : 0;
}

export async function playCustomPlaylistOnSpeaker(playlist) {
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先在音箱页选择账号和设备');
    }
    const playlistId = customPlaylistPlayableId(playlist);
    if (!playlistId) {
        throw new Error('歌单不可播放，请刷新歌单列表后重试');
    }
    if (!Array.isArray(playlist?.songs) || playlist.songs.length === 0) {
        throw new Error('歌单没有可播放歌曲');
    }
    const result = await api.post('/miot/player/play', {
        ...payload,
        playlist_id: playlistId,
        start_index: 0,
        play_mode: 'order',
    });
    setState({ playbackState: 'playing' });
    toast('歌单已推送到音箱');
    return result;
}

async function deleteCustomPlaylist(playlistId) {
    const result = await api.delete(`/custom-playlists/${encodeURIComponent(playlistId)}`);
    toast('歌单已删除');
    await loadCustomPlaylists();
    return result;
}

function bindSongActions(root, getSong) {
    root.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (!['import', 'download', 'speaker', 'add-to-playlist'].includes(action)) return;
        const song = getSong(Number(button.dataset.index));
        if (!song) return;
        button.disabled = true;
        try {
            if (action === 'import') await importSongs([song]);
            if (action === 'download') await downloadSong(song);
            if (action === 'speaker') await playOnSpeaker(song);
            if (action === 'add-to-playlist') await addSongToCustomPlaylist(selectedCustomPlaylistId(), song);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

function selectedSongsFromChecks(root, role, songs) {
    return $$(`[data-role="${role}"]:checked`, root)
        .map(input => songs?.[Number(input.dataset.index)])
        .filter(Boolean);
}

function selectedCustomPlaylistId() {
    const select = $('[data-role="custom-playlist-select"]');
    return select?.value || state.customPlaylistId || '';
}

function isOwnCustomPlaylist(playlist) {
    return Boolean(playlist?.id && !playlist?.source && !playlist?.sourceListId);
}

function targetCustomPlaylists() {
    return (state.customPlaylists || []).filter(isOwnCustomPlaylist);
}

function currentViewedCustomPlaylist() {
    return (state.customPlaylists || []).find(playlist => playlist.id === state.customPlaylistDetailId);
}

function playlistSongLabel(song) {
    return `${song?.title || '未知歌曲'} - ${song?.artist || '未知歌手'}${song?.source_name ? `（${song.source_name}）` : ''}`;
}

function customPlaylistSongMeta(song) {
    const source = song?.source_name || platformName(song?.source_data?.platform);
    return [source, song?.source_data?.quality, durationLabel(song?.duration)]
        .filter(Boolean)
        .join(' · ');
}

function renderCustomPlaylistSongRow(song, index) {
    const hasSourceData = Boolean(song?.source_data?.platform);
    return `
        <article class="song-row media-row custom-playlist-song-row">
            <label class="song-check" title="选择歌曲">
                <input type="checkbox" data-role="custom-playlist-song-check" data-index="${index}">
            </label>
            ${renderArtwork(song, songTitle(song))}
            <div class="row-main">
                <strong>${escapeHtml(songTitle(song))}</strong>
                <span>${escapeHtml(songArtist(song))} · ${escapeHtml(songAlbum(song))}</span>
                <span class="row-meta">${escapeHtml(customPlaylistSongMeta(song))}</span>
            </div>
            <div class="row-actions">
                ${hasSourceData ? `<button type="button" data-action="download-custom-playlist-song" data-index="${index}">下载</button>` : ''}
                <button type="button" data-action="speaker-custom-playlist-song" data-index="${index}">推送音箱</button>
                <button type="button" data-action="add-custom-playlist-song" data-index="${index}">加入歌单</button>
            </div>
        </article>
    `;
}

function updateTargetPlaylistLabels() {
    const selected = targetCustomPlaylists().find(playlist => playlist.id === state.customPlaylistId);
    const label = selected ? selected.name : '未选择自建歌单';
    $$('[data-role="target-playlist-label"]').forEach(node => {
        node.textContent = label;
    });
}

export function renderCustomPlaylistItem(playlist) {
    const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
    const meta = [playlist?.source_name, `${songs.length} 首`].filter(Boolean).join(' · ');
    const songPreview = songs.slice(0, 3).map(song => `<span>${escapeHtml(playlistSongLabel(song))}</span>`).join('');
    const selected = playlist?.id && playlist.id === state.customPlaylistId;
    const viewed = playlist?.id && playlist.id === state.customPlaylistDetailId;
    const selectable = isOwnCustomPlaylist(playlist);
    return `
        <article class="data-row custom-playlist-row" data-playlist-id="${escapeHtml(playlist?.id || '')}">
            ${renderArtwork(playlist, playlist?.name || '歌单')}
            <div class="row-main">
                <strong>${escapeHtml(playlist?.name || '未命名歌单')}</strong>
                <span>${escapeHtml(meta)}</span>
                ${songPreview ? `<span class="row-meta">${songPreview}</span>` : ''}
            </div>
            <div class="row-actions">
                <button type="button" class="${viewed ? 'selected-action' : ''}" data-action="view-custom-playlist" data-playlist-id="${escapeHtml(playlist?.id || '')}">${viewed ? '正在查看' : '查看歌曲'}</button>
                ${playlist?.source && playlist?.sourceListId ? `<button type="button" data-action="refresh-custom-playlist" data-playlist-id="${escapeHtml(playlist.id)}">刷新</button>` : ''}
                ${playlist?.source && playlist?.sourceListId ? `<button type="button" data-action="sync-custom-playlist" data-playlist-id="${escapeHtml(playlist.id)}">同步 Songloft 歌单</button>` : ''}
                ${playlist?.source && playlist?.sourceListId ? `<button type="button" data-action="speaker-custom-playlist" data-playlist-id="${escapeHtml(playlist.id)}">推送音箱</button>` : ''}
                ${selectable ? `<button type="button" class="${selected ? 'selected-action' : ''}" data-action="select-custom-playlist" data-playlist-id="${escapeHtml(playlist?.id || '')}">${selected ? '已选目标' : '设为目标'}</button>` : ''}
                <button type="button" data-action="delete-custom-playlist" data-playlist-id="${escapeHtml(playlist?.id || '')}">删除</button>
            </div>
        </article>
    `;
}

export function renderCustomPlaylistDetail(playlist, page = state.customPlaylistDetailPage || 1) {
    if (!playlist) {
        return '<div class="empty-state">选择一个歌单后可查看歌曲明细，并将选中的歌曲加入自建歌单。</div>';
    }
    const songs = Array.isArray(playlist.songs) ? playlist.songs : [];
    const meta = [playlist.source_name, `${songs.length} 首`].filter(Boolean).join(' · ');
    const totalPages = pageCount(songs.length, pageSizes.customPlaylistDetail);
    const currentPage = clampPage(page, totalPages);
    const start = (currentPage - 1) * pageSizes.customPlaylistDetail;
    const pageSongs = songs.slice(start, start + pageSizes.customPlaylistDetail);
    return `
        <section class="custom-playlist-detail-panel">
            <div class="section-bar">
                <div>
                    <h2>${escapeHtml(playlist.name || '未命名歌单')}</h2>
                    <span>${escapeHtml(meta)}</span>
                </div>
                ${songs.length ? `<button class="primary-button" type="button" data-action="add-selected-custom-playlist-songs">加入选中歌曲</button><button class="ghost-button" type="button" data-action="download-selected-custom-playlist-songs">下载选中歌曲</button>` : ''}
            </div>
            ${songs.length
                ? `${renderListScroller(pageSongs.map((song, index) => renderCustomPlaylistSongRow(song, start + index)).join(''), 'custom-playlist-detail-scroll', 'list-stack tight')}
                    ${renderPagination({ scope: 'custom-playlist-detail', page: currentPage, total: songs.length, pageSize: pageSizes.customPlaylistDetail })}`
                : '<div class="empty-state">这个歌单还没有歌曲。</div>'}
        </section>
    `;
}

function renderCustomPlaylistDetailInto() {
    const detail = $('[data-role="custom-playlist-detail"]');
    if (!detail) return;
    detail.innerHTML = state.customPlaylistDetailId
        ? renderCustomPlaylistDetail(currentViewedCustomPlaylist())
        : '';
}

function renderCustomPlaylists() {
    const list = $('[data-role="custom-playlist-list"]');
    const select = $('[data-role="custom-playlist-select"]');
    const playlists = state.customPlaylists || [];
    const targetPlaylists = playlists.filter(isOwnCustomPlaylist);
    if (select) {
        select.innerHTML = targetPlaylists.length
            ? targetPlaylists.map(playlist => `<option value="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)}</option>`).join('')
            : '<option value="">请先新建自建歌单</option>';
        const nextPlaylistId = state.customPlaylistId && targetPlaylists.some(playlist => playlist.id === state.customPlaylistId)
            ? state.customPlaylistId
            : targetPlaylists[0]?.id || '';
        select.value = nextPlaylistId;
        if (nextPlaylistId !== state.customPlaylistId) {
            setState({ customPlaylistId: nextPlaylistId });
        }
    }
    if (state.customPlaylistDetailId && !playlists.some(playlist => playlist.id === state.customPlaylistDetailId)) {
        setState({ customPlaylistDetailId: '', customPlaylistDetailPage: 1 });
    }
    if (!list) return;
    list.innerHTML = playlists.length
        ? playlists.map(playlist => renderCustomPlaylistItem(playlist)).join('')
        : '<div class="empty-state">暂无自建歌单。</div>';
    renderCustomPlaylistDetailInto();
    updateTargetPlaylistLabels();
}

async function loadCustomPlaylists() {
    const playlists = asArray(await api.get('/custom-playlists'));
    setState({ customPlaylists: playlists });
    renderCustomPlaylists();
    return playlists;
}

function bindCustomPlaylists() {
    const createForm = $('[data-role="custom-playlist-create-form"]');
    const importForm = $('[data-role="custom-playlist-import-form"]');
    const select = $('[data-role="custom-playlist-select"]');
    const list = $('[data-role="custom-playlist-list"]');
    const detail = $('[data-role="custom-playlist-detail"]');

    createForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const button = createForm.querySelector('button[type="submit"]');
        const body = Object.fromEntries(new FormData(createForm).entries());
        if (!body.name?.trim()) return;
        button.disabled = true;
        try {
            await createCustomPlaylist(body.name.trim());
            createForm.reset();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    importForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const button = importForm.querySelector('button[type="submit"]');
        const body = Object.fromEntries(new FormData(importForm).entries());
        if (!body.id?.trim()) return;
        button.disabled = true;
        try {
            await importCustomPlaylistFromSource(body.source_id || state.platform, body.id.trim());
            importForm.reset();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    select?.addEventListener('change', () => {
        setState({ customPlaylistId: select.value });
        updateTargetPlaylistLabels();
    });

    list?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const playlistId = button.dataset.playlistId;
        if (!playlistId) return;
        button.disabled = true;
        try {
            if (button.dataset.action === 'select-custom-playlist') {
                setState({ customPlaylistId: playlistId });
                renderCustomPlaylists();
                updateTargetPlaylistLabels();
            }
            if (button.dataset.action === 'view-custom-playlist') {
                setState({
                    customPlaylistDetailId: nextCustomPlaylistDetailId(state.customPlaylistDetailId, playlistId),
                    customPlaylistDetailPage: 1,
                });
                renderCustomPlaylists();
            }
            if (button.dataset.action === 'refresh-custom-playlist') {
                await refreshCustomPlaylist(playlistId);
            }
            if (button.dataset.action === 'sync-custom-playlist') {
                await syncCustomPlaylistToSongloft(playlistId);
            }
            if (button.dataset.action === 'speaker-custom-playlist') {
                const playlist = (state.customPlaylists || []).find(item => item.id === playlistId);
                await playCustomPlaylistOnSpeaker(playlist);
            }
            if (button.dataset.action === 'delete-custom-playlist') {
                await deleteCustomPlaylist(playlistId);
            }
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    detail?.addEventListener('click', async event => {
        const pageButton = event.target.closest('[data-page-action]');
        if (pageButton && !pageButton.disabled) {
            const root = pageButton.closest('[data-pagination]');
            if (!root) return;
            setState({ customPlaylistDetailPage: pageFromPagination(root, pageButton.dataset.pageAction) });
            renderCustomPlaylistDetailInto();
            return;
        }

        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const playlist = currentViewedCustomPlaylist();
        if (!playlist) return;
        const songs = Array.isArray(playlist.songs) ? playlist.songs : [];
        if (!['download-custom-playlist-song', 'speaker-custom-playlist-song', 'add-custom-playlist-song', 'add-selected-custom-playlist-songs', 'download-selected-custom-playlist-songs'].includes(button.dataset.action)) return;
        button.disabled = true;
        try {
            if (button.dataset.action === 'download-custom-playlist-song') {
                const song = songs[Number(button.dataset.index)];
                if (song) await downloadSong(song);
            }
            if (button.dataset.action === 'speaker-custom-playlist-song') {
                const song = songs[Number(button.dataset.index)];
                if (song) {
                    if (song?.source_data?.platform) await playOnSpeaker(song);
                    else await playResolvedSongOnSpeaker(song);
                }
            }
            if (button.dataset.action === 'add-custom-playlist-song') {
                const song = songs[Number(button.dataset.index)];
                if (song) await addSelectedSongsToCustomPlaylist(selectedCustomPlaylistId(), [song]);
            }
            if (button.dataset.action === 'add-selected-custom-playlist-songs') {
                const selectedSongs = $$('[data-role="custom-playlist-song-check"]:checked', detail)
                    .map(input => songs[Number(input.dataset.index)])
                    .filter(Boolean);
                await addSelectedSongsToCustomPlaylist(selectedCustomPlaylistId(), selectedSongs);
            }
            if (button.dataset.action === 'download-selected-custom-playlist-songs') {
                const selectedSongs = $$('[data-role="custom-playlist-song-check"]:checked', detail)
                    .map(input => songs[Number(input.dataset.index)])
                    .filter(song => song?.source_data?.platform);
                await downloadSongs(selectedSongs);
            }
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    detail?.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !event.target.matches('input[data-role="custom-playlist-detail-page-input"]')) return;
        event.preventDefault();
        const root = event.target.closest('[data-pagination]');
        if (!root) return;
        setState({ customPlaylistDetailPage: pageFromPagination(root, 'jump') });
        renderCustomPlaylistDetailInto();
    });

    $('[data-action="refresh-custom-playlists"]')?.addEventListener('click', () => {
        loadCustomPlaylists().catch(error => toast(error.message, 'error'));
    });
}

async function loadSearchPage(page = 1) {
    const list = $('[data-role="search-results"]');
    const query = state.searchQuery;
    if (!list || !query?.keyword) return;
    list.innerHTML = '<div class="empty-state">正在搜索...</div>';
    const data = await api.post('/music/search', {
        keyword: query.keyword,
        source_id: query.platform,
        page,
        page_size: pageSizes.search,
    });
    const songs = asArray(data);
    const total = resultCount(data);
    setState({ searchResults: songs, searchPage: page, searchTotal: total, platform: query.platform, quality: query.quality });
    $('[data-role="search-total"]').textContent = String(total);
    list.innerHTML = songs.length
        ? renderListScroller(songs.map((song, index) => renderSongRow(song, index, '', {
            selectable: true,
            checkboxRole: 'search-song-check',
        })).join(''), 'search-results-scroll')
        : '<div class="empty-state">没有找到匹配歌曲。</div>';
    renderPaginationInto('search-pagination', { scope: 'search', page, total, pageSize: pageSizes.search });
}

function bindSearch() {
    const form = $('[data-role="music-search-form"]');
    const list = $('[data-role="search-results"]');
    if (!form || !list) return;

    form.addEventListener('change', event => {
        if (event.target.name === 'source_id') setState({ platform: event.target.value });
        if (event.target.name === 'quality') setState({ quality: event.target.value });
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        const body = Object.fromEntries(new FormData(form).entries());
        if (!body.keyword?.trim()) return;
        submit.disabled = true;
        try {
            setState({
                searchQuery: {
                    keyword: body.keyword.trim(),
                    platform: body.source_id || state.platform,
                    quality: body.quality || state.quality,
                },
            });
            await loadSearchPage(1);
        } catch (error) {
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            clearPagination('search-pagination');
            toast(error.message, 'error');
        } finally {
            submit.disabled = false;
        }
    });

    $('[data-action="clear-search"]')?.addEventListener('click', () => {
        const keyword = form.elements.keyword;
        if (keyword) keyword.value = '';
        setState({ searchQuery: null, searchResults: [], searchPage: 1, searchTotal: 0 });
        $('[data-role="search-total"]').textContent = '0';
        list.innerHTML = '';
        clearPagination('search-pagination');
    });

    $('[data-role="search-batch-actions"]')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        const checks = $$('[data-role="search-song-check"]', list);
        if (action === 'select-search-page') {
            checks.forEach(input => { input.checked = true; });
            return;
        }
        if (action === 'clear-search-selection') {
            checks.forEach(input => { input.checked = false; });
            return;
        }
        if (!['import-selected-search', 'add-selected-search-to-playlist', 'download-selected-search', 'speaker-selected-search'].includes(action)) {
            return;
        }
        const selectedSongs = selectedSongsFromChecks(list, 'search-song-check', state.searchResults);
        button.disabled = true;
        try {
            if (!selectedSongs.length) throw new Error('请先选择歌曲');
            if (action === 'import-selected-search') await importSongs(selectedSongs);
            if (action === 'add-selected-search-to-playlist') await addSelectedSongsToCustomPlaylist(selectedCustomPlaylistId(), selectedSongs);
            if (action === 'download-selected-search') await downloadSongs(selectedSongs);
            if (action === 'speaker-selected-search') await playSonglistOnSpeaker(selectedSongs);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    bindPagination('search-pagination', loadSearchPage);
    bindSongActions(list, index => state.searchResults[index]);
}

function bindSources() {
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

    $('[data-action="refresh-sources"]')?.addEventListener('click', () => {
        loadSources().catch(error => toast(error.message, 'error'));
    });

    $('[data-role="source-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.dataset.sourceId;
        button.disabled = true;
        try {
            if (button.dataset.action === 'toggle-source') {
                await api.post('/music/sources/toggle', { id, enabled: button.dataset.enabled === 'true' });
                toast('音源状态已更新');
            }
            if (button.dataset.action === 'delete-source') {
                await api.delete(`/music/sources/${encodeURIComponent(id)}`);
                toast('音源已删除');
            }
            await loadSources();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

function bindDownloads() {
    const input = $('[data-role="download-source-file"]');
    if (input) {
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                await importDownloadSource(file);
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                input.value = '';
            }
        });
    }

    $('[data-action="refresh-download-sources"]')?.addEventListener('click', () => {
        loadDownloadSources().catch(error => toast(error.message, 'error'));
    });
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
        button.disabled = true;
        try {
            const settings = await api.post('/download/settings', body);
            setState({ downloadSettings: settings });
            applyDownloadSettings(settings);
            toast('下载设置已保存');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="download-source-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.dataset.sourceId;
        button.disabled = true;
        try {
            if (button.dataset.action === 'toggle-download-source') {
                await api.post('/download/sources/toggle', { id, enabled: button.dataset.enabled === 'true' });
                toast('下载音源状态已更新');
            }
            if (button.dataset.action === 'delete-download-source') {
                await api.delete(`/download/sources/${encodeURIComponent(id)}`);
                toast('下载音源已删除');
            }
            await loadDownloadSources();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

async function loadSongloftSongs() {
    const node = $('[data-role="songloft-songs"]');
    if (node) node.innerHTML = '<div class="empty-state">正在加载 Songloft 歌曲库...</div>';
    const data = await api.get('/songloft/songs');
    const songs = asArray(data);
    setState({ songloftSongs: songs });
    $('[data-role="songloft-songs-total"]').textContent = String(resultCount(data));
    renderSongloftSongList('songloft-songs', songs, 'Songloft 歌曲库为空。');
    return songs;
}

async function loadSongloftLocalSongs() {
    const node = $('[data-role="songloft-local-songs"]');
    if (node) node.innerHTML = '<div class="empty-state">正在加载本地歌曲...</div>';
    const data = await api.get('/songloft/local-songs');
    const songs = asArray(data);
    setState({ songloftLocalSongs: songs });
    $('[data-role="songloft-local-total"]').textContent = String(resultCount(data));
    renderSongloftSongList('songloft-local-songs', songs, '没有找到本地歌曲。');
    return songs;
}

async function loadSongloftPlaylists() {
    const node = $('[data-role="songloft-playlists"]');
    if (node) node.innerHTML = '<div class="empty-state">正在加载 Songloft 歌单...</div>';
    const data = await api.get('/songloft/playlists');
    const playlists = asArray(data);
    setState({ songloftPlaylists: playlists });
    $('[data-role="songloft-playlists-total"]').textContent = String(resultCount(data));
    renderSongloftPlaylists(playlists);
    return playlists;
}

async function loadSongloftPlaylistSongs(playlist, index) {
    const id = playlist?.id ?? playlist?.playlist_id ?? playlist?.playlistId;
    if (!id) throw new Error('Songloft 歌单缺少 ID');
    const node = $('[data-role="songloft-playlist-songs"]');
    if (node) node.innerHTML = '<div class="empty-state">正在加载歌单歌曲...</div>';
    const data = await api.get(`/songloft/playlists/${encodeURIComponent(id)}/songs`);
    const songs = asArray(data);
    setState({
        songloftPlaylistSongs: songs,
        songloftPlaylistTitle: songloftPlaylistTitle(playlist),
        songloftPlaylistIndex: index,
    });
    $('[data-role="songloft-playlist-title"]').textContent = songloftPlaylistTitle(playlist);
    $('[data-role="songloft-playlist-songs-total"]').textContent = String(resultCount(data));
    renderSongloftSongList('songloft-playlist-songs', songs, '这个 Songloft 歌单没有歌曲。');
    return songs;
}

function bindSongloftLibrary() {
    $('[data-action="load-songloft-songs"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await loadSongloftSongs();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-action="load-songloft-local-songs"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await loadSongloftLocalSongs();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-action="load-songloft-playlists"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await loadSongloftPlaylists();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="songloft-songs"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="speaker-songloft-song"]');
        if (!button) return;
        button.disabled = true;
        try {
            const song = state.songloftSongs?.[Number(button.dataset.index)];
            if (song) await playSongloftSongOnSpeaker(song);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="songloft-local-songs"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="speaker-songloft-song"]');
        if (!button) return;
        button.disabled = true;
        try {
            const song = state.songloftLocalSongs?.[Number(button.dataset.index)];
            if (song) await playSongloftSongOnSpeaker(song);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="songloft-playlists"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="view-songloft-playlist"]');
        if (!button) return;
        button.disabled = true;
        try {
            const playlist = state.songloftPlaylists?.[Number(button.dataset.index)];
            if (playlist) await loadSongloftPlaylistSongs(playlist, Number(button.dataset.index));
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="songloft-playlist-songs"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="speaker-songloft-song"]');
        if (!button) return;
        button.disabled = true;
        try {
            const song = state.songloftPlaylistSongs?.[Number(button.dataset.index)];
            if (song) await playSongloftSongOnSpeaker(song);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

function songListTitle(item) {
    return cleanDisplayText(item?.name || item?.title || item?.songlist_name) || '未命名歌单';
}

function songListId(item) {
    return item?.id || item?.list_id || item?.songlist_id || item?.source_id || item?.play_count;
}

function songListSummary(item) {
    const playCount = item?.play_count || item?.playCount || item?.total || item?.count;
    return firstText(
        item?.author,
        item?.creator,
        item?.desc,
        item?.description,
        item?.tag,
        playCount ? `${playCount} 次播放` : '',
    );
}

export function renderSongListItem(item, index) {
    return `
        <article class="songlist-row media-row" data-index="${index}">
            ${renderArtwork(item, songListTitle(item))}
            <div class="row-main">
                <strong>${escapeHtml(songListTitle(item))}</strong>
                <span>${escapeHtml(songListSummary(item))}</span>
            </div>
            <div class="row-actions">
                <button type="button" data-action="songlist-detail" data-index="${index}">查看</button>
                <button type="button" data-action="favorite-songlist" data-index="${index}">收藏</button>
            </div>
        </article>
    `;
}

function songloftPlaylistTitle(playlist) {
    return playlist?.name || playlist?.title || '未命名歌单';
}

function songloftPlaylistSummary(playlist) {
    const count = playlist?.song_count ?? playlist?.songCount ?? playlist?.count ?? playlist?.total;
    return [playlist?.type, Number.isFinite(Number(count)) ? `${count} 首` : ''].filter(Boolean).join(' · ');
}

export function renderSongloftSongRow(song, index) {
    return `
        <article class="song-row media-row">
            ${renderArtwork(song, songTitle(song))}
            <div class="row-main">
                <strong>${escapeHtml(songTitle(song))}</strong>
                <span>${escapeHtml(songArtist(song))} · ${escapeHtml(songAlbum(song))}</span>
                <span class="row-meta">${escapeHtml([songloftTypeLabel(song), durationLabel(song?.duration)].filter(Boolean).join(' · '))}</span>
            </div>
            <div class="row-actions">
                <button type="button" data-action="speaker-songloft-song" data-index="${index}">推送音箱</button>
            </div>
        </article>
    `;
}

function renderSongloftPlaylistRow(playlist, index) {
    return `
        <article class="songlist-row media-row">
            ${renderArtwork(playlist, songloftPlaylistTitle(playlist))}
            <div class="row-main">
                <strong>${escapeHtml(songloftPlaylistTitle(playlist))}</strong>
                <span>${escapeHtml(songloftPlaylistSummary(playlist))}</span>
            </div>
            <div class="row-actions">
                <button type="button" data-action="view-songloft-playlist" data-index="${index}">查看歌曲</button>
            </div>
        </article>
    `;
}

function renderSongloftSongList(role, songs, emptyText) {
    const node = $(`[data-role="${role}"]`);
    if (!node) return;
    node.innerHTML = songs.length
        ? renderListScroller(songs.map((song, index) => renderSongloftSongRow(song, index)).join(''), `${role}-scroll`)
        : `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
}

function renderSongloftPlaylists(playlists) {
    const node = $('[data-role="songloft-playlists"]');
    if (!node) return;
    node.innerHTML = playlists.length
        ? renderListScroller(playlists.map((playlist, index) => renderSongloftPlaylistRow(playlist, index)).join(''), 'songloft-playlists-scroll')
        : '<div class="empty-state">暂无 Songloft 歌单。</div>';
}

function renderSongLists(items) {
    const list = $('[data-role="songlist-list"]');
    if (!list) return;
    list.innerHTML = items.length
        ? renderListScroller(items.map((item, index) => renderSongListItem(item, index)).join(''), 'songlist-results-scroll')
        : '<div class="empty-state">暂无歌单。</div>';
}

async function loadSongListDetail(item) {
    const id = songListId(item);
    const platform = $('[data-role="songlist-platform"]')?.value || state.platform;
    if (!id) {
        toast('歌单缺少 ID，无法解析', 'error');
        return;
    }
    setState({
        songlistDetailContext: {
            id,
            platform,
            title: songListTitle(item),
        },
    });
    await loadSongListDetailPage(1);
}

async function loadSongListDetailPage(page = 1) {
    const context = state.songlistDetailContext;
    if (!context?.id) return;
    const data = await api.get(`/music/songlist/detail?source_id=${encodeURIComponent(context.platform)}&id=${encodeURIComponent(context.id)}&page=${page}&page_size=${pageSizes.songlistDetail}`);
    const songs = asArray(data);
    const total = resultCount(data);
    setState({ songlistSongs: songs, songlistDetailPage: page, songlistDetailTotal: total });
    $('[data-role="songlist-title"]').textContent = context.title;
    const detail = $('[data-role="songlist-detail"]');
    detail.innerHTML = songs.length
        ? `${renderListScroller(songs.map((song, index) => renderSongRow(song, index)).join(''), 'songlist-detail-scroll')}<div class="inline-actions"><button class="primary-button" type="button" data-action="speaker-songlist">推送整个歌单</button><button class="ghost-button" type="button" data-action="import-songlist">导入当前歌单</button><button class="ghost-button" type="button" data-action="download-songlist">下载当前歌单</button></div>`
        : '<div class="empty-state">歌单没有可显示歌曲。</div>';
    renderPaginationInto('songlist-detail-pagination', { scope: 'songlist-detail', page, total, pageSize: pageSizes.songlistDetail });
}

async function loadSongListsPage(page = 1) {
    const list = $('[data-role="songlist-list"]');
    const query = state.songlistQuery;
    if (!list || !query) return;
    list.innerHTML = '<div class="empty-state">正在加载...</div>';
    const data = query.mode === 'recommended'
        ? await api.get(`/music/songlist/list?source_id=${encodeURIComponent(query.platform)}&page=${page}&page_size=${pageSizes.songlist}`)
        : await api.post('/music/songlist/search', { keyword: query.keyword || '热门', source_id: query.platform, page, page_size: pageSizes.songlist });
    const items = asArray(data);
    const total = resultCount(data);
    setState({ songlists: items, songlistPage: page, songlistTotal: total, platform: query.platform });
    $('[data-role="songlist-total"]').textContent = String(total);
    renderSongLists(items);
    renderPaginationInto('songlist-pagination', { scope: 'songlist', page, total, pageSize: pageSizes.songlist });
}

function bindSongLists() {
    const form = $('[data-role="songlist-form"]');
    const list = $('[data-role="songlist-list"]');
    const detail = $('[data-role="songlist-detail"]');
    if (!form || !list || !detail) return;

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const submitter = event.submitter;
        const body = Object.fromEntries(new FormData(form).entries());
        const platform = body.source_id || state.platform;
        const mode = submitter?.value || 'search';
        const title = $('[data-role="songlist-title"]');
        try {
            setState({
                songlistQuery: {
                    mode,
                    platform,
                    keyword: String(body.keyword || '热门'),
                },
                songlistDetailContext: null,
                songlistSongs: [],
            });
            if (title) title.textContent = '详情';
            detail.innerHTML = '';
            clearPagination('songlist-detail-pagination');
            await loadSongListsPage(1);
        } catch (error) {
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            clearPagination('songlist-pagination');
            toast(error.message, 'error');
        }
    });

    list.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="songlist-detail"], [data-action="favorite-songlist"]');
        if (!button) return;
        const item = state.songlists?.[Number(button.dataset.index)];
        if (!item) return;
        const id = songListId(item);
        const platform = state.songlistQuery?.platform || $('[data-role="songlist-platform"]')?.value || state.platform;
        try {
            if (button.dataset.action === 'songlist-detail') {
                await loadSongListDetail(item);
                return;
            }
            if (!id) {
                toast('歌单缺少 ID，无法收藏', 'error');
                return;
            }
            button.disabled = true;
            await favoriteSongListFromSource(platform, id);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    bindSongActions(detail, index => state.songlistSongs?.[index]);
    bindPagination('songlist-pagination', loadSongListsPage);
    bindPagination('songlist-detail-pagination', loadSongListDetailPage);
    detail.addEventListener('click', async event => {
        const speakerButton = event.target.closest('[data-action="speaker-songlist"]');
        const importButton = event.target.closest('[data-action="import-songlist"]');
        const downloadButton = event.target.closest('[data-action="download-songlist"]');
        if (!speakerButton && !importButton && !downloadButton) return;
        const button = speakerButton || importButton || downloadButton;
        button.disabled = true;
        try {
            if (speakerButton) await playSonglistOnSpeaker(state.songlistSongs || []);
            if (importButton) await importSongs(state.songlistSongs || []);
            if (downloadButton) await downloadSongs(state.songlistSongs || []);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}

function boardTitle(board) {
    return board?.name || board?.title || board?.label || '未命名榜单';
}

function boardId(board) {
    return board?.id || board?.board_id || board?.source_id || board?.bangid || board?.榜单id;
}

function boardSummary(board) {
    return board?.desc || board?.description || board?.updateTime || board?.source_name || board?.source || '';
}

export function renderRankingBoard(board, index) {
    return `
        <button class="ranking-row media-row" type="button" data-action="ranking-detail" data-index="${index}">
            ${renderArtwork(board, boardTitle(board))}
            <span class="row-main">
                <strong>${escapeHtml(boardTitle(board))}</strong>
                <span>${escapeHtml(boardSummary(board))}</span>
            </span>
        </button>
    `;
}

async function loadRankingPage(page = 1) {
    const context = state.rankingContext;
    const songsNode = $('[data-role="ranking-songs"]');
    if (!context?.id || !songsNode) return;
    songsNode.innerHTML = '<div class="empty-state">正在加载歌曲...</div>';
    const data = await api.get(`/music/leaderboard/list?source_id=${encodeURIComponent(context.platform)}&id=${encodeURIComponent(context.id)}&page=${page}&page_size=${pageSizes.ranking}`);
    const songs = asArray(data);
    const total = resultCount(data);
    setState({ rankingSongs: songs, rankingPage: page, rankingTotal: total });
    $('[data-role="ranking-title"]').textContent = context.title;
    songsNode.innerHTML = songs.length
        ? renderListScroller(songs.map((song, index) => renderSongRow(song, index)).join(''), 'ranking-songs-scroll')
        : '<div class="empty-state">榜单没有可显示歌曲。</div>';
    renderPaginationInto('ranking-pagination', { scope: 'ranking', page, total, pageSize: pageSizes.ranking });
}

function bindRankings() {
    const boardsNode = $('[data-role="ranking-list"]');
    const songsNode = $('[data-role="ranking-songs"]');
    if (!boardsNode || !songsNode) return;

    $('[data-action="load-rankings"]')?.addEventListener('click', async () => {
        const platform = $('[data-role="ranking-platform"]')?.value || state.platform;
        boardsNode.innerHTML = '<div class="empty-state">正在加载榜单...</div>';
        try {
            const data = await api.get(`/music/leaderboard/boards?source_id=${encodeURIComponent(platform)}`);
            const boards = asArray(data);
            setState({ rankingBoards: boards, rankingContext: null, rankingSongs: [], platform });
            boardsNode.innerHTML = boards.length
                ? boards.map((board, index) => renderRankingBoard(board, index)).join('')
                : '<div class="empty-state">暂无榜单。</div>';
            songsNode.innerHTML = '';
            clearPagination('ranking-pagination');
        } catch (error) {
            boardsNode.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            toast(error.message, 'error');
        }
    });

    boardsNode.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="ranking-detail"]');
        if (!button) return;
        const board = state.rankingBoards?.[Number(button.dataset.index)];
        const id = boardId(board);
        const platform = $('[data-role="ranking-platform"]')?.value || state.platform;
        if (!id) {
            toast('榜单缺少 ID，无法加载', 'error');
            return;
        }
        try {
            setState({
                rankingContext: {
                    id,
                    platform,
                    title: boardTitle(board),
                },
            });
            await loadRankingPage(1);
        } catch (error) {
            songsNode.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            clearPagination('ranking-pagination');
            toast(error.message, 'error');
        }
    });

    bindPagination('ranking-pagination', loadRankingPage);
    bindSongActions(songsNode, index => state.rankingSongs?.[index]);
}

export async function initMusicUI() {
    installArtworkFallback();
    bindSearch();
    bindSources();
    bindDownloads();
    bindSongloftLibrary();
    bindSongLists();
    bindRankings();
    bindCustomPlaylists();
    await loadPlatforms().catch(error => toast(error.message, 'error'));
    await loadSources().catch(error => toast(error.message, 'error'));
    await loadDownloadSources().catch(error => toast(error.message, 'error'));
    await loadDownloadSettings().catch(error => toast(error.message, 'error'));
    await loadDownloadProgress().catch(error => toast(error.message, 'error'));
    await loadCustomPlaylists().catch(error => toast(error.message, 'error'));
}
