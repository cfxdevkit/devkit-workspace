/**
 * commands/alias.ts — manage workspace aliases (set / rm / list).
 */

import { fail, renderTable } from '../util.js';
import { loadState, saveState } from '../state/loader.js';
import { normalizeAliasName } from '../state/aliases.js';
import { registerProfile, resolveWorkspaceTarget } from '../state/profile.js';
import type { Options } from '../types.js';

export function handleAliasCommand(opts: Options): number {
  const state = loadState();

  switch (opts.aliasAction) {
    case 'list': {
      const aliases = Object.entries(state.aliases).sort(([left], [right]) => left.localeCompare(right));
      if (aliases.length === 0) {
        console.log('No aliases configured.');
        return 0;
      }

      const rows = aliases.map(([aliasName, profileKey]) => {
        const stored = state.profiles[profileKey];
        const workspace =
          profileKey === 'builtin' ? 'built-in project-example' : (stored?.display ?? profileKey);
        const profileSlug = stored?.profileSlug ?? (profileKey === 'builtin' ? 'builtin' : '(unknown)');
        return [`@${aliasName}`, profileSlug, workspace];
      });

      console.log(renderTable(['ALIAS', 'PROFILE', 'WORKSPACE'], rows));
      return 0;
    }
    case 'set': {
      if (!opts.aliasName) fail('Missing alias name for alias set');

      const aliasName = normalizeAliasName(opts.aliasName);
      const target = resolveWorkspaceTarget({ ...opts, command: 'start' }, state);
      state.aliases[aliasName] = target.profileKey;
      registerProfile(state, target);
      saveState(state);
      console.log(`Saved @${aliasName} -> ${target.display}`);
      return 0;
    }
    case 'rm': {
      if (!opts.aliasName) fail('Missing alias name for alias rm');

      const aliasName = normalizeAliasName(opts.aliasName);
      if (!state.aliases[aliasName]) fail(`Alias not found: @${aliasName}`);

      delete state.aliases[aliasName];
      saveState(state);
      console.log(`Removed @${aliasName}`);
      return 0;
    }
    default:
      fail('Missing alias action');
  }
}
