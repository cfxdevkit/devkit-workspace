/**
 * contracts.ts — contract registry via the conflux-devkit REST API
 *
 * All contract state is owned by the conflux-devkit server and persisted under
 * ~/.conflux-devkit/wallets/<id>/data/contracts.json which survives node
 * restarts but is wiped on conflux_node_wipe*.
 *
 * No local JSON files are written. All reads/writes go through the devkit API:
 *   GET  /api/contracts/deployed      → list
 *   POST /api/contracts/register      → register externally-deployed contract
 */

export interface TrackedContract {
  id: string;
  name: string;
  address: string;
  chain: 'evm' | 'core';
  deployer: string;
  txHash?: string;
  constructorArgs?: unknown[];
  deployedAt: string;
  chainId: number;
  abi?: unknown[];
  metadata?: Record<string, unknown>;
}

const DEVKIT_URL = process.env.DEVKIT_URL ?? 'http://localhost:7748';

async function devkitFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${DEVKIT_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`devkit ${path} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export async function readContracts(chain?: 'evm' | 'core'): Promise<TrackedContract[]> {
  const q = chain ? `?chain=${chain}` : '';
  return devkitFetch<TrackedContract[]>(`/api/contracts/deployed${q}`).catch(() => []);
}

export async function saveContract(
  contract: Omit<TrackedContract, 'id'> & { id?: string; abi?: unknown[] | string }
): Promise<TrackedContract> {
  // Normalize abi: if it was pre-stringified with JSON.stringify, parse it back to array
  // so the devkit stores it as a proper array (enabling ABI interaction in the extension).
  const abi: unknown[] | undefined = typeof contract.abi === 'string'
    ? (() => { try { return JSON.parse(contract.abi as string) as unknown[]; } catch { return undefined; } })()
    : contract.abi;
  return devkitFetch<TrackedContract>('/api/contracts/register', {
    method: 'POST',
    body: JSON.stringify({ ...contract, abi }),
  });
}

export async function findContract(nameOrAddress: string): Promise<TrackedContract | null> {
  const contracts = await readContracts();
  const lower = nameOrAddress.toLowerCase();
  return (
    contracts.find(c => c.address.toLowerCase() === lower) ??
    contracts.find(c => c.name.toLowerCase() === lower) ??
    null
  );
}

export function formatContractList(contracts: TrackedContract[]): string {
  if (contracts.length === 0) return 'No contracts tracked yet.';
  return contracts
    .map(c =>
      [
        `${c.name} (${c.chain === 'evm' ? 'eSpace' : 'Core Space'})`,
        `  Address:  ${c.address}`,
        `  Deployer: ${c.deployer}`,
        `  Deployed: ${new Date(c.deployedAt).toLocaleString()}`,
        c.txHash ? `  Tx:       ${c.txHash}` : '',
        c.abi ? `  ABI:      ✓ stored` : '  ABI:      not stored',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
}

