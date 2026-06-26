import { api } from '../api.js';
import { asArray } from '../shared/arrays.js';
import { $, $$, durationLabel, escapeHtml, selectedDevicePayload, setState, state, toast } from '../state.js';
import { clampPage, pageCount, pageFromPagination, pageSizes, renderPagination } from './pagination.js';
import { renderArtwork, renderListScroller, renderSongloftSongRow, songAlbum, songArtist, songTitle } from './renderers.js';

let customPlaylistDependencies = null;

const builtinPlatformNames = {
    kw: '酷我',
    kg: '酷狗',
    tx: 'QQ 音乐',
    mg: '咪咕',
    wy: '网易云',
};

export function setCustomPlaylistDependencies(dependencies) {
    customPlaylistDependencies = dependencies;
}

function getCustomPlaylistDependencies() {
    if (customPlaylistDependencies) return customPlaylistDependencies;
    throw new Error('Custom playlist dependencies are not configured');
}

function sourceDisplayName(id) {
    return state.platforms.find(item => item.id === id)?.name || builtinPlatformNames[id] || id || '未知';
}

function songloftPlaylistId(playlist) {
    const id = playlist?.id ?? playlist?.playlist_id;
    return id === undefined || id === null ? '' : String(id);
}

function songloftPlaylistName(playlist) {
    return playlist?.name || playlist?.title || '未命名歌单';
}

function currentViewedCustomPlaylist() {
    return (state.customPlaylists || []).find(playlist => playlist.id === state.customPlaylistDetailId);
}

function playlistSongLabel(song) {
    return `${song?.title || '未知歌曲'} - ${song?.artist || '未知歌手'}${song?.source_name ? `（${song.source_name}）` : ''}`;
}

function customPlaylistSongMeta(song) {
    const source = song?.source_name || sourceDisplayName(song?.source_data?.platform);
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
    const selected = asArray(state.songloftTargetPlaylists)
        .find(playlist => songloftPlaylistId(playlist) === state.songloftTargetPlaylistId);
    const label = selected
        ? songloftPlaylistName(selected)
        : state.songloftTargetPlaylistName || '未选择 Songloft 歌单';
    $$('[data-role="target-playlist-label"]').forEach(node => {
        node.textContent = label;
    });
}

export function renderCustomPlaylistItem(playlist) {
    const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
    const meta = [playlist?.source_name, `${songs.length} 首`].filter(Boolean).join(' · ');
    const songPreview = songs.slice(0, 3).map(song => `<span>${escapeHtml(playlistSongLabel(song))}</span>`).join('');
    const viewed = playlist?.id && playlist.id === state.customPlaylistDetailId;
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
                ${playlist?.source && playlist?.sourceListId ? `<button type="button" data-action="speaker-custom-playlist" data-playlist-id="${escapeHtml(playlist.id)}">推送音箱</button>` : ''}
                <button type="button" data-action="delete-custom-playlist" data-playlist-id="${escapeHtml(playlist?.id || '')}">删除</button>
            </div>
        </article>
    `;
}

export function renderCustomPlaylistDetail(playlist, page = state.customPlaylistDetailPage || 1) {
    if (!playlist) {
        return '<div class="empty-state">选择一个歌单后可查看歌曲明细，并将选中的歌曲加入 Songloft 歌单。</div>';
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
                ${songs.length ? `<button class="primary-button" type="button" data-action="add-selected-custom-playlist-songs">加入选中到歌单</button><button class="ghost-button" type="button" data-action="download-selected-custom-playlist-songs">下载选中歌曲</button>` : ''}
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

function renderSongloftTargetPlaylistSongs(songs = asArray(state.songloftTargetPlaylistSongs), options = {}) {
    const list = $('[data-role="custom-playlist-list"]');
    const detail = $('[data-role="custom-playlist-detail"]');
    if (detail) detail.innerHTML = '';
    if (!list) return;

    if (options.loading) {
        list.innerHTML = '<div class="empty-state">正在加载歌单歌曲...</div>';
        return;
    }

    if (options.error) {
        list.innerHTML = `<div class="empty-state">${escapeHtml(options.error)}</div>`;
        return;
    }

    if (!state.songloftTargetPlaylistId) {
        list.innerHTML = '<div class="empty-state">请选择 Songloft 歌单。</div>';
        return;
    }

    const title = state.songloftTargetPlaylistName || 'Songloft 歌单';
    list.innerHTML = `
        <section class="custom-playlist-detail-panel songloft-target-playlist-panel">
            <div class="section-bar">
                <div>
                    <h2>${escapeHtml(title)}</h2>
                    <span>${songs.length} 首</span>
                </div>
            </div>
            ${songs.length
                ? renderListScroller(songs.map((song, index) => renderSongloftSongRow(song, index)).join(''), 'songloft-target-playlist-scroll', 'list-stack tight')
                : '<div class="empty-state">这个 Songloft 歌单没有歌曲。</div>'}
        </section>
    `;
}

async function loadSongloftTargetPlaylistSongs(playlistId = state.songloftTargetPlaylistId) {
    const id = String(playlistId || '').trim();
    if (!id) {
        setState({ songloftTargetPlaylistSongs: [] });
        renderSongloftTargetPlaylistSongs([]);
        return [];
    }

    renderSongloftTargetPlaylistSongs([], { loading: true });
    const data = await api.get(`/songloft/playlists/${encodeURIComponent(id)}/songs`);
    const songs = asArray(data);
    setState({ songloftTargetPlaylistSongs: songs });
    renderSongloftTargetPlaylistSongs(songs);
    return songs;
}

function renderCustomPlaylists() {
    const list = $('[data-role="custom-playlist-list"]');
    const select = $('[data-role="custom-playlist-select"]');
    const playlists = state.customPlaylists || [];
    const targetPlaylists = asArray(state.songloftTargetPlaylists);
    if (select) {
        const playlistOptions = targetPlaylists
            .map(playlist => `<option value="${escapeHtml(songloftPlaylistId(playlist))}">${escapeHtml(songloftPlaylistName(playlist))}</option>`)
            .join('');
        select.innerHTML = `<option value="">请选择 Songloft 歌单</option>${playlistOptions}`;
        const currentId = String(state.songloftTargetPlaylistId || '');
        const nextPlaylistId = currentId && targetPlaylists.some(playlist => songloftPlaylistId(playlist) === currentId)
            ? currentId
            : '';
        select.value = nextPlaylistId;
        const selected = targetPlaylists.find(playlist => songloftPlaylistId(playlist) === nextPlaylistId);
        const nextPlaylistName = selected ? songloftPlaylistName(selected) : '';
        if (nextPlaylistId !== state.songloftTargetPlaylistId || nextPlaylistName !== state.songloftTargetPlaylistName) {
            setState({
                songloftTargetPlaylistId: nextPlaylistId,
                songloftTargetPlaylistName: nextPlaylistName,
                ...(!nextPlaylistId ? { songloftTargetPlaylistSongs: [] } : {}),
            });
        }
    }
    if (state.customPlaylistDetailId && !playlists.some(playlist => playlist.id === state.customPlaylistDetailId)) {
        setState({ customPlaylistDetailId: '', customPlaylistDetailPage: 1 });
    }
    if (!list) return;
    renderSongloftTargetPlaylistSongs();
    updateTargetPlaylistLabels();
}

export async function loadCustomPlaylists() {
    const [playlists, songloftPlaylists] = await Promise.all([
        api.get('/custom-playlists').then(asArray),
        api.get('/songloft/playlists')
            .then(asArray)
            .catch(error => {
                toast(error.message || 'Songloft 歌单加载失败', 'error');
                return asArray(state.songloftTargetPlaylists);
            }),
    ]);
    setState({
        customPlaylists: playlists,
        songloftTargetPlaylists: songloftPlaylists,
    });
    renderCustomPlaylists();
    return playlists;
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
    toast(`已同步 ${result?.total ?? 0} 首到歌单${result?.skipped ? `，跳过 ${result.skipped} 首` : ''}`);
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
    toast('歌单已推送到音箱');
    return result;
}

async function deleteCustomPlaylist(playlistId) {
    const result = await api.delete(`/custom-playlists/${encodeURIComponent(playlistId)}`);
    toast('歌单已删除');
    await loadCustomPlaylists();
    return result;
}

export function bindCustomPlaylists() {
    const {
        downloadSong,
        downloadSongs,
        playOnSpeaker,
        playResolvedSongOnSpeaker,
        playSongloftSongOnSpeaker,
        openSongloftPlaylistTarget,
        setControlDisabled,
    } = getCustomPlaylistDependencies();
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
        setControlDisabled(button, true);
        try {
            await createCustomPlaylist(body.name.trim());
            createForm.reset();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setControlDisabled(button, false);
        }
    });

    importForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const button = importForm.querySelector('button[type="submit"]');
        const body = Object.fromEntries(new FormData(importForm).entries());
        if (!body.id?.trim()) return;
        setControlDisabled(button, true);
        try {
            await importCustomPlaylistFromSource(body.source_id || state.platform, body.id.trim());
            importForm.reset();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setControlDisabled(button, false);
        }
    });

    select?.addEventListener('change', async () => {
        const selected = asArray(state.songloftTargetPlaylists)
            .find(playlist => songloftPlaylistId(playlist) === select.value);
        setState({
            songloftTargetPlaylistId: select.value,
            songloftTargetPlaylistName: selected ? songloftPlaylistName(selected) : '',
            songloftTargetPlaylistSongs: [],
        });
        updateTargetPlaylistLabels();
        try {
            await loadSongloftTargetPlaylistSongs(select.value);
        } catch (error) {
            setState({ songloftTargetPlaylistSongs: [] });
            renderSongloftTargetPlaylistSongs([], { error: error.message || '歌单歌曲加载失败' });
            toast(error.message || '歌单歌曲加载失败', 'error');
        }
    });

    list?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (button.dataset.action === 'speaker-songloft-song') {
            button.disabled = true;
            try {
                const song = asArray(state.songloftTargetPlaylistSongs)[Number(button.dataset.index)];
                if (song) {
                    if (playSongloftSongOnSpeaker) await playSongloftSongOnSpeaker(song);
                    else await playResolvedSongOnSpeaker(song);
                }
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                button.disabled = false;
            }
            return;
        }
        const playlistId = button.dataset.playlistId;
        if (!playlistId) return;
        button.disabled = true;
        try {
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
                if (song) await openSongloftPlaylistTarget([song]);
            }
            if (button.dataset.action === 'add-selected-custom-playlist-songs') {
                const selectedSongs = $$('[data-role="custom-playlist-song-check"]:checked', detail)
                    .map(input => songs[Number(input.dataset.index)])
                    .filter(Boolean);
                await openSongloftPlaylistTarget(selectedSongs);
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
