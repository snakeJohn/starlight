import { api } from '../api.js';
import { $, $$, durationLabel, selectedDevicePayload, setState, state, toast } from '../state.js';
import { getCurrentLyricIndex, parseLrc } from './lrc_parser.js';

const PLAYER_POLL_MS = 5000;

let currentPosition = 0;
let currentDuration = 0;
let currentLyrics = [];
let currentLyricUrl = '';
let currentCoverUrl = '';
let currentCoverObjectUrl = '';
let lastUpdateTime = 0;
let progressAnimationFrame = null;
let playerPollTimer = null;
let isCurrentlyPlaying = false;
let currentCanSeek = false;

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
    const paused = playerState === 'paused';
    const label = paused ? '继续播放' : '暂停播放';
    $$('[data-action="speaker-player-toggle"]').forEach(button => {
        const icon = button.querySelector?.('[data-role="speaker-player-play-icon"], [data-role="global-player-play-icon"], [data-role="fullscreen-player-play-icon"]');
        if (icon) {
            icon.classList?.remove?.('fa-play', 'fa-pause');
            icon.classList?.add?.(paused ? 'fa-play' : 'fa-pause');
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
            track.setAttribute?.('title', '当前音箱播放暂不支持拖动跳转');
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
    if (!list) return;

    const previous = list.querySelector?.('.active');
    previous?.classList?.remove?.('active');
    const line = list.querySelector?.(`[data-lyric-index="${index}"]`);
    line?.classList?.add?.('active');
    line?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderFullscreenLyrics(lyrics) {
    const list = $('[data-role="fullscreen-player-lyrics"]');
    if (!list) return;
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

function loadCover(coverUrl) {
    if (coverUrl === currentCoverUrl) return;
    currentCoverUrl = coverUrl || '';

    if (currentCoverObjectUrl && URL.revokeObjectURL) {
        URL.revokeObjectURL(currentCoverObjectUrl);
    }
    currentCoverObjectUrl = '';
    setCoverImage('');

    if (!currentCoverUrl) return;

    fetchWithAuth(currentCoverUrl)
        .then(blob => {
            currentCoverObjectUrl = URL.createObjectURL(blob);
            setCoverImage(currentCoverObjectUrl);
        })
        .catch(() => {
            currentCoverObjectUrl = '';
            setCoverImage('');
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

function loadLyrics(lyricUrl) {
    if (lyricUrl === currentLyricUrl) {
        renderActiveLyric();
        return;
    }

    currentLyricUrl = lyricUrl || '';
    currentLyrics = [];
    renderFullscreenLyrics([]);
    renderActiveLyric();

    if (!currentLyricUrl) return;

    fetchWithAuth(currentLyricUrl)
        .then(blob => blob.text())
        .then(rawText => {
            currentLyrics = parseLrc(lyricTextFrom(rawText));
            renderFullscreenLyrics(currentLyrics);
            renderActiveLyric();
        })
        .catch(() => {
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
        const position = currentDuration > 0
            ? Math.min(currentPosition + elapsed, currentDuration)
            : currentPosition + elapsed;
        renderProgress(position, currentDuration);
        renderActiveLyric(position);
        progressAnimationFrame = requestFrame(tick);
    };

    progressAnimationFrame = requestFrame(tick);
}

export function renderPlayerStatus(status = {}) {
    const nextState = status.state || state.speakerPlayerState || 'idle';
    const song = status.current_song || {};
    const titleText = song.title
        ? `${song.title}${song.artist ? ` - ${song.artist}` : ''}`
        : '暂无播放信息';
    const metaText = `${playStateLabel(nextState)} · ${playModeLabel(status.play_mode)} · ${durationLabel(status.position)}/${durationLabel(status.duration)}`;
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
    loadLyrics(song.lyric_url || '');
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

export async function refreshPlayerStatus() {
    if (!state.accountId || !state.deviceId) {
        renderPlayerStatus({ state: 'idle' });
        return null;
    }
    const result = await api.get(`/miot/player/status?account_id=${encodeURIComponent(state.accountId)}&device_id=${encodeURIComponent(state.deviceId)}`);
    renderPlayerStatus(result || {});
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

async function togglePlayerPlayback() {
    const result = await api.post('/miot/player/toggle', selectedPayload());
    renderPlayerStatus(result || {});
    return result || {};
}

export async function runPlayerAction(action, options = {}) {
    const command = String(action || '').replace(/^speaker-player-/, '');
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

    const modeSelect = $('[data-role="speaker-player-mode"]');
    const selectedMode = command === 'mode'
        ? normalizePlayMode(options.playMode || modeSelect?.value || 'loop')
        : '';
    if (selectedMode && modeSelect) {
        modeSelect.value = selectedMode;
    }
    const result = command === 'toggle'
        ? await togglePlayerPlayback()
        : await api.post(endpoint, selectedPayload(command === 'mode' ? { play_mode: selectedMode || modeSelect?.value || 'order' } : {}));

    if (command === 'stop') {
        renderPlayerStatus({ state: 'stopped', play_mode: modeSelect?.value || 'order', position: 0, duration: 0 });
    } else if (command !== 'toggle') {
        await refreshPlayerStatus().catch(() => null);
    }
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
    if (!state.accountId || !state.deviceId) {
        throw new Error('请先选择账号和设备');
    }
    if (!currentCanSeek) {
        throw new Error('当前音箱播放暂不支持拖动跳转');
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

export function bindProgressInteraction() {
    cleanupProgressHandlers();
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
                toast('当前音箱播放暂不支持拖动跳转', 'error');
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
