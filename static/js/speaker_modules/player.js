import { api } from '../api.js';
import { $, $$, durationLabel, selectedDevicePayload, setState, state } from '../state.js';

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
    $$('[data-action="speaker-player-toggle"]').forEach(button => {
        button.textContent = paused ? '继续播放' : '暂停播放';
        button.title = paused ? '继续播放' : '暂停播放';
        button.setAttribute?.('aria-label', paused ? '继续播放' : '暂停播放');
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
        single: '单曲循环',
        loop: '列表循环',
        repeat: '列表循环',
    }[mode] || '保持';
}

export function renderPlayerStatus(status = {}) {
    const nextState = status.state || state.speakerPlayerState || 'idle';
    const song = status.current_song || {};
    const titleText = song.title
        ? `${song.title}${song.artist ? ` - ${song.artist}` : ''}`
        : '暂无播放信息';
    const metaText = `${playStateLabel(nextState)} · ${playModeLabel(status.play_mode)} · ${durationLabel(status.position)}/${durationLabel(status.duration)}`;

    const title = $('[data-role="speaker-player-title"]');
    const meta = $('[data-role="speaker-player-meta"]');
    if (title) title.textContent = titleText;
    if (meta) meta.textContent = metaText;
    setSpeakerMessage(playStateLabel(nextState));

    const mode = $('[data-role="speaker-player-mode"]');
    if (mode && status.play_mode) {
        mode.value = status.play_mode === 'repeat' ? 'loop' : status.play_mode;
    }

    setState({ speakerPlayerState: nextState });
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

async function togglePlayerPlayback() {
    const result = await api.post('/miot/player/toggle', selectedPayload());
    renderPlayerStatus(result || {});
    return result || {};
}

export async function runPlayerAction(action) {
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
    const result = command === 'toggle'
        ? await togglePlayerPlayback()
        : await api.post(endpoint, selectedPayload(command === 'mode' ? { play_mode: modeSelect?.value || 'order' } : {}));

    if (command === 'stop') {
        renderPlayerStatus({ state: 'stopped', play_mode: modeSelect?.value || 'order', position: 0, duration: 0 });
    } else if (command !== 'toggle') {
        await refreshPlayerStatus().catch(() => null);
    }
    return result || {};
}
