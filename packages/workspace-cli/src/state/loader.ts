/**
 * state/loader.ts — state file persistence (load/save) and config dir resolution.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LauncherState } from '../types.js';
import { WORKSPACE_CONFIG_DIR, STATE_FILE_NAME } from '../types.js';

// ── Path helpers ───────────────────────────────────────────────────────────

export function getConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? process.cwd(), '.config');
  return join(base, WORKSPACE_CONFIG_DIR);
}

export function getStateFilePath(): string {
  return join(getConfigDir(), STATE_FILE_NAME);
}

// ── State IO ───────────────────────────────────────────────────────────────

export function loadState(): LauncherState {
  const stateFile = getStateFilePath();
  if (!existsSync(stateFile)) {
    return { version: 1, aliases: {}, profiles: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<LauncherState>;
    return {
      version: 1,
      aliases: parsed.aliases ?? {},
      profiles: parsed.profiles ?? {},
    };
  } catch {
    console.warn(`Warning: ignoring unreadable launcher state at ${stateFile}`);
    return { version: 1, aliases: {}, profiles: {} };
  }
}

export function saveState(state: LauncherState): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2));
}
