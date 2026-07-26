import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHostBaseUrl,
  isUsableHostBaseUrl,
  normalizeHostBaseUrl,
  requireHostBaseUrl,
  resolveHostBaseUrl,
  setHostBaseUrl,
} from '../../src/utils/http';

function songloftPlugin() {
  return (globalThis as unknown as { songloft: { plugin: { getHostUrl: () => Promise<string> } } }).songloft.plugin;
}

describe('host base URL resolution', () => {
  beforeEach(() => {
    setHostBaseUrl('');
    songloftPlugin().getHostUrl = async () => 'http://127.0.0.1:18191';
  });

  afterEach(() => {
    setHostBaseUrl('');
    songloftPlugin().getHostUrl = async () => 'http://127.0.0.1:18191';
    vi.restoreAllMocks();
  });

  it('rejects port 0 and empty hosts', () => {
    expect(isUsableHostBaseUrl('')).toBe(false);
    expect(isUsableHostBaseUrl('http://localhost:0')).toBe(false);
    expect(isUsableHostBaseUrl('http://127.0.0.1:0/api/v1')).toBe(false);
    expect(isUsableHostBaseUrl('http://127.0.0.1:18191')).toBe(true);
    expect(normalizeHostBaseUrl('http://127.0.0.1:18191/api/v1/jsplugin/starlight')).toBe(
      'http://127.0.0.1:18191',
    );
  });

  it('prefers explicit config over invalid SDK localhost:0', async () => {
    songloftPlugin().getHostUrl = vi.fn(async () => 'http://localhost:0');

    const host = await resolveHostBaseUrl('http://192.168.1.8:18191');
    expect(host).toBe('http://192.168.1.8:18191');
    expect(getHostBaseUrl()).toBe('http://192.168.1.8:18191');
  });

  it('falls back to valid SDK host when config empty', async () => {
    songloftPlugin().getHostUrl = vi.fn(async () => 'http://127.0.0.1:18191/api/v1/jsplugin/starlight');

    setHostBaseUrl('');
    const host = await resolveHostBaseUrl('');
    expect(host).toBe('http://127.0.0.1:18191');
  });

  it('does not replace valid cache with invalid SDK', async () => {
    const getHostUrl = vi.fn(async () => 'http://localhost:0');
    songloftPlugin().getHostUrl = getHostUrl;
    setHostBaseUrl('http://10.0.0.2:18191');

    const host = await resolveHostBaseUrl('');
    expect(host).toBe('http://10.0.0.2:18191');
    expect(getHostUrl).not.toHaveBeenCalled();
  });

  it('requireHostBaseUrl throws when only invalid SDK is available', async () => {
    songloftPlugin().getHostUrl = vi.fn(async () => 'http://localhost:0');
    setHostBaseUrl('');

    await expect(requireHostBaseUrl('')).rejects.toThrow(/Songloft 访问地址不可用/);
  });
});
