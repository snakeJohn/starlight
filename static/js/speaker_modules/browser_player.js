import { api } from '../api.js';
import { authenticateSongloftResourceUrl } from '../auth.js';
import { $, durationLabel } from '../state.js';
import {
    clearPendingTargetHint,
    setActivePlayingTarget,
} from './playback_target.js';

/** @typedef {{ title?: string, artist?: string, name?: string, cover?: string, cover_url?: string, lyric?: string, lyric_url?: string, id?: string|number, song_id?: string|number, url?: string, play_url?: string }} BrowserSong */

let audio = null;
/** @type {BrowserSong[]} */
let queue = [];
let index = 0;
/** @type {'loop'|'once'|'single'|'random'|'order'} */
let playMode = 'loop';
let statusListeners = new Set();
let bound = false;

function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('timeupdate', () => emitStatus());
    audio.addEventListener('loadedmetadata', () => emitStatus());
    audio.addEventListener('play', () => {
        setActivePlayingTarget('browser');
        emitStatus();
    });
    audio.addEventListener('pause', () => emitStatus());
    audio.addEventListener('ended', () => {
        void handleEnded();
    });
    audio.addEventListener('error', () => emitStatus());
    return audio;
}

function emitStatus() {
    const status = getBrowserPlaybackStatus();
    for (const listener of statusListeners) {
        try {
            listener(status);
        } catch {
            // ignore listener errors
        }
    }
}

function normalizeMode(mode) {
    if (mode === 'repeat') return 'loop';
    return ['loop', 'once', 'single', 'random', 'order'].includes(mode) ? mode : 'loop';
}

function songTitle(song) {
    return song?.title || song?.name || '未知歌曲';
}

function songArtist(song) {
    return song?.artist || song?.singer || '-';
}

function absolutizeMediaUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('blob:') || raw.startsWith('data:')) {
        return authenticateSongloftResourceUrl(raw);
    }
    // Host-relative Songloft media paths — attach access_token when needed.
    if (raw.startsWith('/')) {
        const authed = authenticateSongloftResourceUrl(raw);
        try {
            return new URL(authed, window.location?.origin || undefined).toString();
        } catch {
            return authed;
        }
    }
    return raw;
}

function songloftPlayUrlFromId(song) {
    const id = Number(song?.id || song?.song_id || 0);
    if (!Number.isFinite(id) || id <= 0) return '';
    // Local/remote Songloft library tracks from speaker queue often only carry an id.
    return absolutizeMediaUrl(`/api/v1/songs/${id}/play`);
}

function isLikelyPlayableHttpUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return false;
    if (raw.startsWith('blob:') || raw.startsWith('data:audio')) return true;
    if (!/^https?:\/\//i.test(raw)) return false;
    // Empty path or bare origin is not a media source.
    try {
        const parsed = new URL(raw);
        return Boolean(parsed.pathname && parsed.pathname !== '/');
    } catch {
        return false;
    }
}

async function resolvePlayUrl(song) {
    const candidates = [];
    const direct = absolutizeMediaUrl(song?.url || song?.play_url || '');
    if (direct) candidates.push(direct);
    const byId = songloftPlayUrlFromId(song);
    if (byId && byId !== direct) candidates.push(byId);

    for (const candidate of candidates) {
        if (isLikelyPlayableHttpUrl(candidate)) {
            return candidate;
        }
    }

    // Resolve via bridge (platform search / remote preview) when queue only has metadata.
    const payloadSong = {
        ...song,
        title: song?.title || song?.name || '',
        name: song?.name || song?.title || '',
        artist: song?.artist || song?.singer || '',
        singer: song?.singer || song?.artist || '',
    };
    const result = await api.post('/bridge/preview-url', { song: payloadSong });
    const url = absolutizeMediaUrl(result?.url || result?.data?.url || '');
    if (!isLikelyPlayableHttpUrl(url)) {
        throw new Error('无法解析浏览器播放地址');
    }
    return url;
}

function nextIndex(from, direction = 1) {
    if (!queue.length) return 0;
    if (playMode === 'single' || playMode === 'once') {
        return from;
    }
    if (playMode === 'random') {
        if (queue.length === 1) return 0;
        let next = from;
        while (next === from) {
            next = Math.floor(Math.random() * queue.length);
        }
        return next;
    }
    const next = from + direction;
    if (playMode === 'loop') {
        return ((next % queue.length) + queue.length) % queue.length;
    }
    // order
    if (next < 0 || next >= queue.length) return from;
    return next;
}

async function handleEnded() {
    if (!queue.length) {
        emitStatus();
        return;
    }
    if (playMode === 'once') {
        audio?.pause();
        emitStatus();
        return;
    }
    if (playMode === 'single') {
        await playIndex(index, { restart: true });
        return;
    }
    const next = nextIndex(index, 1);
    if (playMode === 'order' && next === index && index >= queue.length - 1) {
        emitStatus();
        return;
    }
    await playIndex(next);
}

/**
 * @param {BrowserSong[]} songs
 * @param {{ startIndex?: number }} [options]
 */
export async function playBrowserQueue(songs, options = {}) {
    if (!Array.isArray(songs) || songs.length === 0) {
        throw new Error('没有可播放的歌曲');
    }
    queue = songs.slice();
    index = Math.max(0, Math.min(options.startIndex || 0, queue.length - 1));
    clearPendingTargetHint();
    setActivePlayingTarget('browser');
    await playIndex(index, { restart: true });
}

async function playIndex(next, options = {}) {
    if (!queue.length) throw new Error('播放队列为空');
    index = ((next % queue.length) + queue.length) % queue.length;
    const song = queue[index];
    const el = ensureAudio();
    let url = '';
    try {
        url = await resolvePlayUrl(song);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`浏览器播放失败: ${message}`);
    }
    if (!url) {
        throw new Error('浏览器播放失败: 无效的音频地址');
    }
    if (options.restart || el.src !== url) {
        try {
            el.pause();
        } catch {
            // ignore
        }
        el.removeAttribute?.('src');
        el.src = url;
        try {
            el.load?.();
        } catch {
            // ignore
        }
    }
    try {
        await el.play();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/no supported sources|empty src|not supported/i.test(message)) {
            throw new Error('浏览器播放失败: 当前歌曲没有可播放的音频源（地址无效或需要重新解析）');
        }
        throw new Error(`浏览器播放失败: ${message}`);
    }
    emitStatus();
}

export async function browserPlayerAction(command, options = {}) {
    const el = ensureAudio();
    const cmd = String(command || '');

    if (cmd === 'refresh') {
        emitStatus();
        return getBrowserPlaybackStatus();
    }
    if (cmd === 'toggle') {
        if (!el.src) {
            if (queue.length) await playIndex(index, { restart: true });
            else throw new Error('浏览器暂无播放内容，请先选择歌曲播放');
        } else if (el.paused) {
            await el.play();
        } else {
            el.pause();
        }
        clearPendingTargetHint();
        setActivePlayingTarget('browser');
        emitStatus();
        return getBrowserPlaybackStatus();
    }
    if (cmd === 'stop') {
        el.pause();
        el.currentTime = 0;
        emitStatus();
        return getBrowserPlaybackStatus();
    }
    if (cmd === 'previous') {
        await playIndex(nextIndex(index, -1), { restart: true });
        return getBrowserPlaybackStatus();
    }
    if (cmd === 'next') {
        await playIndex(nextIndex(index, 1), { restart: true });
        return getBrowserPlaybackStatus();
    }
    if (cmd === 'mode') {
        playMode = normalizeMode(options.playMode || playMode);
        const modeInput = $('[data-role="speaker-player-mode"]');
        if (modeInput) modeInput.value = playMode;
        emitStatus();
        return getBrowserPlaybackStatus();
    }
    if (cmd === 'seek') {
        const position = Number(options.position);
        if (!Number.isFinite(position) || !el.duration || !Number.isFinite(el.duration)) {
            throw new Error('当前浏览器音频不支持拖动跳转');
        }
        el.currentTime = Math.max(0, Math.min(position, el.duration));
        emitStatus();
        return getBrowserPlaybackStatus();
    }
    throw new Error('未知浏览器播放控制命令');
}

export function getBrowserPlaybackStatus() {
    const el = audio;
    const song = queue[index] || null;
    const playing = Boolean(el && !el.paused && !el.ended && el.src);
    const paused = Boolean(el && el.paused && el.src && el.currentTime > 0);
    return {
        state: playing ? 'playing' : paused ? 'paused' : el?.src ? 'stopped' : 'idle',
        title: song ? songTitle(song) : '',
        artist: song ? songArtist(song) : '',
        position: el?.currentTime || 0,
        duration: Number.isFinite(el?.duration) ? el.duration : 0,
        play_mode: playMode,
        can_seek: Boolean(el && Number.isFinite(el.duration) && el.duration > 0),
        cover_url: song?.cover_url || song?.cover || '',
        lyric_url: song?.lyric_url || song?.lyric || '',
        target: 'browser',
        queue_length: queue.length,
        queue_index: index,
        current_song: song || undefined,
    };
}

/** Snapshot for handoff to speaker (or UI retention after target switch). */
export function getBrowserQueueSnapshot() {
    return {
        songs: queue.slice(),
        index,
        playMode,
        status: getBrowserPlaybackStatus(),
    };
}

export function hasBrowserQueue() {
    return queue.length > 0;
}

/** Pause browser audio without clearing the queue (used when switching to speaker). */
export function pauseBrowserPlayback() {
    if (!audio) return getBrowserPlaybackStatus();
    try {
        audio.pause();
    } catch {
        // ignore
    }
    emitStatus();
    return getBrowserPlaybackStatus();
}

export function subscribeBrowserPlayback(listener) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
}

export function formatBrowserTime(seconds) {
    return durationLabel(seconds);
}

export function isBrowserPlayerBound() {
    return bound;
}

export function markBrowserPlayerBound() {
    bound = true;
}
