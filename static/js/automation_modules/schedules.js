import { api } from '../api.js';
import { asArray as sharedAsArray } from '../shared/arrays.js';
import { boolValue, numberValue, textValue } from '../shared/forms.js';
import { $, escapeHtml, toast } from '../state.js';

function asArray(value) {
    return sharedAsArray(value, ['commands', 'tasks', 'logs']);
}

function csvNumbers(value) {
    return String(value || '')
        .split(',')
        .map(item => Number(item.trim()))
        .filter(item => Number.isInteger(item) && item > 0);
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

export async function loadSchedules() {
    renderSchedules(await api.get('/miot/schedules'));
}

export function scheduleFromForm(form) {
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

export function bindScheduleControls() {
    $('[data-role="schedule-form"]')?.addEventListener('submit', event => saveSchedule(event).catch(error => toast(error.message, 'error')));

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
