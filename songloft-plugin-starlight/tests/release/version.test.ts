import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type ReleaseJson = {
  scripts?: Record<string, string>;
  version?: string;
  releaseVersion?: string;
  packages?: Record<string, { version?: string }>;
};

const versionPattern = /^V-\d{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\.([01]\d|2[0-3])\.[0-5]\d$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readJson(path: string): ReleaseJson {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as ReleaseJson;
}

function formatVersion(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `V-${date.getFullYear()}`,
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('.');
}

describe('release version', () => {
  it('uses V-yyyy.mm.dd.hh.mm for release metadata and semver for Songloft manifest validation', () => {
    const packageJson = readJson('package.json');
    const packageLock = readJson('package-lock.json');
    const pluginJson = readJson('plugin.json');

    expect(pluginJson.releaseVersion).toBe(packageJson.version);
    expect(pluginJson.version).toMatch(semverPattern);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages?.['']?.version).toBe(packageJson.version);
    expect(packageJson.version).toMatch(versionPattern);
  });

  it('exposes a version:stamp script backed by scripts/update-version.mjs', () => {
    const packageJson = readJson('package.json');
    const scriptPath = resolve(process.cwd(), 'scripts/update-version.mjs');

    expect(packageJson.scripts?.['version:stamp']).toBe('node scripts/update-version.mjs');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('stamps package, lockfile, and plugin metadata with the current minute', () => {
    const repoRoot = process.cwd();
    const fixtureDir = mkdtempSync(resolve(tmpdir(), 'starlight-version-'));
    const packageJson = {
      name: 'songloft-plugin-starlight',
      version: 'V-2000.01.01.00.00',
      scripts: {},
    };
    const packageLock = {
      name: 'songloft-plugin-starlight',
      version: 'V-2000.01.01.00.00',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'songloft-plugin-starlight',
          version: 'V-2000.01.01.00.00',
        },
      },
    };
    const pluginJson = {
      name: 'Starlight Plugin',
      version: '2000.1.1-0.0',
      releaseVersion: 'V-2000.01.01.00.00',
      download_url: 'https://github.com/snakeJohn/starlight/releases/download/V-2000.01.01.00.00/starlight-V-2000.01.01.00.00.zip',
    };

    writeFileSync(resolve(fixtureDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    writeFileSync(resolve(fixtureDir, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`);
    writeFileSync(resolve(fixtureDir, 'plugin.json'), `${JSON.stringify(pluginJson, null, 2)}\n`);

    const before = new Date();
    execFileSync('node', [resolve(repoRoot, 'scripts/update-version.mjs')], { cwd: fixtureDir });
    const after = new Date();

    const stampedPackage = JSON.parse(readFileSync(resolve(fixtureDir, 'package.json'), 'utf8')) as ReleaseJson;
    const stampedLock = JSON.parse(readFileSync(resolve(fixtureDir, 'package-lock.json'), 'utf8')) as ReleaseJson;
    const stampedPlugin = JSON.parse(readFileSync(resolve(fixtureDir, 'plugin.json'), 'utf8')) as { version?: string; releaseVersion?: string; download_url?: string };
    const allowedVersions = new Set([formatVersion(before), formatVersion(after)]);

    expect(stampedPackage.version).toMatch(versionPattern);
    expect(allowedVersions.has(stampedPackage.version ?? '')).toBe(true);
    expect(stampedLock.version).toBe(stampedPackage.version);
    expect(stampedLock.packages?.['']?.version).toBe(stampedPackage.version);
    expect(stampedPlugin.releaseVersion).toBe(stampedPackage.version);
    expect(stampedPlugin.version).toMatch(semverPattern);
    expect(stampedPlugin.download_url).toBe(
      `https://github.com/snakeJohn/starlight/releases/download/${stampedPackage.version}/starlight-${stampedPackage.version}.zip`,
    );

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
