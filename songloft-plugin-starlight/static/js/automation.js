import { api } from './api.js';
import { $, $$, escapeHtml, toast } from './state.js';

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
    const form = $('[data-role="config-form"]');
    if (!form) return;
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
    const hostNode = $('[data-role="host-url"]');
    if (hostNode) hostNode.textContent = config.songloft_host || config.server_host || '自动获取';
    $('[data-role="config-state"]').textContent = config.server_host_status ? `访问地址: ${config.server_host_status}` : '已加载';
}

function configFromForm(form) {
    return {
        timezone: textValue(form, 'timezone'),
        conversation_monitor_enabled: boolValue(form, 'conversation_monitor_enabled'),
        voice_command_enabled: boolValue(form, 'voice_command_enabled'),
        scheduled_tasks_enabled: boolValue(form, 'scheduled_tasks_enabled'),
        force_mp3: boolValue(form, 'force_mp3'),
        external_search_enabled: boolValue(form, 'external_search_enabled'),
        external_search_url: textValue(form, 'external_search_url'),
        external_search_token: textValue(form, 'external_search_token'),
        extra_music_api_models: textValue(form, 'extra_music_api_models')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean),
        indicator_light_enabled: boolValue(form, 'indicator_light_enabled'),
        interrupt_tts_hint_enabled: boolValue(form, 'interrupt_tts_hint_enabled'),
        interrupt_tts_hint_text: textValue(form, 'interrupt_tts_hint_text'),
        ai_config: {
            enabled: boolValue(form, 'ai_enabled'),
            api_url: textValue(form, 'ai_api_url'),
            api_key: textValue(form, 'ai_api_key'),
            model: textValue(form, 'ai_model'),
            timeout: Number(textValue(form, 'ai_timeout')) || 30,
        },
    };
}

async function saveConfig(event) {
    event.preventDefault();
    const result = await putOrPost('/miot/config', configFromForm(event.currentTarget));
    $('[data-role="config-state"]').textContent = result?.warning || '已保存';
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
    $('[data-action="load-config"]')?.addEventListener('click', () => loadConfig().catch(error => toast(error.message, 'error')));
    $('[data-role="schedule-form"]')?.addEventListener('submit', event => saveSchedule(event).catch(error => toast(error.message, 'error')));
    $('[data-role="config-form"]')?.addEventListener('submit', event => saveConfig(event).catch(error => toast(error.message, 'error')));

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
