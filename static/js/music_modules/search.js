import { api } from '../api.js';
import { asArray, resultCount } from '../shared/arrays.js';
import { bindSelectableBatchActions } from '../shared/selectable_list.js';
import { $, $$, setState, state, toast } from '../state.js';
import { bindPagination, clearPagination, pageSizes, renderPaginationInto } from './pagination.js';
import { renderEmptyState, renderListScroller, renderSongRow } from './renderers.js';

let searchDependencies = null;

export function setSearchDependencies(dependencies) {
    searchDependencies = dependencies;
}

function getSearchDependencies() {
    if (searchDependencies) return searchDependencies;
    throw new Error('Search dependencies are not configured');
}

export async function loadSearchPage(page = 1) {
    const list = $('[data-role="search-results"]');
    const query = state.searchQuery;
    if (!list || !query?.keyword) return;
    list.innerHTML = renderEmptyState('正在搜索...', 'loading');
    const data = await api.post('/music/search', {
        keyword: query.keyword,
        source_id: query.platform,
        quality: query.quality,
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
        : renderEmptyState('没有找到匹配歌曲。');
    renderPaginationInto('search-pagination', { scope: 'search', page, total, pageSize: pageSizes.search });
}

export function bindSearch() {
    const {
        bindSongActions,
        downloadSongs,
        importSongs,
        openSongloftPlaylistTarget,
        playSonglistOnSpeaker,
        selectedSongsFromChecks,
        setControlDisabled,
    } = getSearchDependencies();
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
        setControlDisabled(submit, true);
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
            list.innerHTML = renderEmptyState(error.message, 'error');
            clearPagination('search-pagination');
            toast(error.message, 'error');
        } finally {
            setControlDisabled(submit, false);
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

    bindSelectableBatchActions({
        root: '[data-role="search-batch-actions"]',
        list,
        checkboxRole: 'search-song-check',
        actions: {
            selectAll: 'select-search-page',
            clear: 'clear-search-selection',
            'import-selected-search': 'import',
            'add-selected-search-to-playlist': 'addToPlaylist',
            'download-selected-search': 'download',
            'speaker-selected-search': 'speaker',
        },
        getSelected: (listEl, role) => selectedSongsFromChecks(listEl, role, state.searchResults),
        handlers: {
            import: songs => importSongs(songs),
            addToPlaylist: songs => openSongloftPlaylistTarget(songs),
            download: songs => downloadSongs(songs),
            speaker: songs => playSonglistOnSpeaker(songs),
        },
        toast,
        $,
        $$,
    });

    bindPagination('search-pagination', loadSearchPage);
    bindSongActions(list, index => state.searchResults[index]);
}
