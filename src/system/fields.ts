import { StarlightError } from './errors';

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stringishField(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function boolField(value: unknown): boolean {
  return value === true || value === 'true';
}

export function requireString(value: unknown, name: string): string {
  const text = stringField(value);
  if (!text) {
    throw new StarlightError('BAD_REQUEST', `${name} is required`);
  }
  return text;
}

export function requireId(value: unknown, name = 'id'): string {
  return requireString(value, name);
}

export function requirePositiveInteger(value: unknown, name: string): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric <= 0) {
    throw new StarlightError('BAD_REQUEST', `invalid ${name}`);
  }
  return numeric;
}

export function paginationInt(
  value: unknown,
  name: 'page' | 'page_size',
  fallback: number,
  max?: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (
    typeof numeric !== 'number'
    || !Number.isInteger(numeric)
    || numeric <= 0
    || (max !== undefined && numeric > max)
  ) {
    throw new StarlightError('BAD_REQUEST', `${name} must be an integer between 1 and ${max ?? 'unlimited'}`);
  }

  return numeric;
}
