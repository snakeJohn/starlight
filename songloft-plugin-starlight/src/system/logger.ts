const SECRET_KEYS = [
  'password',
  'passtoken',
  'servicetoken',
  'ssecurity',
  'apikey',
  'cookie',
  'authorization',
] as const;

const SECRET_KEY_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'cookie',
  'authorization',
  'apikey',
  'ssecurity',
] as const;

type PlainRecord = Record<string, unknown>;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SECRET_KEYS.some((secretKey) => normalized === secretKey) ||
    SECRET_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  );
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function maskValue(value: unknown, forceMask: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item, forceMask));
  }

  if (isPlainRecord(value)) {
    return maskPlainRecord(value, forceMask);
  }

  if (!forceMask || value == null) {
    return value;
  }

  return maskSecret(typeof value === 'string' ? value : String(value));
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

function maskPlainRecord(record: PlainRecord, forceMask = false): PlainRecord {
  const masked: PlainRecord = {};

  for (const [key, value] of Object.entries(record)) {
    masked[key] = maskValue(value, forceMask || isSecretKey(key));
  }

  return masked;
}

export function maskRecord(record: Record<string, unknown>): Record<string, unknown> {
  return maskPlainRecord(record);
}
