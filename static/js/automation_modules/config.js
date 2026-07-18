import { api } from '../api.js';
import { asArray as sharedAsArray } from '../shared/arrays.js';
import { boolValue, hasField, numberValue, setField, textValue } from '../shared/forms.js';
import { $, $$, toast } from '../state.js';
import { applyAiConfigToForm, updateAiAnalysisAccess } from './ai_config.js';

let savedConversationMonitorEnabled = false;

function asArray(value) {
    return sharedAsArray(value, ['commands', 'tasks', 'logs']);
}

function csvNumbers(value) {
    return String(value || '')
        .split(',')
        .map(item => Number(item.trim()))
        .filter(item => Number.isInteger(item) && item > 0);
}

async function putOrPost(path, body) {
    try {
        return await api.put(path, body);
    } catch (error) {
        if (error.code === 404 || error.code === 405 || error.code === '404' || error.code === '405') {
            return api.post(path, body);
        }
        throw error;
    }
}

export { putOrPost };

export function setConfigState(message, form = null) {
    const node = form?.querySelector?.('[data-role="config-state"]');
    if (node) node.textContent = message;
}

function normalizeDeviceId(device) {
    return device?.device_id || device?.deviceID || device?.did || device?.miotDID || device?.id || '';
}

function flattenConversationDevices(groups) {
    const rows = [];
    const seen = new Set();
    for (const group of asArray(groups)) {
        const accountId = group?.account_id || group?.id || group?.account || '';
        for (const device of asArray(group?.devices)) {
            const deviceId = normalizeDeviceId(device);
            const key = `${accountId}:${deviceId}`;
            if (!accountId || !deviceId || seen.has(key)) continue;
            seen.add(key);
            rows.push({ account_id: accountId, device_id: deviceId });
        }
    }
    return rows;
}

export async function manageAllConversationDevices() {
    const groups = await api.get('/miot/mina/devices');
    const devices = flattenConversationDevices(groups);
    if (devices.length === 0) {
        throw new Error('未检测到音箱设备，请先在音箱页登录并刷新设备');
    }
    await Promise.all(devices.map(device => api.post('/miot/mina/device/managed', {
        account_id: device.account_id,
        device_id: device.device_id,
        managed: true,
    })));
    return devices.length;
}

export function updateVoiceCommandAccess(form, enabled) {
    const field = form?.elements?.voice_command_enabled;
    if (!field) return;
    field.disabled = !enabled;
    if (!enabled) {
        field.checked = false;
    }
    field.closest?.('.toggle-line')?.classList.toggle('is-muted', !enabled);
}

function updateAllVoiceCommandAccess(enabled) {
    $$('[data-config-form]').forEach(form => updateVoiceCommandAccess(form, enabled));
}

export function configFromForm(form) {
    const payload = {};
    if (hasField(form, 'server_host')) {
        payload.server_host = textValue(form, 'server_host');
    }
    for (const name of [
        'conversation_monitor_enabled',
        'voice_command_enabled',
        'scheduled_tasks_enabled',
        'force_mp3',
    ]) {
        if (hasField(form, name)) {
            payload[name] = boolValue(form, name);
        }
    }
    return payload;
}

export function updateServerHostWarning(form, statusOrHost) {
    const warning = form?.querySelector?.('[data-role="server-host-warning"]');
    if (!warning) return;
    const value = String(statusOrHost || '').trim().toLowerCase();
    const loopback = value === 'loopback'
        || value.includes('localhost')
        || /^https?:\/\/127\./.test(value)
        || /^127\./.test(value);
    warning.hidden = !loopback;
    warning.textContent = loopback
        ? '当前地址是本地回环地址，MIoT 智能音箱可能无法访问，请填写局域网或公网可访问地址。'
        : '';
}

export async function loadConfig() {
    const config = await api.get('/miot/config');
    const forms = $$('[data-config-form]');
    if (forms.length === 0) return;
    for (const form of forms) {
        for (const name of [
            'server_host',
            'conversation_monitor_enabled',
            'voice_command_enabled',
            'scheduled_tasks_enabled',
            'force_mp3',
        ]) {
            setField(form, name, config[name]);
        }
        updateServerHostWarning(form, config.server_host_status || config.server_host);
        setConfigState('已加载', form);
    }
    savedConversationMonitorEnabled = !!config.conversation_monitor_enabled;
    updateAllVoiceCommandAccess(savedConversationMonitorEnabled);
    // AI 依赖语音口令；表单随 config 一并填充
    updateAiAnalysisAccess(!!config.voice_command_enabled);
    applyAiConfigToForm(config.ai_config || {});
}

export async function prepareConversationMonitorFromCheckbox(input) {
    const form = input.closest?.('form') || $('[data-config-form]');
    if (!input.checked) {
        updateVoiceCommandAccess(form, false);
        setConfigState('对话监听关闭后，语音口令将不可用', form);
        return;
    }

    input.disabled = true;
    setConfigState('正在检测并托管音箱设备...', form);
    try {
        const count = await manageAllConversationDevices();
        updateVoiceCommandAccess(form, savedConversationMonitorEnabled);
        setConfigState(`已自动托管 ${count} 台音箱，保存设置后可启用语音口令`, form);
        toast(`已自动托管 ${count} 台音箱`);
    } catch (error) {
        input.checked = false;
        updateVoiceCommandAccess(form, false);
        setConfigState(error.message, form);
        toast(error.message, 'error');
    } finally {
        input.disabled = false;
    }
}

export async function saveConfig(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = configFromForm(form);
    const result = await putOrPost('/miot/config', payload);
    if (hasField(form, 'conversation_monitor_enabled')) {
        savedConversationMonitorEnabled = boolValue(form, 'conversation_monitor_enabled');
        updateAllVoiceCommandAccess(savedConversationMonitorEnabled);
    }
    if (hasField(form, 'voice_command_enabled')) {
        const voiceOn = boolValue(form, 'voice_command_enabled');
        updateAiAnalysisAccess(voiceOn);
        if (!voiceOn) {
            // 关闭语音口令时同步关掉 AI，避免界面显示“已开启”但实际不会跑
            try {
                await putOrPost('/miot/config', { ai_config: { enabled: false } });
                applyAiConfigToForm({ enabled: false });
            } catch {
                // ignore secondary failure
            }
        }
    }
    const savedMessage = hasField(form, 'conversation_monitor_enabled') && savedConversationMonitorEnabled
        ? '已保存，可启用语音口令'
        : '已保存';
    setConfigState(result?.warning || savedMessage, form);
    updateServerHostWarning(form, result?.warning ? 'loopback' : textValue(form, 'server_host'));
    toast(result?.warning || '设置已保存', result?.warning ? 'error' : 'success');
}
