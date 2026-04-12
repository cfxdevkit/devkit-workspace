import * as vscode from 'vscode';
import { registerDevcontainerCommands } from './commands/devcontainer';
import { registerServiceCommands } from './commands/service';
import { registerStackCommands } from './commands/stack';
import { registerWorkspaceCommands } from './commands/workspace';
import { registerConfluxCommands } from './commands/conflux';
import { registerStatusBar } from './statusbar';
import { registerConfluxStatusBar } from './statusbar-conflux';
import { registerDexUiStatusBar } from './statusbar-dex';
import { disposeConfluxProcess } from './conflux/process';
import { initPersistentProcessManager } from './utils/persistent-process';
import { AccountsProvider } from './views/accounts';
import { ContractsProvider } from './views/contracts';
import { NodeControlProvider } from './views/node-control';
import { NetworkProvider } from './views/network';
import { DexPoolsProvider } from './views/dex';
import { networkState, NETWORK_CONFIGS, type NetworkSelection } from './views/network-state';
import { getCurrentNetwork, getNodeStatus, isServerOnline, setCurrentNetwork } from './conflux/api';
import { nodeRunningState } from './views/node-state';
import { resolveNetworkSelection } from './views/network-selection';

export function activate(context: vscode.ExtensionContext): void {
  initPersistentProcessManager(context);

  registerStackCommands(context);
  registerDevcontainerCommands(context);
  registerWorkspaceCommands(context);
  registerServiceCommands(context);

  // Conflux tree view providers
  const networkProvider = new NetworkProvider();
  const nodeControlProvider = new NodeControlProvider();
  const accountsProvider = new AccountsProvider();
  const contractsProvider = new ContractsProvider();
  const dexPoolsProvider = new DexPoolsProvider();

  context.subscriptions.push(
    vscode.window.createTreeView('cfxdevkit.networkView', {
      treeDataProvider: networkProvider,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView('cfxdevkit.nodeView', {
      treeDataProvider: nodeControlProvider,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView('cfxdevkit.accountsView', {
      treeDataProvider: accountsProvider,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView('cfxdevkit.contractsView', {
      treeDataProvider: contractsProvider,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView('cfxdevkit.dexView', {
      treeDataProvider: dexPoolsProvider,
      showCollapseAll: true,
    }),
    contractsProvider,  // disposes file watcher + polling on deactivate
    dexPoolsProvider,   // disposes file watcher + polling on deactivate
  );

  // Network selection command — invoked by tree items & status bar click on non-local networks
  context.subscriptions.push(
    vscode.commands.registerCommand('cfxdevkit.selectNetwork', async (networkId?: NetworkSelection) => {
      const id = networkId ?? await vscode.window.showQuickPick(
        [
          { label: '$(server-process) Local (dev)',  description: 'chainId 2029/2030', id: 'local' },
          { label: '$(globe) Testnet',               description: 'chainId 1/71',      id: 'testnet' },
          { label: '$(globe) Mainnet',               description: 'chainId 1029/1030', id: 'mainnet' },
        ],
        { placeHolder: 'Select Conflux network…' }
      ).then(pick => pick?.id as NetworkSelection | undefined);

      if (!id) return;

      const previous = networkState.selected;
      if (id === previous) return;

      if (id !== 'local') {
        let localNodeActive = nodeRunningState.nodeRunning;
        if (!localNodeActive && await isServerOnline()) {
          try {
            const nodeStatus = await getNodeStatus();
            localNodeActive =
              nodeStatus.server === 'running'
              || nodeStatus.server === 'starting'
              || nodeStatus.server === 'stopping';
          } catch {
            // Keep optimistic behavior when status check fails.
          }
        }

        if (localNodeActive) {
          void vscode.window.showWarningMessage(
            'Stop the local node before switching to testnet/mainnet.'
          );
          return;
        }
      }

      if (await isServerOnline()) {
        try {
          if (id === 'local') {
            await setCurrentNetwork({ mode: 'local' });
          } else {
            const cfg = NETWORK_CONFIGS[id];
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
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          void vscode.window.showWarningMessage(
            `Failed to sync devkit network mode: ${message}`
          );
          return;
        }
      }

      networkState.select(id);

      // Reload accounts to re-derive Core addresses for the new network
      await accountsProvider.load().catch(() => undefined);
    })
  );

  async function syncSelectedNetworkFromBackend(): Promise<void> {
    if (!await isServerOnline()) {
      return;
    }

    try {
      const current = await getCurrentNetwork();
      const resolved = resolveNetworkSelection(current);
      if (resolved && resolved !== networkState.selected) {
        networkState.select(resolved);
      }
    } catch {
      // Keep the current UI state when backend sync is temporarily unavailable.
    }
  }

  // Eagerly load initial data after reconciling extension state with backend network mode.
  void (async () => {
    await syncSelectedNetworkFromBackend();
    await accountsProvider.load().catch(() => undefined);
    await contractsProvider.load().catch(() => undefined);
    await dexPoolsProvider.load().catch(() => undefined);
  })();

  registerConfluxCommands(context, { accounts: accountsProvider, contracts: contractsProvider });
  registerStatusBar(context);
  registerConfluxStatusBar(context, nodeControlProvider);
  registerDexUiStatusBar(context);

  // Auto-start the conflux-devkit server if the user opts in.
  // Deferred slightly so all providers are fully registered first.
  const autoStart = vscode.workspace.getConfiguration('cfxdevkit').get<boolean>('autoStart', false);
  if (autoStart) {
    setTimeout(() => void vscode.commands.executeCommand('cfxdevkit.serverStart'), 500);
  }
}

export function deactivate(): void {
  disposeConfluxProcess();
}
