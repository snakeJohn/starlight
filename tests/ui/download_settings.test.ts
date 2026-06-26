import { afterEach, describe, expect, it, vi } from 'vitest';

interface DownloadModule {
  applyDownloadSettings(settings: Record<string, unknown> | null): void;
}

async function loadDownloadModule(): Promise<DownloadModule> {
  const modulePath = '../../static/js/music_modules/downloads.js';
  return await import(modulePath) as DownloadModule;
}

describe('download settings helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills the download settings form with saved values', async () => {
    const form = {
      elements: {
        path_template: { value: '' },
        download_interval: { value: '' },
        embed_metadata: { checked: true },
      },
    };
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => form),
    });
    const { applyDownloadSettings } = await loadDownloadModule();

    applyDownloadSettings({
      path_template: 'custom/{artist}/{title}',
      download_interval: 3,
      embed_metadata: false,
    });

    expect(form.elements.path_template.value).toBe('custom/{artist}/{title}');
    expect(form.elements.download_interval.value).toBe('3');
    expect(form.elements.embed_metadata.checked).toBe(false);
  });

  it('falls back to the default template when the server value is empty', async () => {
    const form = {
      elements: {
        path_template: { value: '' },
        download_interval: { value: '' },
        embed_metadata: { checked: false },
      },
    };
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => form),
    });
    const { applyDownloadSettings } = await loadDownloadModule();

    applyDownloadSettings({
      path_template: '',
      download_interval: 0,
      embed_metadata: true,
    });

    expect(form.elements.path_template.value).toBe('downloads/{artist}-{album}/{title}');
    expect(form.elements.download_interval.value).toBe('0');
    expect(form.elements.embed_metadata.checked).toBe(true);
  });
});
