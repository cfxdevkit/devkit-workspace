import { orchestrateDeploy } from '../deploy-helpers.js';
import type { NodeManager } from '../node-manager.js';

type DeployableEntry = {
  name: string;
  category: string;
  description: string;
  chains: ('evm' | 'core')[];
  constructorArgs: unknown[];
  abi: readonly unknown[];
  bytecode?: string;
};

type PrecompileEntry = {
  name: string;
  category: string;
  description: string;
  chains: ('evm' | 'core')[];
  address: string;
  abi: readonly unknown[];
};

export class BootstrapApplicationService {
  constructor(private readonly nodeManager: NodeManager) {}

  listCatalog(
    catalog: Record<string, DeployableEntry>,
    precompiles: Record<string, PrecompileEntry>
  ): Array<Record<string, unknown>> {
    const deployable = Object.values(catalog).map(
      ({ name, category, description, chains, constructorArgs }) => ({
        type: 'deployable',
        name,
        category,
        description,
        chains,
        constructorArgs,
      })
    );

    const fixed = Object.values(precompiles).map(
      ({ name, category, description, chains, address }) => ({
        type: 'precompile',
        name,
        category,
        description,
        chains,
        address,
      })
    );

    return [...deployable, ...fixed];
  }

  getCatalogEntry(
    name: string,
    catalog: Record<string, DeployableEntry>,
    precompiles: Record<string, PrecompileEntry>
  ): Record<string, unknown> | null {
    const entry = catalog[name];
    if (entry) return { type: 'deployable', ...entry };

    const precompile = precompiles[name];
    if (precompile) return { type: 'precompile', ...precompile };

    return null;
  }

  async deployCatalogEntry(params: {
    name: string;
    args: unknown[];
    chain: 'evm' | 'core';
    accountIndex: number;
    catalog: Record<string, DeployableEntry>;
  }): Promise<unknown> {
    const entry = params.catalog[params.name];
    if (!entry) {
      throw new Error(`Catalog entry "${params.name}" not found or is a precompile`);
    }
    if (!entry.bytecode) {
      throw new Error(`Entry "${params.name}" has no bytecode — it is a precompile`);
    }
    if (!entry.chains.includes(params.chain)) {
      throw new Error(`"${params.name}" does not support chain "${params.chain}"`);
    }

    return orchestrateDeploy({
      bytecode: entry.bytecode,
      abi: entry.abi as unknown[],
      args: params.args,
      chain: params.chain,
      accountIndex: params.accountIndex,
      contractName: params.name,
      nodeManager: this.nodeManager,
    });
  }
}

export function mapBootstrapDeployErrorStatus(msg: string): number {
  if (msg.includes('not found') || msg.includes('does not support') || msg.includes('no bytecode')) {
    return 400;
  }
  if (msg.includes('Account index')) return 400;
  if (msg.includes('Node') || msg.includes('node')) return 503;
  return 500;
}
