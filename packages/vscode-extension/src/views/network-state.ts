/**
 * views/network-state.ts
 *
 * Shared singleton that tracks which Conflux network is currently selected
 * (local dev node / testnet / mainnet) and fires change events so that the
 * status bar, node control view, and accounts view all stay in sync.
 */

import * as vscode from 'vscode';

export type NetworkSelection = 'local' | 'testnet' | 'mainnet';

export interface NetworkConfig {
  /** Core Space chain ID */
  coreChainId: number;
  /** eSpace (EVM) chain ID */
  espaceChainId: number;
  /** CIP-37 address prefix */
  prefix: string;
  /** Human-readable label */
  label: string;
  /** Default Core Space RPC URL */
  coreRpc: string;
  /** Default eSpace RPC URL */
  espaceRpc: string;
}

export const NETWORK_CONFIGS: Record<NetworkSelection, NetworkConfig> = {
  local: {
    coreChainId:   2029,
    espaceChainId: 2030,
    prefix:        'net2029',
    label:         'Local (dev)',
    coreRpc:       'http://127.0.0.1:12537',
    espaceRpc:     'http://127.0.0.1:8545',
  },
  testnet: {
    coreChainId:   1,
    espaceChainId: 71,
    prefix:        'cfxtest',
    label:         'Testnet',
    coreRpc:       'https://test.confluxrpc.com',
    espaceRpc:     'https://evmtestnet.confluxrpc.com',
  },
  mainnet: {
    coreChainId:   1029,
    espaceChainId: 1030,
    prefix:        'cfx',
    label:         'Mainnet',
    coreRpc:       'https://main.confluxrpc.com',
    espaceRpc:     'https://evm.confluxrpc.com',
  },
};

class NetworkStateManager {
  private _selected: NetworkSelection = 'local';
  private _onDidChange = new vscode.EventEmitter<NetworkSelection>();
  readonly onDidChange = this._onDidChange.event;

  get selected(): NetworkSelection {
    return this._selected;
  }

  get config(): NetworkConfig {
    return NETWORK_CONFIGS[this._selected];
  }

  select(network: NetworkSelection): void {
    if (this._selected === network) return;
    this._selected = network;
    this._onDidChange.fire(network);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/** Module-level singleton — import and use directly */
export const networkState = new NetworkStateManager();
