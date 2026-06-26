import { describe, expect, it } from 'vitest';

interface AutomationVoiceCommandsModule {
  renderVoiceCommandRow(command: Record<string, unknown>, index: number): string;
  voiceCommandFromEditorData(data: Record<string, string | boolean>): Record<string, unknown>;
}

describe('automation voice command module', () => {
  it('renders a form-based row from the extracted voice command module', async () => {
    const modulePath = '../../static/js/automation_modules/voice_commands.js';
    const { renderVoiceCommandRow } = await import(modulePath) as AutomationVoiceCommandsModule;

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

  it('serializes editor fields back to the command payload from the extracted module', async () => {
    const modulePath = '../../static/js/automation_modules/voice_commands.js';
    const { voiceCommandFromEditorData } = await import(modulePath) as AutomationVoiceCommandsModule;

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
