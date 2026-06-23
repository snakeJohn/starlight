import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoUrl = 'https://github.com/snakeJohn/starlight';
const rawPluginUrl = 'https://raw.githubusercontent.com/snakeJohn/starlight/main/plugin.json';
const releaseVersionPattern = /^V-\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

const root = process.cwd();
const pluginPath = join(root, 'plugin.json');
const buildManifestPath = join(root, 'dist', '_build', 'plugin.json');

requireFile(pluginPath, 'root plugin manifest');
requireFile(buildManifestPath, 'built plugin manifest');

const pluginJson = readJson(pluginPath);
const buildManifest = readJson(buildManifestPath);
const entryPath = pluginJson.entryPath || 'starlight';
const releaseVersion = pluginJson.releaseVersion;

if (!releaseVersionPattern.test(releaseVersion || '')) {
  throw new Error(`Invalid releaseVersion: ${releaseVersion}`);
}
if (!buildManifest.entryHash || !buildManifest.zipHash) {
  throw new Error('built plugin manifest is missing entryHash or zipHash');
}

const sourceZipPath = join(root, 'dist', `${entryPath}.jsplugin.zip`);
const releaseZipName = `starlight-${releaseVersion}.zip`;
const releaseZipPath = `dist/${releaseZipName}`;

requireFile(sourceZipPath, 'built plugin zip');
copyFileSync(sourceZipPath, join(root, 'dist', releaseZipName));

pluginJson.homepage = repoUrl;
pluginJson.updateUrl = rawPluginUrl;
pluginJson.download_url = `${repoUrl}/releases/download/${releaseVersion}/${releaseZipName}`;
pluginJson.entryHash = buildManifest.entryHash;
pluginJson.zipHash = buildManifest.zipHash;

writeJson(pluginPath, pluginJson);

writeOutput('release_version', releaseVersion);
writeOutput('release_zip_name', releaseZipName);
writeOutput('release_zip_path', releaseZipPath);
writeOutput('entry_hash', buildManifest.entryHash);
writeOutput('zip_hash', buildManifest.zipHash);

console.log(`release_version=${releaseVersion}`);
console.log(`release_zip_path=${releaseZipPath}`);
console.log(`entry_hash=${buildManifest.entryHash}`);
console.log(`zip_hash=${buildManifest.zipHash}`);
