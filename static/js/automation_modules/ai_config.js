import { api } from '../api.js';
import { putOrPost } from './config.js';
import { $, toast } from '../state.js';

const DEFAULT_AI = {
    enabled: false,
    api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key: '',
    model: 'qwen-flash',
    timeout: 6,
};

let lastVoiceEnabled = false;

function formEl() {
    return $('[data-role="ai-config-form"]');
}

function setAiState(message) {
    const node = $('[data-role="ai-config-state"]');
    if (node) node.textContent = message;
}

function setAiStatus(enabled) {
    const node = $('[data-role="ai-config-status"]');
    if (node) node.textContent = enabled ? '已开启' : '已关闭';
}

export function updateAiAnalysisAccess(voiceEnabled) {
    lastVoiceEnabled = Boolean(voiceEnabled);
    const enabledInput = $('[data-role="ai-enabled"]');
    const hint = $('[data-role="ai-dependency-hint"]');
    const toggle = $('[data-role="ai-enabled-toggle"]');
    if (enabledInput) {
        enabledInput.disabled = !lastVoiceEnabled;
        if (!lastVoiceEnabled) {
            enabledInput.checked = false;
        }
    }
    toggle?.classList.toggle('is-muted', !lastVoiceEnabled);
    if (hint) hint.hidden = lastVoiceEnabled;
}

export function applyAiConfigToForm(aiConfig = {}) {
    const form = formEl();
    if (!form) return;
    const cfg = { ...DEFAULT_AI, ...(aiConfig || {}) };
    const enabled = Boolean(cfg.enabled) && lastVoiceEnabled;
    if (form.elements.enabled) form.elements.enabled.checked = enabled;
    if (form.elements.api_url) form.elements.api_url.value = cfg.api_url || DEFAULT_AI.api_url;
    // API never returns the raw key — only has_api_key. Leave field empty to preserve.
    if (form.elements.api_key) {
        form.elements.api_key.value = typeof cfg.api_key === 'string' ? cfg.api_key : '';
        form.elements.api_key.placeholder = cfg.has_api_key
            ? '已配置（留空保留，填 __CLEAR__ 清除）'
            : 'API Key';
    }
    if (form.elements.model) form.elements.model.value = cfg.model || DEFAULT_AI.model;
    if (form.elements.timeout) form.elements.timeout.value = String(cfg.timeout || DEFAULT_AI.timeout);
    setAiStatus(enabled);
    setAiState(cfg.has_api_key ? '已加载（密钥已配置）' : '已加载');
}

export function aiConfigFromForm(form = formEl()) {
    if (!form) {
        return { ...DEFAULT_AI };
    }
    const timeoutRaw = Number(form.elements.timeout?.value);
    const payload = {
        enabled: Boolean(form.elements.enabled?.checked) && lastVoiceEnabled,
        api_url: String(form.elements.api_url?.value || '').trim(),
        model: String(form.elements.model?.value || '').trim() || DEFAULT_AI.model,
        timeout: Number.isFinite(timeoutRaw) && timeoutRaw > 0
            ? Math.min(30, Math.max(1, Math.floor(timeoutRaw)))
            : DEFAULT_AI.timeout,
    };
    // Only send api_key when the user typed a value (empty = preserve server secret).
    const key = String(form.elements.api_key?.value || '').trim();
    if (key) {
        payload.api_key = key;
    }
    return payload;
}

export function formatAiTestResult(result) {
    if (!result || typeof result !== 'object') {
        return '无分析结果';
    }
    const action = result.action || 'unknown';
    const confidence = result.confidence || 'low';
    const rawText = result.rawText || '';
    let params = '{}';
    try {
        params = JSON.stringify(result.params || {}, null, 2);
    } catch {
        params = String(result.params || {});
    }
    return `操作: ${action}\n置信度: ${confidence}\n有效文本: ${rawText}\n参数:\n${params}`;
}

export async function loadAiConfig(configPayload) {
    let payload = configPayload;
    if (!payload) {
        payload = await api.get('/miot/config');
    }
    if (payload?.voice_command_enabled !== undefined) {
        updateAiAnalysisAccess(!!payload.voice_command_enabled);
    }
    applyAiConfigToForm(payload?.ai_config || DEFAULT_AI);
    return payload?.ai_config || DEFAULT_AI;
}

export async function saveAiConfig(event) {
    if (event?.preventDefault) event.preventDefault();
    const form = event?.currentTarget || formEl();
    if (form?.elements?.enabled?.checked && !lastVoiceEnabled) {
        form.elements.enabled.checked = false;
        toast('请先开启语音口令', 'error');
        setAiState('请先开启语音口令');
        return null;
    }
    const ai_config = aiConfigFromForm(form);
    await putOrPost('/miot/config', { ai_config });
    setAiStatus(ai_config.enabled);
    setAiState('已保存');
    toast('AI 配置已保存');
    return ai_config;
}

export async function runAiTest() {
    const input = $('[data-role="ai-test-input"]');
    const resultNode = $('[data-role="ai-test-result"]');
    const query = String(input?.value || '').trim();
    if (!query) {
        if (resultNode) {
            resultNode.hidden = false;
            resultNode.textContent = '请输入要分析的语句';
        }
        toast('请输入测试语句', 'error');
        return null;
    }
    if (resultNode) {
        resultNode.hidden = false;
        resultNode.textContent = '分析中…';
    }
    const result = await api.post('/miot/voice-commands/ai-test', { query });
    const text = formatAiTestResult(result);
    if (resultNode) {
        resultNode.hidden = false;
        resultNode.textContent = text;
    }
    toast('AI 分析完成');
    return result;
}

export function bindAiConfig() {
    const panel = $('[data-role="ai-config-panel"]');
    if (!panel || panel.dataset.bound === '1') return;
    panel.dataset.bound = '1';

    formEl()?.addEventListener('submit', event => {
        saveAiConfig(event).catch(error => {
            setAiState(error.message || '保存失败');
            toast(error.message || '保存 AI 配置失败', 'error');
        });
    });

    panel.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button || !panel.contains(button)) return;
        const action = button.dataset.action;
        if (action === 'load-ai-config') {
            button.disabled = true;
            loadAiConfig()
                .then(() => toast('AI 配置已刷新'))
                .catch(error => toast(error.message || '加载失败', 'error'))
                .finally(() => { button.disabled = false; });
        }
        if (action === 'ai-test') {
            button.disabled = true;
            runAiTest()
                .catch(error => {
                    const resultNode = $('[data-role="ai-test-result"]');
                    if (resultNode) {
                        resultNode.hidden = false;
                        resultNode.textContent = `分析失败: ${error.message || error}`;
                    }
                    toast(error.message || 'AI 测试失败', 'error');
                })
                .finally(() => { button.disabled = false; });
        }
    });

    $('[data-role="ai-enabled"]')?.addEventListener('change', event => {
        const input = event.currentTarget;
        if (input.checked && !lastVoiceEnabled) {
            input.checked = false;
            toast('请先开启语音口令', 'error');
            return;
        }
        // Persist enabled flag immediately (same as MIoT).
        putOrPost('/miot/config', { ai_config: { enabled: Boolean(input.checked) } })
            .then(() => {
                setAiStatus(Boolean(input.checked));
                setAiState(input.checked ? 'AI 已开启' : 'AI 已关闭');
                toast(input.checked ? 'AI 分析已开启' : 'AI 分析已关闭');
            })
            .catch(error => {
                input.checked = !input.checked;
                toast(error.message || '切换失败', 'error');
            });
    });
}
