import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoUrl = 'https://github.com/snakeJohn/starlight';
const rawPluginUrl = 'https://raw.githubusercontent.com/snakeJohn/starlight/main/plugin.json';

function pad(value) {
  return String(value).padStart(2, '0');
}

function currentVersion(date = new Date()) {
  return [
    `V-${date.getFullYear()}`,
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('.');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const root = process.cwd();
const version = currentVersion();
const downloadUrl = `${repoUrl}/releases/download/${version}/starlight-${version}.zip`;

const packagePath = join(root, 'package.json');
const packageLockPath = join(root, 'package-lock.json');
const pluginPath = join(root, 'plugin.json');

const packageJson = readJson(packagePath);
const packageLock = readJson(packageLockPath);
const pluginJson = readJson(pluginPath);

packageJson.version = version;
packageLock.version = version;
packageLock.packages ??= {};
packageLock.packages[''] ??= {};
packageLock.packages[''].version = version;
pluginJson.version = version;
pluginJson.homepage = repoUrl;
pluginJson.updateUrl = rawPluginUrl;
pluginJson.download_url = downloadUrl;

writeJson(packagePath, packageJson);
writeJson(packageLockPath, packageLock);
writeJson(pluginPath, pluginJson);

console.log(version);
