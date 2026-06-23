import { describe, expect, it } from 'vitest';

interface AutomationModule {
  renderVoiceCommandRow(command: Record<string, unknown>, index: number): string;
  voiceCommandFromEditorData(data: Record<string, string | boolean>): Record<string, unknown>;
}

async function loadAutomationModule(): Promise<AutomationModule> {
  const modulePath = '../../static/js/automation.js';
  return await import(modulePath) as AutomationModule;
}

describe('voice command editor helpers', () => {
  it('renders a form-based row for a voice command', async () => {
    const { renderVoiceCommandRow } = await loadAutomationModule();

    const html = renderVoiceCommandRow({
      type: 'set_volume',
      param: 'up',
      keywords: ['大声一点', '音量大一点'],
      enabled: true,
    }, 0);

    expect(html).toContain('data-role="voice-command-row"');
    expect(html).toContain('name="type"');
    expect(html).toContain('name="keywords"');
    expect(html).toContain('大声一点，音量大一点');
    expect(html).not.toContain('<textarea');
  });

  it('serializes editor fields back to the command payload', async () => {
    const { voiceCommandFromEditorData } = await loadAutomationModule();

    expect(voiceCommandFromEditorData({
      type: 'set_play_mode',
      param: 'random',
      keywords: '随机播放，随机模式, shuffle',
      enabled: true,
    })).toEqual({
      type: 'set_play_mode',
      param: 'random',
      keywords: ['随机播放', '随机模式', 'shuffle'],
      enabled: true,
    });
  });
});
