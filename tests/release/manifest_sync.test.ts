import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const githubRepoUrl = 'https://github.com/snakeJohn/starlight';

describe('release manifest sync', () => {
  it('copies build hashes into root plugin manifest and creates the versioned release zip', () => {
    const repoRoot = process.cwd();
    const fixtureDir = mkdtempSync(resolve(tmpdir(), 'starlight-manifest-'));
    const pluginJson = {
      name: 'Starlight',
      entryPath: 'starlight',
      releaseVersion: 'V-2026.06.23.14.30',
      download_url: `${githubRepoUrl}/releases/download/V-2000.01.01.00.00/starlight-V-2000.01.01.00.00.zip`,
      entryHash: 'old-entry',
      zipHash: 'old-zip',
    };
    const buildManifest = {
      entryHash: 'new-entry-hash',
      zipHash: 'new-zip-hash',
    };

    mkdirSync(resolve(fixtureDir, 'dist/_build'), { recursive: true });
    writeFileSync(resolve(fixtureDir, 'plugin.json'), `${JSON.stringify(pluginJson, null, 2)}\n`);
    writeFileSync(resolve(fixtureDir, 'dist/_build/plugin.json'), `${JSON.stringify(buildManifest, null, 2)}\n`);
    writeFileSync(resolve(fixtureDir, 'dist/starlight.jsplugin.zip'), 'zip-bytes');

    execFileSync('node', [resolve(repoRoot, 'scripts/sync-release-manifest.mjs')], { cwd: fixtureDir });

    const syncedManifest = JSON.parse(readFileSync(resolve(fixtureDir, 'plugin.json'), 'utf8')) as typeof pluginJson;
    const releaseZip = resolve(fixtureDir, 'dist/starlight-V-2026.06.23.14.30.zip');

    expect(syncedManifest.entryHash).toBe('new-entry-hash');
    expect(syncedManifest.zipHash).toBe('new-zip-hash');
    expect(syncedManifest.download_url).toBe(
      `${githubRepoUrl}/releases/download/${pluginJson.releaseVersion}/starlight-${pluginJson.releaseVersion}.zip`,
    );
    expect(existsSync(releaseZip)).toBe(true);
    expect(readFileSync(releaseZip, 'utf8')).toBe('zip-bytes');

    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
