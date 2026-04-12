/**
 * types.ts — shared types, constants, and label keys for the workspace CLI.
 */

// ── Label & config constants ───────────────────────────────────────────────

export const MANAGED_LABEL = 'com.cfxdevkit.workspace.managed=true';
export const PROFILE_LABEL_KEY = 'com.cfxdevkit.workspace.profile';
export const DISPLAY_LABEL_KEY = 'com.cfxdevkit.workspace.display';
export const MODE_LABEL_KEY = 'com.cfxdevkit.workspace.mode';
export const WORKSPACE_CONFIG_DIR = 'conflux-workspace';
export const STATE_FILE_NAME = 'state.json';
export const COMMANDS = new Set(['start', 'stop', 'rm', 'purge', 'status', 'list', 'rebuild', 'alias', 'doctor', 'create', 'clean']);
export const ALIAS_ACTIONS = new Set(['set', 'add', 'rm', 'remove', 'delete', 'list', 'ls']);

// ── Primitive type aliases ─────────────────────────────────────────────────

export type Runtime = 'docker' | 'podman';
export type Command = 'start' | 'stop' | 'rm' | 'purge' | 'status' | 'list' | 'rebuild' | 'alias' | 'doctor' | 'create' | 'clean';
export type AliasAction = 'set' | 'rm' | 'list';

// ── CLI option bag ─────────────────────────────────────────────────────────

export interface Options {
  command: Command;
  projectPath: string | null;
  projectPathSpecified: boolean;
  profileSlug: string | null;
  name: string;
  runtime: Runtime | null;
  socket: string | null;
  image: string;
  imageSpecified: boolean;
  localImage: boolean;
  verbose: boolean;
  aliasAction: AliasAction | null;
  aliasName: string | null;
}

// ── Workspace target ───────────────────────────────────────────────────────

export interface WorkspaceTarget {
  mounted: boolean;
  resolvedPath: string | null;
  profileKey: string;
  profileSlug: string;
  display: string;
  containerName: string;
  volumeName: string;
}

// ── Persisted state ────────────────────────────────────────────────────────

export interface StoredProfile {
  profileKey: string;
  profileSlug: string;
  display: string;
  mounted: boolean;
  containerName: string;
  volumeName: string;
  updatedAt: string;
}

export interface LauncherState {
  version: number;
  aliases: Record<string, string>;
  profiles: Record<string, StoredProfile>;
}

// ── Profile summary (runtime view) ────────────────────────────────────────

export interface ProfileSummary {
  profileSlug: string;
  display: string;
  mounted: boolean;
  containerName: string;
  volumeName: string;
  containerStatus: string;
  image: string;
  volumePresent: boolean;
  aliases: string[];
}
