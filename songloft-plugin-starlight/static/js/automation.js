import { api } from './api.js';
import { $, $$, escapeHtml, toast } from './state.js';

let savedConversationMonitorEnabled = false;
let automationPlayerDevices = [];
const automationPlayerTarget = {
    account_id: '',
    device_id: '',
    device_name: '',
    playbackState: 'idle',
};

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.commands)) return value.commands;
    if (Array.isArray(value?.tasks)) return value.tasks;
    if (Array.isArray(value?.logs)) return value.logs;
    return [];
}

function boolValue(form, name) {
    return Boolean(form.elements[name]?.checked);
}

function hasField(form, name) {
    return Boolean(form.elements[name]);
}

function textValue(form, name) {
    return String(form.elements[name]?.value || '').trim();
}

function numberValue(form, name) {
    const raw = textValue(form, name);
    return raw === '' ? undefined : Number(raw);
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

function setConfigState(message, form = null) {
    const node = form?.querySelector?.('[data-role="config-state"]') || $('[data-role="config-state"]');
    if (node) node.textContent = message;
}

function normalizeDeviceId(device) {
    return device?.device_id || device?.deviceID || device?.did || device?.miotDID || device?.id || '';
}

function normalizeDeviceName(device) {
    return device?.name || device?.device_name || device?.miotName || device?.alias || device?.model || normalizeDeviceId(device) || '未命名设备';
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

export function flattenAutomationPlayerDevices(groups) {
    const rows = [];
    const seen = new Set();
    for (const group of asArray(groups)) {
        const accountId = group?.account_id || group?.id || group?.account || '';
        const accountName = group?.account_name || group?.account || group?.username || accountId || '小米账号';
        for (const device of asArray(group?.devices)) {
            const deviceId = normalizeDeviceId(device);
            const key = `${accountId}:${deviceId}`;
            if (!accountId || !deviceId || seen.has(key)) continue;
            seen.add(key);
            rows.push({
                account_id: accountId,
                account_name: accountName,
                device_id: deviceId,
                device_name: normalizeDeviceName(device),
            });
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

const voiceCommandTypes = [
    ['create_playlist', '创建歌单'],
    ['add_song_to_playlist', '加入自建歌单'],
    ['play_playlist', '播放歌单'],
    ['play_song', '播放歌曲'],
    ['set_play_mode', '播放模式'],
    ['set_volume', '音量控制'],
    ['next', '下一首'],
    ['previous', '上一首'],
    ['stop', '停止播放'],
];

const voiceCommandParams = {
    set_play_mode: [
        ['order', '顺序播放'],
        ['random', '随机播放'],
        ['single', '单曲循环'],
        ['loop', '列表循环'],
    ],
    set_volume: [
        ['absolute', '设置到指定音量'],
        ['up', '增加音量'],
        ['down', '减小音量'],
    ],
};

const defaultVoiceCommand = {
    type: 'play_song',
    keywords: ['播放歌曲'],
    enabled: true,
};

function splitKeywords(value) {
    return String(value || '')
        .split(/[,，、\n]/)
        .map(item => item.trim())
        .filter(Boolean);
}

function typeOptions(selected) {
    return voiceCommandTypes
        .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
        .join('');
}

function paramOptions(type, selected) {
    const options = voiceCommandParams[type] || [];
    if (!options.length) {
        return '<option value="">无参数</option>';
    }
    return options
        .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
        .join('');
}

export function voiceCommandFromEditorData(data) {
    const command = {
        type: String(data.type || 'play_song'),
        keywords: splitKeywords(data.keywords),
        enabled: Boolean(data.enabled),
    };
    const param = String(data.param || '').trim();
    if (param) command.param = param;
    return command;
}

export function renderVoiceCommandRow(command = defaultVoiceCommand, index = 0) {
    const type = command.type || 'play_song';
    const keywords = Array.isArray(command.keywords) ? command.keywords.join('，') : '';
    const hasParam = Boolean(voiceCommandParams[type]?.length);
    return `
        <article class="voice-command-row" data-role="voice-command-row" data-index="${index}">
            <label class="toggle-line compact-toggle">
                <input name="enabled" type="checkbox" ${command.enabled === false ? '' : 'checked'}>
                <span>启用</span>
            </label>
            <label>
                <span>功能</span>
                <select name="type">${typeOptions(type)}</select>
            </label>
            <label class="${hasParam ? '' : 'is-muted'}">
                <span>参数</span>
                <select name="param" ${hasParam ? '' : 'disabled'}>${paramOptions(type, command.param || '')}</select>
            </label>
            <label class="wide-field">
                <span>口令词</span>
                <input name="keywords" value="${escapeHtml(keywords)}" placeholder="多个口令用逗号分隔">
            </label>
            <button class="ghost-button" type="button" data-action="delete-voice-command">删除</button>
        </article>
    `;
}

function renderVoiceCommands(commands) {
    const list = $('[data-role="voice-command-list"]');
    if (!list) return;
    list.innerHTML = commands.length
        ? commands.map((command, index) => renderVoiceCommandRow(command, index)).join('')
        : '<div class="empty-state">暂无语音口令。点击“新增口令”创建一条。</div>';
}

function voiceRowToCommand(row) {
    return voiceCommandFromEditorData({
        enabled: row.querySelector('[name="enabled"]')?.checked,
        type: row.querySelector('[name="type"]')?.value,
        param: row.querySelector('[name="param"]')?.value,
        keywords: row.querySelector('[name="keywords"]')?.value,
    });
}

function collectVoiceCommands() {
    return $$('[data-role="voice-command-row"]')
        .map(row => voiceRowToCommand(row))
        .filter(command => command.keywords.length > 0);
}

function updateVoiceRowParam(row) {
    const type = row.querySelector('[name="type"]')?.value || 'play_song';
    const select = row.querySelector('[name="param"]');
    const wrapper = select?.closest('label');
    if (!select) return;
    const hasParam = Boolean(voiceCommandParams[type]?.length);
    select.innerHTML = paramOptions(type, select.value);
    select.disabled = !hasParam;
    wrapper?.classList.toggle('is-muted', !hasParam);
}

function automationPlayerOptionValue(device) {
    return `${device.account_id}|${device.device_id}`;
}

function playStateLabel(state) {
    return {
        idle: '空闲',
        playing: '播放中',
        paused: '已暂停',
        stopped: '已停止',
    }[state] || '未知';
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

function durationText(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '--:--';
    const minutes = Math.floor(value / 60);
    const rest = Math.floor(value % 60);
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function setAutomationPlayerState(message) {
    const node = $('[data-role="automation-player-state"]');
    if (node) node.textContent = message;
}

function updateAutomationPlayerToggleButton(playbackState = automationPlayerTarget.playbackState) {
    const button = $('[data-action="automation-player-toggle"]');
    if (!button) return;
    const paused = playbackState === 'paused';
    button.textContent = paused ? '继续播放' : '暂停播放';
    button.title = paused ? '继续播放' : '暂停播放';
    button.setAttribute?.('aria-label', paused ? '继续播放' : '暂停播放');
}

export function selectAutomationPlayerDevice(accountId, deviceId, deviceName = '') {
    automationPlayerTarget.account_id = accountId || '';
    automationPlayerTarget.device_id = deviceId || '';
    automationPlayerTarget.device_name = deviceName || '';

    const select = $('[data-role="automation-player-device"]');
    if (select && accountId && deviceId) {
        select.value = automationPlayerOptionValue({ account_id: accountId, device_id: deviceId });
    }
    setAutomationPlayerState(deviceName || deviceId ? `已选择：${deviceName || deviceId}` : '未选择设备');
}

export function automationPlayerPayload(extra = {}) {
    if (!automationPlayerTarget.account_id || !automationPlayerTarget.device_id) {
        throw new Error('请先选择音箱播放设备');
    }
    return {
        account_id: automationPlayerTarget.account_id,
        device_id: automationPlayerTarget.device_id,
        ...extra,
    };
}

function renderAutomationPlayerDevices(rows) {
    const select = $('[data-role="automation-player-device"]');
    if (!select) return;
    automationPlayerDevices = rows;

    if (rows.length === 0) {
        select.innerHTML = '<option value="">暂无音箱设备</option>';
        selectAutomationPlayerDevice('', '', '');
        setAutomationPlayerState('未检测到设备');
        return;
    }

    select.innerHTML = rows.map(row => `
        <option value="${escapeHtml(automationPlayerOptionValue(row))}">
            ${escapeHtml(row.device_name)} · ${escapeHtml(row.account_name)}
        </option>
    `).join('');

    const selected = rows.find(row =>
        row.account_id === automationPlayerTarget.account_id
        && row.device_id === automationPlayerTarget.device_id
    ) || rows[0];
    selectAutomationPlayerDevice(selected.account_id, selected.device_id, selected.device_name);
}

function renderAutomationPlayerStatus(status) {
    if (!status) return;
    if (status.state) {
        automationPlayerTarget.playbackState = status.state;
    }
    updateAutomationPlayerToggleButton();
    setAutomationPlayerState(playStateLabel(status.state || automationPlayerTarget.playbackState));

    const song = status.current_song || {};
    const title = $('[data-role="automation-player-title"]');
    const meta = $('[data-role="automation-player-meta"]');
    if (title) {
        title.textContent = song.title
            ? `${song.title}${song.artist ? ` - ${song.artist}` : ''}`
            : '暂无播放信息';
    }
    if (meta) {
        const position = durationText(status.position);
        const duration = durationText(status.duration);
        meta.textContent = `${playStateLabel(status.state)} · ${playModeLabel(status.play_mode)} · ${position}/${duration}`;
    }

    const mode = $('[data-role="automation-player-mode"]');
    if (mode && status.play_mode) {
        mode.value = status.play_mode === 'repeat' ? 'loop' : status.play_mode;
    }
}

async function loadAutomationPlayerDevices() {
    const groups = await api.get('/miot/mina/devices');
    const rows = flattenAutomationPlayerDevices(groups);
    renderAutomationPlayerDevices(rows);
    return rows;
}

export async function refreshAutomationPlayerStatus() {
    if (!automationPlayerTarget.account_id || !automationPlayerTarget.device_id) {
        return null;
    }
    const result = await api.get(`/miot/player/status?account_id=${encodeURIComponent(automationPlayerTarget.account_id)}&device_id=${encodeURIComponent(automationPlayerTarget.device_id)}`);
    renderAutomationPlayerStatus(result);
    return result || {};
}

async function loadAutomationPlayer() {
    const rows = await loadAutomationPlayerDevices();
    if (rows.length > 0) {
        await refreshAutomationPlayerStatus().catch(() => null);
    }
}

export async function runAutomationPlayerAction(action) {
    const command = String(action || '').replace(/^automation-player-/, '');
    const modeSelect = $('[data-role="automation-player-mode"]');
    const endpointMap = {
        previous: '/miot/player/previous',
        toggle: '/miot/player/toggle',
        stop: '/miot/player/stop',
        next: '/miot/player/next',
        mode: '/miot/player/mode',
    };
    const endpoint = endpointMap[command];
    if (!endpoint) {
        throw new Error('未知播放控制命令');
    }

    const result = await api.post(endpoint, automationPlayerPayload(
        command === 'mode' ? { play_mode: modeSelect?.value || 'order' } : {},
    ));

    if (command === 'stop') {
        renderAutomationPlayerStatus({ state: 'stopped', play_mode: modeSelect?.value || 'order', position: 0, duration: 0 });
    } else if (result?.state || result?.current_song) {
        renderAutomationPlayerStatus(result);
    }
    await refreshAutomationPlayerStatus().catch(() => null);
    return result || {};
}

async function loadVoiceCommands() {
    const data = await api.get('/miot/voice-commands');
    const status = $('[data-role="voice-enabled"]');
    renderVoiceCommands(data.commands || asArray(data));
    if (status) status.textContent = data.enabled ? '已启用' : '未启用';
}

async function saveVoiceCommands() {
    const commands = collectVoiceCommands();
    await putOrPost('/miot/voice-commands', { commands });
    toast('语音口令已保存');
}

function renderIndexing(status) {
    $('[data-role="indexing-state"]').textContent = status?.is_refreshing ? '刷新中' : status?.ready ? '已就绪' : '未就绪';
    $('[data-role="index-playlists"]').textContent = String(status?.playlist_count ?? 0);
    $('[data-role="index-songs"]').textContent = String(status?.song_count ?? 0);
    $('[data-role="index-updated"]').textContent = status?.last_refresh_time ? new Date(status.last_refresh_time).toLocaleString() : '-';
}

async function loadIndexing() {
    renderIndexing(await api.get('/miot/indexing/status'));
}

async function refreshIndexing() {
    await api.post('/miot/indexing/refresh', {});
    toast('索引刷新已开始');
    await loadIndexing();
}

function scheduleLabel(task) {
    const schedule = task.schedule || {};
    if (schedule.type === 'weekly') return `每周 ${asArray(schedule.weekdays).join(',')} ${schedule.time || ''}`;
    if (schedule.type === 'monthly') return `每月 ${asArray(schedule.monthdays).join(',')} ${schedule.time || ''}`;
    return `${schedule.type || '未知'} ${schedule.time || ''}`;
}

function renderSchedules(data) {
    const tasks = asArray(data);
    const status = $('[data-role="schedules-enabled"]');
    const list = $('[data-role="schedule-list"]');
    if (status) status.textContent = data?.enabled ? '已启用' : '未启用';
    if (!list) return;
    list.innerHTML = tasks.length
        ? tasks.map(task => `
            <article class="schedule-row">
                <span class="row-main">
                    <strong>${escapeHtml(task.name || task.id)}</strong>
                    <span>${escapeHtml(task.action || '')} · ${escapeHtml(scheduleLabel(task))}</span>
                    <span class="row-meta">${task.enabled === false ? '停用' : '启用'} · ${escapeHtml(task.id || '')}</span>
                </span>
                <span class="row-actions">
                    <button type="button" data-action="toggle-schedule" data-id="${escapeHtml(task.id)}" data-enabled="${task.enabled === false ? 'true' : 'false'}">${task.enabled === false ? '启用' : '停用'}</button>
                    <button type="button" data-action="edit-schedule" data-id="${escapeHtml(task.id)}">填入</button>
                </span>
            </article>
        `).join('')
        : '<div class="empty-state">暂无定时任务。</div>';
}

async function loadSchedules() {
    renderSchedules(await api.get('/miot/schedules'));
}

function scheduleFromForm(form) {
    const type = textValue(form, 'schedule_type') || 'weekly';
    const action = textValue(form, 'action') || 'play_playlist';
    const params = {};
    const volume = numberValue(form, 'volume');
    if (textValue(form, 'playlist_name')) params.playlist_name = textValue(form, 'playlist_name');
    if (volume !== undefined) params.volume = volume;
    if (textValue(form, 'play_mode')) params.play_mode = textValue(form, 'play_mode');

    const schedule = {
        type,
        time: textValue(form, 'time') || '08:00',
    };
    if (type === 'weekly') schedule.weekdays = csvNumbers(textValue(form, 'weekdays'));
    if (type === 'monthly') schedule.monthdays = csvNumbers(textValue(form, 'monthdays'));

    return {
        id: textValue(form, 'id') || undefined,
        name: textValue(form, 'name'),
        enabled: boolValue(form, 'enabled'),
        action,
        schedule,
        target: {
            all_managed: boolValue(form, 'all_managed'),
            devices: [],
        },
        params,
    };
}

async function saveSchedule(event) {
    event.preventDefault();
    const task = scheduleFromForm(event.currentTarget);
    if (!task.name) throw new Error('请填写任务名称');
    if (task.id) {
        await api.post('/miot/schedules/update', task);
    } else {
        await api.post('/miot/schedules', task);
    }
    toast('定时任务已保存');
    await loadSchedules();
}

function fillScheduleForm(task) {
    const form = $('[data-role="schedule-form"]');
    if (!form || !task) return;
    form.elements.id.value = task.id || '';
    form.elements.name.value = task.name || '';
    form.elements.action.value = task.action || 'play_playlist';
    form.elements.schedule_type.value = task.schedule?.type || 'weekly';
    form.elements.time.value = task.schedule?.time || '08:00';
    form.elements.weekdays.value = asArray(task.schedule?.weekdays).join(',');
    form.elements.monthdays.value = asArray(task.schedule?.monthdays).join(',');
    form.elements.playlist_name.value = task.params?.playlist_name || '';
    form.elements.volume.value = task.params?.volume ?? '';
    form.elements.play_mode.value = task.params?.play_mode || '';
    form.elements.enabled.checked = task.enabled !== false;
    form.elements.all_managed.checked = task.target?.all_managed !== false;
}

function setField(form, name, value) {
    if (!form.elements[name]) return;
    const field = form.elements[name];
    if (field.type === 'checkbox') {
        field.checked = Boolean(value);
    } else if (Array.isArray(value)) {
        field.value = value.join(',');
    } else {
        field.value = value ?? '';
    }
}

async function loadConfig() {
    const config = await api.get('/miot/config');
    const forms = $$('[data-config-form]');
    if (forms.length === 0) return;
    for (const form of forms) {
        for (const name of [
            'timezone',
            'external_search_url',
            'external_search_token',
            'extra_music_api_models',
            'interrupt_tts_hint_text',
            'conversation_monitor_enabled',
            'voice_command_enabled',
            'scheduled_tasks_enabled',
            'force_mp3',
            'external_search_enabled',
            'indicator_light_enabled',
            'interrupt_tts_hint_enabled',
        ]) {
            setField(form, name, config[name]);
        }
        const ai = config.ai_config || {};
        setField(form, 'ai_enabled', ai.enabled);
        setField(form, 'ai_api_url', ai.api_url);
        setField(form, 'ai_model', ai.model);
        setField(form, 'ai_timeout', ai.timeout);
        setField(form, 'ai_api_key', ai.api_key);
        setConfigState('已加载', form);
    }
    const hostNode = $('[data-role="host-url"]');
    if (hostNode) hostNode.textContent = config.songloft_host || config.server_host || '自动获取';
    savedConversationMonitorEnabled = !!config.conversation_monitor_enabled;
    updateAllVoiceCommandAccess(savedConversationMonitorEnabled);
}

export function configFromForm(form) {
    const payload = {};
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
    if (hasField(form, 'timezone')) {
        payload.timezone = textValue(form, 'timezone');
    }
    if (hasField(form, 'extra_music_api_models')) {
        payload.extra_music_api_models = textValue(form, 'extra_music_api_models')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }
    if (hasField(form, 'external_search_enabled')) {
        payload.external_search_enabled = boolValue(form, 'external_search_enabled');
    }
    if (hasField(form, 'external_search_url')) {
        payload.external_search_url = textValue(form, 'external_search_url');
    }
    if (hasField(form, 'external_search_token')) {
        payload.external_search_token = textValue(form, 'external_search_token');
    }
    if (hasField(form, 'indicator_light_enabled')) {
        payload.indicator_light_enabled = boolValue(form, 'indicator_light_enabled');
    }
    if (hasField(form, 'interrupt_tts_hint_enabled')) {
        payload.interrupt_tts_hint_enabled = boolValue(form, 'interrupt_tts_hint_enabled');
    }
    if (hasField(form, 'interrupt_tts_hint_text')) {
        payload.interrupt_tts_hint_text = textValue(form, 'interrupt_tts_hint_text');
    }
    if (hasField(form, 'ai_enabled')) {
        payload.ai_config = {
            enabled: boolValue(form, 'ai_enabled'),
            api_url: textValue(form, 'ai_api_url'),
            api_key: textValue(form, 'ai_api_key'),
            model: textValue(form, 'ai_model'),
            timeout: Number(textValue(form, 'ai_timeout')) || 30,
        };
    }
    return payload;
}

async function prepareConversationMonitorFromCheckbox(input) {
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

async function saveConfig(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await putOrPost('/miot/config', configFromForm(form));
    if (hasField(form, 'conversation_monitor_enabled')) {
        savedConversationMonitorEnabled = boolValue(form, 'conversation_monitor_enabled');
        updateAllVoiceCommandAccess(savedConversationMonitorEnabled);
    }
    const savedMessage = hasField(form, 'conversation_monitor_enabled') && savedConversationMonitorEnabled
        ? '已保存，可启用语音口令'
        : '已保存';
    setConfigState(result?.warning || savedMessage, form);
    toast(result?.warning || '设置已保存', result?.warning ? 'error' : 'success');
}

function bindAutomation() {
    $('[data-action="load-voice"]')?.addEventListener('click', () => loadVoiceCommands().catch(error => toast(error.message, 'error')));
    $('[data-action="save-voice"]')?.addEventListener('click', () => saveVoiceCommands().catch(error => toast(error.message, 'error')));
    $('[data-action="add-voice-command"]')?.addEventListener('click', () => {
        const list = $('[data-role="voice-command-list"]');
        if (!list) return;
        if (list.querySelector('.empty-state')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', renderVoiceCommandRow(defaultVoiceCommand, list.querySelectorAll('[data-role="voice-command-row"]').length));
    });
    $('[data-action="refresh-index"]')?.addEventListener('click', () => refreshIndexing().catch(error => toast(error.message, 'error')));
    $('[data-action="refresh-automation"]')?.addEventListener('click', () => loadAutomation().catch(error => toast(error.message, 'error')));
    $$('[data-action="load-config"]').forEach(button => {
        button.addEventListener('click', () => loadConfig().catch(error => toast(error.message, 'error')));
    });
    $('[data-role="schedule-form"]')?.addEventListener('submit', event => saveSchedule(event).catch(error => toast(error.message, 'error')));
    $$('[data-config-form]').forEach(form => {
        form.addEventListener('submit', event => saveConfig(event).catch(error => toast(error.message, 'error')));
    });
    $$('[name="conversation_monitor_enabled"]').forEach(input => {
        input.addEventListener('change', event => {
            prepareConversationMonitorFromCheckbox(event.currentTarget).catch(error => {
                setConfigState(error.message, event.currentTarget.closest?.('form'));
                toast(error.message, 'error');
            });
        });
    });

    $('[data-role="automation-player-device"]')?.addEventListener('change', event => {
        const row = automationPlayerDevices.find(device => automationPlayerOptionValue(device) === event.currentTarget.value);
        if (!row) return;
        selectAutomationPlayerDevice(row.account_id, row.device_id, row.device_name);
        refreshAutomationPlayerStatus().catch(error => toast(error.message, 'error'));
    });

    for (const action of ['previous', 'toggle', 'stop', 'next', 'mode']) {
        $(`[data-action="automation-player-${action}"]`)?.addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try {
                await runAutomationPlayerAction(action);
                toast('播放控制命令已发送');
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                event.currentTarget.disabled = false;
            }
        });
    }

    $('[data-role="voice-command-list"]')?.addEventListener('change', event => {
        if (event.target?.name !== 'type') return;
        const row = event.target.closest('[data-role="voice-command-row"]');
        if (row) updateVoiceRowParam(row);
    });

    $('[data-role="voice-command-list"]')?.addEventListener('click', event => {
        const button = event.target.closest('[data-action="delete-voice-command"]');
        if (!button) return;
        button.closest('[data-role="voice-command-row"]')?.remove();
        if ($$('[data-role="voice-command-row"]').length === 0) {
            renderVoiceCommands([]);
        }
    });

    $('[data-role="schedule-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        try {
            const schedules = await api.get('/miot/schedules');
            const task = asArray(schedules).find(item => item.id === button.dataset.id);
            if (button.dataset.action === 'edit-schedule') {
                fillScheduleForm(task);
            }
            if (button.dataset.action === 'toggle-schedule') {
                await api.post('/miot/schedules/toggle', {
                    id: button.dataset.id,
                    enabled: button.dataset.enabled === 'true',
                });
                await loadSchedules();
                toast('任务状态已更新');
            }
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

async function loadAutomation() {
    await Promise.allSettled([
        loadVoiceCommands(),
        loadIndexing(),
        loadSchedules(),
        loadConfig(),
    ]);
}

export async function initAutomationUI() {
    bindAutomation();
    await loadAutomation();
}
