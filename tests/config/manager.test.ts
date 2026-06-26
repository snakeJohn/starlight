import { describe, expect, it } from 'vitest';
import { ConfigManager } from '../../src/config/manager';

describe('ConfigManager defaults', () => {
  it('merges default runtime fields into legacy stored config', async () => {
    await songloft.storage.set('starlight:miot:config', JSON.stringify({
      version: '1.0',
      conversation_monitor_enabled: true,
      voice_command_enabled: true,
    }));

    const config = await new ConfigManager().getConfig();

    expect(config.conversation_monitor_enabled).toBe(true);
    expect(config.voice_command_enabled).toBe(true);
    expect(config.conversation_poll_interval).toBe(1);
    expect(config.smart_resume_timeout).toBe(30);
    expect(config.max_song_index).toBe(10000);
    expect(config.external_search_timeout).toBe(6);
    expect(config.server_host).toBe('');
  });
});
