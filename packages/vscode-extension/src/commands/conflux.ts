/**
 * commands/conflux.ts
 *
 * Registers all cfxdevkit.* VSCode commands for Conflux node management,
 * keystore lifecycle, and contract deployment.
 *
 * LIFECYCLE ORDER:
 *   serverStart → (auto-check keystore) → initializeSetup → nodeStart → deploy
 */

import * as vscode from 'vscode';
import {
  setCurrentNetwork,
} from '../conflux/api';
import { checkKeystoreAndPrompt, requireServerOnline } from './conflux-prereqs';
import { registerGeneralConfluxCommands } from './conflux-general-commands';
import { registerDeployCommands } from './conflux-deploy-commands';
import { registerImportCommands } from './conflux-import-commands';
import { registerKeystoreLifecycleCommands } from './conflux-keystore-commands';
import { registerNodeLifecycleCommands } from './conflux-node-commands';
import { registerContractCommands } from './conflux-contract-commands';
import { NETWORK_CONFIGS, networkState } from '../views/network-state';

// Providers injected from extension.ts so commands can refresh tree views
export interface ConfluxProviders {
  accounts: { load(): Promise<void>; clear(): void };
  contracts: { load(): Promise<void>; clear(): void };
}

export function registerConfluxCommands(
  context: vscode.ExtensionContext,
  providers?: ConfluxProviders
): void {
  registerGeneralConfluxCommands({
    context,
    providers,
    requireServerOnline,
    checkKeystoreAndPrompt,
  });

  registerKeystoreLifecycleCommands({
    context,
    requireServerOnline,
  });

  registerNodeLifecycleCommands({
    context,
    providers,
    requireServerOnline,
  });

  registerDeployCommands({
    context,
    providers,
    requireServerOnline,
    ensureBackendNetworkMode,
  });

  async function ensureBackendNetworkMode(): Promise<boolean> {
    try {
      if (networkState.selected === 'local') {
        await setCurrentNetwork({ mode: 'local' });
      } else {
        const cfg = NETWORK_CONFIGS[networkState.selected];
        await setCurrentNetwork({
          mode: 'public',
          public: {
            coreRpcUrl: cfg.coreRpc,
            evmRpcUrl: cfg.espaceRpc,
            chainId: cfg.coreChainId,
            evmChainId: cfg.espaceChainId,
          },
        });
      }
      return true;
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to sync backend network mode: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }

  registerImportCommands({
    context,
    providers,
    requireServerOnline,
  });

  registerContractCommands({
    context,
    providers,
    requireServerOnline,
    ensureBackendNetworkMode,
  });
}
