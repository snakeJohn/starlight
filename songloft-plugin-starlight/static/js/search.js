/**
 * 搜索模块
 * 提供歌单搜索和歌曲筛选功能
 */

/**
 * 初始化歌单搜索（在歌单列表渲染完成后调用）
 */
export function initPlaylistSearch() {
    const input = document.getElementById('playlistSearchInput');
    if (!input) return;

    input.value = '';

    input.removeEventListener('input', handlePlaylistSearch);
    input.addEventListener('input', handlePlaylistSearch);
}

function handlePlaylistSearch() {
    const input = document.getElementById('playlistSearchInput');
    const keyword = (input.value || '').trim().toLowerCase();
    const items = document.querySelectorAll('#playlistSelectList .playlist-select-item');

    items.forEach(item => {
        if (!keyword) {
            item.style.display = '';
            return;
        }
        const name = (item.querySelector('.playlist-select-item-name')?.textContent || '').toLowerCase();
        item.style.display = name.includes(keyword) ? '' : 'none';
    });
}

/**
 * 初始化歌曲搜索（在歌曲列表渲染完成后调用）
 */
export function initSongSearch() {
    const bar = document.getElementById('songSearchBar');
    const input = document.getElementById('songSearchInput');
    if (!bar || !input) return;

    bar.style.display = 'flex';
    input.value = '';

    input.removeEventListener('input', handleSongSearch);
    input.addEventListener('input', handleSongSearch);
}

function handleSongSearch() {
    const input = document.getElementById('songSearchInput');
    const keyword = (input.value || '').trim().toLowerCase();
    const items = document.querySelectorAll('#songList .song-item');

    items.forEach(item => {
        if (!keyword) {
            item.style.display = '';
            return;
        }
        const title = (item.querySelector('.song-item-title')?.textContent || '').toLowerCase();
        const artist = (item.querySelector('.song-item-subtitle')?.textContent || '').toLowerCase();
        item.style.display = (title.includes(keyword) || artist.includes(keyword)) ? '' : 'none';
    });
}
