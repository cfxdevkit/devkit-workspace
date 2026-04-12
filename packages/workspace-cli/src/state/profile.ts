/**
 * state/profile.ts — workspace target creation and resolution.
 */

import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';

import { fail } from '../util.js';
import { loadState, saveState } from './loader.js';
import type { LauncherState, Options, StoredProfile, WorkspaceTarget } from '../types.js';

// ── Target constructors ────────────────────────────────────────────────────

export function createBuiltinTarget(name: string): WorkspaceTarget {
  return {
    mounted: false,
    resolvedPath: null,
    profileKey: 'builtin',
    profileSlug: 'builtin',
    display: 'built-in project-example',
    containerName: `${name}-builtin`,
    volumeName: `${name}-builtin-home`,
  };
}

export function createMountedTarget(name: string, resolvedPath: string): WorkspaceTarget {
  const hash = createHash('sha256').update(resolvedPath).digest('hex').slice(0, 12);
  const profileSlug = `ws-${hash}`;

  return {
    mounted: true,
    resolvedPath,
    profileKey: resolvedPath,
    profileSlug,
    display: resolvedPath,
    containerName: `${name}-${profileSlug}`,
    volumeName: `${name}-${profileSlug}-home`,
  };
}

export function createTargetFromStoredProfile(profile: StoredProfile): WorkspaceTarget {
  return {
    mounted: profile.mounted,
    resolvedPath: profile.mounted && profile.profileKey !== 'builtin' ? profile.profileKey : null,
    profileKey: profile.profileKey,
    profileSlug: profile.profileSlug,
    display: profile.display,
    containerName: profile.containerName,
    volumeName: profile.volumeName,
  };
}

export function createTargetFromProfileSlug(name: string, profileSlug: string): WorkspaceTarget {
  if (profileSlug === 'builtin') {
    return createBuiltinTarget(name);
  }

  return {
    mounted: true,
    resolvedPath: null,
    profileKey: `profile:${profileSlug}`,
    profileSlug,
    display: `(profile ${profileSlug})`,
    containerName: `${name}-${profileSlug}`,
    volumeName: `${name}-${profileSlug}-home`,
  };
}

// ── Profile registry mutations ─────────────────────────────────────────────

export function registerProfile(state: LauncherState, target: WorkspaceTarget): void {
  state.profiles[target.profileKey] = {
    profileKey: target.profileKey,
    profileSlug: target.profileSlug,
    display: target.display,
    mounted: target.mounted,
    containerName: target.containerName,
    volumeName: target.volumeName,
    updatedAt: new Date().toISOString(),
  };
}

export function removeProfile(state: LauncherState, target: WorkspaceTarget): void {
  delete state.profiles[target.profileKey];

  for (const [aliasName, profileKey] of Object.entries(state.aliases)) {
    if (profileKey === target.profileKey) {
      delete state.aliases[aliasName];
    }
  }
}

export function findStoredProfileBySlug(state: LauncherState, profileSlug: string): StoredProfile | null {
  for (const profile of Object.values(state.profiles)) {
    if (profile.profileSlug === profileSlug) return profile;
  }
  return null;
}

// ── Target resolution ──────────────────────────────────────────────────────

export function resolveWorkspaceTarget(opts: Options, state: LauncherState): WorkspaceTarget {
  if (opts.profileSlug) {
    const stored = findStoredProfileBySlug(state, opts.profileSlug);
    if (stored) return createTargetFromStoredProfile(stored);

    if (opts.command === 'start' || opts.command === 'rebuild') {
      fail(`Unknown profile slug for ${opts.command}: ${opts.profileSlug}`);
    }

    return createTargetFromProfileSlug(opts.name, opts.profileSlug);
  }

  if (!opts.projectPath) {
    fail(
      `No workspace target specified.\n\n` +
      `Create a new project with:\n` +
      `  conflux-workspace create ./my-project\n\n` +
      `Then start it with:\n` +
      `  conflux-workspace start ./my-project\n\n` +
      `Run conflux-workspace --help for all options.`,
    );
  }

  let projectPath = opts.projectPath;
  if (projectPath.startsWith('@')) {
    const aliasName = normalizeAliasName(projectPath.slice(1));
    const profileKey = state.aliases[aliasName];
    if (!profileKey) fail(`Alias not found: @${aliasName}`);
    const stored = state.profiles[profileKey];
    if (stored) return createTargetFromStoredProfile(stored);
    projectPath = profileKey;
  }

  if (!existsSync(projectPath)) {
    fail(`Project path not found: ${projectPath}`);
  }

  const resolvedPath = realpathSync(projectPath);
  const target = createMountedTarget(opts.name, resolvedPath);
  registerProfile(state, target);
  return target;
}

// re-export so callers can import loadState for side-effects when needed
export { loadState, saveState };

// ── Alias normalization (local use only) ───────────────────────────────────

function normalizeAliasName(aliasName: string): string {
  const normalized = aliasName.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    fail(`Invalid alias name: ${aliasName}`);
  }
  return normalized;
}
