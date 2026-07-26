import { api } from '../api.js';
import { $, setState, toast } from '../state.js';

function showPanel(name) {
    document.querySelectorAll('[data-auth-panel]').forEach((node) => {
        const active = node.getAttribute('data-auth-panel') === name;
        node.classList.toggle('active', active);
        if ('hidden' in node) node.hidden = !active;
    });
    document.querySelectorAll('[data-auth-tab]').forEach((button) => {
        const active = button.getAttribute('data-auth-tab') === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

async function afterLoginSuccess(accountId, refreshSpeaker, message) {
    setState({
        accountId,
        deviceId: '',
        deviceName: '',
        speakerPlayerState: 'idle',
    });
    toast(message || 'Token 登录成功');
    if (typeof refreshSpeaker === 'function') {
        await refreshSpeaker({ restoreSavedDevice: false });
    }
}

export function bindTokenLogin({ refreshSpeaker }) {
    document.querySelectorAll('[data-action="auth-tab"]').forEach((button) => {
        button.addEventListener('click', () => {
            showPanel(button.getAttribute('data-auth-tab') || 'qrcode');
        });
    });

    $('[data-role="token-login-form"]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const userId = String(form.elements.user_id?.value || '').trim();
        const passToken = String(form.elements.pass_token?.value || '').trim();
        if (!userId || !passToken) {
            toast('请填写 User ID 和 Pass Token', 'error');
            return;
        }
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        try {
            const data = await api.post('/miot/auth/token', {
                account_id: userId,
                user_id: userId,
                pass_token: passToken,
            });
            if (data?.success === false || data?.state === 'failed') {
                toast(data.error || data.message || 'Token 登录失败', 'error');
                return;
            }
            form.reset();
            await afterLoginSuccess(userId, refreshSpeaker, data?.message);
        } catch (error) {
            toast(error.message || 'Token 登录失败', 'error');
        } finally {
            if (submit) submit.disabled = false;
        }
    });
}
