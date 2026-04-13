/**
 * process.ts
 *
 * Manages the conflux-devkit server process as a durable background service.
 * Prefers the globally-installed `conflux-devkit` binary (baked into the
 * devcontainer image) and falls back to `npx conflux-devkit` if not found.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { isServerOnline } from './api';
import {
  isManagedProcessRunning,
  openManagedProcessLogs,
  startManagedProcess,
  stopManagedProcess,
} from '../utils/persistent-process';

const OUTPUT_CHANNEL_NAME = 'Conflux DevKit Server';
const SERVER_PROCESS_ID = 'conflux-devkit-server';
const CONTAINER_BACKEND_LOG = '/home/node/.conflux-devkit/backend.log';

let outputChannel: vscode.OutputChannel | null = null;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }
  return outputChannel;
}

function getConfig(): { port: number } {
  const cfg = vscode.workspace.getConfiguration('cfxdevkit');
  return { port: cfg.get<number>('port') ?? 7748 };
}

/**
 * Resolve the vendored backend CLI to use.
 * Preference order:
 *   1) explicit env override (CFXDEVKIT_LOCAL_BACKEND_CLI)
 *   2) vendored workspace backend package (dev workflow)
 *   3) devkit-backend system binary (installed globally in the container image)
 *
 * No fallback to `conflux-devkit` or npx: that binary opens a browser UI, not
 * a headless server. The container image always provides either the dev package
 * or the global `devkit-backend` binary at /usr/local/bin/devkit-backend.
 */
function resolveCommand(): { cmd: string; args: string[] } {
  const envCli = process.env.CFXDEVKIT_LOCAL_BACKEND_CLI;
  if (envCli && existsSync(envCli)) {
    return { cmd: 'node', args: [envCli] };
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const localCli = join(
      workspaceRoot,
      'packages',
      'devkit-backend',
      'dist',
      'cli.js'
    );
    if (existsSync(localCli)) {
      return { cmd: 'node', args: [localCli] };
    }
  }

  // Global binary installed in the container image via npm install -g
  if (existsSync('/usr/local/bin/devkit-backend')) {
    return { cmd: 'devkit-backend', args: [] };
  }

  throw new Error(
    'devkit-backend not found. Expected the devkit-backend binary at ' +
    '/usr/local/bin/devkit-backend or CFXDEVKIT_LOCAL_BACKEND_CLI set.'
  );
}

/** Returns true if the server process is currently alive. */
export function isServerProcessRunning(): boolean {
  return isManagedProcessRunning(SERVER_PROCESS_ID);
}

/**
 * Start the conflux-devkit server process and wait for the HTTP API to respond.
 */
export async function startDevkitProcess(): Promise<void> {
  if (await isServerOnline()) {
    const channel = getOutputChannel();
    channel.appendLine('[conflux-devkit] Server is already healthy (container-managed or previously started).');
    return;
  }

  if (isServerProcessRunning()) {
    throw new Error('conflux-devkit server is already running.');
  }

  const { port } = getConfig();
  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine(`[conflux-devkit] Starting server on port ${port}…`);

  let resolved: { cmd: string; args: string[] };
  try {
    resolved = resolveCommand();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    channel.appendLine(`[conflux-devkit] ERROR: ${msg}`);
    throw err;
  }
  const { cmd, args } = resolved;
  channel.appendLine('[conflux-devkit] Using vendored backend package');

  const command = [cmd, ...args, '--no-open', '--host', '0.0.0.0', '--port', String(port)].join(' ');
  await startManagedProcess({
    id: SERVER_PROCESS_ID,
    label: OUTPUT_CHANNEL_NAME,
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    command,
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isServerOnline()) {
      channel.appendLine('[conflux-devkit] Server is responding.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  channel.appendLine('[conflux-devkit] Server did not respond before timeout. Check logs if startup failed.');
}

/** Kill the conflux-devkit server process. */
export async function stopDevkitProcess(): Promise<void> {
  if (isServerProcessRunning()) {
    const channel = getOutputChannel();
    channel.appendLine('[conflux-devkit] Stopping server…');
    await stopManagedProcess(SERVER_PROCESS_ID);
    channel.appendLine('[conflux-devkit] Server stopped.');
    return;
  }

  if (await isServerOnline()) {
    throw new Error('Conflux devkit backend is running as a container-managed service and cannot be stopped from the extension.');
  }

  throw new Error('conflux-devkit server is not running.');
}

export async function showDevkitProcessLogs(): Promise<void> {
  if (isManagedProcessRunning(SERVER_PROCESS_ID)) {
    await openManagedProcessLogs(SERVER_PROCESS_ID, OUTPUT_CHANNEL_NAME);
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `${OUTPUT_CHANNEL_NAME} Logs`,
    shellPath: '/bin/bash',
    shellArgs: ['-lc', `if [ -f '${CONTAINER_BACKEND_LOG}' ]; then tail -n 200 -f '${CONTAINER_BACKEND_LOG}'; else echo 'No backend log found at ${CONTAINER_BACKEND_LOG}'; fi`],
  });
  terminal.show(true);
}

/** Dispose transient resources on extension deactivate without killing the server. */
export function disposeConfluxProcess(): void {
  outputChannel?.dispose();
  outputChannel = null;
}
