import { api } from '../api.js';
import { putOrPost } from './config.js';
import { asArray as sharedAsArray } from '../shared/arrays.js';
import { $, $$, escapeHtml, toast } from '../state.js';

function asArray(value) {
    return sharedAsArray(value, ['commands', 'tasks', 'logs']);
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
        ['once', '单曲播放'],
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

export async function loadVoiceCommands() {
    const data = await api.get('/miot/voice-commands');
    const status = $('[data-role="voice-enabled"]');
    renderVoiceCommands(data.commands || asArray(data));
    if (status) status.textContent = data.enabled ? '已启用' : '未启用';
}

export async function saveVoiceCommands() {
    const commands = collectVoiceCommands();
    await putOrPost('/miot/voice-commands', { commands });
    toast('语音口令已保存');
}

export function bindVoiceCommandEditor() {
    $('[data-action="load-voice"]')?.addEventListener('click', () => loadVoiceCommands().catch(error => toast(error.message, 'error')));
    $('[data-action="save-voice"]')?.addEventListener('click', () => saveVoiceCommands().catch(error => toast(error.message, 'error')));
    $('[data-action="add-voice-command"]')?.addEventListener('click', () => {
        const list = $('[data-role="voice-command-list"]');
        if (!list) return;
        if (list.querySelector('.empty-state')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', renderVoiceCommandRow(defaultVoiceCommand, list.querySelectorAll('[data-role="voice-command-row"]').length));
    });

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
}
