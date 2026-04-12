/**
 * commands/start.ts — start a workspace container.
 */

import {
  ensureTargetVolume,
  resolveLaunchImage,
  runVisible,
  socketGroupId,
  stopAndRemoveManagedContainers,
} from '../runtime/container.js';
import { detectSocket } from '../runtime/detect.js';
import { loadState, saveState, getStateFilePath } from '../state/loader.js';
import { resolveWorkspaceTarget } from '../state/profile.js';
import type { Options, Runtime } from '../types.js';

/** Image references — kept here to avoid a circular dep with cli.ts. */
export const DEFAULT_IMAGE_PREFIX = 'ghcr.io/cfxdevkit/devkit-workspace-web:';
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
  const image = imageSelection.image;

  stopAndRemoveManagedContainers(runtime);
  ensureTargetVolume(runtime, target);

  const args: string[] = [
    'run',
    '-d',
    '--name',
    target.containerName,
    '--network=host',
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

  if (target.mounted && target.resolvedPath) {
    args.push('-v', `${target.resolvedPath}:/workspace`);
    args.push('-e', 'WORKSPACE=/workspace');
  }

  if (socket) {
    args.push(
      '-v',
      runtime === 'podman'
        ? `${socket}:/var/run/docker.sock:z`
        : `${socket}:/var/run/docker.sock`,
    );
    const gid = socketGroupId(socket);
    if (gid) args.push('--group-add', gid);
  } else {
    console.warn(`Warning: no ${runtime} socket found; container-managed child workloads will fail.`);
  }

  if (process.env.GITHUB_TOKEN) {
    args.push('-e', `GITHUB_TOKEN=${process.env.GITHUB_TOKEN}`);
  }

  if (runtime === 'podman') {
    args.push('--userns=keep-id', '--cap-add=NET_RAW');
  }

  args.push(image);

  console.log('Starting CFX DevKit workspace...');
  console.log(`  Runtime:   ${runtime}`);
  console.log(`  Image:     ${image}`);
  console.log(`  Source:    ${imageSelection.source}`);
  console.log(`  Profile:   ${target.profileSlug}`);
  console.log(`  Container: ${target.containerName}`);
  console.log(`  Volume:    ${target.volumeName}`);
  console.log(`  Workspace: ${target.display}`);
  console.log(`  State:     ${getStateFilePath()}`);
  console.log('  URL:       http://localhost:8080');
  console.log('');

  const status = runVisible(runtime, args, opts.verbose);
  if (status !== 0 && imageSelection.source === 'published') {
    console.error('Published image launch failed.');
    console.error('Check your internet connection or specify a local image with --image or --local-image.');
  }
  if (status === 0) {
    saveState(state);
    console.log('Workspace is running at http://localhost:8080');
  }
  return status;
}
