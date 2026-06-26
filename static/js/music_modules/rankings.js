import { api } from '../api.js';
import { asArray, resultCount } from '../shared/arrays.js';
import { $, escapeHtml, setState, state, toast } from '../state.js';
import { bindPagination, clearPagination, pageSizes, renderPaginationInto } from './pagination.js';
import { boardTitle, renderListScroller, renderRankingBoard, renderSongRow } from './renderers.js';

let rankingDependencies = null;

export function setRankingDependencies(dependencies) {
    rankingDependencies = dependencies;
}

function getRankingDependencies() {
    if (rankingDependencies) return rankingDependencies;
    throw new Error('Ranking dependencies are not configured');
}

export function boardId(board) {
    return board?.id || board?.board_id || board?.source_id || board?.bangid || board?.榜单id;
}

export async function loadRankingPage(page = 1) {
    const context = state.rankingContext;
    const songsNode = $('[data-role="ranking-songs"]');
    if (!context?.id || !songsNode) return;
    songsNode.innerHTML = '<div class="empty-state">正在加载歌曲...</div>';
    const data = await api.get(`/music/leaderboard/list?source_id=${encodeURIComponent(context.platform)}&id=${encodeURIComponent(context.id)}&quality=${encodeURIComponent(context.quality)}&page=${page}&page_size=${pageSizes.ranking}`);
    const songs = asArray(data);
    const total = resultCount(data);
    setState({ rankingSongs: songs, rankingPage: page, rankingTotal: total });
    $('[data-role="ranking-title"]').textContent = context.title;
    songsNode.innerHTML = songs.length
        ? `${renderListScroller(songs.map((song, index) => renderSongRow(song, index, '', {
            selectable: true,
            checkboxRole: 'ranking-song-check',
        })).join(''), 'ranking-songs-scroll')}<div class="inline-actions"><button class="ghost-button" type="button" data-action="select-ranking-page">全选当前页</button><button class="ghost-button" type="button" data-action="clear-ranking-selection">取消选择</button><button class="ghost-button" type="button" data-action="add-selected-ranking-to-playlist">加入选中到歌单</button></div>`
        : '<div class="empty-state">榜单没有可显示歌曲。</div>';
    renderPaginationInto('ranking-pagination', { scope: 'ranking', page, total, pageSize: pageSizes.ranking });
}

export function bindRankings() {
    const { bindSongActions, openSongloftPlaylistTarget, selectedSongsFromChecks } = getRankingDependencies();
    const boardsNode = $('[data-role="ranking-list"]');
    const songsNode = $('[data-role="ranking-songs"]');
    if (!boardsNode || !songsNode) return;

    $('[data-action="load-rankings"]')?.addEventListener('click', async () => {
        const platform = $('[data-role="ranking-platform"]')?.value || state.platform;
        const quality = $('[data-role="ranking-quality"]')?.value || state.rankingQuality;
        boardsNode.innerHTML = '<div class="empty-state">正在加载榜单...</div>';
        try {
            const data = await api.get(`/music/leaderboard/boards?source_id=${encodeURIComponent(platform)}`);
            const boards = asArray(data);
            setState({ rankingBoards: boards, rankingContext: null, rankingSongs: [], platform, rankingQuality: quality });
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
        const quality = $('[data-role="ranking-quality"]')?.value || state.rankingQuality;
        if (!id) {
            toast('榜单缺少 ID，无法加载', 'error');
            return;
        }
        try {
            setState({
                rankingContext: {
                    id,
                    platform,
                    quality,
                    title: boardTitle(board),
                },
                rankingQuality: quality,
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
    songsNode.addEventListener('click', async event => {
        const selectButton = event.target.closest('[data-action="select-ranking-page"]');
        const clearButton = event.target.closest('[data-action="clear-ranking-selection"]');
        const playlistButton = event.target.closest('[data-action="add-selected-ranking-to-playlist"]');
        if (selectButton) {
            songsNode.querySelectorAll('[data-role="ranking-song-check"]').forEach(input => { input.checked = true; });
            return;
        }
        if (clearButton) {
            songsNode.querySelectorAll('[data-role="ranking-song-check"]').forEach(input => { input.checked = false; });
            return;
        }
        if (!playlistButton) return;
        playlistButton.disabled = true;
        try {
            await openSongloftPlaylistTarget(selectedSongsFromChecks(songsNode, 'ranking-song-check', state.rankingSongs || []));
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            playlistButton.disabled = false;
        }
    });
}
