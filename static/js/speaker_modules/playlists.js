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

function playablePlaylistId(id) {
    const parsed = Number(id);
    if (!Number.isFinite(parsed)) {
        throw new Error('Songloft 歌单 ID 无效');
    }
    return parsed;
}

function setSummary(text) {
    const node = $('[data-role="speaker-playlist-summary"]');
    if (node) node.textContent = text;
}

function renderPlaylistOptions(playlists) {
    const select = $('[data-role="speaker-playlist-select"]');
    if (!select) return;
    select.innerHTML = [
        '<option value="">请选择歌单</option>',
        ...playlists.map(playlist => {
            const id = playlistId(playlist);
            const count = playlistCount(playlist);
            return `<option value="${escapeHtml(id)}">${escapeHtml(songloftPlaylistTitle(playlist))} (${escapeHtml(count)})</option>`;
        }),
    ].join('');
    select.value = state.speakerPlaylistId || '';
}

function renderPlaylistList(playlists) {
    const list = $('[data-role="speaker-playlist-list"]');
    if (!list) return;
    list.innerHTML = playlists.length
        ? `<div class="list-scroll speaker-playlist-scroll"><div class="list-stack tight">${
            playlists.map((playlist, index) => {
                const id = playlistId(playlist);
                const active = id && id === state.speakerPlaylistId ? ' active' : '';
                return `
                    <button class="speaker-playlist-row media-row${active}" type="button" data-action="speaker-playlist-select" data-index="${index}">
                        ${renderArtwork(playlist, songloftPlaylistTitle(playlist))}
                        <span class="row-main">
                            <strong>${escapeHtml(songloftPlaylistTitle(playlist))}</strong>
                            <span>${escapeHtml(playlistCount(playlist))} 首歌曲</span>
                        </span>
                    </button>
                `;
            }).join('')
        }</div></div>`
        : '<div class="empty-state">暂无 Songloft 歌单。</div>';
}

function renderSongRows(songs, action, activeIndex = -1) {
    return songs.map((song, index) => {
        const active = index === activeIndex ? ' active' : '';
        return `
            <button class="speaker-playlist-song-row speaker-song-list-row song-row media-row${active}" type="button" data-action="${action}" data-index="${index}">
                <span class="speaker-song-list-index">${index + 1}</span>
                ${renderArtwork(song, songTitle(song))}
                <span class="row-main">
                    <strong>${escapeHtml(songTitle(song))}</strong>
                    <span>${escapeHtml(songArtist(song))}</span>
                    <span class="row-meta">${escapeHtml(durationLabel(song?.duration))}</span>
                </span>
                <span class="material-symbols-outlined speaker-playlist-playmark" aria-hidden="true">play_arrow</span>
            </button>
        `;
    }).join('');
}

function renderSongList(songs) {
    const list = $('[data-role="speaker-playlist-songs"]');
    if (!list) return;
    list.innerHTML = songs.length
        ? `<div class="list-scroll speaker-playlist-song-scroll"><div class="list-stack tight">${renderSongRows(songs, 'speaker-playlist-song')}</div></div>`
        : '<div class="empty-state">这个歌单没有歌曲。</div>';
}

function playlistById(id) {
    const targetId = id === undefined || id === null ? '' : String(id);
    if (!targetId) return null;
    return (state.speakerPlaylists || []).find(playlist => playlistId(playlist) === targetId) || null;
}

function selectedPlaylist() {
    const id = state.speakerPlaylistId || $('[data-role="speaker-playlist-select"]')?.value || '';
    return playlistById(id);
}

function activeSongListPlaylistId() {
    const playerPlaylistId = state.speakerPlayerPlaylistId === undefined || state.speakerPlayerPlaylistId === null
        ? ''
        : String(state.speakerPlayerPlaylistId);
    if (playerPlaylistId && Number(playerPlaylistId) > 0) return playerPlaylistId;
    return state.speakerPlaylistId || playlistId((state.speakerPlaylists || [])[0]);
}

function renderSpeakerSongListDialog(songs = state.speakerPlaylistSongs || []) {
    const title = $('[data-role="speaker-song-list-title"]');
    const summary = $('[data-role="speaker-song-list-summary"]');
    const list = $('[data-role="speaker-song-list"]');
    const playlist = selectedPlaylist();
    if (title) title.textContent = playlist ? songloftPlaylistTitle(playlist) : '歌曲列表';
    if (summary) summary.textContent = songs.length ? `${songs.length} 首` : '暂无歌曲';
    if (!list) return;
    const activeIndex = String(state.speakerPlayerPlaylistId || '') === String(state.speakerPlaylistId || '')
        ? Number(state.speakerPlayerCurrentIndex)
        : -1;
    list.innerHTML = songs.length
        ? `<div class="list-scroll speaker-song-list-scroll"><div class="list-stack tight">${renderSongRows(songs, 'speaker-song-list-song', activeIndex)}</div></div>`
        : '<div class="empty-state">当前歌单没有歌曲。</div>';
}

async function ensureSpeakerSongListSongs({ force = false } = {}) {
    let id = activeSongListPlaylistId();
    if (!id && !(state.speakerPlaylists || []).length) {
        await loadSpeakerPlaylists();
        id = activeSongListPlaylistId();
    }
    if (!id) {
        setState({ speakerPlaylistId: '', speakerPlaylistSongs: [] });
        renderSpeakerSongListDialog([]);
        return [];
    }

    if (String(state.speakerPlaylistId || '') !== String(id)) {
        setState({ speakerPlaylistId: String(id) });
        const select = $('[data-role="speaker-playlist-select"]');
        if (select) select.value = String(id);
        renderPlaylistList(state.speakerPlaylists || []);
    }

    if (force || !state.speakerPlaylistSongs?.length) {
        return await loadSpeakerPlaylistSongs(id);
    }

    renderSpeakerSongListDialog(state.speakerPlaylistSongs || []);
    return state.speakerPlaylistSongs || [];
}

export async function loadSpeakerPlaylistSongs(id = state.speakerPlaylistId) {
    const list = $('[data-role="speaker-playlist-songs"]');
    if (!list || !id) {
        if (list) list.innerHTML = '<div class="empty-state">请选择歌单。</div>';
        setState({ speakerPlaylistSongs: [], speakerPlaylistId: id || '' });
        renderSpeakerSongListDialog([]);
        return [];
    }

    list.innerHTML = '<div class="empty-state">正在加载歌单歌曲...</div>';
    const data = await api.get(`/songloft/playlists/${encodeURIComponent(id)}/songs`);
    const songs = asArray(data);
    setState({ speakerPlaylistSongs: songs, speakerPlaylistId: String(id) });
    renderSongList(songs);
    renderSpeakerSongListDialog(songs);
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
    const currentId = state.speakerPlaylistId;
    const nextId = playlists.some(playlist => playlistId(playlist) === currentId)
        ? currentId
        : playlistId(playlists[0]);
    setState({ speakerPlaylists: playlists, speakerPlaylistId: nextId || '' });
    renderPlaylistOptions(playlists);
    renderPlaylistList(playlists);
    setSummary(`${resultCount(data)} 个歌单`);
    if (nextId) await loadSpeakerPlaylistSongs(nextId);
    else await loadSpeakerPlaylistSongs('');
    return playlists;
}

export async function openSpeakerSongListDialog() {
    const dialog = $('[data-role="speaker-song-list-dialog"]');
    if (!dialog) return [];
    dialog.hidden = false;
    dialog.setAttribute?.('aria-hidden', 'false');
    document.body?.classList?.add?.('speaker-song-list-open');
    renderSpeakerSongListDialog(state.speakerPlaylistSongs || []);
    try {
        return await ensureSpeakerSongListSongs();
    } catch (error) {
        const summary = $('[data-role="speaker-song-list-summary"]');
        const list = $('[data-role="speaker-song-list"]');
        if (summary) summary.textContent = '加载失败';
        if (list) list.innerHTML = '<div class="empty-state">歌曲列表加载失败。</div>';
        throw error;
    }
}

export function closeSpeakerSongListDialog() {
    const dialog = $('[data-role="speaker-song-list-dialog"]');
    if (!dialog) return;
    dialog.hidden = true;
    dialog.setAttribute?.('aria-hidden', 'true');
    document.body?.classList?.remove?.('speaker-song-list-open');
}

async function playSpeakerPlaylist(startIndex = 0) {
    const playlist = selectedPlaylist();
    const id = playlistId(playlist);
    if (!id) throw new Error('请先选择歌单');
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先选择账号和设备');
    }
    const mode = $('[data-role="speaker-player-mode"]')?.value || 'loop';
    return await api.post('/miot/player/play', {
        ...payload,
        playlist_id: playablePlaylistId(id),
        start_index: startIndex,
        play_mode: mode,
    });
}

export function bindSpeakerPlaylists({ refreshPlayerStatus } = {}) {
    $$('[data-action="speaker-player-song-list"]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation?.();
            const buttonNode = event.currentTarget;
            if (buttonNode) buttonNode.disabled = true;
            try {
                await openSpeakerSongListDialog();
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                if (buttonNode) buttonNode.disabled = false;
            }
        });
    });

    $$('[data-action="close-speaker-song-list"]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation?.();
            closeSpeakerSongListDialog();
        });
    });

    $('[data-action="speaker-song-list-refresh"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button) button.disabled = true;
        try {
            await ensureSpeakerSongListSongs({ force: true });
            toast('歌曲列表已刷新');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    });

    $('[data-role="speaker-song-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="speaker-song-list-song"]');
        if (!button) return;
        button.disabled = true;
        try {
            await playSpeakerPlaylist(Number(button.dataset.index) || 0);
            await refreshPlayerStatus?.();
            closeSpeakerSongListDialog();
            toast('已推送歌曲到音箱');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-action="speaker-playlist-refresh"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button) button.disabled = true;
        try {
            await loadSpeakerPlaylists();
            toast('歌单已刷新');
        } catch (error) {
            setSummary('加载失败');
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    });

    $('[data-role="speaker-playlist-select"]')?.addEventListener('change', async event => {
        const id = event.currentTarget.value || '';
        setState({ speakerPlaylistId: id });
        renderPlaylistList(state.speakerPlaylists || []);
        try {
            await loadSpeakerPlaylistSongs(id);
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="speaker-playlist-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="speaker-playlist-select"]');
        if (!button) return;
        const playlist = state.speakerPlaylists?.[Number(button.dataset.index)];
        const id = playlistId(playlist);
        if (!id) return;
        const select = $('[data-role="speaker-playlist-select"]');
        if (select) select.value = id;
        setState({ speakerPlaylistId: id });
        renderPlaylistList(state.speakerPlaylists || []);
        try {
            await loadSpeakerPlaylistSongs(id);
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-action="speaker-playlist-play"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button) button.disabled = true;
        try {
            await playSpeakerPlaylist(0);
            await refreshPlayerStatus?.();
            toast('已开始播放歌单');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    });

    $('[data-role="speaker-playlist-songs"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="speaker-playlist-song"]');
        if (!button) return;
        button.disabled = true;
        try {
            await playSpeakerPlaylist(Number(button.dataset.index) || 0);
            await refreshPlayerStatus?.();
            toast('已推送歌曲到音箱');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}
