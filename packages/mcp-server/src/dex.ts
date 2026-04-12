/**
 * Compatibility shim.
 *
 * DEX source of truth moved to src/features/dex/dex.ts.
 * Keep this re-export module so existing integrations that import
 * @cfxdevkit/mcp/dist/dex.js continue working.
 */

export {
  dexToolDefinitions,
  dexToolHandler,
  wipeLocalDexState,
  deployV2Stack,
  verifyDeployment,
} from './features/dex/dex.js';

export type {
  StableEntry,
  V2Manifest,
} from './features/dex/dex.js';
