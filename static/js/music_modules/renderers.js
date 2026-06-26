import { authenticateSongloftResourceUrl } from '../auth.js';
import { asArray } from '../shared/arrays.js';
import { durationLabel, escapeHtml, state } from '../state.js';

const builtinPlatformNames = {
    kw: '酷我',
    kg: '酷狗',
    tx: 'QQ 音乐',
    mg: '咪咕',
    wy: '网易云',
};

let artworkFallbackInstalled = false;

function platformName(id) {
    return state.platforms.find(item => item.id === id)?.name || builtinPlatformNames[id] || id || '未知';
}

export function songTitle(song) {
    return song?.title || song?.name || song?.songName || '未知歌曲';
}

export function songArtist(song) {
    const artist = song?.artist || song?.singer || song?.author || song?.singerName;
    if (Array.isArray(artist)) return artist.map(item => item.name || item).join(', ');
    return artist || '未知歌手';
}

export function songAlbum(song) {
    return song?.album || song?.albumName || '未知专辑';
}

export function songloftTypeLabel(song) {
    const type = String(song?.type || '').trim().toLowerCase();
    if (type === 'local') return '本地';
    if (type === 'remote') return '网络';
    if (type === 'radio') return '电台';
    return type || 'Songloft';
}

export function sourceMeta(song) {
    const data = song?.source_data || {};
    return [data.platform && platformName(data.platform), data.quality, durationLabel(song?.duration)]
        .filter(Boolean)
        .join(' · ');
}

function decodeHtmlEntities(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

export function cleanDisplayText(value) {
    return decodeHtmlEntities(value)
        .replace(/\\\\u003c/gi, '<')
        .replace(/\\\\u003e/gi, '>')
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function firstText(...values) {
    for (const value of values) {
        const text = cleanDisplayText(value);
        if (text) return text;
    }
    return '';
}

export function normalizeCoverUrl(value) {
    const url = cleanDisplayText(value).replace('{size}', '400');
    if (!url) return '';
    if (/^(https?:)?\/\//i.test(url)) return authenticateSongloftResourceUrl(url);
    if (/^(data:image\/|blob:)/i.test(url)) return url;
    if (url.startsWith('/')) return authenticateSongloftResourceUrl(url);
    return '';
}

export function mediaCoverUrl(item = {}) {
    const sourceData = item?.source_data || {};
    const songInfo = sourceData.songInfo || {};
    const candidates = [
        item.cover_url,
        item.coverUrl,
        item.picUrl,
        item.pic_url,
        item.imgurl,
        item.imgUrl,
        item.album_img,
        item.album_sizable_cover,
        item.albumPic,
        item.img,
        item.pic,
        item.cover,
        item.image,
        sourceData.cover_url,
        sourceData.coverUrl,
        sourceData.picUrl,
        sourceData.pic_url,
        sourceData.imgurl,
        sourceData.imgUrl,
        sourceData.album_img,
        sourceData.album_sizable_cover,
        sourceData.albumPic,
        sourceData.img,
        sourceData.pic,
        sourceData.cover,
        sourceData.image,
        songInfo.cover_url,
        songInfo.coverUrl,
        songInfo.picUrl,
        songInfo.pic_url,
        songInfo.imgurl,
        songInfo.imgUrl,
        songInfo.album_img,
        songInfo.album_sizable_cover,
        songInfo.albumPic,
        songInfo.img,
        songInfo.pic,
        songInfo.cover,
        songInfo.image,
    ];
    for (const candidate of candidates) {
        const cover = normalizeCoverUrl(candidate);
        if (cover) return cover;
    }
    return '';
}

export function renderArtwork(item, alt) {
    const cover = mediaCoverUrl(item);
    if (cover) {
        return `<img class="media-artwork" src="${escapeHtml(cover)}" alt="" title="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<span class="media-artwork media-artwork-placeholder" aria-hidden="true">♪</span>`;
}

export function installArtworkFallback() {
    if (artworkFallbackInstalled || typeof document === 'undefined') return;
    artworkFallbackInstalled = true;
    document.addEventListener('error', event => {
        const image = event.target;
        if (!image?.matches?.('img.media-artwork')) return;
        const placeholder = document.createElement('span');
        placeholder.className = 'media-artwork media-artwork-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '♪';
        image.replaceWith(placeholder);
    }, true);
}

function actionButton(action, index, text) {
    return `<button type="button" data-action="${action}" data-index="${index}">${text}</button>`;
}

function customPlaylistAction(index) {
    return actionButton('add-to-playlist', index, '加入歌单');
}

export function renderSongCheckbox(index, options = {}) {
    if (!options.selectable) return '';
    const role = options.checkboxRole || 'song-check';
    const label = options.checkboxLabel || '选择歌曲';
    return `
            <label class="song-check" title="${escapeHtml(label)}">
                <input type="checkbox" data-role="${escapeHtml(role)}" data-index="${index}">
            </label>`;
}

export function renderListScroller(innerHtml, extraClass = '', stackClass = 'list-stack') {
    const className = ['list-scroll', extraClass].filter(Boolean).join(' ');
    return `<div class="${escapeHtml(className)}"><div class="${escapeHtml(stackClass)}">${innerHtml}</div></div>`;
}

export function renderSongRow(song, index, extraActions = '', options = {}) {
    const selectable = Boolean(options.selectable);
    return `
        <article class="song-row media-row${selectable ? ' selectable-song-row' : ''}">
            ${renderSongCheckbox(index, options)}
            ${renderArtwork(song, songTitle(song))}
            <div class="row-main">
                <strong>${escapeHtml(songTitle(song))}</strong>
                <span>${escapeHtml(songArtist(song))} · ${escapeHtml(songAlbum(song))}</span>
                <span class="row-meta">${escapeHtml(sourceMeta(song))}</span>
            </div>
            <div class="row-actions">
                ${actionButton('import', index, '加入歌曲库')}
                ${actionButton('download', index, '下载')}
                ${actionButton('speaker', index, '推送音箱')}
                ${customPlaylistAction(index)}
                ${extraActions}
            </div>
        </article>
    `;
}

export function renderDownloadProgressMarkup(progress) {
    if (!progress?.active) {
        return '<div class="empty-state">暂无下载任务。</div>';
    }

    const current = Number(progress.current) || 0;
    const total = Number(progress.total) || 0;
    const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0;
    const rows = asArray(progress.results).slice(-8).map(result => `
        <div class="download-progress-row">
            <span>${escapeHtml(result.status === 'failed' ? '失败' : '完成')}</span>
            <strong>${escapeHtml(result.path || result.error || `Song #${result.song_id || '-'}`)}</strong>
        </div>
    `).join('');
    return `
        <div class="download-progress-bar" aria-label="下载进度 ${percent}%">
            <div class="download-progress-track">
                <span class="download-progress-fill" style="width: ${percent}%"></span>
            </div>
            <strong>${percent}%</strong>
        </div>
        <div class="metric-grid">
            <div><span>进度</span><strong>${current}/${total}</strong></div>
            <div><span>成功</span><strong>${Number(progress.success) || 0}</strong></div>
            <div><span>失败</span><strong>${Number(progress.failed) || 0}</strong></div>
        </div>
        <div class="list-stack tight">${rows || '<div class="empty-state">任务已开始，等待第一首完成。</div>'}</div>
    `;
}

export function songListTitle(item) {
    return cleanDisplayText(item?.name || item?.title || item?.songlist_name) || '未命名歌单';
}

export function songListSummary(item) {
    const playCount = item?.play_count || item?.playCount || item?.total || item?.count;
    return firstText(
        item?.author,
        item?.creator,
        item?.desc,
        item?.description,
        item?.tag,
        playCount ? `${playCount} 次播放` : '',
    );
}

export function renderSongListItem(item, index) {
    return `
        <article class="songlist-row media-row" data-index="${index}">
            ${renderArtwork(item, songListTitle(item))}
            <div class="row-main">
                <strong>${escapeHtml(songListTitle(item))}</strong>
                <span>${escapeHtml(songListSummary(item))}</span>
            </div>
            <div class="row-actions">
                <button type="button" data-action="songlist-detail" data-index="${index}">查看</button>
                <button type="button" data-action="favorite-songlist" data-index="${index}">收藏</button>
                <button type="button" data-action="import-songlist-to-playlist" data-index="${index}">整单加入歌单</button>
            </div>
        </article>
    `;
}

export function boardTitle(board) {
    return board?.name || board?.title || board?.label || '未命名榜单';
}

export function boardSummary(board) {
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

export function songloftPlaylistTitle(playlist) {
    return playlist?.name || playlist?.title || '未命名歌单';
}

export function songloftPlaylistSummary(playlist) {
    const count = playlist?.song_count ?? playlist?.songCount ?? playlist?.count ?? playlist?.total;
    return [playlist?.type, Number.isFinite(Number(count)) ? `${count} 首` : ''].filter(Boolean).join(' · ');
}

export function renderSongloftSongRow(song, index) {
    return `
        <article class="song-row media-row">
            ${renderArtwork(song, songTitle(song))}
            <div class="row-main">
                <strong>${escapeHtml(songTitle(song))}</strong>
                <span>${escapeHtml(songArtist(song))} · ${escapeHtml(songAlbum(song))}</span>
                <span class="row-meta">${escapeHtml([songloftTypeLabel(song), durationLabel(song?.duration)].filter(Boolean).join(' · '))}</span>
            </div>
            <div class="row-actions">
                <button type="button" data-action="speaker-songloft-song" data-index="${index}">推送音箱</button>
            </div>
        </article>
    `;
}

export function renderSongloftPlaylistRow(playlist, index) {
    return `
        <article class="songlist-row media-row">
            ${renderArtwork(playlist, songloftPlaylistTitle(playlist))}
            <div class="row-main">
                <strong>${escapeHtml(songloftPlaylistTitle(playlist))}</strong>
                <span>${escapeHtml(songloftPlaylistSummary(playlist))}</span>
            </div>
            <div class="row-actions">
                <button type="button" data-action="view-songloft-playlist" data-index="${index}">查看歌曲</button>
                <button type="button" data-action="import-songloft-playlist-to-custom" data-index="${index}">导入我的歌单</button>
            </div>
        </article>
    `;
}
