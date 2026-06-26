import { api } from '../api.js';
import { asArray, resultCount } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';
import { bindPagination, clearPagination, pageSizes, renderPaginationInto } from './pagination.js';
import { renderListScroller, renderSongListItem, renderSongRow, songListTitle } from './renderers.js';
import { songloftImportSummary, trackSongloftImportJob } from './songloft_playlist_target.js';

let songlistDependencies = null;

export function setSonglistDependencies(dependencies) {
    songlistDependencies = dependencies;
}

function getSonglistDependencies() {
    if (songlistDependencies) return songlistDependencies;
    throw new Error('Songlist dependencies are not configured');
}

export function songListId(item) {
    return item?.id || item?.list_id || item?.songlist_id || item?.source_id || item?.play_count;
}

function renderSongLists(items) {
    const list = $('[data-role="songlist-list"]');
    if (!list) return;
    list.innerHTML = items.length
        ? renderListScroller(items.map((item, index) => renderSongListItem(item, index)).join(''), 'songlist-results-scroll')
        : '<div class="empty-state">暂无歌单。</div>';
}

export async function loadSongListDetail(item) {
    const id = songListId(item);
    const platform = state.songlistQuery?.platform || $('[data-role="songlist-platform"]')?.value || state.platform;
    const quality = state.songlistQuery?.quality || $('[data-role="songlist-quality"]')?.value || state.songlistQuality;
    if (!id) {
        toast('歌单缺少 ID，无法解析', 'error');
        return;
    }
    setState({
        songlistDetailContext: {
            id,
            platform,
            quality,
            title: songListTitle(item),
        },
    });
    await loadSongListDetailPage(1);
}

export async function loadSongListDetailPage(page = 1) {
    const context = state.songlistDetailContext;
    if (!context?.id) return;
    const data = await api.get(`/music/songlist/detail?source_id=${encodeURIComponent(context.platform)}&id=${encodeURIComponent(context.id)}&quality=${encodeURIComponent(context.quality)}&page=${page}&page_size=${pageSizes.songlistDetail}`);
    const songs = asArray(data);
    const total = resultCount(data);
    setState({ songlistSongs: songs, songlistDetailPage: page, songlistDetailTotal: total });
    $('[data-role="songlist-title"]').textContent = context.title;
    const detail = $('[data-role="songlist-detail"]');
    detail.innerHTML = songs.length
        ? `${renderListScroller(songs.map((song, index) => renderSongRow(song, index, '', {
            selectable: true,
            checkboxRole: 'songlist-detail-song-check',
        })).join(''), 'songlist-detail-scroll')}<div class="inline-actions"><button class="ghost-button" type="button" data-action="select-songlist-detail-page">全选当前页</button><button class="ghost-button" type="button" data-action="clear-songlist-detail-selection">取消选择</button><button class="ghost-button" type="button" data-action="add-selected-songlist-detail-to-playlist">加入选中到歌单</button><button class="primary-button" type="button" data-action="speaker-songlist">推送整个歌单</button><button class="ghost-button" type="button" data-action="import-songlist">导入当前歌单</button><button class="ghost-button" type="button" data-action="download-songlist">下载当前歌单</button></div>`
        : '<div class="empty-state">歌单没有可显示歌曲。</div>';
    renderPaginationInto('songlist-detail-pagination', { scope: 'songlist-detail', page, total, pageSize: pageSizes.songlistDetail });
}

export async function loadSongListsPage(page = 1) {
    const list = $('[data-role="songlist-list"]');
    const query = state.songlistQuery;
    if (!list || !query) return;
    list.innerHTML = '<div class="empty-state">正在加载...</div>';
    const data = query.mode === 'recommended'
        ? await api.get(`/music/songlist/list?source_id=${encodeURIComponent(query.platform)}&quality=${encodeURIComponent(query.quality)}&page=${page}&page_size=${pageSizes.songlist}`)
        : await api.post('/music/songlist/search', { keyword: query.keyword || '热门', source_id: query.platform, quality: query.quality, page, page_size: pageSizes.songlist });
    const items = asArray(data);
    const total = resultCount(data);
    setState({ songlists: items, songlistPage: page, songlistTotal: total, platform: query.platform, songlistQuality: query.quality });
    $('[data-role="songlist-total"]').textContent = String(total);
    renderSongLists(items);
    renderPaginationInto('songlist-pagination', { scope: 'songlist', page, total, pageSize: pageSizes.songlist });
}

export function bindSongLists() {
    const {
        bindSongActions,
        downloadSongs,
        favoriteSongListFromSource,
        importSongs,
        openSongloftPlaylistTarget,
        playSonglistOnSpeaker,
        selectedSongsFromChecks,
    } = getSonglistDependencies();
    const form = $('[data-role="songlist-form"]');
    const list = $('[data-role="songlist-list"]');
    const detail = $('[data-role="songlist-detail"]');
    if (!form || !list || !detail) return;

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const submitter = event.submitter;
        const body = Object.fromEntries(new FormData(form).entries());
        const platform = body.source_id || state.platform;
        const quality = body.quality || state.songlistQuality;
        const mode = submitter?.value || 'search';
        const title = $('[data-role="songlist-title"]');
        try {
            setState({
                songlistQuery: {
                    mode,
                    platform,
                    quality: body.quality || state.songlistQuality,
                    keyword: String(body.keyword || '热门'),
                },
                songlistQuality: quality,
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
        const button = event.target.closest('[data-action="songlist-detail"], [data-action="favorite-songlist"], [data-action="import-songlist-to-playlist"]');
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
                toast('歌单缺少 ID，无法处理', 'error');
                return;
            }
            button.disabled = true;
            if (button.dataset.action === 'favorite-songlist') {
                await favoriteSongListFromSource(platform, id);
            }
            if (button.dataset.action === 'import-songlist-to-playlist') {
                const quality = state.songlistQuery?.quality || $('[data-role="songlist-quality"]')?.value || state.songlistQuality;
                const started = await api.post('/songloft/playlists/import-source-songlist/jobs', {
                    source_id: platform,
                    id,
                    quality,
                    playlist_name: songListTitle(item),
                });
                toast('已开始整单加入歌单，正在后台处理');
                if (started?.job_id) {
                    void trackSongloftImportJob(started.job_id, {
                        targetPlaylistName: songListTitle(item),
                    });
                } else {
                    toast(songloftImportSummary(started));
                }
            }
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
        const selectButton = event.target.closest('[data-action="select-songlist-detail-page"]');
        const clearButton = event.target.closest('[data-action="clear-songlist-detail-selection"]');
        const playlistButton = event.target.closest('[data-action="add-selected-songlist-detail-to-playlist"]');
        if (selectButton) {
            detail.querySelectorAll('[data-role="songlist-detail-song-check"]').forEach(input => { input.checked = true; });
            return;
        }
        if (clearButton) {
            detail.querySelectorAll('[data-role="songlist-detail-song-check"]').forEach(input => { input.checked = false; });
            return;
        }
        if (!speakerButton && !importButton && !downloadButton && !playlistButton) return;
        const button = speakerButton || importButton || downloadButton || playlistButton;
        button.disabled = true;
        try {
            if (speakerButton) await playSonglistOnSpeaker(state.songlistSongs || []);
            if (importButton) await importSongs(state.songlistSongs || []);
            if (downloadButton) await downloadSongs(state.songlistSongs || []);
            if (playlistButton) await openSongloftPlaylistTarget(selectedSongsFromChecks(detail, 'songlist-detail-song-check', state.songlistSongs || []));
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}
