import { api } from './api.js';
import { $, $$, escapeHtml, selectedDevicePayload, setState, state, toast } from './state.js';

let qrAccountId = '';
let qrPollTimer = null;
let qrLoginDone = false;
let voiceRecordPollTimer = null;

const VOICE_RECORD_WINDOW_MS = 12 * 60 * 60 * 1000;
const VOICE_RECORD_POLL_MS = 15000;

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.accounts)) return value.accounts;
    return [];
}

function accountId(account) {
    return account?.id || account?.account_id || account?.user_id || account?.account || '';
}

function accountName(account) {
    return account?.account || account?.account_name || account?.username || accountId(account) || '未命名账号';
}

export function normalizeDeviceId(device) {
    return device?.device_id || device?.deviceID || device?.did || device?.miotDID || device?.id || '';
}

export function normalizeDeviceName(device) {
    return device?.name || device?.device_name || device?.miotName || device?.alias || device?.model || normalizeDeviceId(device) || '未命名设备';
}

function deviceId(device) {
    return normalizeDeviceId(device);
}

function deviceName(device) {
    return normalizeDeviceName(device);
}

function flattenDevices(groups) {
    const rows = [];
    for (const group of groups) {
        for (const device of asArray(group.devices)) {
            rows.push({
                account_id: group.account_id,
                account_name: group.account_name || group.account_id,
                device,
            });
        }
    }
    return rows;
}

function selectedPayload(extra = {}) {
    const payload = { ...selectedDevicePayload(), ...extra };
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先选择账号和设备');
    }
    return payload;
}

function firstText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text && text !== '[object Object]') return text;
        if (value && typeof value === 'object') {
            const nested = firstText(
                value.text,
                value.to_speak,
                value.toSpeak,
                value.displayText,
                value.display_text,
                value.answer,
                value.content,
            );
            if (nested) return nested;
        }
    }
    return '';
}

function voiceRecordTimestamp(record) {
    const value = Number(record?.message?.timestamp_ms ?? record?.timestamp_ms ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function voiceRecordParts(record = {}) {
    const message = record.message || record;
    const answer = message?.response?.answer?.[0] || {};
    return {
        timestampMs: voiceRecordTimestamp(record),
        deviceName: firstText(record.device_name, record.device_id, '未知音箱'),
        question: firstText(answer.question, answer.intention?.query),
        answer: firstText(
            answer.content,
            answer.text,
            answer.displayText,
            answer.display_text,
            answer.answer,
            answer.tts?.text,
        ),
        domain: firstText(answer.domain, answer.action),
    };
}

function isRecentVoiceRecord(record, now = Date.now()) {
    const timestamp = voiceRecordTimestamp(record);
    return timestamp > 0
        && timestamp >= now - VOICE_RECORD_WINDOW_MS
        && timestamp <= now + 60000;
}

function voiceRecordTimeLabel(timestampMs, now = Date.now()) {
    const diff = Math.max(0, now - timestampMs);
    if (diff < 60000) return '刚刚';
    if (diff < 60 * 60000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 60 * 60000) return `${Math.floor(diff / (60 * 60000))} 小时前`;
    return new Date(timestampMs).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function recentVoiceRecords(records = [], now = Date.now()) {
    return asArray(records)
        .filter(record => isRecentVoiceRecord(record, now))
        .sort((left, right) => voiceRecordTimestamp(right) - voiceRecordTimestamp(left));
}

export function renderVoiceRecordList(records = [], now = Date.now()) {
    const recent = recentVoiceRecords(records, now);
    if (!recent.length) {
        return '<div class="empty-state">暂无近 12 小时对话记录。开启对话监听后会自动记录新的语音交互。</div>';
    }

    return recent.map(record => {
        const parts = voiceRecordParts(record);
        const question = parts.question || '未识别到用户语音';
        const answer = parts.answer || '音箱暂无文本回应';
        return `
            <article class="voice-record-item">
                <div class="voice-record-meta">
                    <strong>${escapeHtml(parts.deviceName)}</strong>
                    <span>${escapeHtml(voiceRecordTimeLabel(parts.timestampMs, now))}</span>
                </div>
                <div class="voice-record-bubble user">
                    <span>用户</span>
                    <p>${escapeHtml(question)}</p>
                </div>
                <div class="voice-record-bubble assistant">
                    <span>音箱</span>
                    <p>${escapeHtml(answer)}</p>
                </div>
                ${parts.domain ? `<div class="voice-record-domain">${escapeHtml(parts.domain)}</div>` : ''}
            </article>
        `;
    }).join('');
}

function findDeviceRow(accountId, deviceIdValue) {
    return flattenDevices(state.deviceGroups).find(row =>
        row.account_id === accountId && deviceId(row.device) === deviceIdValue
    );
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

function selectDevice(accountId, deviceIdValue, name = '') {
    const row = findDeviceRow(accountId, deviceIdValue);
    setState({
        accountId,
        deviceId: deviceIdValue,
        deviceName: name || (row ? deviceName(row.device) : ''),
    });
}

export async function selectAndPersistDevice(accountId, deviceIdValue, name = '') {
    selectDevice(accountId, deviceIdValue, name);
    await api.post('/miot/mina/device/managed', {
        account_id: accountId,
        device_id: deviceIdValue,
        managed: true,
    });
    await api.post('/miot/mina/last_selection', {
        account_id: accountId,
        device_id: deviceIdValue,
    });
}

export function renderAccountRow(account) {
    const id = accountId(account);
    const selected = Boolean(id && id === state.accountId);
    return `
        <article class="account-row">
            <span class="row-main">
                <strong>${escapeHtml(accountName(account))}</strong>
                <span>${escapeHtml(id)} · ${account.auth_type || account.status || '已保存'}</span>
            </span>
            <span class="row-actions">
                <button
                    type="button"
                    class="${selected ? 'selected-action' : ''}"
                    data-action="select-account"
                    data-account-id="${escapeHtml(id)}"
                >${selected ? '已选' : '选择'}</button>
                <button type="button" data-action="relogin-account" data-account-id="${escapeHtml(id)}">重新登录</button>
                <button type="button" data-action="delete-account" data-account-id="${escapeHtml(id)}">删除账号</button>
            </span>
        </article>
    `;
}

function renderAccounts(accounts) {
    const list = $('[data-role="account-list"]');
    const select = $('[data-role="account-select"]');

    if (select) {
        select.innerHTML = accounts.length
            ? accounts.map(account => `<option value="${escapeHtml(accountId(account))}">${escapeHtml(accountName(account))}</option>`).join('')
            : '<option value="">暂无账号</option>';
        if (state.accountId) select.value = state.accountId;
        if (!state.accountId && accounts[0]) setState({ accountId: accountId(accounts[0]) });
    }

    if (list) {
        list.innerHTML = accounts.length
            ? accounts.map(account => renderAccountRow(account)).join('')
            : '<div class="empty-state">暂无米家账号。可使用扫码、账密或 Token 登录。</div>';
    }

    const authSummary = $('[data-role="auth-summary"]');
    if (authSummary) authSummary.textContent = accounts.length ? `${accounts.length} 个账号` : '未登录';
}

function renderDevices(groups) {
    const rows = flattenDevices(groups);
    const select = $('[data-role="device-select"]');
    const playerSelect = $('[data-role="speaker-player-device"]');
    const list = $('[data-role="device-list"]');

    if (select) {
        const filtered = rows.filter(row => !state.accountId || row.account_id === state.accountId);
        select.innerHTML = filtered.length
            ? filtered.map(row => `<option value="${escapeHtml(deviceId(row.device))}">${escapeHtml(deviceName(row.device))}</option>`).join('')
            : '<option value="">暂无设备</option>';
        if (state.deviceId) select.value = state.deviceId;
        if (!state.deviceId && filtered[0]) {
            setState({ deviceId: deviceId(filtered[0].device), deviceName: deviceName(filtered[0].device) });
        } else if (state.deviceId) {
            const selected = filtered.find(row => deviceId(row.device) === state.deviceId);
            if (selected && state.deviceName !== deviceName(selected.device)) {
                setState({ deviceName: deviceName(selected.device) });
            }
        }
    }

    if (playerSelect) {
        playerSelect.innerHTML = rows.length
            ? rows.map(row => {
                const id = deviceId(row.device);
                const value = `${row.account_id}|${id}`;
                return `<option value="${escapeHtml(value)}">${escapeHtml(deviceName(row.device))} · ${escapeHtml(row.account_name)}</option>`;
            }).join('')
            : '<option value="">暂无设备</option>';
        if (state.accountId && state.deviceId) {
            playerSelect.value = `${state.accountId}|${state.deviceId}`;
        } else if (rows[0]) {
            playerSelect.value = `${rows[0].account_id}|${deviceId(rows[0].device)}`;
        }
    }

    if (list) {
        list.innerHTML = rows.length
            ? rows.map(row => `
                <article class="device-row">
                    <span class="row-main">
                        <strong>${escapeHtml(deviceName(row.device))}</strong>
                        <span>${escapeHtml(row.account_name)} · ${escapeHtml(deviceId(row.device))} · ${escapeHtml(row.device.model || row.device.hardware || '')}</span>
                    </span>
                    <span class="row-actions">
                        <button
                            type="button"
                            class="${state.accountId === row.account_id && state.deviceId === deviceId(row.device) ? 'selected-action' : ''}"
                            data-action="select-device"
                            data-account-id="${escapeHtml(row.account_id)}"
                            data-device-id="${escapeHtml(deviceId(row.device))}"
                            data-device-name="${escapeHtml(deviceName(row.device))}"
                        >${state.accountId === row.account_id && state.deviceId === deviceId(row.device) ? '已选' : '选择'}</button>
                    </span>
                </article>
            `).join('')
            : '<div class="empty-state">暂无设备。登录米家账号后刷新设备列表。</div>';
    }
}

async function loadAccounts() {
    const [accounts, statuses] = await Promise.allSettled([
        api.get('/miot/accounts'),
        api.get('/miot/auth/status'),
    ]);
    const merged = accounts.status === 'fulfilled' && asArray(accounts.value).length
        ? asArray(accounts.value)
        : statuses.status === 'fulfilled'
            ? asArray(statuses.value)
            : [];
    setState({ accounts: merged });
    renderAccounts(merged);
}

async function loadDevices() {
    const path = state.accountId ? `/miot/mina/devices?account_id=${encodeURIComponent(state.accountId)}` : '/miot/mina/devices';
    const groups = asArray(await api.get(path));
    setState({ deviceGroups: groups });
    renderDevices(groups);
}

async function refreshSpeaker() {
    await loadAccounts().catch(error => toast(error.message, 'error'));
    await loadDevices().catch(error => toast(error.message, 'error'));
}

async function reloginAccount(accountIdValue) {
    await api.post('/miot/auth/relogin', { account_id: accountIdValue });
    toast('重新登录已完成');
    await refreshSpeaker();
}

async function deleteAccount(accountIdValue) {
    if (window.confirm && !window.confirm('确认删除当前米家账号？删除后需要重新登录。')) return;
    await api.delete(`/miot/account?account_id=${encodeURIComponent(accountIdValue)}`);
    if (state.accountId === accountIdValue) {
        setState({ accountId: '', deviceId: '', deviceName: '', speakerPlayerState: 'idle' });
        updatePlayerToggleButton('idle');
    }
    toast('账号已删除');
    await refreshSpeaker();
}

function setSpeakerMessage(message) {
    const node = $('[data-role="speaker-player-state"]');
    if (node) node.textContent = message;
}

function updatePlayerToggleButton(playerState = state.speakerPlayerState) {
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

function durationText(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return '--:--';
    const minutes = Math.floor(value / 60);
    const rest = Math.floor(value % 60);
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function renderPlayerStatus(status = {}) {
    const nextState = status.state || state.speakerPlayerState || 'idle';
    const song = status.current_song || {};
    const titleText = song.title
        ? `${song.title}${song.artist ? ` - ${song.artist}` : ''}`
        : '暂无播放信息';
    const metaText = `${playStateLabel(nextState)} · ${playModeLabel(status.play_mode)} · ${durationText(status.position)}/${durationText(status.duration)}`;

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

async function refreshPlayerStatus() {
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

function setQrStatus(message) {
    const status = $('[data-role="qr-status"]');
    if (status) status.textContent = message;
}

function stopQrPolling() {
    if (qrPollTimer) {
        clearTimeout(qrPollTimer);
        qrPollTimer = null;
    }
}

async function pollQRCodeStatus(accountId) {
    stopQrPolling();
    qrLoginDone = false;

    async function pollOnce() {
        if (qrLoginDone || accountId !== qrAccountId) return;

        try {
            const result = await api.post('/miot/auth/qrcode/poll', { account_id: accountId });
            if (qrLoginDone || accountId !== qrAccountId) return;

            setQrStatus(result.message || result.state || '等待扫码');

            if (result.account_id) {
                setState({ accountId: result.account_id });
                qrAccountId = result.account_id;
            }

            if (result.state === 'success') {
                qrLoginDone = true;
                stopQrPolling();
                toast('扫码登录成功');
                await refreshSpeaker();
                return;
            }

            if (result.state === 'expired' || result.state === 'timeout') {
                stopQrPolling();
                setQrStatus('二维码已过期，请刷新后重新扫描');
                toast('二维码已过期，请重新获取', 'error');
                return;
            }

            if (result.state === 'error') {
                stopQrPolling();
                toast(result.message || '扫码登录失败', 'error');
                return;
            }

            qrPollTimer = window.setTimeout(pollOnce, 3000);
        } catch (error) {
            if (qrLoginDone || accountId !== qrAccountId) return;
            stopQrPolling();
            setQrStatus(`轮询失败：${error.message}`);
            toast(error.message, 'error');
        }
    }

    pollOnce();
}

function bindLogin() {
    $('[data-action="qr-start"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        stopQrPolling();
        qrLoginDone = false;
        try {
            const result = await api.post('/miot/auth/qrcode', {});
            qrAccountId = result.account_id || '';
            const box = $('[data-role="qr-box"]');
            const img = $('[data-role="qr-image"]');
            const link = $('[data-role="qr-link"]');
            const status = $('[data-role="qr-status"]');
            if (img && result.qrcode_url) img.src = result.qrcode_url;
            if (link) {
                link.href = result.login_url || result.qrcode_url || '#';
                link.textContent = result.login_url ? '打开登录链接' : '';
            }
            box?.classList.toggle('has-qr', Boolean(result.qrcode_url));
            if (status) status.textContent = '请使用米家扫码，页面将自动确认登录状态';
            toast('二维码已生成');
            if (qrAccountId) {
                pollQRCodeStatus(qrAccountId);
            }
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-action="qr-poll"]')?.addEventListener('click', async event => {
        if (!qrAccountId) {
            toast('请先获取二维码', 'error');
            return;
        }
        const button = event.currentTarget;
        button.disabled = true;
        try {
            setQrStatus('正在检查扫码状态');
            pollQRCodeStatus(qrAccountId);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

}

function bindDeviceSelection() {
    $('[data-role="account-select"]')?.addEventListener('change', event => {
        setState({ accountId: event.target.value, deviceId: '', deviceName: '' });
        renderDevices(state.deviceGroups);
    });

    $('[data-role="device-select"]')?.addEventListener('change', async event => {
        try {
            await selectAndPersistDevice(state.accountId, event.target.value);
            renderDevices(state.deviceGroups);
            refreshPlayerStatus().catch(() => null);
            toast('设备已选择');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="speaker-player-device"]')?.addEventListener('change', async event => {
        const [accountIdValue, deviceIdValue] = String(event.target.value || '').split('|');
        if (!accountIdValue || !deviceIdValue) return;
        const row = findDeviceRow(accountIdValue, deviceIdValue);
        try {
            await selectAndPersistDevice(accountIdValue, deviceIdValue, row ? deviceName(row.device) : '');
            const accountSelect = $('[data-role="account-select"]');
            const deviceSelect = $('[data-role="device-select"]');
            if (accountSelect) accountSelect.value = state.accountId;
            renderDevices(state.deviceGroups);
            if (deviceSelect) deviceSelect.value = state.deviceId;
            await refreshPlayerStatus().catch(() => null);
            toast('播放设备已选择');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="account-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const accountIdValue = button.dataset.accountId;
        if (!accountIdValue) return;
        button.disabled = true;
        try {
            if (button.dataset.action === 'select-account') {
                setState({ accountId: accountIdValue, deviceId: '', deviceName: '' });
                const select = $('[data-role="account-select"]');
                if (select) select.value = state.accountId;
                renderAccounts(state.accounts);
                renderDevices(state.deviceGroups);
                toast('账号已选择');
            }
            if (button.dataset.action === 'relogin-account') {
                await reloginAccount(accountIdValue);
            }
            if (button.dataset.action === 'delete-account') {
                await deleteAccount(accountIdValue);
            }
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-role="device-list"]')?.addEventListener('click', async event => {
        const button = event.target.closest('[data-action="select-device"]');
        if (!button) return;
        button.disabled = true;
        try {
            await selectAndPersistDevice(button.dataset.accountId, button.dataset.deviceId, button.dataset.deviceName);
            const accountSelect = $('[data-role="account-select"]');
            const deviceSelect = $('[data-role="device-select"]');
            if (accountSelect) accountSelect.value = state.accountId;
            renderDevices(state.deviceGroups);
            if (deviceSelect) deviceSelect.value = state.deviceId;
            refreshPlayerStatus().catch(() => null);
            toast('设备已选择');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
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
        event.currentTarget.disabled = true;
        try {
            await loadVoiceRecords();
            toast('语音记录已刷新');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            event.currentTarget.disabled = false;
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
    bindLogin();
    bindDeviceSelection();
    bindSpeakerPlayer();
    bindRefresh();
    updatePlayerToggleButton();
    await refreshSpeaker();
    await refreshPlayerStatus().catch(() => null);
    startVoiceRecordPolling();
}
