import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const holidaysDir = resolve(process.cwd(), 'src/data/holidays');

function readYearJson(file: string): {
  year?: number;
  days?: Array<{ date?: string; isOffDay?: boolean }>;
} {
  return JSON.parse(readFileSync(resolve(holidaysDir, file), 'utf8')) as {
    year?: number;
    days?: Array<{ date?: string; isOffDay?: boolean }>;
  };
}

describe('holiday data release contract', () => {
  it('ships year JSON files, index, and SOURCE_REVISION', () => {
    expect(existsSync(resolve(holidaysDir, 'index.ts'))).toBe(true);
    expect(existsSync(resolve(holidaysDir, 'SOURCE_REVISION'))).toBe(true);
    expect(existsSync(resolve(holidaysDir, '2026.json'))).toBe(true);
  });

  it('current year snapshot is non-empty and well-formed', () => {
    // Future years may ship as empty placeholders until the State Council publishes them.
    const currentYear = new Date().getFullYear();
    const file = `${currentYear}.json`;
    expect(existsSync(resolve(holidaysDir, file))).toBe(true);
    const raw = readYearJson(file);
    expect(Array.isArray(raw.days)).toBe(true);
    expect(raw.days!.length).toBeGreaterThan(0);
    for (const day of raw.days!) {
      expect(typeof day.date).toBe('string');
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.isOffDay).toBe('boolean');
    }
  });

  it('package.json does not refresh holidays on build', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.prebuild).toBeUndefined();
    expect(pkg.scripts?.predev).toBeUndefined();
    expect(pkg.scripts?.['fetch:holidays']).toBe('node scripts/fetch-holidays.mjs');
  });
});
