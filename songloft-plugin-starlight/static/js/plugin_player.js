import { escapeHtml, setState, state } from './state.js';

const playModes = ['order', 'loop', 'random', 'single'];
const modeLabels = {
    order: '顺序',
    loop: '循环',
    random: '随机',
    single: '单曲',
};

function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function songTitle(song) {
    return cleanText(song?.title || song?.name || song?.songName) || '暂无播放';
}

function songArtist(song) {
    const artist = song?.artist || song?.singer || song?.author || song?.singerName;
    if (Array.isArray(artist)) return artist.map(item => item?.name || item).join(', ');
    return cleanText(artist) || '未知歌手';
}

function coverUrl(item = {}) {
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
        item.albumPic,
        item.cover,
        item.image,
        sourceData.cover_url,
        sourceData.coverUrl,
        sourceData.picUrl,
        sourceData.pic_url,
        sourceData.imgurl,
        sourceData.imgUrl,
        songInfo.pic,
        songInfo.img,
        songInfo.cover,
    ];
    const url = candidates.map(cleanText).find(value => /^(https?:)?\/\//i.test(value) || /^(data:image\/|blob:)/i.test(value) || value.startsWith('/'));
    return url || '';
}

function currentSong() {
    return state.pluginPlayerQueue?.[state.pluginPlayerIndex] || null;
}

function boundedIndex(index, length) {
    if (!length) return -1;
    const value = Number(index);
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(0, Math.floor(value)), length - 1);
}

function nextIndex(direction) {
    const length = state.pluginPlayerQueue.length;
    if (!length) return -1;
    if (state.pluginPlayerMode === 'random' && direction > 0) {
        return (state.pluginPlayerIndex + 1) % length;
    }
    if (state.pluginPlayerMode === 'single') return state.pluginPlayerIndex;
    const next = state.pluginPlayerIndex + direction;
    if (next < 0) return state.pluginPlayerMode === 'loop' ? length - 1 : 0;
    if (next >= length) return state.pluginPlayerMode === 'loop' ? 0 : length - 1;
    return next;
}

export function playPluginQueue(songs, startIndex = 0) {
    const queue = Array.isArray(songs) ? songs.filter(Boolean) : [];
    setState({
        pluginPlayerQueue: queue,
        pluginPlayerIndex: boundedIndex(startIndex, queue.length),
        pluginPlayerState: queue.length ? 'playing' : 'idle',
    });
}

export function runPluginPlayerAction(action) {
    const command = String(action || '').replace(/^plugin-player-/, '');
    if (command === 'previous') {
        setState({ pluginPlayerIndex: nextIndex(-1), pluginPlayerState: state.pluginPlayerQueue.length ? 'playing' : 'idle' });
        return;
    }
    if (command === 'next') {
        setState({ pluginPlayerIndex: nextIndex(1), pluginPlayerState: state.pluginPlayerQueue.length ? 'playing' : 'idle' });
        return;
    }
    if (command === 'toggle') {
        setState({ pluginPlayerState: state.pluginPlayerState === 'playing' ? 'paused' : (state.pluginPlayerQueue.length ? 'playing' : 'idle') });
        return;
    }
    if (command === 'stop') {
        setState({ pluginPlayerState: 'stopped' });
        return;
    }
    if (command === 'mode') {
        const current = playModes.indexOf(state.pluginPlayerMode);
        setState({ pluginPlayerMode: playModes[(current + 1) % playModes.length] || 'order' });
    }
}

function renderArtwork(song, title) {
    const url = coverUrl(song);
    if (!url) return `<span class="plugin-player-cover" aria-hidden="true">${escapeHtml(title.slice(0, 1) || 'P')}</span>`;
    return `<img class="plugin-player-cover" src="${escapeHtml(url)}" alt="${escapeHtml(title)}">`;
}

function renderQueue() {
    const queue = state.pluginPlayerQueue || [];
    if (!queue.length) {
        return '<div class="plugin-player-empty">队列为空</div>';
    }
    return queue.map((song, index) => {
        const title = songTitle(song);
        return `
            <button class="plugin-player-queue-item${index === state.pluginPlayerIndex ? ' active' : ''}" type="button" data-action="plugin-player-select" data-index="${index}">
                ${renderArtwork(song, title)}
                <span>
                    <strong>${escapeHtml(title)}</strong>
                    <small>${escapeHtml(songArtist(song))}</small>
                </span>
            </button>
        `;
    }).join('');
}

export function renderPluginPlayer() {
    const song = currentSong();
    const title = song ? songTitle(song) : '暂无播放';
    const meta = song ? songArtist(song) : '本插件本地队列';
    const paused = state.pluginPlayerState === 'paused';
    return `
        <section class="plugin-player" data-role="plugin-player">
            <div class="plugin-player-now">
                ${renderArtwork(song || {}, title)}
                <span class="plugin-player-info">
                    <strong>${escapeHtml(title)}</strong>
                    <span>${escapeHtml(meta)}</span>
                </span>
            </div>
            <div class="plugin-player-actions">
                <button class="icon-button compact-icon-button" type="button" data-action="plugin-player-previous" title="上一首" aria-label="上一首">上一首</button>
                <button class="icon-button compact-icon-button" type="button" data-action="plugin-player-toggle" title="${paused ? '继续播放' : '暂停播放'}" aria-label="${paused ? '继续播放' : '暂停播放'}">${paused ? '继续播放' : '暂停播放'}</button>
                <button class="icon-button compact-icon-button" type="button" data-action="plugin-player-next" title="下一首" aria-label="下一首">下一首</button>
                <button class="icon-button compact-icon-button" type="button" data-action="plugin-player-stop" title="停止播放" aria-label="停止播放">停止播放</button>
                <button class="ghost-button compact-icon-button" type="button" data-action="plugin-player-mode" title="播放模式" aria-label="播放模式">${escapeHtml(modeLabels[state.pluginPlayerMode] || '顺序')}</button>
            </div>
            <div class="plugin-player-queue" data-role="plugin-player-queue">${renderQueue()}</div>
        </section>
    `;
}

export function bindPluginPlayerControls(root = document) {
    root.addEventListener('click', event => {
        const button = event.target.closest('button[data-action^="plugin-player-"]');
        if (!button) return;
        if (button.dataset.action === 'plugin-player-select') {
            setState({ pluginPlayerIndex: boundedIndex(button.dataset.index, state.pluginPlayerQueue.length), pluginPlayerState: 'playing' });
            return;
        }
        runPluginPlayerAction(button.dataset.action);
    });
}
