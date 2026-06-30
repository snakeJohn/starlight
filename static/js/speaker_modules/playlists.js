import { api } from '../api.js';
import { asArray, resultCount } from '../shared/arrays.js';
import { $, $$, durationLabel, escapeHtml, selectedDevicePayload, setState, state, toast } from '../state.js';
import { renderArtwork, songArtist, songTitle, songloftPlaylistTitle } from '../music_modules/renderers.js';

function playlistId(playlist) {
    const id = playlist?.id ?? playlist?.playlist_id ?? playlist?.playlistId;
    return id === undefined || id === null ? '' : String(id);
}

function playlistCount(playlist) {
    return playlist?.song_count ?? playlist?.songCount ?? playlist?.count ?? playlist?.total ?? 0;
}

function speakerPlaylistSummary(playlist) {
    return `普通歌单 · ${playlistCount(playlist)} 首`;
}

function playablePlaylistId(id) {
    const parsed = Number(id);
    if (!Number.isFinite(parsed)) throw new Error('Songloft 歌单 ID 无效');
    return parsed;
}

function isSpeakerNormalPlaylist(playlist) {
    return String(playlist?.type || '').trim().toLowerCase() !== 'radio';
}

function setSummary(text) {
    const node = $('[data-role="speaker-playlist-summary"]');
    if (node) node.textContent = text;
}

function drawerOpen() {
    const drawer = $('[data-role="speaker-song-list-drawer"]');
    return drawer && !drawer.classList.contains('open');
}

// 渲染歌单行
function renderPlaylistRow(playlist, active) {
    const activeClass = active ? ' active' : '';
    return `<button class="speaker-playlist-row songlist-row media-row speaker-song-list-playlist-row${activeClass}" type="button" data-action="speaker-song-list-playlist-select" data-id="${escapeHtml(playlistId(playlist))}">
        ${renderArtwork(playlist, songloftPlaylistTitle(playlist))}
        <span class="row-main">
            <strong>${escapeHtml(songloftPlaylistTitle(playlist))}</strong>
            <span>${escapeHtml(speakerPlaylistSummary(playlist))}</span>
        </span>
    </button>`;
}

// 渲染歌曲行
function renderSongRow(song, index, isCurrent) {
    const activeClass = isCurrent ? ' active' : '';
    return `<button class="speaker-playlist-song-row speaker-song-list-song-row song-row media-row${activeClass}" type="button" data-action="speaker-song-list-song" data-index="${index}">
        ${isCurrent ? '<span class="speaker-song-list-current-marker" aria-hidden="true"></span>' : '<span class="speaker-song-list-index">${index + 1}</span>'}
        ${renderArtwork(song, songTitle(song))}
        <span class="row-main">
            <strong>${escapeHtml(songTitle(song))}</strong>
            <span>${escapeHtml(songArtist(song))}</span>
            <span class="row-meta">${escapeHtml(durationLabel(song?.duration))}</span>
        </span>
        <span class="material-symbols-outlined speaker-playlist-playmark" aria-hidden="true">play_arrow</span>
    </button>`;
}

// 加载歌单列表到 drawer
async function loadDrawerPlaylists() {
    const container = $('[data-role="speaker-song-list-playlists"]');
    if (!container) return;
    try {
        const data = await api.get('/songloft/playlists');
        const playlists = asArray(data).filter(isSpeakerNormalPlaylist);
        setState({ speakerPlaylists: playlists });
        const currentId = state.speakerPlaylistId;
        container.innerHTML = playlists.length
            ? `<div class="list-scroll"><div class="list-stack tight">${playlists.map(p => renderPlaylistRow(p, playlistId(p) === currentId)).join('')}</div></div>`
            : '<div class="empty-state">暂无普通歌单。</div>';
        return playlists;
    } catch (e) {
        container.innerHTML = '<div class="empty-state">歌单加载失败</div>';
        throw e;
    }
}

// 加载歌曲列表到 drawer
async function loadDrawerSongs(plId) {
    const container = $('[data-role="speaker-song-list-songs"]');
    const summary = $('[data-role="speaker-song-list-summary"]');
    const title = $('[data-role="speaker-song-list-title"]');
    if (!container) return;
    if (!plId) {
        container.innerHTML = '<div class="empty-state">请选择歌单。</div>';
        if (summary) summary.textContent = '请选择歌单';
        if (title) title.textContent = '歌曲列表';
        return;
    }
    try {
        container.innerHTML = '<div class="empty-state">加载歌曲中...</div>';
        const data = await api.get(`/songloft/playlists/${encodeURIComponent(plId)}/songs`);
        const songs = asArray(data);
        setState({ speakerPlaylistSongs: songs, speakerPlaylistId: String(plId) });
        const currentIndex = String(state.speakerPlayerPlaylistId || '') === String(plId)
            ? Number(state.speakerPlayerCurrentIndex)
            : -1;
        const playlist = (state.speakerPlaylists || []).find(p => playlistId(p) === String(plId));
        if (title) title.textContent = playlist ? songloftPlaylistTitle(playlist) : '歌曲列表';
        if (summary) summary.textContent = songs.length ? `${songs.length} 首` : '暂无歌曲';
        container.innerHTML = songs.length
            ? `<div class="list-scroll"><div class="list-stack tight">${songs.map((s, i) => renderSongRow(s, i, i === currentIndex)).join('')}</div></div>`
            : '<div class="empty-state">这个歌单没有歌曲。</div>';
        return songs;
    } catch (e) {
        container.innerHTML = '<div class="empty-state">歌曲加载失败</div>';
        throw e;
    }
}

export async function openSpeakerSongListDrawer() {
    const drawer = $('[data-role="speaker-song-list-drawer"]');
    if (!drawer) return;
    drawer.classList.add('open');
    const plId = state.speakerPlayerPlaylistId || state.speakerPlaylistId || '';
    await loadDrawerPlaylists().catch(() => null);
    await loadDrawerSongs(plId).catch(() => null);
}

export function closeSpeakerSongListDrawer() {
    const drawer = $('[data-role="speaker-song-list-drawer"]');
    if (!drawer) return;
    drawer.classList.remove('open');
}

async function playDrawerSong(index) {
    const playlist = (state.speakerPlaylists || []).find(p => playlistId(p) === String(state.speakerPlaylistId));
    const id = playlistId(playlist);
    if (!id) throw new Error('请先选择歌单');
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) throw new Error('请先选择账号和设备');
    const mode = $('[data-role="speaker-player-mode"]')?.value || 'loop';
    return await api.post('/miot/player/play', {
        ...payload,
        playlist_id: playablePlaylistId(id),
        start_index: Number(index) || 0,
        play_mode: mode,
    });
}

export function bindSpeakerSongListDrawer({ refreshPlayerStatus } = {}) {
    $$('[data-action="speaker-player-song-list"]').forEach(btn => {
        btn.addEventListener('click', async event => {
            event.stopPropagation?.();
            const node = event.currentTarget;
            if (node) node.disabled = true;
            try {
                await openSpeakerSongListDrawer();
            } catch (e) {
                toast(e.message, 'error');
            } finally {
                if (node) node.disabled = false;
            }
        });
    });

    $$('[data-action="close-speaker-song-list"]').forEach(btn => {
        btn.addEventListener('click', event => {
            event.stopPropagation?.();
            closeSpeakerSongListDrawer();
        });
    });

    $('[data-action="speaker-song-list-refresh"]')?.addEventListener('click', async event => {
        const btn = event.currentTarget;
        if (btn) btn.disabled = true;
        try {
            const id = state.speakerPlaylistId || state.speakerPlayerPlaylistId || '';
            await Promise.all([loadDrawerPlaylists(), loadDrawerSongs(id)]);
            toast('已刷新');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // 歌单选择和歌曲列表事件委托
    $('[data-role="speaker-song-list-playlists"]')?.addEventListener('click', async event => {
        const btn = event.target.closest('[data-action="speaker-song-list-playlist-select"]');
        if (!btn) return;
        const id = btn.dataset.id || '';
        setState({ speakerPlaylistId: id });
        // 更新歌单行高亮
        const container = $('[data-role="speaker-song-list-playlists"]');
        if (container) {
            const rows = container.querySelectorAll('[data-action="speaker-song-list-playlist-select"]');
            rows.forEach(r => r.classList.remove('active'));
            btn.classList.add('active');
        }
        await loadDrawerSongs(id);
    });

    $('[data-role="speaker-song-list-songs"]')?.addEventListener('click', async event => {
        const btn = event.target.closest('[data-action="speaker-song-list-song"]');
        if (!btn) return;
        btn.disabled = true;
        try {
            await playDrawerSong(btn.dataset.index);
            await refreshPlayerStatus?.();
            closeSpeakerSongListDrawer();
            toast('已推送歌曲到音箱');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    });

    // 点击背景关闭
    $('[data-role="speaker-song-list-drawer"]')?.addEventListener('click', event => {
        if (event.target === event.currentTarget || event.target.classList.contains('speaker-song-list-backdrop')) {
            closeSpeakerSongListDrawer();
        }
    });
}

// ===== 音箱页歌单（保留原有，上层调用依然可用）=====

function renderPlaylistOptions(playlists) {
    const select = $('[data-role="speaker-playlist-select"]');
    if (!select) return;
    select.innerHTML = [
        '<option value="">请选择歌单</option>',
        ...playlists.filter(isSpeakerNormalPlaylist).map(playlist => {
            const id = playlistId(playlist);
            const count = playlistCount(playlist);
            return `<option value="${escapeHtml(id)}">${escapeHtml(songloftPlaylistTitle(playlist))} (${escapeHtml(count)})</option>`;
        }),
    ].join('');
    select.value = state.speakerPlaylistId || '';
}

function renderPlaylistList(playlists) {
    playlists = playlists.filter(isSpeakerNormalPlaylist);
    const list = $('[data-role="speaker-playlist-list"]');
    if (!list) return;
    list.innerHTML = playlists.length
        ? `<div class="list-scroll speaker-playlist-scroll"><div class="list-stack tight">${playlists.map((p, i) => {
            const id = playlistId(p);
            const active = id && id === state.speakerPlaylistId ? ' active' : '';
            return `<button class="speaker-playlist-row songlist-row media-row${active}" type="button" data-action="speaker-playlist-select" data-index="${i}">
                ${renderArtwork(p, songloftPlaylistTitle(p))}
                <span class="row-main">
                    <strong>${escapeHtml(songloftPlaylistTitle(p))}</strong>
                    <span>${escapeHtml(speakerPlaylistSummary(p))}</span>
                </span>
                <span class="speaker-playlist-count" aria-hidden="true">${escapeHtml(playlistCount(p))} 首</span>
            </button>`;
        }).join('')}</div></div>`
        : '<div class="empty-state">暂无 Songloft 普通歌单。</div>';
}

function renderSongList(songs) {
    const list = $('[data-role="speaker-playlist-songs"]');
    if (!list) return;
    list.innerHTML = songs.length
        ? `<div class="list-scroll speaker-playlist-song-scroll"><div class="list-stack tight">${songs.map((song, index) => {
            return `<button class="speaker-playlist-song-row song-row media-row" type="button" data-action="speaker-playlist-song" data-index="${index}">
                <span class="speaker-song-list-index">${index + 1}</span>
                ${renderArtwork(song, songTitle(song))}
                <span class="row-main">
                    <strong>${escapeHtml(songTitle(song))}</strong>
                    <span>${escapeHtml(songArtist(song))}</span>
                    <span class="row-meta">${escapeHtml(durationLabel(song?.duration))}</span>
                </span>
                <span class="material-symbols-outlined speaker-playlist-playmark" aria-hidden="true">play_arrow</span>
            </button>`;
        }).join('')}</div></div>`
        : '<div class="empty-state">这个歌单没有歌曲。</div>';
}

export async function loadSpeakerPlaylistSongs(id = state.speakerPlaylistId) {
    const list = $('[data-role="speaker-playlist-songs"]');
    if (!list || !id) {
        if (list) list.innerHTML = '<div class="empty-state">请选择歌单。</div>';
        setState({ speakerPlaylistSongs: [], speakerPlaylistId: id || '' });
        return [];
    }
    list.innerHTML = '<div class="empty-state">正在加载歌单歌曲...</div>';
    const data = await api.get(`/songloft/playlists/${encodeURIComponent(id)}/songs`);
    const songs = asArray(data);
    setState({ speakerPlaylistSongs: songs, speakerPlaylistId: String(id) });
    renderSongList(songs);
    setSummary(`${resultCount(data)} 首`);
    return songs;
}

export async function loadSpeakerPlaylists() {
    const select = $('[data-role="speaker-playlist-select"]');
    const list = $('[data-role="speaker-playlist-list"]');
    if (!select && !list) return [];
    setSummary('加载中');
    if (list) list.innerHTML = '<div class="empty-state">正在加载 Songloft 歌单...</div>';
    const data = await api.get('/songloft/playlists');
    const playlists = asArray(data);
    const normalPlaylists = playlists.filter(isSpeakerNormalPlaylist);
    const currentId = state.speakerPlaylistId;
    const nextId = normalPlaylists.some(p => playlistId(p) === currentId) ? currentId : playlistId(normalPlaylists[0]);
    setState({ speakerPlaylists: normalPlaylists, speakerPlaylistId: nextId || '' });
    renderPlaylistOptions(playlists);
    renderPlaylistList(playlists);
    setSummary(`${resultCount(data)} 个歌单`);
    if (nextId) await loadSpeakerPlaylistSongs(nextId);
    else await loadSpeakerPlaylistSongs('');
    return normalPlaylists;
}

async function playSpeakerPlaylist(startIndex = 0) {
    const playlist = selectedPlaylist();
    const id = playlistId(playlist);
    if (!id) throw new Error('请先选择歌单');
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) throw new Error('请先选择账号和设备');
    const mode = $('[data-role="speaker-player-mode"]')?.value || 'loop';
    return await api.post('/miot/player/play', {
        ...payload,
        playlist_id: playablePlaylistId(id),
        start_index: startIndex,
        play_mode: mode,
    });
}

function selectedPlaylist() {
    const id = state.speakerPlaylistId || $('[data-role="speaker-playlist-select"]')?.value || '';
    return (state.speakerPlaylists || []).find(p => playlistId(p) === id) || null;
}

export function bindSpeakerPlaylists({ refreshPlayerStatus } = {}) {
    bindSpeakerSongListDrawer({ refreshPlayerStatus });

    $('[data-action="speaker-playlist-refresh"]')?.addEventListener('click', async event => {
        const btn = event.currentTarget;
        if (btn) btn.disabled = true;
        try {
            await loadSpeakerPlaylists();
            toast('歌单已刷新');
        } catch (e) {
            setSummary('加载失败');
            toast(e.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    $('[data-role="speaker-playlist-select"]')?.addEventListener('change', async event => {
        const id = event.currentTarget.value || '';
        setState({ speakerPlaylistId: id });
        renderPlaylistList(state.speakerPlaylists || []);
        try { await loadSpeakerPlaylistSongs(id); } catch (e) { toast(e.message, 'error'); }
    });

    $('[data-role="speaker-playlist-list"]')?.addEventListener('click', async event => {
        const btn = event.target.closest('[data-action="speaker-playlist-select"]');
        if (!btn) return;
        const playlist = state.speakerPlaylists?.[Number(btn.dataset.index)];
        const id = playlistId(playlist);
        if (!id) return;
        const select = $('[data-role="speaker-playlist-select"]');
        if (select) select.value = id;
        setState({ speakerPlaylistId: id });
        renderPlaylistList(state.speakerPlaylists || []);
        try { await loadSpeakerPlaylistSongs(id); } catch (e) { toast(e.message, 'error'); }
    });

    $('[data-action="speaker-playlist-play"]')?.addEventListener('click', async event => {
        const btn = event.currentTarget;
        if (btn) btn.disabled = true;
        try {
            await playSpeakerPlaylist(0);
            await refreshPlayerStatus?.();
            toast('已开始播放歌单');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    $('[data-role="speaker-playlist-songs"]')?.addEventListener('click', async event => {
        const btn = event.target.closest('[data-action="speaker-playlist-song"]');
        if (!btn) return;
        btn.disabled = true;
        try {
            await playSpeakerPlaylist(Number(btn.dataset.index) || 0);
            await refreshPlayerStatus?.();
            toast('已推送歌曲到音箱');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    });
}

