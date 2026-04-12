#!/usr/bin/env node
/**
 * Runtime-agnostic docker/podman compose wrapper.
 * Detects podman-compose or docker compose and forwards all arguments.
 *
 * Docker build workflows enable BuildKit automatically so compose-driven
 * builds use the Dockerfile cache mounts and isolated download stages.
 */

import { spawnSync, execFileSync } from 'node:child_process';

const FORCED_RUNTIME = process.env.CFXDEVKIT_RUNTIME?.trim().toLowerCase() ?? '';

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveForcedRuntime() {
  if (!FORCED_RUNTIME) return null;
  if (FORCED_RUNTIME !== 'docker' && FORCED_RUNTIME !== 'podman') {
    console.error(`Unsupported CFXDEVKIT_RUNTIME: ${FORCED_RUNTIME}. Expected "docker" or "podman".`);
    process.exit(1);
  }
  if (!commandExists(FORCED_RUNTIME)) {
    console.error(`Requested runtime not found in PATH: ${FORCED_RUNTIME}`);
    process.exit(1);
  }
  return FORCED_RUNTIME;
}

function resolveCompose() {
  const forcedRuntime = resolveForcedRuntime();
  if (forcedRuntime === 'podman') {
    if (commandExists('podman-compose')) {
      return { cmd: 'podman-compose', args: [] };
    }
    return { cmd: 'podman', args: ['compose'] };
  }
  if (forcedRuntime === 'docker') {
    return { cmd: 'docker', args: ['compose'] };
  }

  if (commandExists('podman') && commandExists('podman-compose')) {
    return { cmd: 'podman-compose', args: [] };
  }
  if (commandExists('podman')) {
    return { cmd: 'podman', args: ['compose'] };
  }
  if (commandExists('docker')) {
    return { cmd: 'docker', args: ['compose'] };
  }
  console.error('Neither podman nor docker found in PATH.');
  process.exit(1);
}

const { cmd, args } = resolveCompose();
const passthrough = process.argv.slice(2);

function shouldEnableDockerBuildkit(command, forwardedArgs) {
  if (command !== 'docker') return false;
  return forwardedArgs.some((arg) => arg === 'build' || arg === 'up');
}

const env = { ...process.env };
if (shouldEnableDockerBuildkit(cmd, passthrough)) {
  env.DOCKER_BUILDKIT = env.DOCKER_BUILDKIT ?? '1';
  env.COMPOSE_DOCKER_CLI_BUILD = env.COMPOSE_DOCKER_CLI_BUILD ?? '1';
}

const result = spawnSync(cmd, [...args, ...passthrough], { stdio: 'inherit', env });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
