import { api } from './api.js';
import { asArray } from './shared/arrays.js';
import { $, $$, escapeHtml, selectedDevicePayload, setState, state, toast } from './state.js';
import {
    bindCustomPlaylists,
    favoriteSongListFromSource,
    loadCustomPlaylists,
    setCustomPlaylistDependencies,
} from './music_modules/custom_playlists.js';
import {
    bindDownloads,
    downloadSong,
    downloadSongs,
    loadDownloadProgress,
    loadDownloadSettings,
} from './music_modules/downloads.js';
import {
    bindRankings,
    setRankingDependencies,
} from './music_modules/rankings.js';
import {
    bindSearch,
    setSearchDependencies,
} from './music_modules/search.js';
import {
    bindSongloftLibrary,
    setSongloftLibraryDependencies,
} from './music_modules/songloft_library.js';
import {
    bindSongloftPlaylistTarget,
    openSongloftPlaylistTarget,
} from './music_modules/songloft_playlist_target.js';
import {
    bindSongLists,
    setSonglistDependencies,
} from './music_modules/songlists.js';
import {
    bindSources,
    loadSources,
    mergeSourceRows,
} from './music_modules/sources.js';
import {
    bindLxSync,
    loadLxSyncConfig,
} from './music_modules/lx_sync.js';
import {
    installArtworkFallback,
    songArtist,
    songTitle,
} from './music_modules/renderers.js';

export {
    addSelectedSongsToCustomPlaylist,
    addSongToCustomPlaylist,
    customPlaylistPlayableId,
    favoriteSongListFromSource,
    importCustomPlaylistFromSource,
    nextCustomPlaylistDetailId,
    playCustomPlaylistOnSpeaker,
    refreshCustomPlaylist,
    renderCustomPlaylistDetail,
    renderCustomPlaylistItem,
    syncCustomPlaylistToSongloft,
} from './music_modules/custom_playlists.js';
export {
    downloadSong,
} from './music_modules/downloads.js';
export {
    bindPagination,
    clearPagination,
    musicPageSize,
    pageFromPagination,
    renderPagination,
    renderPaginationInto,
} from './music_modules/pagination.js';
export {
    mergeSourceRows,
} from './music_modules/sources.js';
export {
    setSongloftLibraryPanelExpanded,
} from './music_modules/songloft_library.js';
export {
    cleanDisplayText,
    mediaCoverUrl,
    renderDownloadProgressMarkup,
    renderListScroller,
    renderRankingBoard,
    renderSongListItem,
    renderSongRow,
    renderSongloftSongRow,
} from './music_modules/renderers.js';

const platformSelectRoles = [
    'platform-select',
    'songlist-platform',
    'ranking-platform',
    'custom-playlist-import-platform',
];

const builtinPlatformNames = {
    kw: '酷我',
    kg: '酷狗',
    tx: 'QQ 音乐',
    mg: '咪咕',
    wy: '网易云',
};

function setControlDisabled(control, disabled) {
    if (control) control.disabled = disabled;
}

export function sourceDisplayName(id) {
    return state.platforms.find(item => item.id === id)?.name || builtinPlatformNames[id] || id || '未知';
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

async function importSongs(songs, options = {}) {
    const result = await api.post('/bridge/songs/import', { songs });
    if (!options.silent) {
        toast(`已导入 ${result?.total ?? songs.length} 首歌曲`);
    }
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
    toast('Songloft 歌曲已推送到音箱');
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
            if (action === 'add-to-playlist') await openSongloftPlaylistTarget([song]);
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

setSearchDependencies({
    bindSongActions,
    downloadSongs,
    importSongs,
    openSongloftPlaylistTarget,
    playSonglistOnSpeaker,
    selectedSongsFromChecks,
    setControlDisabled,
});

setSonglistDependencies({
    bindSongActions,
    downloadSongs,
    favoriteSongListFromSource,
    importSongs,
    openSongloftPlaylistTarget,
    playSonglistOnSpeaker,
    selectedSongsFromChecks,
});

setRankingDependencies({
    bindSongActions,
    openSongloftPlaylistTarget,
    selectedSongsFromChecks,
});

setSongloftLibraryDependencies({
    playSongloftSongOnSpeaker,
    setControlDisabled,
});

setCustomPlaylistDependencies({
    downloadSong,
    downloadSongs,
    playOnSpeaker,
    playResolvedSongOnSpeaker,
    playSongloftSongOnSpeaker,
    openSongloftPlaylistTarget,
    setControlDisabled,
});

export async function initMusicUI() {
    installArtworkFallback();
    bindSearch();
    bindSources();
    bindDownloads();
    bindSongloftLibrary();
    bindSongloftPlaylistTarget();
    bindSongLists();
    bindRankings();
    bindCustomPlaylists();
    bindLxSync();
    await loadPlatforms().catch(error => toast(error.message, 'error'));
    await loadSources().catch(error => toast(error.message, 'error'));
    await loadDownloadSettings().catch(error => toast(error.message, 'error'));
    await loadDownloadProgress().catch(error => toast(error.message, 'error'));
    await loadCustomPlaylists().catch(error => toast(error.message, 'error'));
    await loadLxSyncConfig().catch(error => toast(error.message, 'error'));
}
