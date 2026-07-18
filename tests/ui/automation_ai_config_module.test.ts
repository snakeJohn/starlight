import { afterEach, describe, expect, it, vi } from 'vitest';

interface AiConfigModule {
  aiConfigFromForm(form: { elements: Record<string, { value?: string; checked?: boolean }> }): Record<string, unknown>;
  formatAiTestResult(result: Record<string, unknown> | null): string;
  updateAiAnalysisAccess(voiceEnabled: boolean): void;
  applyAiConfigToForm(aiConfig: Record<string, unknown>): void;
}

function installDom(overrides: {
  enabledChecked?: boolean;
  enabledDisabled?: boolean;
  hintHidden?: boolean;
} = {}) {
  const enabled = {
    checked: overrides.enabledChecked ?? false,
    disabled: overrides.enabledDisabled ?? false,
  };
  const hint = { hidden: overrides.hintHidden ?? true };
  const status = { textContent: '' };
  const state = { textContent: '' };
  const elements: Record<string, { value?: string; checked?: boolean; disabled?: boolean }> = {
    enabled,
    api_url: { value: 'https://example.com/v1' },
    api_key: { value: 'sk-test' },
    model: { value: 'qwen-flash' },
    timeout: { value: '8' },
  };
  const form = {
    elements,
    querySelector: vi.fn(() => null),
  };
  const toggle = { classList: { toggle: vi.fn() } };

  const map: Record<string, unknown> = {
    '[data-role="ai-config-form"]': form,
    '[data-role="ai-enabled"]': enabled,
    '[data-role="ai-dependency-hint"]': hint,
    '[data-role="ai-enabled-toggle"]': toggle,
    '[data-role="ai-config-status"]': status,
    '[data-role="ai-config-state"]': state,
  };

  vi.stubGlobal('document', {
    querySelector: vi.fn((selector: string) => map[selector] ?? null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({ className: '', textContent: '', remove: vi.fn() })),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('window', {
    setTimeout: vi.fn(),
    dispatchEvent: vi.fn(),
    SongloftPlugin: { getAuthToken: () => 'ui-token' },
  });
  vi.stubGlobal('CustomEvent', vi.fn((type, init) => ({ type, ...init })));

  return { form, enabled, hint, status, state, toggle };
}

describe('automation AI config module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('serializes AI form fields into config payload', async () => {
    installDom();
    const modulePath = '../../static/js/automation_modules/ai_config.js';
    const { aiConfigFromForm, updateAiAnalysisAccess } = await import(modulePath) as AiConfigModule;
    updateAiAnalysisAccess(true);

    const payload = aiConfigFromForm({
      elements: {
        enabled: { checked: true },
        api_url: { value: '  https://api.example/v1  ' },
        api_key: { value: ' secret ' },
        model: { value: ' qwen-plus ' },
        timeout: { value: '12' },
      },
    });

    expect(payload).toEqual({
      enabled: true,
      api_url: 'https://api.example/v1',
      api_key: 'secret',
      model: 'qwen-plus',
      timeout: 12,
    });
  });

  it('formats AI test results for display', async () => {
    installDom();
    const modulePath = '../../static/js/automation_modules/ai_config.js';
    const { formatAiTestResult } = await import(modulePath) as AiConfigModule;

    const text = formatAiTestResult({
      action: 'play_song',
      confidence: 'high',
      rawText: '晴天 周杰伦',
      params: { name: '晴天', artist: '周杰伦' },
    });

    expect(text).toContain('操作: play_song');
    expect(text).toContain('置信度: high');
    expect(text).toContain('晴天');
    expect(text).toContain('周杰伦');
  });

  it('disables AI switch when voice commands are off', async () => {
    const { enabled, hint, toggle } = installDom({ enabledChecked: true });
    const modulePath = '../../static/js/automation_modules/ai_config.js';
    const { updateAiAnalysisAccess, applyAiConfigToForm } = await import(modulePath) as AiConfigModule;

    updateAiAnalysisAccess(false);
    applyAiConfigToForm({ enabled: true, api_url: 'https://x', api_key: 'k', model: 'm', timeout: 6 });

    expect(enabled.disabled).toBe(true);
    expect(enabled.checked).toBe(false);
    expect(hint.hidden).toBe(false);
    expect(toggle.classList.toggle).toHaveBeenCalledWith('is-muted', true);
  });
});
