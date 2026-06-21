const SECRET_KEYS = [
  'password',
  'pass_token',
  'service_token',
  'ssecurity',
  'api_key',
  'cookie',
  'authorization',
] as const;

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_KEYS.some((secretKey) => normalized === secretKey || normalized.includes(secretKey));
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return maskSecret(value);
  }

  if (value == null) {
    return value;
  }

  return maskSecret(String(value));
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return '*'.repeat(secret.length);
  }

  const visiblePrefix = secret.slice(0, 4);
  const visibleSuffix = secret.slice(-4);
  const maskedLength = Math.max(6, secret.length - 8);
  return `${visiblePrefix}${'*'.repeat(maskedLength)}${visibleSuffix}`;
}

export function maskRecord(record: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    masked[key] = isSecretKey(key) ? maskValue(value) : value;
  }

  return masked;
}
