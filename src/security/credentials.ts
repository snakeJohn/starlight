/**
 * Credential protection helpers for API responses and config updates.
 *
 * Local threat model:
 * - Songloft does not expose a dedicated secure-secret vault API to plugins.
 * - Secrets (Mi passwords, pass tokens, service tokens, external-search tokens,
 *   AI API keys) are persisted only in host-provided `songloft.storage`, which
 *   is isolated by the host process and not readable by other plugins.
 * - This plugin never embeds an encryption key in the repository. Client-side
 *   "encryption" with a key shipped in the plugin binary would not raise the
 *   bar against a host-compromise attacker who already controls storage.
 * - API responses and logs must never return raw secrets; only presence flags
 *   (or redacted placeholders) are exposed to the UI.
 */

import type { AccountConfig, AIConfig, PluginConfig, ServiceTokenInfo } from '../types';

/** Public account DTO — never includes raw secrets. */
export interface PublicAccountDto {
  id: string;
  account: string;
  auth_type: string;
  login_method: string;
  user_id: string;
  has_password: boolean;
  has_pass_token: boolean;
  services: Record<string, PublicServiceTokenDto>;
  devices: AccountConfig['devices'];
  last_selected_device_id: string;
  created_at: string;
  updated_at: string;
}

export interface PublicServiceTokenDto {
  has_service_token: boolean;
  has_ssecurity: boolean;
  expires_at: number;
}

/** Public AI config DTO — never includes api_key value. */
export interface PublicAIConfigDto {
  enabled: boolean;
  api_url: string;
  has_api_key: boolean;
  model: string;
  timeout: number;
}

/** Public plugin config fields that may be returned from GET /config. */
export interface PublicConfigSecrets {
  has_external_search_token: boolean;
  ai_config: PublicAIConfigDto;
}

export function toPublicAccount(account: AccountConfig): PublicAccountDto {
  const services: Record<string, PublicServiceTokenDto> = {};
  for (const [sid, info] of Object.entries(account.services || {})) {
    services[sid] = toPublicServiceToken(info);
  }
  return {
    id: account.id,
    account: account.account || '',
    auth_type: account.auth_type || '',
    login_method: account.login_method || '',
    user_id: account.user_id || '',
    has_password: Boolean(account.password),
    has_pass_token: Boolean(account.pass_token),
    services,
    devices: account.devices || [],
    last_selected_device_id: account.last_selected_device_id || '',
    created_at: account.created_at || '',
    updated_at: account.updated_at || '',
  };
}

export function toPublicServiceToken(info: ServiceTokenInfo | undefined | null): PublicServiceTokenDto {
  return {
    has_service_token: Boolean(info?.service_token),
    has_ssecurity: Boolean(info?.ssecurity),
    expires_at: typeof info?.expires_at === 'number' ? info.expires_at : 0,
  };
}

export function toPublicAIConfig(ai: AIConfig): PublicAIConfigDto {
  return {
    enabled: Boolean(ai.enabled),
    api_url: ai.api_url || '',
    has_api_key: Boolean(ai.api_key),
    model: ai.model || '',
    timeout: typeof ai.timeout === 'number' ? ai.timeout : 6,
  };
}

export function publicConfigSecretFlags(config: PluginConfig, ai: AIConfig): PublicConfigSecrets {
  return {
    has_external_search_token: Boolean(config.external_search_token),
    ai_config: toPublicAIConfig(ai),
  };
}

/**
 * Secret update semantics:
 * - `undefined` / omitted → preserve existing
 * - `null` or explicit clear sentinel → clear
 * - non-empty string → replace
 * - empty string → preserve (UI leaves field blank when secret already set)
 */
export function resolveSecretUpdate(
  incoming: unknown,
  current: string,
  options: { clearSentinel?: string } = {},
): string {
  if (incoming === undefined) {
    return current;
  }
  if (incoming === null) {
    return '';
  }
  if (typeof incoming !== 'string') {
    return current;
  }
  const value = incoming.trim();
  const clear = options.clearSentinel ?? '__CLEAR__';
  if (value === clear) {
    return '';
  }
  if (value === '') {
    return current;
  }
  return value;
}

/**
 * Idempotent migration marker for account/config secret records.
 * Ensures older stores that only held plaintext remain readable; no-op when
 * already in the expected shape.
 */
export function migrateAccountSecrets(account: AccountConfig): AccountConfig {
  // Currently secrets remain in host storage as plain strings (see threat model).
  // Normalize missing fields so callers can rely on string types.
  return {
    ...account,
    password: typeof account.password === 'string' ? account.password : '',
    pass_token: typeof account.pass_token === 'string' ? account.pass_token : '',
    services: account.services || {},
  };
}

export function migratePluginSecrets(config: PluginConfig): PluginConfig {
  return {
    ...config,
    external_search_token:
      typeof config.external_search_token === 'string' ? config.external_search_token : '',
  };
}

export function migrateAISecrets(ai: AIConfig): AIConfig {
  return {
    ...ai,
    api_key: typeof ai.api_key === 'string' ? ai.api_key : '',
  };
}
