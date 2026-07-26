import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());

describe('playback target UI contract', () => {
  it('exposes browser/speaker selector distinct from play-mode controls', () => {
    const html = readFileSync(resolve(root, 'static/index.html'), 'utf8');
    expect(html).toContain('data-action="playback-target-select"');
    expect(html).toContain('data-target="browser"');
    expect(html).toContain('data-target="speaker"');
    expect(html).toContain('data-role="playback-target-hint"');
    // Play mode remains a separate control surface.
    expect(html).toContain('data-action="speaker-player-mode-option"');
  });

  it('routes controls through selected playback target modules', () => {
    const player = readFileSync(resolve(root, 'static/js/speaker_modules/player.js'), 'utf8');
    const target = readFileSync(resolve(root, 'static/js/speaker_modules/playback_target.js'), 'utf8');
    const browser = readFileSync(resolve(root, 'static/js/speaker_modules/browser_player.js'), 'utf8');
    const music = readFileSync(resolve(root, 'static/js/music.js'), 'utf8');

    expect(target).toContain('starlight.playbackTarget');
    expect(target).toContain('已切换到');
    expect(target).toContain('下次播放将使用');
    expect(browser).toContain('new Audio');
    expect(browser).toContain('/bridge/preview-url');
    expect(player).toContain('getSelectedPlaybackTarget');
    expect(player).toContain('browserPlayerAction');
    expect(player).toContain('handoffBrowserQueueToSpeaker');
    expect(player).toContain('handoffSpeakerQueueToBrowser');
    expect(player).toContain('retained_from_browser');
    expect(player).toContain('retained_from_speaker');
    expect(browser).toContain('getBrowserQueueSnapshot');
    expect(browser).toContain('pauseBrowserPlayback');
    expect(music).toContain("getSelectedPlaybackTarget() === 'browser'");
  });
});
