/**
 * views/node-state.ts
 *
 * Shared singleton that tracks whether the local Conflux devkit server and
 * node are reachable. Updated on every poll cycle by statusbar-conflux.ts.
 *
 * Consumers (statusbar-dex.ts, statusbar.ts, views) subscribe via onDidChange
 * instead of polling independently, so UI reacts immediately when the node
 * starts or stops.
 *
 * Also drives VS Code context keys:
 *   cfxdevkit.serverOnline  — devkit REST server is reachable
 *   cfxdevkit.nodeRunning   — Conflux local node is in 'running' state
 *
 * These context keys are used by contributes.views `when` clauses to show /
 * hide sidebar sections only when they are meaningful.
 */

import * as vscode from 'vscode';

class NodeRunningState {
  private _serverOnline = false;
  private _nodeRunning  = false;

  private _emitter = new vscode.EventEmitter<{ serverOnline: boolean; nodeRunning: boolean }>();
  readonly onDidChange = this._emitter.event;

  get serverOnline(): boolean { return this._serverOnline; }
  get nodeRunning():  boolean { return this._nodeRunning; }

  /**
   * Called by statusbar-conflux.ts on every poll cycle.
   * Fires the change event and sets VS Code context keys only when the state
   * actually changes, to avoid unnecessary re-renders.
   */
  update(serverOnline: boolean, nodeRunning: boolean): void {
    const changed = serverOnline !== this._serverOnline || nodeRunning !== this._nodeRunning;
    this._serverOnline = serverOnline;
    this._nodeRunning  = nodeRunning;
    void vscode.commands.executeCommand('setContext', 'cfxdevkit.serverOnline', serverOnline);
    void vscode.commands.executeCommand('setContext', 'cfxdevkit.nodeRunning',  nodeRunning);
    if (changed) this._emitter.fire({ serverOnline, nodeRunning });
  }
}

export const nodeRunningState = new NodeRunningState();
