import { api } from '../api.js';
import { $, setState, toast } from '../state.js';

/** Account id used for captcha / verify continuation (username or userId). */
let pendingAccountId = '';
let verifyUrl = '';

function panel(name) {
    return $(`[data-auth-panel="${name}"]`);
}

function showPanel(name) {
    document.querySelectorAll('[data-auth-panel]').forEach((node) => {
        const active = node.getAttribute('data-auth-panel') === name;
        node.classList.toggle('active', active);
        if ('hidden' in node) node.hidden = !active;
    });
    document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
        const active = btn.getAttribute('data-auth-tab') === name;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function hideExtras() {
    const captcha = $('[data-role="captcha-panel"]');
    const verify = $('[data-role="verify-panel"]');
    if (captcha) captcha.hidden = true;
    if (verify) verify.hidden = true;
}

function captchaImageSrc(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    return `data:image/png;base64,${raw}`;
}

async function afterLoginSuccess(accountId, refreshSpeaker, message) {
    hideExtras();
    pendingAccountId = '';
    verifyUrl = '';
    if (accountId) {
        setState({
            accountId,
            deviceId: '',
            deviceName: '',
            speakerPlayerState: 'idle',
        });
    }
    toast(message || '登录成功');
    if (typeof refreshSpeaker === 'function') {
        await refreshSpeaker({ restoreSavedDevice: false });
    }
}

/**
 * Map AuthService login result (state: need_captcha | need_verify | success | failed).
 */
async function handleLoginResult(data, refreshSpeaker) {
    if (!data) {
        toast('登录无响应', 'error');
        return;
    }
    if (data.success === false && !data.state) {
        toast(data.error || data.message || '登录失败', 'error');
        return;
    }

    const state = String(data.state || '');
    if (state === 'success' || data.state === 0) {
        const accountId = data.account_id || pendingAccountId;
        await afterLoginSuccess(accountId, refreshSpeaker, data.message || '登录成功');
        const user = $('[data-role="auth-username"]');
        const pass = $('[data-role="auth-password"]');
        if (user) user.value = '';
        if (pass) pass.value = '';
        return;
    }

    if (state === 'need_captcha') {
        pendingAccountId = data.account_id || pendingAccountId;
        const panelEl = $('[data-role="captcha-panel"]');
        const img = $('[data-role="captcha-image"]');
        const input = $('[data-role="captcha-input"]');
        if (img) img.src = captchaImageSrc(data.captcha_url || data.captcha_image);
        if (input) input.value = '';
        if (panelEl) panelEl.hidden = false;
        const verifyPanel = $('[data-role="verify-panel"]');
        if (verifyPanel) verifyPanel.hidden = true;
        toast(data.message || '请输入图形验证码');
        return;
    }

    if (state === 'need_verify') {
        pendingAccountId = data.account_id || pendingAccountId;
        verifyUrl = data.notification_url || data.verify_url || '';
        const panelEl = $('[data-role="verify-panel"]');
        const input = $('[data-role="verify-code-input"]');
        if (input) input.value = '';
        if (panelEl) panelEl.hidden = false;
        const captchaPanel = $('[data-role="captcha-panel"]');
        if (captchaPanel) captchaPanel.hidden = true;
        toast(data.message || '请完成二次验证');
        return;
    }

    toast(data.message || data.error || '登录失败', 'error');
}

export function bindPasswordTokenLogin({ refreshSpeaker }) {
    document.querySelectorAll('[data-action="auth-tab"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-auth-tab') || 'qrcode';
            showPanel(tab);
            if (tab !== 'password') hideExtras();
        });
    });

    $('[data-role="password-login-form"]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const username = String(form.elements.username?.value || '').trim();
        const password = String(form.elements.password?.value || '');
        if (!username || !password) {
            toast('请填写用户名和密码', 'error');
            return;
        }
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        hideExtras();
        pendingAccountId = username;
        try {
            const data = await api.post('/miot/auth/login', {
                account_id: username,
                username,
                password,
            });
            await handleLoginResult(data, refreshSpeaker);
        } catch (error) {
            toast(error.message || '登录失败', 'error');
        } finally {
            if (submit) submit.disabled = false;
        }
    });

    $('[data-action="auth-captcha-submit"]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const captcha = String($('[data-role="captcha-input"]')?.value || '').trim();
        if (!pendingAccountId) {
            toast('会话已失效，请重新登录', 'error');
            return;
        }
        if (!captcha) {
            toast('请输入验证码', 'error');
            return;
        }
        button.disabled = true;
        try {
            const data = await api.post('/miot/auth/captcha', {
                account_id: pendingAccountId,
                captcha,
            });
            await handleLoginResult(data, refreshSpeaker);
        } catch (error) {
            toast(error.message || '提交验证码失败', 'error');
        } finally {
            button.disabled = false;
        }
    });

    $('[data-action="auth-verify-open"]')?.addEventListener('click', () => {
        if (!verifyUrl) {
            toast('验证链接不可用', 'error');
            return;
        }
        window.open(verifyUrl, '_blank', 'noopener,noreferrer');
        toast('请在新窗口中完成验证');
    });

    $('[data-action="auth-verify-submit"]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const code = String($('[data-role="verify-code-input"]')?.value || '').trim();
        if (!pendingAccountId) {
            toast('会话已失效，请重新登录', 'error');
            return;
        }
        if (!code) {
            toast('请输入验证码', 'error');
            return;
        }
        button.disabled = true;
        try {
            const data = await api.post('/miot/auth/verify', {
                account_id: pendingAccountId,
                code,
            });
            await handleLoginResult(data, refreshSpeaker);
        } catch (error) {
            toast(error.message || '提交验证码失败', 'error');
        } finally {
            button.disabled = false;
        }
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
            await afterLoginSuccess(userId, refreshSpeaker, data?.message || 'Token 登录成功');
        } catch (error) {
            toast(error.message || 'Token 登录失败', 'error');
        } finally {
            if (submit) submit.disabled = false;
        }
    });
}
