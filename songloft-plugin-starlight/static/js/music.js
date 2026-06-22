import { api } from './api.js';
import { $, $$, durationLabel, escapeHtml, selectedDevicePayload, setState, state, toast } from './state.js';

const platformSelectRoles = [
    'platform-select',
    'songlist-platform',
    'ranking-platform',
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

export function sourceDisplayName(id) {
    return state.platforms.find(item => item.id === id)?.name || builtinPlatformNames[id] || id || '未知';
}

function platformName(id) {
    return sourceDisplayName(id);
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

function sourceMeta(song) {
    const data = song?.source_data || {};
    return [data.platform && platformName(data.platform), data.quality, durationLabel(song?.duration)]
        .filter(Boolean)
        .join(' · ');
}

export function mediaCoverUrl(item = {}) {
    const sourceData = item?.source_data || {};
    return item.cover_url
        || item.coverUrl
        || item.img
        || item.pic
        || item.cover
        || item.image
        || item.albumPic
        || sourceData.cover_url
        || sourceData.coverUrl
        || sourceData.img
        || sourceData.pic
        || sourceData.cover
        || sourceData.image
        || '';
}

function renderArtwork(item, alt) {
    const cover = mediaCoverUrl(item);
    if (cover) {
        return `<img class="media-artwork" src="${escapeHtml(cover)}" alt="${escapeHtml(alt)}">`;
    }
    return `<span class="media-artwork media-artwork-placeholder" aria-hidden="true">♪</span>`;
}

function actionButton(action, index, text) {
    return `<button type="button" data-action="${action}" data-index="${index}">${text}</button>`;
}

export function renderSongRow(song, index, extraActions = '') {
    return `
        <article class="song-row media-row">
            ${renderArtwork(song, songTitle(song))}
            <div class="row-main">
                <strong>${escapeHtml(songTitle(song))}</strong>
                <span>${escapeHtml(songArtist(song))} · ${escapeHtml(songAlbum(song))}</span>
                <span class="row-meta">${escapeHtml(sourceMeta(song))}</span>
            </div>
            <div class="row-actions">
                ${actionButton('preview', index, '试听')}
                ${actionButton('import', index, '导入')}
                ${actionButton('speaker', index, '音箱')}
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

async function previewSong(song) {
    const result = await api.post('/bridge/preview-url', { song });
    if (result?.url) {
        const player = $('#miniPlayer');
        if (player) {
            player.innerHTML = `
                <div class="now-playing">
                    <strong>${escapeHtml(songTitle(song))}</strong>
                    <span>${escapeHtml(songArtist(song))}</span>
                </div>
                <audio controls src="${escapeHtml(result.url)}"></audio>
            `;
        }
        toast('试听地址已解析');
    }
    return result;
}

async function importSongs(songs) {
    const result = await api.post('/bridge/songs/import', { songs });
    toast(`已导入 ${result?.total ?? songs.length} 首歌曲`);
    return result;
}

async function playOnSpeaker(song) {
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        toast('请先在音箱页选择账号和设备', 'error');
        return null;
    }
    const result = await api.post('/bridge/play-url', { ...payload, song });
    toast('已发送到音箱播放');
    return result;
}

export async function playSonglistOnSpeaker(songs) {
    if (!songs?.length) {
        throw new Error('歌单没有可播放歌曲');
    }
    await importSongs(songs);
    return playOnSpeaker(songs[0]);
}

function bindSongActions(root, getSong) {
    root.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (!['preview', 'import', 'speaker'].includes(action)) return;
        const song = getSong(Number(button.dataset.index));
        if (!song) return;
        button.disabled = true;
        try {
            if (action === 'preview') await previewSong(song);
            if (action === 'import') await importSongs([song]);
            if (action === 'speaker') await playOnSpeaker(song);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
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
        list.innerHTML = '<div class="empty-state">正在搜索...</div>';
        try {
            const data = await api.post('/music/search', {
                keyword: body.keyword.trim(),
                source_id: body.source_id || state.platform,
                page: 1,
                page_size: 30,
            });
            const songs = asArray(data);
            setState({ searchResults: songs, platform: body.source_id || state.platform, quality: body.quality || state.quality });
            $('[data-role="search-total"]').textContent = String(resultCount(data));
            list.innerHTML = songs.length
                ? songs.map((song, index) => renderSongRow(song, index)).join('')
                : '<div class="empty-state">没有找到匹配歌曲。</div>';
        } catch (error) {
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            toast(error.message, 'error');
        } finally {
            submit.disabled = false;
        }
    });

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

function songListTitle(item) {
    return item?.name || item?.title || item?.songlist_name || '未命名歌单';
}

function songListId(item) {
    return item?.id || item?.list_id || item?.songlist_id || item?.source_id || item?.play_count;
}

function songListSummary(item) {
    const playCount = item?.play_count || item?.playCount || item?.total || item?.count;
    return item?.author
        || item?.creator
        || item?.desc
        || item?.description
        || item?.tag
        || (playCount ? `${playCount} 次播放` : '')
        || '';
}

export function renderSongListItem(item, index) {
    return `
        <button class="songlist-row media-row" type="button" data-action="songlist-detail" data-index="${index}">
            ${renderArtwork(item, songListTitle(item))}
            <span class="row-main">
                <strong>${escapeHtml(songListTitle(item))}</strong>
                <span>${escapeHtml(songListSummary(item))}</span>
            </span>
        </button>
    `;
}

function renderSongLists(items) {
    const list = $('[data-role="songlist-list"]');
    if (!list) return;
    list.innerHTML = items.length
        ? items.map((item, index) => renderSongListItem(item, index)).join('')
        : '<div class="empty-state">暂无歌单。</div>';
}

async function loadSongListDetail(item) {
    const id = songListId(item);
    const platform = $('[data-role="songlist-platform"]')?.value || state.platform;
    if (!id) {
        toast('歌单缺少 ID，无法解析', 'error');
        return;
    }
    const data = await api.get(`/music/songlist/detail?source_id=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}&page=1&page_size=50`);
    const songs = asArray(data);
    setState({ songlistSongs: songs });
    $('[data-role="songlist-title"]').textContent = songListTitle(item);
    const detail = $('[data-role="songlist-detail"]');
    detail.innerHTML = songs.length
        ? `${songs.map((song, index) => renderSongRow(song, index)).join('')}<div class="inline-actions"><button class="primary-button" type="button" data-action="play-songlist">播放整个歌单</button><button class="ghost-button" type="button" data-action="import-songlist">导入当前歌单</button></div>`
        : '<div class="empty-state">歌单没有可显示歌曲。</div>';
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
        list.innerHTML = '<div class="empty-state">正在加载...</div>';
        try {
            const data = mode === 'recommended'
                ? await api.get(`/music/songlist/list?source_id=${encodeURIComponent(platform)}&page=1&page_size=30`)
                : await api.post('/music/songlist/search', { keyword: body.keyword || '热门', source_id: platform, page: 1, page_size: 30 });
            const items = asArray(data);
            setState({ songlists: items, platform });
            $('[data-role="songlist-total"]').textContent = String(resultCount(data));
            renderSongLists(items);
        } catch (error) {
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            toast(error.message, 'error');
        }
    });

    list.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="songlist-detail"]');
        if (!button) return;
        try {
            await loadSongListDetail(state.songlists?.[Number(button.dataset.index)]);
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    bindSongActions(detail, index => state.songlistSongs?.[index]);
    detail.addEventListener('click', async event => {
        const playButton = event.target.closest('[data-action="play-songlist"]');
        const importButton = event.target.closest('[data-action="import-songlist"]');
        if (!playButton && !importButton) return;
        const button = playButton || importButton;
        button.disabled = true;
        try {
            if (playButton) await playSonglistOnSpeaker(state.songlistSongs || []);
            if (importButton) await importSongs(state.songlistSongs || []);
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
            setState({ rankingBoards: boards, platform });
            boardsNode.innerHTML = boards.length
                ? boards.map((board, index) => renderRankingBoard(board, index)).join('')
                : '<div class="empty-state">暂无榜单。</div>';
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
        songsNode.innerHTML = '<div class="empty-state">正在加载歌曲...</div>';
        try {
            const data = await api.get(`/music/leaderboard/list?source_id=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}&page=1&page_size=50`);
            const songs = asArray(data);
            setState({ rankingSongs: songs });
            $('[data-role="ranking-title"]').textContent = boardTitle(board);
            songsNode.innerHTML = songs.length
                ? songs.map((song, index) => renderSongRow(song, index)).join('')
                : '<div class="empty-state">榜单没有可显示歌曲。</div>';
        } catch (error) {
            songsNode.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            toast(error.message, 'error');
        }
    });

    bindSongActions(songsNode, index => state.rankingSongs?.[index]);
}

export async function initMusicUI() {
    bindSearch();
    bindSources();
    bindSongLists();
    bindRankings();
    await loadPlatforms().catch(error => toast(error.message, 'error'));
    await loadSources().catch(error => toast(error.message, 'error'));
}
