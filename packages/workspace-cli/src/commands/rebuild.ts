/**
 * commands/rebuild.ts — purge then start fresh.
 */

import { purgeWorkspace } from './purge.js';
import { startWorkspace } from './start.js';
import type { Options, Runtime } from '../types.js';

export function rebuildWorkspace(runtime: Runtime, opts: Options, defaultImage: string): number {
  purgeWorkspace(runtime, opts);
  return startWorkspace(runtime, opts, defaultImage);
}
