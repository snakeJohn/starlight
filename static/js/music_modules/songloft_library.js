import { api } from '../api.js';
import { asArray, resultCount } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';
import {
    renderListScroller,
    renderSongloftPlaylistRow,
    renderSongloftSongRow,
    songloftPlaylistTitle,
} from './renderers.js';

let songloftLibraryDependencies = null;

export function setSongloftLibraryDependencies(dependencies) {
    songloftLibraryDependencies = dependencies;
}

function getSongloftLibraryDependencies() {
    if (songloftLibraryDependencies) return songloftLibraryDependencies;
    throw new Error('Songloft library dependencies are not configured');
}

const songloftLibraryPanelMap = {
    songs: {
        panelRole: 'songloft-songs-panel',
        action: 'load-songloft-songs',
    },
    local: {
        panelRole: 'songloft-local-songs-panel',
        action: 'load-songloft-local-songs',
    },
    playlists: {
        panelRole: 'songloft-playlists-panel',
        action: 'load-songloft-playlists',
    },
};

export function setSongloftLibraryPanelExpanded(kind, expanded) {
    const config = songloftLibraryPanelMap[kind];
    if (!config) return false;

    const panel = $(`[data-role="${config.panelRole}"]`);
    if (!panel) return false;

    panel.hidden = !expanded;
    panel.setAttribute?.('aria-hidden', expanded ? 'false' : 'true');

    const button = $(`[data-action="${config.action}"]`);
    button?.setAttribute?.('aria-expanded', String(expanded));
    button?.classList?.toggle?.('selected-action', expanded);
    return true;
}

function isSongloftLibraryPanelExpanded(kind) {
    const config = songloftLibraryPanelMap[kind];
    const panel = config ? $(`[data-role="${config.panelRole}"]`) : null;
    return Boolean(panel && !panel.hidden);
}

async function toggleSongloftLibraryPanel(kind, load) {
    const nextExpanded = !isSongloftLibraryPanelExpanded(kind);
    if (!setSongloftLibraryPanelExpanded(kind, nextExpanded)) return;
    if (nextExpanded) await load();
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

async function loadSongloftSongs() {
    const node = $('[data-role="songloft-songs"]');
    if (node) node.innerHTML = '<div class="empty-state">正在加载 Songloft 歌曲库...</div>';
    const data = await api.get('/songloft/songs');
    const songs = asArray(data);
    setState({ songloftSongs: songs });
    $('[data-role="songloft-songs-total"]').textContent = String(resultCount(data));
    renderSongloftSongList('songloft-songs', songs, 'Songloft 曲库为空。');
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

async function importSongloftPlaylistToCustom(playlist) {
    const id = playlist?.id ?? playlist?.playlist_id ?? playlist?.playlistId;
    if (!id) throw new Error('Songloft 歌单缺少 ID');
    const result = await api.post('/custom-playlists/import-songloft', {
        playlist_id: id,
        name: songloftPlaylistTitle(playlist),
    });
    toast('已导入我的歌单');
    return result;
}

export function bindSongloftLibrary() {
    const { playSongloftSongOnSpeaker, setControlDisabled } = getSongloftLibraryDependencies();

    $('[data-action="load-songloft-songs"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        setControlDisabled(button, true);
        try {
            await toggleSongloftLibraryPanel('songs', loadSongloftSongs);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setControlDisabled(button, false);
        }
    });

    $('[data-action="load-songloft-local-songs"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        setControlDisabled(button, true);
        try {
            await toggleSongloftLibraryPanel('local', loadSongloftLocalSongs);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setControlDisabled(button, false);
        }
    });

    $('[data-action="load-songloft-playlists"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        setControlDisabled(button, true);
        try {
            await toggleSongloftLibraryPanel('playlists', loadSongloftPlaylists);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            setControlDisabled(button, false);
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
        const button = event.target.closest('[data-action="view-songloft-playlist"], [data-action="import-songloft-playlist-to-custom"]');
        if (!button) return;
        button.disabled = true;
        try {
            const playlist = state.songloftPlaylists?.[Number(button.dataset.index)];
            if (!playlist) return;
            if (button.dataset.action === 'view-songloft-playlist') {
                await loadSongloftPlaylistSongs(playlist, Number(button.dataset.index));
            }
            if (button.dataset.action === 'import-songloft-playlist-to-custom') {
                await importSongloftPlaylistToCustom(playlist);
            }
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
