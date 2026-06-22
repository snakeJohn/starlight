import { api } from './api.js';
import { $, $$, escapeHtml, selectedDevicePayload, setState, state, toast } from './state.js';

let qrAccountId = '';
let qrPollTimer = null;
let qrLoginDone = false;

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

function findDeviceRow(accountId, deviceIdValue) {
    return flattenDevices(state.deviceGroups).find(row =>
        row.account_id === accountId && deviceId(row.device) === deviceIdValue
    );
}

function selectDevice(accountId, deviceIdValue, name = '') {
    const row = findDeviceRow(accountId, deviceIdValue);
    setState({
        accountId,
        deviceId: deviceIdValue,
        deviceName: name || (row ? deviceName(row.device) : ''),
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
        setState({ accountId: '', deviceId: '', deviceName: '', playbackState: 'idle' });
        updatePlayerToggleButton('idle');
    }
    toast('账号已删除');
    await refreshSpeaker();
}

function setSpeakerMessage(message) {
    const node = $('[data-role="speaker-message"]');
    if (node) node.textContent = message;
}

function updatePlayerToggleButton(playbackState = state.playbackState) {
    const button = $('[data-action="player-toggle"]');
    if (!button) return;
    const paused = playbackState === 'paused';
    button.textContent = paused ? '继续播放' : '暂停播放';
    button.title = paused ? '继续播放' : '暂停播放';
    button.setAttribute?.('aria-label', paused ? '继续播放' : '暂停播放');
}

async function refreshPlayerStatus() {
    if (!state.accountId || !state.deviceId) return null;
    const result = await api.get(`/miot/player/status?account_id=${encodeURIComponent(state.accountId)}&device_id=${encodeURIComponent(state.deviceId)}`);
    if (result?.state) {
        setState({ playbackState: result.state });
        updatePlayerToggleButton(result.state);
    }
    return result;
}

export async function togglePlayerPlayback() {
    const result = await api.post('/miot/player/toggle', selectedPayload());
    if (result?.state) {
        setState({ playbackState: result.state });
        updatePlayerToggleButton(result.state);
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

function bindAuthModes() {
    $$('.segmented [data-auth-mode]').forEach(button => {
        button.addEventListener('click', () => {
            const mode = button.dataset.authMode;
            $$('.segmented [data-auth-mode]').forEach(item => item.classList.toggle('active', item === button));
            $$('[data-auth-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.authPanel === mode));
        });
    });
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

    $('[data-role="password-login-form"]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
            await api.post('/miot/auth/login', body);
            setState({ accountId: body.account_id || body.username });
            toast('登录请求已提交');
            await refreshSpeaker();
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="token-login-form"]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
            await api.post('/miot/auth/token', body);
            setState({ accountId: body.account_id || body.user_id });
            toast('Token 已保存');
            await refreshSpeaker();
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

function bindDeviceSelection() {
    $('[data-role="account-select"]')?.addEventListener('change', event => {
        setState({ accountId: event.target.value, deviceId: '', deviceName: '' });
        renderDevices(state.deviceGroups);
    });

    $('[data-role="device-select"]')?.addEventListener('change', event => {
        selectDevice(state.accountId, event.target.value);
        renderDevices(state.deviceGroups);
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

    $('[data-role="device-list"]')?.addEventListener('click', event => {
        const button = event.target.closest('[data-action="select-device"]');
        if (!button) return;
        selectDevice(button.dataset.accountId, button.dataset.deviceId, button.dataset.deviceName);
        const accountSelect = $('[data-role="account-select"]');
        const deviceSelect = $('[data-role="device-select"]');
        if (accountSelect) accountSelect.value = state.accountId;
        renderDevices(state.deviceGroups);
        if (deviceSelect) deviceSelect.value = state.deviceId;
        refreshPlayerStatus().catch(() => null);
        toast('设备已选择');
    });
}

function bindPlayback() {
    const volumeForm = $('[data-role="volume-form"]');
    const volumeInput = volumeForm?.querySelector('[name="volume"]');
    volumeInput?.addEventListener('input', () => {
        const output = $('[data-role="volume-value"]');
        if (output) output.textContent = volumeInput.value;
    });
    volumeForm?.addEventListener('submit', async event => {
        event.preventDefault();
        try {
            await api.post('/miot/mina/volume', selectedPayload({ volume: Number(volumeInput.value) }));
            setSpeakerMessage(`音量 ${volumeInput.value}`);
            toast('音量已设置');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="url-play-form"]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        try {
            await api.post('/miot/mina/play-url', selectedPayload({ url: body.url }));
            setState({ playbackState: 'playing' });
            updatePlayerToggleButton('playing');
            setSpeakerMessage('URL 播放中');
            toast('URL 已发送');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    const playerActions = {
        'player-previous': () => api.post('/miot/player/previous', selectedPayload()),
        'player-next': () => api.post('/miot/player/next', selectedPayload()),
        'player-stop': () => api.post('/miot/player/stop', selectedPayload()),
        'player-toggle': () => togglePlayerPlayback(),
        'player-mode': () => api.post('/miot/player/mode', selectedPayload({ play_mode: $('[data-role="play-mode-select"]')?.value || 'order' })),
    };

    for (const [action, run] of Object.entries(playerActions)) {
        $(`[data-action="${action}"]`)?.addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try {
                await run();
                if (action === 'player-stop') {
                    setState({ playbackState: 'stopped' });
                    updatePlayerToggleButton('stopped');
                } else if (action !== 'player-toggle') {
                    await refreshPlayerStatus().catch(() => null);
                }
                setSpeakerMessage('控制命令已发送');
                toast('控制命令已发送');
            } catch (error) {
                toast(error.message, 'error');
            } finally {
                event.currentTarget.disabled = false;
            }
        });
    }
}

function bindRefresh() {
    $('[data-action="refresh-speaker"]')?.addEventListener('click', refreshSpeaker);
    $('[data-action="refresh-devices"]')?.addEventListener('click', () => loadDevices().catch(error => toast(error.message, 'error')));
}

export async function initSpeakerUI() {
    bindAuthModes();
    bindLogin();
    bindDeviceSelection();
    bindPlayback();
    bindRefresh();
    updatePlayerToggleButton();
    await refreshSpeaker();
    await refreshPlayerStatus().catch(() => null);
}
