import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

describe('release package contents', () => {
  it('packages only the browser bundle instead of its source modules', async () => {
    const root = resolve(process.cwd());
    const runtimeProcess = process as unknown as {
      env: Record<string, string | undefined>;
      execPath: string;
    };
    const npmCli = runtimeProcess.env.npm_execpath;
    if (!npmCli) throw new Error('npm_execpath is unavailable');
    const build = () => execFileSync(runtimeProcess.execPath, [npmCli, 'run', 'build'], { cwd: root });

    build();
    const firstZip = readFileSync(resolve(root, 'dist/starlight.jsplugin.zip'), 'base64');
    const first = await JSZip.loadAsync(firstZip, { base64: true });

    build();
    const secondZip = readFileSync(resolve(root, 'dist/starlight.jsplugin.zip'), 'base64');
    const zip = await JSZip.loadAsync(secondZip, { base64: true });

    const javascriptEntries = Object.keys(zip.files)
      .filter((name) => name.startsWith('static/js/') && name.endsWith('.js'));

    expect(javascriptEntries).toHaveLength(1);
    expect(javascriptEntries[0]).toMatch(/^static\/js\/app\.bundle\.[a-f0-9]{8}\.js$/);
    expect(Object.keys(zip.files).sort()).toEqual(Object.keys(first.files).sort());
  }, 30_000);
});
