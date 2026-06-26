import { api } from '../api.js';
import { asArray, resultCount } from '../shared/arrays.js';
import { $, $$, escapeHtml, setState, state, toast } from '../state.js';
import { bindPagination, clearPagination, pageSizes, renderPaginationInto } from './pagination.js';
import { renderListScroller, renderSongRow } from './renderers.js';

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
    list.innerHTML = '<div class="empty-state">正在搜索...</div>';
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
        : '<div class="empty-state">没有找到匹配歌曲。</div>';
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
            list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
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
            if (action === 'add-selected-search-to-playlist') await openSongloftPlaylistTarget(selectedSongs);
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
