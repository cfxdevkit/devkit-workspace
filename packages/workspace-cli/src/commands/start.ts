/**
 * commands/start.ts — start a workspace container.
 */

import {
  ensureTargetVolume,
  imageExists,
  resolveLaunchImage,
  socketGroupId,
  stopAndRemoveManagedContainers,
} from '../runtime/container.js';
import { run, runVisibleResult } from '../runtime/exec.js';
import { detectSocket } from '../runtime/detect.js';
import { loadState, saveState, getStateFilePath } from '../state/loader.js';
import { resolveWorkspaceTarget } from '../state/profile.js';
import type { Options, Runtime } from '../types.js';

/** Image references — kept here to avoid a circular dep with cli.ts. */
export const DEFAULT_IMAGE_PREFIX = 'ghcr.io/cfxdevkit/devkit-workspace-web:';
export const DEFAULT_IMAGE_LATEST = `${DEFAULT_IMAGE_PREFIX}latest`;
export const LOCAL_IMAGE = 'cfxdevkit/devkit-workspace-web:latest';

export function startWorkspace(
  runtime: Runtime,
  opts: Options,
  defaultImage: string,
): number {
  const state = loadState();
  const target = resolveWorkspaceTarget(opts, state);
  const socket = detectSocket(runtime, opts.socket);
  const imageSelection = resolveLaunchImage(runtime, opts, defaultImage, LOCAL_IMAGE);
  let image = imageSelection.image;

  console.log('Starting CFX DevKit workspace...');
  console.log(`  Runtime:   ${runtime}`);
  console.log(`  Image:     ${image}`);
  console.log(`  Source:    ${imageSelection.source}`);
  console.log(`  Profile:   ${target.profileSlug}`);
  console.log(`  Container: ${target.containerName}`);
  console.log(`  Volume:    ${target.volumeName}`);
  console.log(`  Workspace: ${target.display}`);
  console.log(`  State:     ${getStateFilePath()}`);
  console.log('  URL:       pending, available after startup completes');
  console.log('');

  if (!imageExists(runtime, image)) {
    console.log(`Pulling image ${image}...`);
    let pullStatus = run(runtime, ['pull', image], true);

    if (
      pullStatus !== 0 &&
      imageSelection.source === 'published' &&
      image === defaultImage
    ) {
      console.warn(`Published image ${defaultImage} is unavailable. Retrying with ${DEFAULT_IMAGE_LATEST}...`);
      image = DEFAULT_IMAGE_LATEST;
      pullStatus = run(runtime, ['pull', image], true);
    }

    if (pullStatus !== 0) {
      if (imageSelection.source === 'published') {
        console.error('Published image launch failed.');
        console.error('Check your internet connection or specify a local image with --image or --local-image.');
      }
      return pullStatus;
    }

    console.log(`Image ready: ${image}`);
    console.log('');
  }

  stopAndRemoveManagedContainers(runtime);
  ensureTargetVolume(runtime, target);

  // Host networking gives services direct access to host ports (Conflux node, devkit API, etc.).
  // Docker Desktop on Windows and Mac do not support --network=host; use bridge mode with
  // explicit publish flags instead. Port 8080 → code-server, others → devkit services.
  const useHostNetwork = process.platform === 'linux';

  const args: string[] = [
    'run',
    '-d',
    '--name',
    target.containerName,
    '-l',
    'com.cfxdevkit.workspace.managed=true',
    '-l',
    `com.cfxdevkit.workspace.profile=${target.profileSlug}`,
    '-l',
    `com.cfxdevkit.workspace.display=${target.display}`,
    '-l',
    `com.cfxdevkit.workspace.mode=${target.mounted ? 'mounted' : 'builtin'}`,
    '-v',
    `${target.volumeName}:/home/node`,
    '-e',
    'DOCKER_HOST=unix:///var/run/docker.sock',
  ];

  if (useHostNetwork) {
    args.push('--network=host');
  } else {
    // Bridge mode: publish all ports that code-server and devkit services listen on.
    for (const port of ['8080', '3030', '7748', '8545', '8546', '8888', '12537', '12535']) {
      args.push('-p', `${port}:${port}`);
    }
  }

  if (target.mounted && target.resolvedPath) {
    args.push('-v', `${target.resolvedPath}:/workspace`);
    args.push('-e', 'WORKSPACE=/workspace');
  }

  if (socket) {
    if (process.platform === 'win32') {
      // Windows named pipes: Docker Desktop translates these into /var/run/docker.sock
      // inside the Linux container automatically.
      args.push('-v', `${socket}:/var/run/docker.sock`);
    } else {
      args.push(
        '-v',
        runtime === 'podman'
          ? `${socket}:/var/run/docker.sock:z`
          : `${socket}:/var/run/docker.sock`,
      );
    }
    const gid = socketGroupId(socket);
    if (gid) args.push('--group-add', gid);
  } else {
    console.warn(`Warning: no ${runtime} socket found; container-managed child workloads will fail.`);
  }

  if (process.env.GITHUB_TOKEN) {
    args.push('-e', `GITHUB_TOKEN=${process.env.GITHUB_TOKEN}`);
  }

  if (runtime === 'podman') {
    // --userns=keep-id is Linux-only (rootless Podman); Podman Desktop on Windows/Mac
    // runs containers inside a VM where UID mapping is handled differently.
    if (process.platform === 'linux') {
      args.push('--userns=keep-id');
    }
    args.push('--cap-add=NET_RAW');
  }

  args.push(image);

  let launch = runVisibleResult(runtime, args, opts.verbose);
  let status = launch.status;

  if (
    status !== 0 &&
    imageSelection.source === 'published' &&
    image === defaultImage &&
    shouldRetryWithLatest(launch.stderr)
  ) {
    console.warn(`Published image ${defaultImage} is unavailable. Retrying with ${DEFAULT_IMAGE_LATEST}...`);
    image = DEFAULT_IMAGE_LATEST;
    const retryArgs = [...args.slice(0, -1), image];
    launch = runVisibleResult(runtime, retryArgs, opts.verbose);
    status = launch.status;
  }

  if (status !== 0 && imageSelection.source === 'published') {
    console.error('Published image launch failed.');
    console.error('Check your internet connection or specify a local image with --image or --local-image.');
  }
  if (status === 0) {
    saveState(state);
    console.log('URL: http://localhost:8080');
    console.log('Workspace is running at http://localhost:8080');
  }
  return status;
}

function shouldRetryWithLatest(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return normalized.includes('manifest unknown') || normalized.includes('not found');
}
