import { describe, expect, it } from 'vitest';
import { isBlockedHostname, validateOutboundWebhookUrl } from '../../src/utils/url_safety';

describe('isBlockedHostname', () => {
  it('blocks loopback and private IPv4 literals', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
    expect(isBlockedHostname('10.0.0.1')).toBe(true);
    expect(isBlockedHostname('192.168.1.1')).toBe(true);
    expect(isBlockedHostname('172.16.5.1')).toBe(true);
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('localhost')).toBe(true);
  });

  it('allows public hosts', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('8.8.8.8')).toBe(false);
  });
});

describe('validateOutboundWebhookUrl', () => {
  it('accepts https public URLs', () => {
    const result = validateOutboundWebhookUrl('https://hooks.example.com/path');
    expect(result).toEqual({ ok: true, url: 'https://hooks.example.com/path' });
  });

  it('rejects missing url, non-http schemes, and private hosts', () => {
    expect(validateOutboundWebhookUrl('').ok).toBe(false);
    expect(validateOutboundWebhookUrl('ftp://example.com').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://127.0.0.1/hook').ok).toBe(false);
    expect(validateOutboundWebhookUrl('http://192.168.0.10/x').ok).toBe(false);
    expect(validateOutboundWebhookUrl('https://user:pass@example.com/x').ok).toBe(false);
  });
});
