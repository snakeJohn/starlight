import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rawPluginUrl = 'https://raw.githubusercontent.com/snakeJohn/starlight/main/plugin.json';
const githubRepoUrl = 'https://github.com/snakeJohn/starlight';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
}

describe('release registry', () => {
  it('publishes a repository raw plugin registry', () => {
    const registry = readJson<{ name?: string; plugins?: string[] }>('registry.json');

    expect(registry).toEqual({
      name: 'Starlight Plugin Registry',
      plugins: [rawPluginUrl],
    });
  });

  it('points plugin release metadata at the GitHub repository and release artifact', () => {
    const pluginJson = readJson<{
      homepage?: string;
      updateUrl?: string;
      download_url?: string;
      version?: string;
    }>('plugin.json');

    expect(pluginJson.homepage).toBe(githubRepoUrl);
    expect(pluginJson.updateUrl).toBe(rawPluginUrl);
    expect(pluginJson.download_url).toBe(
      `${githubRepoUrl}/releases/download/${pluginJson.version}/starlight-${pluginJson.version}.zip`,
    );
  });
});
