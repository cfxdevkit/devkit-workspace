/**
 * commands/doctor.ts — check runtime, socket, state, and local CLI environment.
 */

import { existsSync } from 'node:fs';

import {
  commandExists,
  commandPath,
  detectSocket,
} from '../runtime/detect.js';
import { run } from '../runtime/exec.js';
import {
  imageExists,
  resolveImageRef,
  resolveLaunchImage,
} from '../runtime/container.js';
import { getStateFilePath, loadState } from '../state/loader.js';
import { renderTable } from '../util.js';
import { LOCAL_IMAGE, DEFAULT_IMAGE_PREFIX } from './start.js';
import type { Options, Runtime } from '../types.js';

export function showDoctor(opts: Options, cliVersion: string): number {
  const state = loadState();
  const runtimeCandidates: Runtime[] = ['podman', 'docker'];
  const availableRuntimes = runtimeCandidates.filter(commandExists);
  const runtime = opts.runtime ?? availableRuntimes[0] ?? null;
  const socket = runtime ? detectSocket(runtime, opts.socket) : opts.socket;
  const runtimePath = runtime ? commandPath(runtime) : '';
  const runtimeAccess = runtime ? run(runtime, ['info'], false) === 0 : false;
  const cliPath = commandPath('conflux-workspace');
  const localImage = runtime ? resolveImageRef(runtime, LOCAL_IMAGE, true) : LOCAL_IMAGE;
  const localImagePresent = runtime ? imageExists(runtime, localImage) : false;
  const defaultImage = `${DEFAULT_IMAGE_PREFIX}${cliVersion}`;
  const defaultLaunch = runtime
    ? resolveLaunchImage(runtime, opts, defaultImage, LOCAL_IMAGE)
    : null;

  const rows = [
    ['cli-version', cliVersion],
    ['cli-path', cliPath || '(not installed in PATH)'],
    ['runtime', runtime ?? '(not found)'],
    ['runtime-path', runtimePath || '(not found)'],
    ['runtime-access', runtime ? (runtimeAccess ? 'ok' : 'failed') : 'skipped'],
    ['socket', socket ?? '(not found)'],
    ['state-file', getStateFilePath()],
    ['state-file-exists', existsSync(getStateFilePath()) ? 'yes' : 'no'],
    ['profiles-known', String(Object.keys(state.profiles).length)],
    ['aliases-known', String(Object.keys(state.aliases).length)],
    ['local-image', localImage],
    ['local-image-present', localImagePresent ? 'yes' : 'no'],
    ['default-image', defaultImage],
    ['default-launch-image', defaultLaunch?.image ?? defaultImage],
    ['default-launch-source', defaultLaunch?.source ?? 'n/a'],
  ];

  console.log(renderTable(['CHECK', 'VALUE'], rows));
  return runtime && !runtimeAccess ? 1 : 0;
}
