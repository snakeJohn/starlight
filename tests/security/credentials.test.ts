import { describe, expect, it } from 'vitest';
import {
  migrateAccountSecrets,
  resolveSecretUpdate,
  toPublicAccount,
  toPublicAIConfig,
} from '../../src/security/credentials';
import type { AccountConfig, AIConfig } from '../../src/types';

describe('credential DTOs', () => {
  it('never exposes password, pass_token, or service secrets', () => {
    const account: AccountConfig = {
      id: 'u1',
      account: 'user@example.com',
      auth_type: 'password',
      login_method: 'password',
      password: 'super-secret',
      pass_token: 'pt-secret',
      user_id: '123',
      services: {
        micoapi: {
          service_token: 'st-secret',
          ssecurity: 'ss-secret',
          expires_at: 99,
        },
      },
      devices: [],
      last_selected_device_id: '',
      created_at: 'a',
      updated_at: 'b',
    };

    const pub = toPublicAccount(account);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('super-secret');
    expect(json).not.toContain('pt-secret');
    expect(json).not.toContain('st-secret');
    expect(json).not.toContain('ss-secret');
    expect(pub.has_password).toBe(true);
    expect(pub.has_pass_token).toBe(true);
    expect(pub.services.micoapi.has_service_token).toBe(true);
    expect(pub.services.micoapi.has_ssecurity).toBe(true);
    expect(pub.services.micoapi.expires_at).toBe(99);
  });

  it('returns has_api_key instead of api_key for AI config', () => {
    const ai: AIConfig = {
      enabled: true,
      api_url: 'https://example/v1',
      api_key: 'sk-live-secret',
      model: 'm',
      timeout: 6,
    };
    const pub = toPublicAIConfig(ai);
    expect(pub).toEqual({
      enabled: true,
      api_url: 'https://example/v1',
      has_api_key: true,
      model: 'm',
      timeout: 6,
    });
    expect(JSON.stringify(pub)).not.toContain('sk-live-secret');
  });
});

describe('migrateAccountSecrets', () => {
  it('normalizes legacy records without devices so device paths cannot throw', () => {
    const legacy = {
      id: 'u1',
      account: 'user@example.com',
      auth_type: 'password',
      login_method: 'password',
      user_id: '123',
      created_at: 'a',
      updated_at: 'b',
    } as unknown as AccountConfig;

    const migrated = migrateAccountSecrets(legacy);

    expect(migrated.devices).toEqual([]);
    expect(migrated.services).toEqual({});
    expect(migrated.password).toBe('');
    expect(migrated.pass_token).toBe('');
    expect(() => migrated.devices.map(device => device.device_id)).not.toThrow();
  });
});

describe('resolveSecretUpdate', () => {
  it('preserves when omitted or blank, replaces when set, clears with sentinel', () => {
    expect(resolveSecretUpdate(undefined, 'keep')).toBe('keep');
    expect(resolveSecretUpdate('', 'keep')).toBe('keep');
    expect(resolveSecretUpdate('  new  ', 'keep')).toBe('new');
    expect(resolveSecretUpdate(null, 'keep')).toBe('');
    expect(resolveSecretUpdate('__CLEAR__', 'keep')).toBe('');
  });
});
