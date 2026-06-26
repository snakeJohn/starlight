import { api } from '../api.js';
import { asArray as sharedAsArray } from '../shared/arrays.js';
import { refreshPlayerStatus, renderPlayerStatus, updatePlayerToggleButton } from './player.js';
import { $, escapeHtml, selectedDevicePayload, setState, state, toast } from '../state.js';

function asArray(value) {
    return sharedAsArray(value, ['data', 'accounts']);
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

export function restoreSavedDeviceSelection(groups) {
    if (state.deviceId) return false;

    const rows = flattenDevices(groups);
    for (const group of groups) {
        const savedDeviceId = group?.last_selected_device_id || '';
        const groupAccountId = group?.account_id || '';
        if (!savedDeviceId || !groupAccountId) continue;
        if (state.accountId && state.accountId !== groupAccountId) continue;

        const row = rows.find(item => item.account_id === groupAccountId && deviceId(item.device) === savedDeviceId);
        if (!row) continue;

        selectDevice(groupAccountId, savedDeviceId, deviceName(row.device));
        return true;
    }

    return false;
}

function selectedPayload(extra = {}) {
    const payload = { ...selectedDevicePayload(), ...extra };
    if (!payload.account_id || !payload.device_id) {
        throw new Error('请先选择账号和设备');
    }
    return payload;
}

function findDeviceRow(accountIdValue, deviceIdValue) {
    return flattenDevices(state.deviceGroups).find(row =>
        row.account_id === accountIdValue && deviceId(row.device) === deviceIdValue
    );
}

function selectDevice(accountIdValue, deviceIdValue, name = '') {
    const row = findDeviceRow(accountIdValue, deviceIdValue);
    setState({
        accountId: accountIdValue,
        deviceId: deviceIdValue,
        deviceName: name || (row ? deviceName(row.device) : ''),
    });
}

export function clearSelectedDevice() {
    setState({ deviceId: '', deviceName: '', speakerPlayerState: 'idle' });
    const deviceSelect = $('[data-role="device-select"]');
    const playerSelect = $('[data-role="speaker-player-device"]');
    if (deviceSelect) deviceSelect.value = '';
    if (playerSelect) playerSelect.value = '';
    renderPlayerStatus({ state: 'idle' });
}

export async function selectAndPersistDevice(accountIdValue, deviceIdValue, name = '') {
    selectDevice(accountIdValue, deviceIdValue, name);
    await persistSelectedDeviceSelection();
}

export async function persistSelectedDeviceSelection() {
    const payload = selectedPayload();
    await api.post('/miot/mina/device/managed', {
        account_id: payload.account_id,
        device_id: payload.device_id,
        managed: true,
    });
    await api.post('/miot/mina/last_selection', {
        account_id: payload.account_id,
        device_id: payload.device_id,
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

export function renderDeviceRow(row) {
    const id = deviceId(row.device);
    const selected = state.accountId === row.account_id && state.deviceId === id;
    const action = selected ? 'clear-device-selection' : 'select-device';
    const label = selected ? '取消选择' : '选择';
    return `
        <article class="device-row">
            <span class="row-main">
                <strong>${escapeHtml(deviceName(row.device))}</strong>
                <span>${escapeHtml(row.account_name)} · ${escapeHtml(id)} · ${escapeHtml(row.device.model || row.device.hardware || '')}</span>
            </span>
            <span class="row-actions">
                <button
                    type="button"
                    class="${selected ? 'selected-action' : ''}"
                    data-action="${action}"
                    data-account-id="${escapeHtml(row.account_id)}"
                    data-device-id="${escapeHtml(id)}"
                    data-device-name="${escapeHtml(deviceName(row.device))}"
                >${label}</button>
            </span>
        </article>
    `;
}

function renderDevices(groups) {
    const rows = flattenDevices(groups);
    const select = $('[data-role="device-select"]');
    const playerSelect = $('[data-role="speaker-player-device"]');
    const list = $('[data-role="device-list"]');

    if (select) {
        const filtered = rows.filter(row => !state.accountId || row.account_id === state.accountId);
        select.innerHTML = filtered.length
            ? '<option value="">请选择设备</option>' + filtered.map(row => `<option value="${escapeHtml(deviceId(row.device))}">${escapeHtml(deviceName(row.device))}</option>`).join('')
            : '<option value="">暂无设备</option>';
        if (state.deviceId) select.value = state.deviceId;
        if (!state.deviceId) {
            select.value = '';
        } else {
            const selected = filtered.find(row => deviceId(row.device) === state.deviceId);
            if (selected && state.deviceName !== deviceName(selected.device)) {
                setState({ deviceName: deviceName(selected.device) });
            }
        }
    }

    if (playerSelect) {
        playerSelect.innerHTML = rows.length
            ? '<option value="">请选择设备</option>' + rows.map(row => {
                const id = deviceId(row.device);
                const value = `${row.account_id}|${id}`;
                return `<option value="${escapeHtml(value)}">${escapeHtml(deviceName(row.device))} · ${escapeHtml(row.account_name)}</option>`;
            }).join('')
            : '<option value="">暂无设备</option>';
        if (state.accountId && state.deviceId) {
            playerSelect.value = `${state.accountId}|${state.deviceId}`;
        } else {
            playerSelect.value = '';
        }
    }

    if (list) {
        list.innerHTML = rows.length
            ? rows.map(row => renderDeviceRow(row)).join('')
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

export async function loadDevices(options = {}) {
    const shouldRestoreSaved = options.restoreSaved !== false;
    const path = state.accountId ? `/miot/mina/devices?account_id=${encodeURIComponent(state.accountId)}` : '/miot/mina/devices';
    const groups = asArray(await api.get(path));
    setState({ deviceGroups: groups });
    if (shouldRestoreSaved) {
        restoreSavedDeviceSelection(groups);
    }
    renderDevices(groups);
}

export async function refreshSpeaker(options = {}) {
    await loadAccounts().catch(error => toast(error.message, 'error'));
    await loadDevices({ restoreSaved: options.restoreSavedDevice }).catch(error => toast(error.message, 'error'));
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

export function bindDeviceSelection() {
    $('[data-role="account-select"]')?.addEventListener('change', event => {
        setState({ accountId: event.target.value, deviceId: '', deviceName: '' });
        renderDevices(state.deviceGroups);
    });

    $('[data-role="device-select"]')?.addEventListener('change', async event => {
        try {
            if (!event.target.value) {
                clearSelectedDevice();
                renderDevices(state.deviceGroups);
                toast('已取消设备选择');
                return;
            }
            selectDevice(state.accountId, event.target.value);
            renderDevices(state.deviceGroups);
            refreshPlayerStatus().catch(() => null);
            toast('设备已选择，点击保存设备后刷新仍会保留');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-role="speaker-player-device"]')?.addEventListener('change', async event => {
        const [accountIdValue, deviceIdValue] = String(event.target.value || '').split('|');
        if (!accountIdValue || !deviceIdValue) {
            clearSelectedDevice();
            renderDevices(state.deviceGroups);
            toast('已取消播放设备选择');
            return;
        }
        const row = findDeviceRow(accountIdValue, deviceIdValue);
        try {
            selectDevice(accountIdValue, deviceIdValue, row ? deviceName(row.device) : '');
            const accountSelect = $('[data-role="account-select"]');
            const deviceSelect = $('[data-role="device-select"]');
            if (accountSelect) accountSelect.value = state.accountId;
            renderDevices(state.deviceGroups);
            if (deviceSelect) deviceSelect.value = state.deviceId;
            await refreshPlayerStatus().catch(() => null);
            toast('播放设备已选择，点击保存设备后刷新仍会保留');
        } catch (error) {
            toast(error.message, 'error');
        }
    });

    $('[data-action="save-device-selection"]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        if (button) button.disabled = true;
        try {
            await persistSelectedDeviceSelection();
            toast('设备选择已保存');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            if (button) button.disabled = false;
        }
    });

    $('[data-action="clear-device-selection"]')?.addEventListener('click', () => {
        clearSelectedDevice();
        renderDevices(state.deviceGroups);
        refreshPlayerStatus().catch(() => null);
        toast('已取消设备选择');
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
        const button = event.target.closest('[data-action="select-device"], [data-action="clear-device-selection"]');
        if (!button) return;
        button.disabled = true;
        try {
            if (button.dataset.action === 'clear-device-selection') {
                clearSelectedDevice();
                renderDevices(state.deviceGroups);
                refreshPlayerStatus().catch(() => null);
                toast('已取消设备选择');
                return;
            }
            selectDevice(button.dataset.accountId, button.dataset.deviceId, button.dataset.deviceName);
            const accountSelect = $('[data-role="account-select"]');
            const deviceSelect = $('[data-role="device-select"]');
            if (accountSelect) accountSelect.value = state.accountId;
            renderDevices(state.deviceGroups);
            if (deviceSelect) deviceSelect.value = state.deviceId;
            refreshPlayerStatus().catch(() => null);
            toast('设备已选择，点击保存设备后刷新仍会保留');
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}
