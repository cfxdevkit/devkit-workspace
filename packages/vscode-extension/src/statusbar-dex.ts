/**
 * statusbar-dex.ts
 *
 * Status bar item for the standalone DEX UI (Uniswap V2 swap / LP / vault interface).
 * The DEX UI runs as a Node.js process (server.mjs) inside the devkit container.
 *
 * States:
 *   $(server-process) DEX UI: stopped  — server not running
 *   $(loading~spin)   DEX UI: starting — server starting up
 *   $(pulse)          DEX UI: running  — server responding to /health
 *
 * Auto-show: polls the DEX service's /api/dex/manifest — when a manifest is available
 * (written by dex_deploy via MCP), shows the status bar and offers to start if stopped.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { getDeployedContracts } from './conflux/api';
import {
  isManagedProcessRunning,
  openManagedProcessLogs,
  startManagedProcess,
  stopManagedProcess,
} from './utils/persistent-process';
import { nodeRunningState } from './views/node-state';

const POLL_INTERVAL_MS  = 15_000;
const DEX_PROCESS_ID    = 'dex-ui-server';

function getDexServerScript(): string {
  return vscode.workspace.getConfiguration('cfxdevkit').get<string>('dexServerScript')
    ?? '/opt/devkit/dex-ui/server.mjs';
}

function getDexUrl(): string {
  const port = vscode.workspace.getConfiguration('cfxdevkit').get<number>('dexUiPort') ?? 8888;
  return `http://127.0.0.1:${port}`;
}

function shouldAutoStartDexWhenDeployed(): boolean {
  return vscode.workspace.getConfiguration('cfxdevkit').get<boolean>('dexAutoStartWhenDeployed', true);
}

type DexUiState = 'stopped' | 'starting' | 'running';

/** Check if the DEX UI server is responding. */
async function getDexUiState(): Promise<DexUiState> {
  try {
    const r = await fetch(`${getDexUrl()}/health`, { signal: AbortSignal.timeout(3_000) });
    if (r.ok) return 'running';
  } catch { /* not running */ }
  return 'stopped';
}

/**
 * Check if DEX contracts have been deployed.
 * Tries the DEX UI manifest endpoint first; falls back to the devkit contract
 * registry so detection works even when the DEX UI server is not yet running.
 */
async function isDexDeployed(): Promise<boolean> {
  // 1. DEX UI manifest (fast path when UI is running)
  try {
    const r = await fetch(`${getDexUrl()}/api/dex/manifest`, { signal: AbortSignal.timeout(2_000) });
    if (r.ok) {
      const data = await r.json();
      if (data !== null && data !== undefined) return true;
    }
  } catch { /* DEX UI not running */ }

  // 2. Devkit contract registry (works even before DEX UI is started)
  try {
    const contracts = await getDeployedContracts();
    return contracts.some(c => c.name?.includes('UniswapV2Factory'));
  } catch { /* devkit not available */ }

  return false;
}

async function openDexUi(): Promise<void> {
  const uri = await vscode.env.asExternalUri(vscode.Uri.parse(`${getDexUrl()}/`));
  await vscode.env.openExternal(uri);
}

async function ensureDexDeployedOrKickoff(): Promise<boolean> {
  const deployed = await isDexDeployed();
  if (deployed) return true;

  const action = await vscode.window.showWarningMessage(
    'DEX contracts are not deployed yet. Run DEX deploy first?',
    'Deploy DEX',
    'Cancel'
  );
  if (action === 'Deploy DEX') {
    await vscode.commands.executeCommand('cfxdevkit.deployDex');
  }
  return false;
}

export function registerDexUiStatusBar(context: vscode.ExtensionContext): void {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8);
  bar.command  = 'cfxdevkit.dexUiClick';
  bar.tooltip  = 'DEX UI — Uniswap V2 swap/LP interface (click for actions)';
  bar.text     = '$(loading~spin) DEX UI';
  bar.hide();
  context.subscriptions.push(bar);

  let lastState: DexUiState = 'stopped';
  let starting = false;

  // ── Render ───────────────────────────────────────────────────────────────
  async function refresh(): Promise<void> {
    // Only show when local Conflux node is running
    if (!nodeRunningState.nodeRunning) {
      bar.hide();
      return;
    }

    if (starting) {
      bar.text = '$(loading~spin) DEX UI: starting';
      bar.show();
      return;
    }

    const state = await getDexUiState();
    const processRunning = isManagedProcessRunning(DEX_PROCESS_ID);
    const effectiveState: DexUiState = state === 'running' ? 'running' : (processRunning ? 'starting' : 'stopped');
    lastState = effectiveState;
    bar.show(); // always visible when node is running

    switch (effectiveState) {
      case 'stopped':
        bar.text    = '$(server-process) DEX UI: stopped';
        bar.tooltip = 'DEX UI stopped — click to start';
        bar.backgroundColor = undefined;
        // Auto-start once when DEX contracts are deployed
        if (shouldAutoStartDexWhenDeployed() && !hasShownPrompt) {
          const deployed = await isDexDeployed();
          if (deployed) {
            hasShownPrompt = true;
            vscode.commands.executeCommand('cfxdevkit.dexUiStart');
          }
        }
        break;
      case 'starting':
        bar.text = '$(loading~spin) DEX UI: starting';
        bar.tooltip = 'DEX UI process is starting — click for logs or stop.';
        bar.backgroundColor = undefined;
        break;
      case 'running':
        bar.text    = '$(pulse) DEX UI: running';
        bar.tooltip = `DEX UI running at ${getDexUrl()} — click to open or manage`;
        bar.backgroundColor = undefined;
        break;
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('cfxdevkit.dexUiStart', async () => {
      const deployed = await ensureDexDeployedOrKickoff();
      if (!deployed) {
        starting = false;
        await refresh();
        return;
      }

      starting = true;
      bar.text = '$(loading~spin) DEX UI: starting';
      bar.show();

      if (!isManagedProcessRunning(DEX_PROCESS_ID)) {
        await startManagedProcess({
          id: DEX_PROCESS_ID,
          label: 'DEX UI',
          cwd: path.dirname(getDexServerScript()),
          command: `node "${getDexServerScript()}"`,
        });
      }

      // Poll until running (up to 60s)
      const deadline = Date.now() + 60_000;
      const poll = setInterval(async () => {
        const s = await getDexUiState();
        if (s === 'running' || Date.now() > deadline) {
          starting = false;
          clearInterval(poll);
          await refresh();
          if (s === 'running') {
            const action = await vscode.window.showInformationMessage('DEX UI started!', 'Open in Browser');
            if (action) void openDexUi();
          }
        }
      }, 3_000);
      context.subscriptions.push({ dispose: () => clearInterval(poll) });
    }),

    vscode.commands.registerCommand('cfxdevkit.dexUiStop', async () => {
      starting = false;
      await stopManagedProcess(DEX_PROCESS_ID);
      setTimeout(() => void refresh(), 2_000);
    }),

    vscode.commands.registerCommand('cfxdevkit.dexUiRestart', async () => {
      starting = true;
      bar.text = '$(loading~spin) DEX UI: restarting';
      bar.show();

      await stopManagedProcess(DEX_PROCESS_ID);

      // Wait a beat, then start fresh
      await new Promise(r => setTimeout(r, 1_000));
      await startManagedProcess({
        id: DEX_PROCESS_ID,
        label: 'DEX UI',
        cwd: path.dirname(getDexServerScript()),
        command: `node "${getDexServerScript()}"`,
      });

      const deadline = Date.now() + 60_000;
      const poll = setInterval(async () => {
        const s = await getDexUiState();
        if (s === 'running' || Date.now() > deadline) {
          starting = false;
          clearInterval(poll);
          await refresh();
        }
      }, 3_000);
      context.subscriptions.push({ dispose: () => clearInterval(poll) });
    }),

    vscode.commands.registerCommand('cfxdevkit.dexUiClick', async () => {
      if (lastState === 'stopped') {
        const deployed = await isDexDeployed();
        if (!deployed) {
          const pick = await vscode.window.showQuickPick(
            [
              { label: '$(pulse) Deploy DEX stack', id: 'deploy' },
              { label: '$(refresh) Refresh status',  id: 'refresh' },
            ],
            { placeHolder: 'DEX contracts are missing. Deploy first to initialize DEX UI.' }
          );
          if (!pick) return;
          if (pick.id === 'deploy') {
            await vscode.commands.executeCommand('cfxdevkit.deployDex');
          }
          if (pick.id === 'refresh') {
            await refresh();
          }
          return;
        }

        vscode.commands.executeCommand('cfxdevkit.dexUiStart');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: `$(link-external) Open DEX UI (port ${vscode.workspace.getConfiguration('cfxdevkit').get<number>('dexUiPort') ?? 8888})`, id: 'open'    },
          { label: '$(output)        View logs',                    id: 'logs'    },
          { label: '$(refresh)       Restart',                      id: 'restart' },
          { label: '$(debug-stop)    Stop DEX UI',                  id: 'stop'    },
        ],
        { placeHolder: 'DEX UI — Uniswap V2 swap / LP interface' }
      );
      if (!pick) return;
      if (pick.id === 'open')    void openDexUi();
      if (pick.id === 'logs')    void openManagedProcessLogs(DEX_PROCESS_ID, 'DEX UI');
      if (pick.id === 'restart') vscode.commands.executeCommand('cfxdevkit.dexUiRestart');
      if (pick.id === 'stop')    vscode.commands.executeCommand('cfxdevkit.dexUiStop');
    }),
  );

  // ── Auto-show: react to node state changes and poll ───────────────────────
  let hasShownPrompt = false;

  // React immediately when the local Conflux node starts or stops
  context.subscriptions.push(
    nodeRunningState.onDidChange(() => void refresh())
  );

  void refresh();

  const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(
    vscode.commands.registerCommand('cfxdevkit.dexUiRefresh', () => void refresh())
  );
}
