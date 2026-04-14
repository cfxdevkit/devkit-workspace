#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const artifactsRoot = resolve(repoRoot, 'packages', 'devkit-base', 'artifacts');
const generatedRoot = resolve(artifactsRoot, 'generated');
const tempRoot = resolve(artifactsRoot, '.tmp');

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function packDirectory(sourceDir, outputFile) {
  execFileSync('tar', ['-czf', outputFile, '-C', sourceDir, '.']);
}

rmSync(tempRoot, { recursive: true, force: true });
rmSync(generatedRoot, { recursive: true, force: true });
ensureDir(tempRoot);
ensureDir(generatedRoot);

const mcpRoot = resolve(tempRoot, 'devkit-mcp');
const mcpBinRoot = resolve(mcpRoot, 'bin');
ensureDir(mcpBinRoot);
writeFileSync(resolve(mcpRoot, 'package.json'), JSON.stringify({
  name: '@new-devkit/devkit-mcp-artifact',
  version: '0.0.0',
  private: true,
  bin: { 'devkit-mcp': 'bin/devkit-mcp' }
}, null, 2));
writeExecutable(resolve(mcpBinRoot, 'devkit-mcp'), '#!/usr/bin/env sh\necho "new-devkit mcp placeholder"\n');
packDirectory(mcpRoot, resolve(generatedRoot, 'devkit-mcp.tgz'));

const manifestPath = resolve(artifactsRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
writeFileSync(resolve(generatedRoot, 'manifest.resolved.json'), JSON.stringify(manifest, null, 2));

const configSource = resolve(artifactsRoot, 'config');
if (existsSync(configSource)) {
  cpSync(configSource, resolve(generatedRoot, 'config'), { recursive: true });
}

rmSync(tempRoot, { recursive: true, force: true });
console.log(`Prepared devkit artifacts in ${generatedRoot}`);
