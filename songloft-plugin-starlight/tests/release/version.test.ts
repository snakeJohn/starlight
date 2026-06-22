import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson(path: string): { version?: string; packages?: Record<string, { version?: string }> } {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as { version?: string; packages?: Record<string, { version?: string }> };
}

describe('release version', () => {
  it('uses yyyy.mm.dd.hh format consistently across release metadata', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const pluginJson = readJson('plugin.json');
    const versionPattern = /^\d{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\.([01]\d|2[0-3])$/;

    expect(pluginJson.version).toBe(packageJson.version);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages?.['']?.version).toBe(packageJson.version);
    expect(packageJson.version).toMatch(versionPattern);
  });
});
