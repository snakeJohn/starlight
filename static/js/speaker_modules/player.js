import { api } from '../api.js';
import { $, $$, durationLabel, escapeHtml, selectedDevicePayload, setState, state, toast } from '../state.js';
import { getCurrentLyricIndex, parseLrc } from './lrc_parser.js';
import {
    browserPlayerAction,
    getBrowserPlaybackStatus,
    getBrowserQueueSnapshot,
    hasBrowserQueue,
    pauseBrowserPlayback,
    playBrowserQueue,
    subscribeBrowserPlayback,
} from './browser_player.js';
import {
    clearPendingTargetHint,
    getActivePlayingTarget,
    getSelectedPlaybackTarget,
    onPlaybackTargetChange,
    setActivePlayingTarget,
} from './playback_target.js';

const PLAYER_POLL_MS = 5000;

let currentPosition = 0;
let currentDuration = 0;
let currentLyrics = [];
let currentLyricUrl = '';
let currentLyricText = '';
let currentLyricIndex = null;
let currentCoverUrl = '';
let currentCoverObjectUrl = '';
/** Monotonic tokens so late cover/lyric fetches for a previous track are ignored. */
let coverRequestId = 0;
let lyricRequestId = 0;
let lastUpdateTime = 0;
let progressAnimationFrame = null;
let playerPollTimer = null;
let isCurrentlyPlaying = false;
let currentCanSeek = false;

/** Last non-empty speaker status (for speaker → browser handoff). */
let lastSpeakerPlayback = null;
let explicitlyStoppedTarget = null;

function selectedPayload(extra = {}) {
    const payload = { ...selectedDevicePayload(), ...extra };
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先选择账号和设备');
    }
    return payload;
}

export function setSpeakerMessage(message) {
    const node = $('[data-role="speaker-player-state"]');
    if (node) node.textContent = message;
}

export function updatePlayerToggleButton(playerState = state.speakerPlayerState) {
    // Idle/stopped → Play; paused → Resume; only playing → Pause.
    // (Old logic treated every non-paused state as playing, so idle showed 暂停播放.)
    const isPlaying = playerState === 'playing';
    const isPaused = playerState === 'paused';
    const label = isPlaying ? '暂停播放' : isPaused ? '继续播放' : '播放';
    const showPlayIcon = !isPlaying;
    $$('[data-action="speaker-player-toggle"]').forEach(button => {
        const icon = button.querySelector?.('[data-role="speaker-player-play-icon"], [data-role="global-player-play-icon"], [data-role="fullscreen-player-play-icon"]');
        if (icon) {
            icon.classList?.remove?.('fa-play', 'fa-pause');
            icon.classList?.add?.(showPlayIcon ? 'fa-play' : 'fa-pause');
        } else {
            button.textContent = label;
        }
        button.title = label;
        button.setAttribute?.('aria-label', label);
    });
}

function playStateLabel(playerState) {
    return {
        idle: '空闲',
        playing: '播放中',
        paused: '已暂停',
        stopped: '已停止',
    }[playerState] || '未知';
}

function playModeLabel(mode) {
    return {
        order: '顺序',
        random: '随机',
        once: '单曲播放',
        single: '单曲循环',
        loop: '列表循环',
        repeat: '列表循环',
    }[mode] || '保持';
}

function normalizePlayMode(mode) {
    if (mode === 'repeat') return 'loop';
    return ['loop', 'once', 'single', 'random', 'order'].includes(mode) ? mode : 'order';
}

function playModeIcon(mode) {
    const normalized = normalizePlayMode(mode);
    return {
        order: 'fa-play',
        random: 'fa-random',
        once: 'fa-dot-circle',
        single: 'fa-redo-alt',
        loop: 'fa-redo',
    }[normalized] || 'fa-redo';
}

function safePercent(position, duration) {
    if (!duration || duration <= 0) return '0%';
    const percent = Math.min(Math.max(position / duration, 0), 1) * 100;
    return `${Math.round(percent * 10) / 10}%`;
}

function setText(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text;
}

function setIcon(selector, iconName) {
    const node = $(selector);
    if (!node) return;
    node.classList?.remove?.('fa-play', 'fa-pause', 'fa-redo', 'fa-redo-alt', 'fa-random', 'fa-dot-circle');
    node.classList?.add?.(iconName);
}

function setPlayIcon(selector, playing) {
    setIcon(selector, playing ? 'fa-pause' : 'fa-play');
}

function updateModeButtons(mode) {
    const normalized = normalizePlayMode(mode);
    const label = `播放模式：${playModeLabel(normalized)}`;
    $$('[data-action="speaker-player-mode-menu"]').forEach(button => {
        button.title = label;
        button.setAttribute?.('aria-label', label);
    });
    $$('[data-action="speaker-player-mode-option"]').forEach(button => {
        button.classList?.toggle?.('active', button.dataset.mode === normalized);
        button.setAttribute?.('aria-pressed', String(button.dataset.mode === normalized));
    });
}

function setProgress(selector, position, duration) {
    const node = $(selector);
    if (node) node.style.width = safePercent(position, duration);
}

function setProgressThumb(selector, position, duration) {
    const node = $(selector);
    if (node) node.style.left = safePercent(position, duration);
}

function renderProgress(position = currentPosition, duration = currentDuration) {
    const currentTime = durationLabel(position);
    const totalTime = durationLabel(duration);

    for (const scope of ['global-player', 'speaker-player', 'fullscreen-player']) {
        setText(`[data-role="${scope}-current-time"]`, currentTime);
        setText(`[data-role="${scope}-total-time"]`, totalTime);
        setProgress(`[data-role="${scope}-progress"]`, position, duration);
        setProgressThumb(`[data-role="${scope}-progress-thumb"]`, position, duration);
    }
}

function getProgressTrack(scope) {
    return $(`[data-role="${scope}-progress"]`)?.parentElement || null;
}

function updateProgressSeekState() {
    for (const scope of ['global-player', 'speaker-player', 'fullscreen-player']) {
        const track = getProgressTrack(scope);
        if (!track) continue;
        track.setAttribute?.('aria-disabled', String(!currentCanSeek));
        track.classList?.toggle?.('seek-enabled', currentCanSeek);
        track.classList?.toggle?.('seek-disabled', !currentCanSeek);
        if (currentCanSeek) {
            track.removeAttribute?.('title');
        } else {
            track.setAttribute?.('title', getSelectedPlaybackTarget() === 'browser'
                ? '当前浏览器音频不支持拖动跳转'
                : '当前音箱播放暂不支持拖动跳转');
        }
    }
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function renderActiveLyric(position = currentPosition) {
    const index = getCurrentLyricIndex(currentLyrics, position);
    const lyric = index >= 0 ? currentLyrics[index]?.text || '暂无歌词' : '暂无歌词';
    setText('[data-role="global-player-lyric"]', lyric);
    setText('[data-role="speaker-player-lyric"]', lyric);

    const list = $('[data-role="fullscreen-player-lyrics"]');
    if (!list || index === currentLyricIndex) return;

    const previous = list.querySelector?.('.active');
    previous?.classList?.remove?.('active');
    const line = list.querySelector?.(`[data-lyric-index="${index}"]`);
    line?.classList?.add?.('active');
    if (line) {
        const listRect = list.getBoundingClientRect?.();
        const lineRect = line.getBoundingClientRect?.();
        const relativeTop = Number.isFinite(lineRect?.top) && Number.isFinite(listRect?.top)
            ? lineRect.top - listRect.top + list.scrollTop
            : line.offsetTop - list.offsetTop;
        const targetTop = relativeTop - Math.max((list.clientHeight - line.offsetHeight) / 2, 0);
        list.scrollTop = Math.max(0, targetTop);
    }
    currentLyricIndex = index;
}

function renderFullscreenLyrics(lyrics) {
    const list = $('[data-role="fullscreen-player-lyrics"]');
    if (!list) return;
    currentLyricIndex = null;
    if (!lyrics.length) {
        list.innerHTML = '<div class="fullscreen-player-lyric-empty">暂无歌词</div>';
        return;
    }
    list.innerHTML = lyrics.map((line, index) => (
        `<div class="fullscreen-player-lyric-line" data-lyric-index="${index}">${escapeHtml(line.text)}</div>`
    )).join('');
}

function getAuthHeaders() {
    const token = window.SongloftPlugin?.getAuthToken?.();
    if (!token) return {};
    return { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
}

export function fetchWithAuth(url) {
    return fetch(url, { headers: getAuthHeaders() }).then(response => {
        if (!response.ok) throw new Error(`资源加载失败: ${response.status}`);
        return response.blob();
    });
}

function setCoverImage(src) {
    for (const selector of [
        '[data-role="global-player-cover"]',
        '[data-role="speaker-player-cover"]',
        '[data-role="fullscreen-player-cover"]',
    ]) {
        const image = $(selector);
        if (image) image.src = src || '';
    }

    const background = $('[data-role="fullscreen-player-bg"]');
    if (background) {
        background.style.backgroundImage = src ? `url(${src})` : '';
    }
}

function isSameOriginUrl(url) {
    try {
        const parsed = new URL(url, window.location?.href || 'http://localhost');
        return parsed.origin === (window.location?.origin || parsed.origin);
    } catch {
        return !/^https?:\/\//i.test(String(url || ''));
    }
}

function loadCover(coverUrl) {
    if (coverUrl === currentCoverUrl) return;
    currentCoverUrl = coverUrl || '';
    // Invalidate any in-flight fetch for the previous cover.
    coverRequestId += 1;

    if (currentCoverObjectUrl && URL.revokeObjectURL) {
        URL.revokeObjectURL(currentCoverObjectUrl);
    }
    currentCoverObjectUrl = '';
    setCoverImage('');

    if (!currentCoverUrl) return;

    // External album art (e.g. kuwo CDN) cannot be fetched with auth headers (CORS).
    // Use the browser's native image load for cross-origin URLs.
    if (!isSameOriginUrl(currentCoverUrl)) {
        setCoverImage(currentCoverUrl);
        return;
    }

    // Track changes can outrun in-flight fetches; drop responses for a stale cover.
    const requestedUrl = currentCoverUrl;
    const requestId = coverRequestId;

    fetchWithAuth(requestedUrl)
        .then(blob => {
            if (requestId !== coverRequestId) return;
            currentCoverObjectUrl = URL.createObjectURL(blob);
            setCoverImage(currentCoverObjectUrl);
        })
        .catch(() => {
            if (requestId !== coverRequestId) return;
            // Fall back to direct URL if authenticated fetch fails.
            currentCoverObjectUrl = '';
            setCoverImage(requestedUrl);
        });
}

function lyricTextFrom(rawText) {
    try {
        const json = JSON.parse(rawText);
        if (typeof json.lyric === 'string') return json.lyric;
        if (typeof json.data === 'string') return json.data;
        if (json.data && typeof json.data.lyric === 'string') return json.data.lyric;
    } catch {
        // Plain LRC text is valid.
    }
    return rawText;
}

function loadLyrics(lyricUrl, lyricText = '') {
    const inlineText = String(lyricText || '');
    if (lyricUrl === currentLyricUrl && inlineText === currentLyricText) {
        renderActiveLyric();
        return;
    }

    currentLyricUrl = lyricUrl || '';
    currentLyricText = inlineText;
    // Invalidate any in-flight fetch for the previous track's lyrics.
    lyricRequestId += 1;
    currentLyrics = [];
    renderFullscreenLyrics([]);
    renderActiveLyric();

    if (currentLyricText) {
        currentLyrics = parseLrc(currentLyricText);
        renderFullscreenLyrics(currentLyrics);
        renderActiveLyric();
        return;
    }
    if (!currentLyricUrl) return;

    // Same race as the cover: a slow lyric fetch must not overwrite a newer track.
    const requestedUrl = currentLyricUrl;
    const requestId = lyricRequestId;

    fetchWithAuth(requestedUrl)
        .then(blob => blob.text())
        .then(rawText => {
            if (requestId !== lyricRequestId) return;
            currentLyrics = parseLrc(lyricTextFrom(rawText));
            renderFullscreenLyrics(currentLyrics);
            renderActiveLyric();
        })
        .catch(() => {
            if (requestId !== lyricRequestId) return;
            currentLyrics = [];
            renderFullscreenLyrics([]);
            renderActiveLyric();
        });
}

function stopProgressAnimation() {
    const cancelFrame = window.cancelAnimationFrame || globalThis.cancelAnimationFrame;
    if (progressAnimationFrame && cancelFrame) {
        cancelFrame(progressAnimationFrame);
    }
    progressAnimationFrame = null;
}

function startProgressAnimation() {
    const requestFrame = window.requestAnimationFrame || globalThis.requestAnimationFrame;
    if (!requestFrame || progressAnimationFrame) return;

    const tick = () => {
        if (!isCurrentlyPlaying) {
            progressAnimationFrame = null;
            return;
        }
        const now = nowMs();
        const elapsed = lastUpdateTime ? (now - lastUpdateTime) / 1000 : 0;
        currentPosition = currentDuration > 0
            ? Math.min(currentPosition + elapsed, currentDuration)
            : currentPosition + elapsed;
        lastUpdateTime = now;
        renderProgress(currentPosition, currentDuration);
        renderActiveLyric(currentPosition);
        progressAnimationFrame = requestFrame(tick);
    };

    progressAnimationFrame = requestFrame(tick);
}

export function renderPlayerStatus(status = {}) {
    const nextState = status.state || state.speakerPlayerState || 'idle';
    const stopped = nextState === 'stopped' || nextState === 'idle';
    const song = stopped ? {} : (status.current_song || {
        title: status.title,
        artist: status.artist,
        cover_url: status.cover_url,
        lyric_url: status.lyric_url,
    });
    const titleText = song.title
        ? `${song.title}${song.artist ? ` - ${song.artist}` : ''}`
        : '暂无播放信息';
    const targetHint = status.target === 'browser' ? '浏览器' : status.target === 'speaker' ? '智能音箱' : '';
    const metaText = `${playStateLabel(nextState)} · ${playModeLabel(status.play_mode)}${targetHint ? ` · ${targetHint}` : ''} · ${durationLabel(status.position)}/${durationLabel(status.duration)}`;
    const songTitle = song.title || '暂无播放';
    const songArtist = song.artist || '-';

    const title = $('[data-role="speaker-player-title"]');
    const meta = $('[data-role="speaker-player-meta"]');
    if (title) title.textContent = titleText;
    if (meta) meta.textContent = metaText;
    setSpeakerMessage(playStateLabel(nextState));
    setText('[data-role="global-player-state"]', playStateLabel(nextState));
    setText('[data-role="global-player-title"]', songTitle);
    setText('[data-role="global-player-artist"]', songArtist);
    setText('[data-role="fullscreen-player-title"]', songTitle);
    setText('[data-role="fullscreen-player-artist"]', songArtist);

    const mode = $('[data-role="speaker-player-mode"]');
    const uiMode = normalizePlayMode(status.play_mode || mode?.value || 'loop');
    if (mode && status.play_mode) {
        mode.value = uiMode;
    }
    for (const selector of [
        '[data-role="speaker-player-mode-icon"]',
        '[data-role="global-player-mode-icon"]',
        '[data-role="fullscreen-player-mode-icon"]',
    ]) {
        setIcon(selector, playModeIcon(uiMode));
    }
    updateModeButtons(uiMode);

    currentPosition = Number(status.position) || 0;
    currentDuration = Number(status.duration) || 0;
    lastUpdateTime = nowMs();
    isCurrentlyPlaying = status.is_playing === true || nextState === 'playing';
    currentCanSeek = status.can_seek === true;

    renderProgress(currentPosition, currentDuration);
    updateProgressSeekState();
    loadCover(song.cover_url || '');
    loadLyrics(song.lyric_url || '', song.lyric_text || '');
    setPlayIcon('[data-role="speaker-player-play-icon"]', isCurrentlyPlaying);
    setPlayIcon('[data-role="global-player-play-icon"]', isCurrentlyPlaying);
    setPlayIcon('[data-role="fullscreen-player-play-icon"]', isCurrentlyPlaying);

    if (isCurrentlyPlaying) {
        startProgressAnimation();
    } else {
        stopProgressAnimation();
        renderProgress(currentPosition, currentDuration);
    }

    const playlistId = status.playlist_id === undefined || status.playlist_id === null
        ? state.speakerPlayerPlaylistId
        : String(status.playlist_id);
    const parsedIndex = Number(status.current_index);
    setState({
        speakerPlayerState: nextState,
        speakerPlayerPlaylistId: playlistId || '',
        speakerPlayerCurrentIndex: Number.isFinite(parsedIndex) ? parsedIndex : state.speakerPlayerCurrentIndex,
    });
    updatePlayerToggleButton(nextState);
}

function speakerStatusLooksEmpty(status) {
    if (!status || typeof status !== 'object') return true;
    const song = status.current_song || null;
    const title = status.title || song?.title || song?.name || '';
    const playing = status.is_playing === true || status.state === 'playing' || status.state === 'paused';
    // playlist_id may be 0 for standalone queues; trust song/title/playing instead.
    return !title && !song && !playing;
}

/** Keep browser queue visible after switching to speaker until handoff/play. */
function retainedBrowserStatusForSpeaker() {
    if (!hasBrowserQueue()) return null;
    const status = getBrowserPlaybackStatus();
    return {
        ...status,
        state: status.state === 'playing' ? 'paused' : (status.state || 'paused'),
        is_playing: false,
        target: 'speaker',
        retained_from_browser: true,
    };
}

function rememberSpeakerPlayback(status) {
    if (!status || typeof status !== 'object') return;
    const queue = Array.isArray(status.queue) ? status.queue : [];
    const song = status.current_song || null;
    const title = status.title || song?.title || '';
    if (!queue.length && !title && !song) return;
    lastSpeakerPlayback = {
        ...status,
        queue: queue.length
            ? queue
            : (song || title
                ? [{
                    id: song?.id || 0,
                    title: song?.title || status.title || '未知歌曲',
                    artist: song?.artist || status.artist || '',
                    cover_url: song?.cover_url || status.cover_url || '',
                    lyric_url: song?.lyric_url || status.lyric_url || '',
                    url: song?.url || status.url || '',
                }]
                : []),
        current_index: Number.isFinite(Number(status.current_index)) ? Number(status.current_index) : 0,
    };
}

function retainedSpeakerStatusForBrowser() {
    if (!lastSpeakerPlayback) return null;
    const song = lastSpeakerPlayback.current_song || lastSpeakerPlayback.queue?.[lastSpeakerPlayback.current_index] || lastSpeakerPlayback.queue?.[0];
    if (!song && !lastSpeakerPlayback.title) return null;
    return {
        state: 'paused',
        is_playing: false,
        title: song?.title || lastSpeakerPlayback.title || '',
        artist: song?.artist || lastSpeakerPlayback.artist || '',
        cover_url: song?.cover_url || lastSpeakerPlayback.cover_url || '',
        lyric_url: song?.lyric_url || lastSpeakerPlayback.lyric_url || '',
        play_mode: lastSpeakerPlayback.play_mode || 'loop',
        position: lastSpeakerPlayback.position || 0,
        duration: lastSpeakerPlayback.duration || 0,
        target: 'browser',
        retained_from_speaker: true,
        current_song: song || undefined,
        queue_length: lastSpeakerPlayback.queue?.length || 0,
        queue_index: lastSpeakerPlayback.current_index || 0,
    };
}

function songsFromSpeakerPlayback(playback) {
    if (!playback) return [];
    if (Array.isArray(playback.queue) && playback.queue.length) {
        return playback.queue.map((song) => ({
            id: song.id,
            title: song.title,
            name: song.title,
            artist: song.artist,
            album: song.album,
            cover_url: song.cover_url,
            cover: song.cover_url,
            lyric_url: song.lyric_url,
            lyric: song.lyric_url,
            url: song.url,
            play_url: song.url,
        }));
    }
    const song = playback.current_song;
    if (song?.title || playback.title) {
        return [{
            id: song?.id || 0,
            title: song?.title || playback.title,
            name: song?.title || playback.title,
            artist: song?.artist || playback.artist || '',
            cover_url: song?.cover_url || playback.cover_url || '',
            lyric_url: song?.lyric_url || playback.lyric_url || '',
            url: song?.url || playback.url || '',
        }];
    }
    return [];
}

/**
 * Push the in-memory browser queue to the selected speaker device.
 * Rotates so the current browser track starts first.
 */
export async function handoffBrowserQueueToSpeaker() {
    const snapshot = getBrowserQueueSnapshot();
    if (!snapshot.songs.length) {
        throw new Error('没有可交接的浏览器播放队列');
    }
    const payload = selectedDevicePayload();
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先在音箱页选择账号和设备');
    }

    const rotated = [
        ...snapshot.songs.slice(snapshot.index),
        ...snapshot.songs.slice(0, snapshot.index),
    ];

    const result = await api.post('/bridge/play-songlist', {
        ...payload,
        songs: rotated,
    });
    pauseBrowserPlayback();
    clearPendingTargetHint();
    setActivePlayingTarget('speaker');
    await refreshPlayerStatus().catch(() => null);
    toast('已将当前队列推送到音箱');
    return result;
}

/**
 * Load the last speaker queue into the browser player and start playback.
 */
/**
 * 浏览器开始播放时把音箱停下来，否则两端会同时出声。
 *
 * 用幂等的 /miot/mina/pause，而不是「先查状态再发 /player/toggle」：
 * toggle 是翻转语义，查询与翻转之间音箱状态一旦变化（自动切歌、语音口令、
 * 智能续播都会改它），就会把已暂停的音箱反过来唤醒。pause 无论当前状态如何
 * 都只会暂停，天然没有这个竞态，也保留播放位置便于切回。
 * 停不下来不应中断浏览器播放，因此失败只吞掉。
 */
async function pauseSpeakerForBrowserPlayback() {
    if (!state.accountId || !state.deviceId) return;
    try {
        await api.post('/miot/mina/pause', selectedDevicePayload());
    } catch {
        // 音箱可能离线或未选设备，忽略
    }
}

export async function handoffSpeakerQueueToBrowser() {
    // Prefer a fresh speaker status (includes queue) when device is selected.
    let playback = lastSpeakerPlayback;
    if (state.accountId && state.deviceId) {
        try {
            const fresh = await api.get(`/miot/player/status?account_id=${encodeURIComponent(state.accountId)}&device_id=${encodeURIComponent(state.deviceId)}`);
            if (fresh && !speakerStatusLooksEmpty(fresh)) {
                rememberSpeakerPlayback(fresh);
                playback = lastSpeakerPlayback;
            }
        } catch {
            // fall back to cached speaker playback
        }
    }

    const songs = songsFromSpeakerPlayback(playback);
    if (!songs.length) {
        throw new Error('浏览器暂无播放内容，请先选择歌曲播放');
    }

    const absoluteIndex = Number(playback?.current_index) || 0;
    const queueOffset = Number(playback?.queue_offset) || 0;
    const startIndex = Math.max(0, Math.min(absoluteIndex - queueOffset, songs.length - 1));
    const modeSelect = $('[data-role="speaker-player-mode"]');
    if (modeSelect && playback?.play_mode) {
        modeSelect.value = normalizePlayMode(playback.play_mode);
    }

    clearPendingTargetHint();
    await playBrowserQueue(songs, {
        startIndex,
        playMode: normalizePlayMode(playback?.play_mode),
    });
    // 与「浏览器 → 音箱」对称：新目标接受播放后，再停掉旧目标。
    await pauseSpeakerForBrowserPlayback();
    const status = getBrowserPlaybackStatus();
    renderPlayerStatus(status);
    toast('已在浏览器继续播放');
    return status;
}

export async function refreshPlayerStatus() {
    if (getSelectedPlaybackTarget() === 'browser') {
        if (hasBrowserQueue()) {
            const browserStatus = getBrowserPlaybackStatus();
            renderPlayerStatus(browserStatus);
            return browserStatus;
        }
        // Empty browser queue: keep showing retained speaker track until handoff play.
        const retained = explicitlyStoppedTarget === 'browser' ? null : retainedSpeakerStatusForBrowser();
        if (retained) {
            renderPlayerStatus(retained);
            return retained;
        }
        const browserStatus = getBrowserPlaybackStatus();
        renderPlayerStatus(browserStatus);
        return browserStatus;
    }
    if (!state.accountId || !state.deviceId) {
        const retained = retainedBrowserStatusForSpeaker();
        renderPlayerStatus(retained || { state: 'idle' });
        return retained;
    }
    const result = await api.get(`/miot/player/status?account_id=${encodeURIComponent(state.accountId)}&device_id=${encodeURIComponent(state.deviceId)}`);
    if (explicitlyStoppedTarget === 'speaker' && result?.state !== 'playing' && result?.is_playing !== true) {
        renderPlayerStatus({ state: 'stopped', target: 'speaker' });
        return { state: 'stopped', target: 'speaker' };
    }
    if (result?.state === 'playing' || result?.is_playing === true) explicitlyStoppedTarget = null;
    // Avoid wiping the now-playing card when speaker has no session yet but browser still has a queue.
    if (speakerStatusLooksEmpty(result) && hasBrowserQueue()) {
        const retained = retainedBrowserStatusForSpeaker();
        if (retained) {
            renderPlayerStatus(retained);
            return retained;
        }
    }
    if (!speakerStatusLooksEmpty(result)) {
        rememberSpeakerPlayback(result);
    }
    renderPlayerStatus({ ...(result || {}), target: 'speaker' });
    if (result?.state === 'playing' || result?.is_playing) {
        setActivePlayingTarget('speaker');
    }
    return result;
}

export function startPlayerStatusPolling() {
    if (playerPollTimer && window.clearInterval) {
        window.clearInterval(playerPollTimer);
        playerPollTimer = null;
    }
    refreshPlayerStatus().catch(() => null);
    if (window.setInterval) {
        playerPollTimer = window.setInterval(() => {
            refreshPlayerStatus().catch(() => null);
        }, PLAYER_POLL_MS);
    }
}

export function openFullscreenPlayer() {
    const player = $('[data-role="fullscreen-player"]');
    if (!player) return;
    player.classList?.add?.('open');
    player.setAttribute?.('aria-hidden', 'false');
    document.body?.classList?.add?.('fullscreen-player-open');
    renderProgress(currentPosition, currentDuration);
    renderActiveLyric();
}

export function closeFullscreenPlayer() {
    const player = $('[data-role="fullscreen-player"]');
    if (!player) return;
    player.classList?.remove?.('open');
    player.setAttribute?.('aria-hidden', 'true');
    document.body?.classList?.remove?.('fullscreen-player-open');
}

/**
 * /miot/player/toggle 只回 { message, state }，不带 position/duration。
 * 直接把它渲染出去会让 `Number(undefined) || 0` 把进度条和时间清零，
 * 看起来就像暂停后从头开始播（音箱其实是原地续播的）。
 * 所以这里改为拉一次真实状态；拉取失败才退回只用 state 更新按钮。
 */
async function togglePlayerPlayback() {
    const result = await api.post('/miot/player/toggle', selectedPayload());
    const status = await refreshPlayerStatus().catch(() => null);
    if (!status) {
        const nextState = result?.state || state.speakerPlayerState;
        setState({ speakerPlayerState: nextState });
        updatePlayerToggleButton(nextState);
    }
    return result || {};
}

export async function runPlayerAction(action, options = {}) {
    const command = String(action || '').replace(/^speaker-player-/, '');
    const modeSelect = $('[data-role="speaker-player-mode"]');
    const selectedMode = command === 'mode'
        ? normalizePlayMode(options.playMode || modeSelect?.value || 'loop')
        : '';
    if (selectedMode && modeSelect) {
        modeSelect.value = selectedMode;
    }

    if (getSelectedPlaybackTarget() === 'browser') {
        if (command === 'refresh') {
            return await refreshPlayerStatus() || {};
        }
        // Speaker → browser: empty browser queue should resume from last speaker session.
        if ((command === 'toggle' || command === 'next' || command === 'previous') && !hasBrowserQueue()) {
            try {
                return await handoffSpeakerQueueToBrowser();
            } catch (error) {
                // fall through to browser action for clearer empty-queue message if handoff fails
                const message = error instanceof Error ? error.message : String(error);
                if (!/暂无播放内容|没有可播放|没有可交接/.test(message)) {
                    throw error;
                }
            }
        }
        try {
            const result = await browserPlayerAction(command, {
                playMode: selectedMode || modeSelect?.value || 'loop',
                position: options.position,
            });
            clearPendingTargetHint();
            if (command === 'stop') explicitlyStoppedTarget = 'browser';
            else if (result?.state === 'playing' || result?.is_playing) explicitlyStoppedTarget = null;
            // 浏览器队列已存在时直接按播放也会走到这里，同样要确保音箱不再出声。
            if (result?.state === 'playing' || result?.is_playing === true) {
                await pauseSpeakerForBrowserPlayback();
            }
            renderPlayerStatus(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if ((command === 'toggle' || command === 'next' || command === 'previous')
                && /暂无播放内容|播放队列为空|没有可播放/.test(message)
                && lastSpeakerPlayback) {
                return await handoffSpeakerQueueToBrowser();
            }
            throw error;
        }
    }

    const endpointMap = {
        previous: '/miot/player/previous',
        toggle: '/miot/player/toggle',
        stop: '/miot/player/stop',
        next: '/miot/player/next',
        mode: '/miot/player/mode',
        refresh: '',
    };
    if (command === 'refresh') {
        return await refreshPlayerStatus() || {};
    }

    const endpoint = endpointMap[command];
    if (!endpoint) throw new Error('未知播放控制命令');

    // Browser → speaker: toggle/next/previous with no speaker playlist should hand off the browser queue.
    if ((command === 'toggle' || command === 'next' || command === 'previous') && hasBrowserQueue()) {
        if (command === 'toggle' && getActivePlayingTarget() === 'browser') {
            return await handoffBrowserQueueToSpeaker();
        }
        try {
            if (command === 'toggle') {
                const result = await togglePlayerPlayback();
                if (result?.state === 'playing' || result?.is_playing === true) {
                    pauseBrowserPlayback();
                    setActivePlayingTarget('speaker');
                }
                clearPendingTargetHint();
                return result;
            }
            const result = await api.post(endpoint, selectedPayload());
            pauseBrowserPlayback();
            clearPendingTargetHint();
            setActivePlayingTarget('speaker');
            await refreshPlayerStatus().catch(() => null);
            return result || {};
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/no playlist loaded|select a playlist first|没有.*歌单|playlist/i.test(message)) {
                return await handoffBrowserQueueToSpeaker();
            }
            throw error;
        }
    }

    const result = command === 'toggle'
        ? await togglePlayerPlayback()
        : await api.post(endpoint, selectedPayload(command === 'mode' ? { play_mode: selectedMode || modeSelect?.value || 'order' } : {}));

    clearPendingTargetHint();
    setActivePlayingTarget('speaker');
    if (command === 'stop') {
        explicitlyStoppedTarget = 'speaker';
        lastSpeakerPlayback = null;
        renderPlayerStatus({ state: 'stopped', play_mode: modeSelect?.value || 'order', position: 0, duration: 0, target: 'speaker' });
    } else if (command !== 'toggle') {
        await refreshPlayerStatus().catch(() => null);
    }
    // toggle 已在 togglePlayerPlayback() 内刷新过真实状态，不能再用那份缺 position 的响应覆盖。
    return result || {};
}

// ===== 进度条交互 =====

const progressInteractionHandlers = [];

function getPositionFromEvent(event, track, duration) {
    const rect = track.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    return percent * duration;
}

async function seekToPosition(seconds) {
    if (!currentCanSeek) {
        throw new Error(getSelectedPlaybackTarget() === 'browser'
            ? '当前浏览器音频不支持拖动跳转'
            : '当前音箱播放暂不支持拖动跳转');
    }

    if (getSelectedPlaybackTarget() === 'browser') {
        const result = await browserPlayerAction('seek', { position: seconds });
        renderPlayerStatus(result);
        return result;
    }

    if (!state.accountId || !state.deviceId) {
        throw new Error('请先选择账号和设备');
    }

    const result = await api.post('/miot/player/seek', {
        account_id: state.accountId,
        device_id: state.deviceId,
        position: seconds,
    });

    currentPosition = seconds;
    lastUpdateTime = nowMs();
    renderProgress(seconds, currentDuration);
    renderActiveLyric(seconds);
    if (isCurrentlyPlaying) {
        startProgressAnimation();
    }

    return result || {};
}

function addProgressHandler(target, type, handler) {
    target.addEventListener(type, handler);
    progressInteractionHandlers.push({ target, type, handler });
}

function cleanupProgressHandlers() {
    for (const { target, type, handler } of progressInteractionHandlers.splice(0)) {
        target.removeEventListener?.(type, handler);
    }
}

let browserStatusUnsub = null;

let targetChangeBound = false;

export function bindBrowserStatusBridge() {
    if (browserStatusUnsub) return;
    browserStatusUnsub = subscribeBrowserPlayback((status) => {
        if (getSelectedPlaybackTarget() !== 'browser') return;
        renderPlayerStatus(status);
    });
}

export function bindPlaybackTargetHandoff() {
    if (targetChangeBound) return;
    targetChangeBound = true;
    onPlaybackTargetChange((next, previous) => {
        if (previous === 'browser' && next === 'speaker') {
            // Selecting a target only affects the next command; handoff pauses after acceptance.
            const retained = retainedBrowserStatusForSpeaker();
            if (retained) {
                renderPlayerStatus(retained);
                return;
            }
        }
        // Selecting browser: keep current card (speaker session) if browser queue is empty.
        if (next === 'browser') {
            if (hasBrowserQueue()) {
                renderPlayerStatus(getBrowserPlaybackStatus());
                return;
            }
            const retained = retainedSpeakerStatusForBrowser();
            if (retained) {
                renderPlayerStatus(retained);
                return;
            }
            renderPlayerStatus(getBrowserPlaybackStatus());
            return;
        }
        refreshPlayerStatus().catch(() => null);
    });
}

export function bindProgressInteraction() {
    cleanupProgressHandlers();
    bindBrowserStatusBridge();
    bindPlaybackTargetHandoff();
    updateProgressSeekState();

    const scopes = ['speaker-player', 'global-player', 'fullscreen-player'];

    for (const scope of scopes) {
        const track = getProgressTrack(scope);
        if (!track) continue;

        let isDragging = false;
        let dragPosition = 0;

        addProgressHandler(track, 'mousedown', (event) => {
            if (currentDuration <= 0) return;
            if (!currentCanSeek) {
                toast(getSelectedPlaybackTarget() === 'browser'
                    ? '当前浏览器音频不支持拖动跳转'
                    : '当前音箱播放暂不支持拖动跳转', 'error');
                return;
            }
            isDragging = true;
            dragPosition = getPositionFromEvent(event, track, currentDuration);

            stopProgressAnimation();
            renderProgress(dragPosition, currentDuration);

            event.preventDefault?.();
        });

        const handleMouseMove = (event) => {
            if (!isDragging) return;
            dragPosition = getPositionFromEvent(event, track, currentDuration);
            renderProgress(dragPosition, currentDuration);
        };

        const handleMouseUp = async (event) => {
            if (!isDragging) return;
            isDragging = false;

            dragPosition = getPositionFromEvent(event, track, currentDuration);
            try {
                await seekToPosition(dragPosition);
            } catch (e) {
                console.error('Seek failed:', e);
                toast(e.message || '跳转失败', 'error');
                if (isCurrentlyPlaying) {
                    startProgressAnimation();
                }
            }
        };

        addProgressHandler(document, 'mousemove', handleMouseMove);
        addProgressHandler(document, 'mouseup', handleMouseUp);
    }
}
