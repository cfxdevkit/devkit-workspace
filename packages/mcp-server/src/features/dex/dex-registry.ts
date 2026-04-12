import { _init_code_hash } from '@cfxdevkit/dex-contracts';
import type { TranslationTable } from '@cfxdevkit/shared';
import { readContracts, type TrackedContract } from '../../contracts.js';
import type { V2Manifest } from './dex-types.js';

function trackedTimestamp(contract: Pick<TrackedContract, 'deployedAt'>): number {
  const value = Date.parse(contract.deployedAt);
  return Number.isFinite(value) ? value : 0;
}

function findLatestTrackedContract(
  contracts: TrackedContract[],
  predicate: (contract: TrackedContract) => boolean,
): TrackedContract | null {
  let latest: TrackedContract | null = null;
  for (const contract of contracts) {
    if (!predicate(contract)) continue;
    if (!latest || trackedTimestamp(contract) >= trackedTimestamp(latest)) {
      latest = contract;
    }
  }
  return latest;
}

export async function readTrackedDexContracts(chainId: number): Promise<TrackedContract[]> {
  const contracts = await readContracts('evm');
  return contracts.filter((contract) => contract.chainId === chainId);
}

export function findTrackedContractByName(contracts: TrackedContract[], name: string): TrackedContract | null {
  return findLatestTrackedContract(contracts, (contract) => contract.name === name);
}

export function findTrackedContractByRealAddress(contracts: TrackedContract[], realAddress: string): TrackedContract | null {
  const normalized = realAddress.toLowerCase();
  return findLatestTrackedContract(contracts, (contract) => {
    const metadata = contract.metadata ?? {};
    return typeof metadata.realAddress === 'string' && metadata.realAddress.toLowerCase() === normalized;
  });
}

export function buildManifestFromTrackedContracts(
  contracts: TrackedContract[],
  rpcUrl: string,
  chainId: number,
  registrySuffix: string,
): V2Manifest | null {
  const factory = findTrackedContractByName(contracts, `UniswapV2Factory${registrySuffix}`);
  const weth9 = findTrackedContractByName(contracts, `WETH9${registrySuffix}`);
  const router = findTrackedContractByName(contracts, `UniswapV2Router02${registrySuffix}`);
  if (!factory || !weth9 || !router) return null;

  return {
    deployedAt: factory.deployedAt,
    chainId,
    rpcUrl,
    deployer: factory.deployer,
    contracts: {
      factory: factory.address,
      weth9: weth9.address,
      router02: router.address,
    },
    initCodeHash:
      typeof factory.metadata?.initCodeHash === 'string'
        ? factory.metadata.initCodeHash
        : _init_code_hash.computed,
  };
}

export function buildTranslationTableFromTrackedContracts(
  contracts: TrackedContract[],
  localWETH: string,
  chainId: number,
  registrySuffix: string,
): TranslationTable | null {
  const entries = contracts
    .filter((contract) => typeof contract.metadata?.realAddress === 'string')
    .map((contract) => {
      const metadata = contract.metadata ?? {};
      return {
        realAddress: String(metadata.realAddress).toLowerCase(),
        localAddress: contract.address.toLowerCase(),
        symbol: typeof metadata.symbol === 'string' ? metadata.symbol : contract.name.replace(registrySuffix, ''),
        decimals: typeof metadata.decimals === 'number' ? metadata.decimals : 18,
        iconCached: false,
        mirroredAt: trackedTimestamp(contract),
      };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));

  if (!entries.length) return null;

  return {
    chainId,
    localWETH: localWETH.toLowerCase(),
    updatedAt: Date.now(),
    entries,
  };
}
