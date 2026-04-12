/**
 * commands/status.ts — show detailed status for one or all workspace profiles.
 */

import { collectProfileSummaries } from '../runtime/container.js';
import { runCapture } from '../runtime/exec.js';
import { getStateFilePath, loadState, saveState } from '../state/loader.js';
import { resolveWorkspaceTarget } from '../state/profile.js';
import { aliasDisplay, renderTable } from '../util.js';
import type { Options, Runtime } from '../types.js';

export function showStatus(runtime: Runtime, opts: Options): number {
  const state = loadState();

  if (!opts.projectPathSpecified) {
    console.log(`Runtime: ${runtime}`);
    console.log(`State file: ${getStateFilePath()}`);
    console.log('');

    const profiles = collectProfileSummaries(runtime, opts, state);
    if (profiles.length === 0) {
      console.log('No managed workspace profiles found.');
      return 0;
    }

    const rows = profiles.map((profile) => [
      profile.profileSlug,
      aliasDisplay(profile.aliases),
      describeState(profile),
      profile.containerStatus,
      profile.volumePresent ? 'present' : 'missing',
      profile.containerName,
      profile.display,
    ]);

    console.log(renderTable(['PROFILE', 'ALIASES', 'STATE', 'CONTAINER', 'VOLUME', 'RESOURCE', 'WORKSPACE'], rows));
    return 0;
  }

  const target = resolveWorkspaceTarget(opts, state);
  saveState(state);
  const aliases = Object.entries(state.aliases)
    .filter(([, profileKey]) => profileKey === target.profileKey)
    .map(([aliasName]) => aliasName)
    .sort();

  console.log(`Runtime:   ${runtime}`);
  console.log(`Profile:   ${target.profileSlug}`);
  console.log(`Aliases:   ${aliasDisplay(aliases)}`);
  console.log(`Container: ${target.containerName}`);
  const container = runCapture(runtime, [
    'ps', '-a',
    '--filter', `name=^${target.containerName}$`,
    '--format', 'table {{.Names}}\t{{.Status}}\t{{.Image}}',
  ]);
  console.log(container || '(container not found)');
  console.log(`Volume:    ${target.volumeName}`);
  const volume = runCapture(runtime, ['volume', 'inspect', target.volumeName]);
  console.log(volume ? 'present' : 'missing');
  console.log(`Workspace: ${target.display}`);
  console.log(`State:     ${getStateFilePath()}`);
  return 0;
}

function describeState(profile: { containerStatus: string; volumePresent: boolean }): string {
  const containerPresent = profile.containerStatus !== 'missing';
  if (containerPresent && profile.volumePresent)
    return profile.containerStatus.toLowerCase().startsWith('up') ? 'running' : 'stopped';
  if (containerPresent) return 'container-only';
  if (profile.volumePresent) return 'persisted-volume';
  return 'missing';
}
