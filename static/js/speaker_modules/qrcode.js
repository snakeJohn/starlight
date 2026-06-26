import { api } from '../api.js';
import { $, setState, toast } from '../state.js';

let qrAccountId = '';
let qrPollTimer = null;
let qrLoginDone = false;

function setQrStatus(message) {
    const status = $('[data-role="qr-status"]');
    if (status) status.textContent = message;
}

function hideQRCodeAfterLogin() {
    const box = $('[data-role="qr-box"]');
    const img = $('[data-role="qr-image"]');
    const link = $('[data-role="qr-link"]');
    if (box) {
        box.hidden = true;
        box.classList.toggle('has-qr', false);
    }
    if (img) img.src = '';
    if (link) {
        link.href = '#';
        link.textContent = '';
    }
    setQrStatus('登录成功，账号已保存');
}

function stopQrPolling() {
    if (qrPollTimer) {
        clearTimeout(qrPollTimer);
        qrPollTimer = null;
    }
}

async function pollQRCodeStatus(accountId, refreshSpeaker) {
    stopQrPolling();
    qrLoginDone = false;

    async function pollOnce() {
        if (qrLoginDone || accountId !== qrAccountId) return;

        try {
            const result = await api.post('/miot/auth/qrcode/poll', { account_id: accountId });
            if (qrLoginDone || accountId !== qrAccountId) return;

            setQrStatus(result.message || result.state || '等待扫码');

            if (result.account_id) {
                setState({
                    accountId: result.account_id,
                    deviceId: '',
                    deviceName: '',
                    speakerPlayerState: 'idle',
                });
                qrAccountId = result.account_id;
            }

            if (result.state === 'success') {
                qrLoginDone = true;
                stopQrPolling();
                hideQRCodeAfterLogin();
                toast('扫码登录成功');
                await refreshSpeaker({ restoreSavedDevice: false });
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

export function bindQrLogin({ refreshSpeaker }) {
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
            if (box) box.hidden = false;
            if (img && result.qrcode_url) img.src = result.qrcode_url;
            if (link) {
                link.href = result.login_url || result.qrcode_url || '#';
                link.textContent = result.login_url ? '打开登录链接' : '';
            }
            box?.classList.toggle('has-qr', Boolean(result.qrcode_url));
            if (status) status.textContent = '请使用米家扫码，页面将自动确认登录状态';
            toast('二维码已生成');
            if (qrAccountId) {
                pollQRCodeStatus(qrAccountId, refreshSpeaker);
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
            pollQRCodeStatus(qrAccountId, refreshSpeaker);
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    });
}
