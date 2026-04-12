/**
 * state/aliases.ts — alias name normalization and display helpers.
 */

import { fail } from '../util.js';

export function normalizeAliasName(aliasName: string): string {
  const normalized = aliasName.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    fail(`Invalid alias name: ${aliasName}`);
  }
  return normalized;
}
