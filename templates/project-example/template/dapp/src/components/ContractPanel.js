import { exampleCounterArtifact } from '../../../contracts/generated/example-counter.js';
import { CONTRACT_ADDRESSES_BY_CHAIN_ID } from '../generated/contracts-addresses.js';
import { PROJECT_DEFAULT_CHAIN_ID } from '../generated/project-network.js';

export function renderContractPanel() {
  const currentAddress = CONTRACT_ADDRESSES_BY_CHAIN_ID[PROJECT_DEFAULT_CHAIN_ID]?.ExampleCounter ?? 'not deployed';

  return `
    <article class="card">
      <h2>Contract Artifact</h2>
      <div class="row"><span>Contract</span><strong>${exampleCounterArtifact.contractName}</strong></div>
      <div class="row"><span>Chain ID</span><strong>${exampleCounterArtifact.chainId}</strong></div>
      <div class="row"><span>ABI entries</span><strong>${exampleCounterArtifact.abi.length}</strong></div>
      <div class="row"><span>Tracked address</span><strong>${currentAddress}</strong></div>
    </article>
  `;
}
