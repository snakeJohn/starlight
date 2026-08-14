import { describe, expect, it } from 'vitest';
import { ConfigManager, mergeMissingVoiceCommands } from '../../src/config/manager';
import { getDefaultVoiceCommands } from '../../src/voicecmd/engine';
import type { VoiceCommand } from '../../src/types';

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
    expect(config.conversation_poll_debug).toBe(false);
    expect(config.touchscreen_lyrics_enabled).toBe(false);
    expect(config.default_cover_id).toBe('1732418460076477549');
    expect(config.smart_resume_timeout).toBe(30);
    expect(config.max_song_index).toBe(10000);
    expect(config.external_search_timeout).toBe(6);
    expect(config.server_host).toBe('');
    expect(config.radio_force_mp3).toBe(false);
    expect(config.play_announcement_enabled).toBe(false);
    expect(config.play_announcement_template).toBe('即将播放{artist}的{song}');
    expect(config.play_announcement_wait_mode).toBe('auto');
    expect(config.play_announcement_delay).toBe(3);
  });

  it('appends only missing default voice-command types for upgrades', () => {
    const existing: VoiceCommand[] = [
      { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
      { type: 'stop', keywords: ['停止播放'], enabled: true },
    ];
    const merged = mergeMissingVoiceCommands(existing, getDefaultVoiceCommands());

    expect(merged.filter(cmd => cmd.type === 'play_song')).toHaveLength(1);
    expect(merged.filter(cmd => cmd.type === 'stop')).toHaveLength(1);
    expect(merged.some(cmd => cmd.type === 'sleep_timer')).toBe(true);
    expect(merged.some(cmd => cmd.type === 'cancel_sleep_timer')).toBe(true);
    expect(merged.some(cmd => cmd.type === 'query_sleep_timer')).toBe(true);
  });

  it('persists newly added sleep-timer commands for existing installs', async () => {
    const existing: VoiceCommand[] = [
      { type: 'play_song', keywords: ['播放歌曲'], enabled: true },
      { type: 'stop', keywords: ['停止播放'], enabled: true },
    ];
    await songloft.storage.set('starlight:miot:voice_commands', JSON.stringify(existing));

    const manager = new ConfigManager();
    const merged = await manager.ensureVoiceCommandDefaults(getDefaultVoiceCommands());
    const stored = JSON.parse(String(await songloft.storage.get('starlight:miot:voice_commands'))) as VoiceCommand[];

    expect(merged.some(cmd => cmd.type === 'sleep_timer')).toBe(true);
    expect(stored.some(cmd => cmd.type === 'sleep_timer')).toBe(true);
    expect(stored.filter(cmd => cmd.type === 'play_song')).toHaveLength(1);
  });
});
