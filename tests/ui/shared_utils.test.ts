import { describe, expect, it } from 'vitest';

interface ArraysModule {
  asArray(value: unknown, keys?: string[]): unknown[];
  resultCount(value: unknown): number;
}

interface FormsModule {
  boolValue(form: HTMLFormElement, name: string): boolean;
  hasField(form: HTMLFormElement, name: string): boolean;
  numberValue(form: HTMLFormElement, name: string): number | undefined;
  setField(form: HTMLFormElement, name: string, value: unknown): void;
  textValue(form: HTMLFormElement, name: string): string;
}

async function loadArraysModule(): Promise<ArraysModule> {
  return await import('../../static/js/shared/arrays.js') as ArraysModule;
}

async function loadFormsModule(): Promise<FormsModule> {
  return await import('../../static/js/shared/forms.js') as FormsModule;
}

describe('shared array helpers', () => {
  it('normalizes the response shapes used by music UI by default', async () => {
    const { asArray, resultCount } = await loadArraysModule();

    expect(asArray(['song'])).toEqual(['song']);
    expect(asArray({ list: ['from-list'], data: ['from-data'] })).toEqual(['from-list']);
    expect(asArray({ songs: ['from-songs'] })).toEqual(['from-songs']);
    expect(asArray({ data: ['from-data'] })).toEqual(['from-data']);
    expect(asArray({ accounts: ['not-default'] })).toEqual([]);
    expect(resultCount({ total: 12, list: ['one'] })).toBe(12);
    expect(resultCount({ list: ['one', 'two'] })).toBe(2);
  });

  it('supports scoped keys for speaker and automation response shapes', async () => {
    const { asArray } = await loadArraysModule();

    expect(asArray({ data: ['status'] }, ['data', 'accounts'])).toEqual(['status']);
    expect(asArray({ accounts: ['account'] }, ['data', 'accounts'])).toEqual(['account']);
    expect(asArray({ commands: ['voice'] }, ['commands', 'tasks', 'logs'])).toEqual(['voice']);
    expect(asArray({ tasks: ['schedule'] }, ['commands', 'tasks', 'logs'])).toEqual(['schedule']);
    expect(asArray({ logs: ['log'] }, ['commands', 'tasks', 'logs'])).toEqual(['log']);
  });
});

describe('shared form helpers', () => {
  it('reads and writes common form field types without throwing on missing fields', async () => {
    const { boolValue, hasField, numberValue, setField, textValue } = await loadFormsModule();
    const form = {
      elements: {
        title: { value: '  morning mix  ' },
        volume: { type: 'number', value: '42' },
        enabled: { type: 'checkbox', checked: true },
      },
    } as unknown as HTMLFormElement;

    expect(hasField(form, 'title')).toBe(true);
    expect(hasField(form, 'missing')).toBe(false);
    expect(textValue(form, 'title')).toBe('morning mix');
    expect(numberValue(form, 'volume')).toBe(42);
    expect(boolValue(form, 'enabled')).toBe(true);

    setField(form, 'title', 'night mix');
    setField(form, 'volume', 18);
    setField(form, 'enabled', false);
    setField(form, 'missing', 'ignored');

    expect(textValue(form, 'title')).toBe('night mix');
    expect(numberValue(form, 'volume')).toBe(18);
    expect(boolValue(form, 'enabled')).toBe(false);
  });
});
