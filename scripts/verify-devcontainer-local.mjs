#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const generatedProjectRoot = resolve(repoRoot, '.generated', 'project-example-devcontainer');
const devcontainerJsonPath = resolve(generatedProjectRoot, '.devcontainer', 'devcontainer.json');
const devcontainerDockerfilePath = resolve(generatedProjectRoot, '.devcontainer', 'Dockerfile');

function run(command, args, cwd = repoRoot) {
  return execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

function findDevContainersCli() {
  const extensionsRoot = resolve(homedir(), '.vscode', 'extensions');
  const match = readdirSync(extensionsRoot)
    .filter((name) => name.startsWith('ms-vscode-remote.remote-containers-'))
    .sort()
    .at(-1);

  if (!match) {
    throw new Error('Dev Containers extension is not installed in ~/.vscode/extensions');
  }

  const cliPath = resolve(extensionsRoot, match, 'dist', 'spec-node', 'devContainersSpecCLI.js');
  if (!existsSync(cliPath)) {
    throw new Error(`Dev Containers CLI not found: ${cliPath}`);
  }

  return cliPath;
}

function assertGeneratedConfig() {
  if (!existsSync(devcontainerJsonPath)) {
    throw new Error(`Missing generated devcontainer.json: ${devcontainerJsonPath}`);
  }
  if (!existsSync(devcontainerDockerfilePath)) {
    throw new Error(`Missing generated Dockerfile: ${devcontainerDockerfilePath}`);
  }

  const config = JSON.parse(readFileSync(devcontainerJsonPath, 'utf8'));
  const dockerfile = readFileSync(devcontainerDockerfilePath, 'utf8').trim();

  if (!config.build || config.build.dockerfile !== 'Dockerfile') {
    throw new Error('Generated devcontainer.json is not using build.dockerfile mode');
  }
  if (config.build.args?.DEVKIT_DEVCONTAINER_IMAGE !== 'new-devkit-devcontainer:dev') {
    throw new Error('Generated devcontainer.json should default DEVKIT_DEVCONTAINER_IMAGE to new-devkit-devcontainer:dev');
  }
  if (config.image) {
    throw new Error('Generated devcontainer.json should not use image mode');
  }
  if (dockerfile !== 'ARG DEVKIT_DEVCONTAINER_IMAGE=new-devkit-devcontainer:dev\nFROM ${DEVKIT_DEVCONTAINER_IMAGE}') {
    throw new Error(`Unexpected generated Dockerfile contents: ${dockerfile}`);
  }
}

function assertSharedImage() {
  run('docker', ['inspect', '--type', 'image', 'new-devkit-devcontainer:dev']);
}

function main() {
  assertGeneratedConfig();
  assertSharedImage();

  const cliPath = findDevContainersCli();
  const readConfigurationOutput = run('node', [
    cliPath,
    'read-configuration',
    '--workspace-folder', generatedProjectRoot,
    '--config', devcontainerJsonPath,
    '--log-level', 'debug',
    '--log-format', 'json',
  ]);

  const upOutput = run('node', [
    cliPath,
    'up',
    '--user-data-folder', resolve(homedir(), '.config', 'Code', 'User', 'globalStorage', 'ms-vscode-remote.remote-containers', 'data'),
    '--container-session-data-folder', '/tmp/devcontainers-verify-local',
    '--workspace-folder', generatedProjectRoot,
    '--workspace-mount-consistency', 'cached',
    '--gpu-availability', 'detect',
    '--id-label', `devcontainer.local_folder=${generatedProjectRoot}`,
    '--id-label', `devcontainer.config_file=${devcontainerJsonPath}`,
    '--log-level', 'debug',
    '--log-format', 'json',
    '--config', devcontainerJsonPath,
    '--default-user-env-probe', 'loginInteractiveShell',
    '--mount', 'type=volume,source=vscode,target=/vscode,external=true',
    '--skip-post-create',
    '--update-remote-user-uid-default', 'on',
    '--mount-workspace-git-root',
    '--include-configuration',
    '--include-merged-configuration',
  ]);

  console.log(JSON.stringify({
    status: 'success',
    generatedProjectRoot,
    readConfigurationOutput: readConfigurationOutput.trim().split('\n').slice(-1)[0],
    upOutput: upOutput.trim().split('\n').slice(-1)[0],
  }, null, 2));
}

main();