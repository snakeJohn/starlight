import { api } from './api.js';
import { $, $$, escapeHtml, selectedDevicePayload, setState, state, toast } from './state.js';

let qrAccountId = '';

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

function deviceId(device) {
    return device?.device_id || device?.did || device?.miotDID || device?.id || '';
}

function deviceName(device) {
    return device?.name || device?.miotName || device?.alias || device?.model || deviceId(device) || '未命名设备';
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
            ? accounts.map(account => `
                <article class="account-row">
                    <span class="row-main">
                        <strong>${escapeHtml(accountName(account))}</strong>
                        <span>${escapeHtml(accountId(account))} · ${account.auth_type || account.status || '已保存'}</span>
                    </span>
                    <button type="button" data-action="select-account" data-account-id="${escapeHtml(accountId(account))}">选择</button>
                </article>
            `).join('')
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
        if (!state.deviceId && filtered[0]) setState({ deviceId: deviceId(filtered[0].device) });
    }

    if (list) {
        list.innerHTML = rows.length
            ? rows.map(row => `
                <article class="device-row">
                    <span class="row-main">
                        <strong>${escapeHtml(deviceName(row.device))}</strong>
                        <span>${escapeHtml(row.account_name)} · ${escapeHtml(deviceId(row.device))} · ${escapeHtml(row.device.model || row.device.hardware || '')}</span>
                    </span>
                    <button type="button" data-action="select-device" data-account-id="${escapeHtml(row.account_id)}" data-device-id="${escapeHtml(deviceId(row.device))}">选择</button>
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

function setSpeakerMessage(message) {
    const node = $('[data-role="speaker-message"]');
    if (node) node.textContent = message;
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
            if (status) status.textContent = '请使用米家扫码';
            toast('二维码已生成');
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
            const result = await api.post('/miot/auth/qrcode/poll', { account_id: qrAccountId });
            const status = $('[data-role="qr-status"]');
            if (status) status.textContent = result.message || result.state || '等待扫码';
            if (result.account_id) {
                setState({ accountId: result.account_id });
                qrAccountId = result.account_id;
            }
            if (result.state === 'success') {
                toast('扫码登录成功');
                await refreshSpeaker();
            }
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
        setState({ accountId: event.target.value, deviceId: '' });
        renderDevices(state.deviceGroups);
    });

    $('[data-role="device-select"]')?.addEventListener('change', event => {
        setState({ deviceId: event.target.value });
    });

    $('[data-role="account-list"]')?.addEventListener('click', event => {
        const button = event.target.closest('[data-action="select-account"]');
        if (!button) return;
        setState({ accountId: button.dataset.accountId, deviceId: '' });
        const select = $('[data-role="account-select"]');
        if (select) select.value = state.accountId;
        renderDevices(state.deviceGroups);
        toast('账号已选择');
    });

    $('[data-role="device-list"]')?.addEventListener('click', event => {
        const button = event.target.closest('[data-action="select-device"]');
        if (!button) return;
        setState({ accountId: button.dataset.accountId, deviceId: button.dataset.deviceId });
        const accountSelect = $('[data-role="account-select"]');
        const deviceSelect = $('[data-role="device-select"]');
        if (accountSelect) accountSelect.value = state.accountId;
        renderDevices(state.deviceGroups);
        if (deviceSelect) deviceSelect.value = state.deviceId;
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
        'player-mode': () => api.post('/miot/player/mode', selectedPayload({ play_mode: $('[data-role="play-mode-select"]')?.value || 'order' })),
    };

    for (const [action, run] of Object.entries(playerActions)) {
        $(`[data-action="${action}"]`)?.addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try {
                await run();
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
    await refreshSpeaker();
}
