/**
 * runtime/container.ts — container, volume, and image management helpers.
 * Also exports collectProfileSummaries which aggregates runtime + state view.
 */

import { existsSync, statSync } from 'node:fs';

import { fail } from '../util.js';
import { run, runCapture, } from './exec.js';
import type {
  LauncherState,
  Options,
  ProfileSummary,
  Runtime,
  WorkspaceTarget,
} from '../types.js';
import {
  DISPLAY_LABEL_KEY,
  MANAGED_LABEL,
  MODE_LABEL_KEY,
  PROFILE_LABEL_KEY,
} from '../types.js';

// ── Socket helpers ─────────────────────────────────────────────────────────

export function socketGroupId(socket: string | null): string | null {
  if (!socket || !existsSync(socket)) return null;
  try {
    return String(statSync(socket).gid);
  } catch {
    return null;
  }
}

// ── Image helpers ──────────────────────────────────────────────────────────

export function resolveImageRef(runtime: Runtime, image: string, localImage: boolean): string {
  if (localImage && runtime === 'podman' && !image.startsWith('localhost/')) {
    return `localhost/${image}`;
  }
  return image;
}

export function imageExists(runtime: Runtime, image: string): boolean {
  return run(runtime, ['image', 'inspect', image], false) === 0;
}

export function resolveLaunchImage(
  runtime: Runtime,
  opts: Options,
  defaultImage: string,
  localImage: string,
): { image: string; source: 'explicit' | 'local' | 'published' } {
  if (opts.localImage) {
    return {
      image: resolveImageRef(runtime, opts.image, true),
      source: opts.imageSpecified ? 'explicit' : 'local',
    };
  }

  if (opts.imageSpecified) {
    return {
      image: resolveImageRef(runtime, opts.image, false),
      source: 'explicit',
    };
  }

  const local = resolveImageRef(runtime, localImage, true);
  if (imageExists(runtime, local)) {
    return { image: local, source: 'local' };
  }

  return { image: defaultImage, source: 'published' };
}

// ── Volume helpers ─────────────────────────────────────────────────────────

export function volumeExists(runtime: Runtime, volumeName: string): boolean {
  return run(runtime, ['volume', 'inspect', volumeName], false) === 0;
}

export function ensureTargetVolume(runtime: Runtime, target: WorkspaceTarget): void {
  if (volumeExists(runtime, target.volumeName)) return;

  const status = run(
    runtime,
    [
      'volume',
      'create',
      '--label',
      MANAGED_LABEL,
      '--label',
      `${PROFILE_LABEL_KEY}=${target.profileSlug}`,
      '--label',
      `${DISPLAY_LABEL_KEY}=${target.display}`,
      '--label',
      `${MODE_LABEL_KEY}=${target.mounted ? 'mounted' : 'builtin'}`,
      target.volumeName,
    ],
    false,
  );

  if (status !== 0) {
    fail(`Failed to create managed volume: ${target.volumeName}`);
  }
}

export function removeTargetVolume(runtime: Runtime, target: WorkspaceTarget): void {
  run(runtime, ['volume', 'rm', target.volumeName], false);
}

// ── Container helpers ──────────────────────────────────────────────────────

export function inspectContainerLabel(runtime: Runtime, containerName: string, labelKey: string): string {
  return runCapture(runtime, ['inspect', containerName, '--format', `{{ index .Config.Labels "${labelKey}" }}`]);
}

export function stopTargetContainer(runtime: Runtime, target: WorkspaceTarget): void {
  run(runtime, ['stop', target.containerName], false);
}

export function removeTargetContainer(runtime: Runtime, target: WorkspaceTarget): void {
  run(runtime, ['rm', target.containerName], false);
}

export function stopAndRemoveManagedContainers(runtime: Runtime): void {
  const ids = runCapture(runtime, ['ps', '-aq', '--filter', `label=${MANAGED_LABEL}`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (ids.length === 0) return;

  run(runtime, ['stop', ...ids], false);
  run(runtime, ['rm', ...ids], false);
}

// ── Slug derivation ────────────────────────────────────────────────────────

export function slugFromContainerName(namePrefix: string, containerName: string): string | null {
  if (!containerName.startsWith(`${namePrefix}-`)) return null;
  return containerName.slice(namePrefix.length + 1) || null;
}

export function slugFromVolumeName(namePrefix: string, volumeName: string): string | null {
  const prefix = `${namePrefix}-`;
  const suffix = '-home';
  if (!volumeName.startsWith(prefix) || !volumeName.endsWith(suffix)) return null;
  return volumeName.slice(prefix.length, -suffix.length) || null;
}

// ── Profile summary aggregation ────────────────────────────────────────────

export function collectProfileSummaries(
  runtime: Runtime,
  opts: Options,
  state: LauncherState,
): ProfileSummary[] {
  const summaries = new Map<string, ProfileSummary>();

  for (const stored of Object.values(state.profiles)) {
    summaries.set(stored.profileSlug, {
      profileSlug: stored.profileSlug,
      display: stored.display,
      mounted: stored.mounted,
      containerName: stored.containerName,
      volumeName: stored.volumeName,
      containerStatus: 'missing',
      image: '-',
      volumePresent: false,
      aliases: [],
    });
  }

  for (const [aliasName, profileKey] of Object.entries(state.aliases)) {
    const stored = state.profiles[profileKey];
    if (!stored) continue;

    const existing = summaries.get(stored.profileSlug);
    if (existing) {
      existing.aliases.push(aliasName);
    }
  }

  const containers = runCapture(runtime, [
    'ps', '-a',
    '--filter', `label=${MANAGED_LABEL}`,
    '--format', '{{.Names}}|{{.Status}}|{{.Image}}',
  ])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const container of containers) {
    const [containerName, containerStatus, image] = container.split('|');
    const profileSlug =
      inspectContainerLabel(runtime, containerName, PROFILE_LABEL_KEY) ||
      slugFromContainerName(opts.name, containerName);
    if (!profileSlug) continue;

    const display =
      inspectContainerLabel(runtime, containerName, DISPLAY_LABEL_KEY) ||
      summaries.get(profileSlug)?.display ||
      '(unknown workspace)';
    const mounted =
      (inspectContainerLabel(runtime, containerName, MODE_LABEL_KEY) || '').trim() !== 'builtin';
    const existing = summaries.get(profileSlug);

    summaries.set(profileSlug, {
      profileSlug,
      display,
      mounted,
      containerName,
      volumeName: existing?.volumeName ?? `${opts.name}-${profileSlug}-home`,
      containerStatus,
      image: image || '-',
      volumePresent: existing?.volumePresent ?? false,
      aliases: existing?.aliases ?? [],
    });
  }

  const volumes = runCapture(runtime, ['volume', 'ls', '--format', '{{.Name}}'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const volumeName of volumes) {
    const profileSlug = slugFromVolumeName(opts.name, volumeName);
    if (!profileSlug) continue;

    const existing = summaries.get(profileSlug);
    if (existing) {
      existing.volumePresent = true;
      existing.volumeName = volumeName;
      continue;
    }

    summaries.set(profileSlug, {
      profileSlug,
      display: '(unknown workspace)',
      mounted: profileSlug !== 'builtin',
      containerName: `${opts.name}-${profileSlug}`,
      volumeName,
      containerStatus: 'missing',
      image: '-',
      volumePresent: true,
      aliases: [],
    });
  }

  return [...summaries.values()].sort((left, right) => {
    if (left.profileSlug === 'builtin') return -1;
    if (right.profileSlug === 'builtin') return 1;
    return left.display.localeCompare(right.display);
  });
}

// ── Passthrough of runVisible for commands that need it ───────────────────

export { runVisible } from './exec.js';
