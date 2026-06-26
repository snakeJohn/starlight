import { api } from './api.js';
import { asArray as sharedAsArray } from './shared/arrays.js';
import {
    bindDeviceSelection,
    clearSelectedDevice,
    loadDevices,
    normalizeDeviceId,
    normalizeDeviceName,
    refreshSpeaker,
    renderAccountRow,
    renderDeviceRow,
    restoreSavedDeviceSelection,
    selectAndPersistDevice,
} from './speaker_modules/devices.js';
import { refreshPlayerStatus, renderPlayerStatus, runPlayerAction, setSpeakerMessage, updatePlayerToggleButton } from './speaker_modules/player.js';
import { bindQrLogin } from './speaker_modules/qrcode.js';
import { recentVoiceRecords, renderVoiceRecordList } from './speaker_modules/voice_records.js';
import { $, toast } from './state.js';

export {
    clearSelectedDevice,
    normalizeDeviceId,
    normalizeDeviceName,
    renderAccountRow,
    renderDeviceRow,
    restoreSavedDeviceSelection,
    selectAndPersistDevice,
} from './speaker_modules/devices.js';
export { renderPlayerStatus, runPlayerAction } from './speaker_modules/player.js';
export { renderVoiceRecordList } from './speaker_modules/voice_records.js';

let voiceRecordPollTimer = null;
let speakerBindingsBound = false;

const VOICE_RECORD_WINDOW_MS = 12 * 60 * 60 * 1000;
const VOICE_RECORD_POLL_MS = 15000;

function asArray(value) {
    return sharedAsArray(value, ['data', 'accounts']);
}

async function loadVoiceRecords() {
    const list = $('[data-role="voice-record-list"]');
    const summary = $('[data-role="voice-record-summary"]');
    if (!list && !summary) return [];

    const now = Date.now();
    const since = now - VOICE_RECORD_WINDOW_MS;
    const records = asArray(await api.get(`/miot/conversation/messages?since=${since}&limit=200`));
    const recent = recentVoiceRecords(records, now);

    if (list) {
        list.innerHTML = renderVoiceRecordList(recent, now);
    }
    if (summary) {
        summary.textContent = `12 小时内 ${recent.length} 条`;
    }
    return recent;
}

function startVoiceRecordPolling() {
    if (voiceRecordPollTimer) {
        window.clearInterval?.(voiceRecordPollTimer);
        voiceRecordPollTimer = null;
    }
    loadVoiceRecords().catch(error => {
        const summary = $('[data-role="voice-record-summary"]');
        if (summary) summary.textContent = '加载失败';
        toast(error.message, 'error');
    });
    if (window.setInterval) {
        voiceRecordPollTimer = window.setInterval(() => {
            loadVoiceRecords().catch(() => null);
        }, VOICE_RECORD_POLL_MS);
    }
}

function bindSpeakerPlayer() {
    for (const action of ['speaker-player-previous', 'speaker-player-toggle', 'speaker-player-stop', 'speaker-player-next', 'speaker-player-mode', 'speaker-player-refresh']) {
        $(`[data-action="${action}"]`)?.addEventListener('click', async event => {
            const button = event.currentTarget;
            if (button) button.disabled = true;
            try {
                await runPlayerAction(action);
                setSpeakerMessage('控制命令已发送');
                toast('控制命令已发送');
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                if (button) button.disabled = false;
            }
        });
    }
}

function bindRefresh() {
    $('[data-action="refresh-speaker"]')?.addEventListener('click', refreshSpeaker);
    $('[data-action="refresh-devices"]')?.addEventListener('click', () => loadDevices().catch(error => toast(error.message, 'error')));
    $('[data-action="refresh-voice-records"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button) button.disabled = true;
        try {
            await loadVoiceRecords();
            toast('语音记录已刷新');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    });
    $('[data-action="clear-voice-records"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button) button.disabled = true;
        try {
            await api.post('/miot/conversation/messages/clear');
            const list = $('[data-role="voice-record-list"]');
            const summary = $('[data-role="voice-record-summary"]');
            if (list) list.innerHTML = '<div class="empty-state">暂无近 12 小时对话记录。开启对话监听后会自动记录新的语音交互。</div>';
            if (summary) summary.textContent = '12 小时内 0 条';
            toast('语音记录已清空');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    });
}

export async function initSpeakerUI() {
    if (!speakerBindingsBound) {
        bindQrLogin({ refreshSpeaker });
        bindDeviceSelection();
        bindSpeakerPlayer();
        bindRefresh();
        speakerBindingsBound = true;
    }
    updatePlayerToggleButton();
    await refreshSpeaker();
    await refreshPlayerStatus().catch(() => null);
    startVoiceRecordPolling();
}
