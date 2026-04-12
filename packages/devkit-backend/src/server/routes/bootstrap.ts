/**
 * Bootstrap routes
 *
 * Provides a curated catalog of production-ready contracts from the
 * @cfxdevkit/contracts library.  A developer can browse the catalog and
 * one-click deploy any entry; the deployed contract is then tracked in the
 * shared contract storage (same as contracts deployed from the Contracts tab).
 *
 * GET  /api/bootstrap/catalog            — list all catalog entries (no ABI/bytecode)
 * GET  /api/bootstrap/catalog/:name      — get full entry (ABI + bytecode + schema)
 * POST /api/bootstrap/deploy             — deploy a catalog contract
 *   body: { name, args, chain?, accountIndex? }
 *
 * Precompile entries (AdminControl, SponsorWhitelist, CrossSpaceCall) are also
 * included in the catalog but as type "precompile" — they have no bytecode and
 * are never deployed; the UI shows their fixed address and ABI for direct use.
 */

import {
  // Token contracts
  erc20BaseAbi,
  erc20BaseBytecode,
  erc721BaseAbi,
  erc721BaseBytecode,
  erc1155BaseAbi,
  erc1155BaseBytecode,
  merkleAirdropAbi,
  merkleAirdropBytecode,
  // Mocks
  mockPriceOracleAbi,
  mockPriceOracleBytecode,
  // Governance
  multiSigWalletAbi,
  multiSigWalletBytecode,
  // Utils
  paymentSplitterAbi,
  paymentSplitterBytecode,
  // DeFi contracts
  stakingRewardsAbi,
  stakingRewardsBytecode,
  vestingScheduleAbi,
  vestingScheduleBytecode,
  wrappedCfxAbi,
  wrappedCfxBytecode,
} from '@cfxdevkit/contracts';
import {
  adminControlAbi,
  adminControlAddress,
  crossSpaceCallAbi,
  crossSpaceCallAddress,
  sponsorWhitelistAbi,
  sponsorWhitelistAddress,
  stakingAbi,
  stakingAddress,
} from '@cfxdevkit/protocol';
import { Router } from 'express';
import { BootstrapApplicationService, mapBootstrapDeployErrorStatus } from '../application/bootstrap-service.js';
import type { NodeManager } from '../node-manager.js';

// ── Catalog definition ─────────────────────────────────────────────────────

export type ConstructorArgDef = {
  name: string;
  type: string;
  description: string;
  placeholder?: string;
};

export type CatalogEntry = {
  name: string;
  category: 'tokens' | 'defi' | 'governance' | 'utils' | 'mocks';
  description: string;
  /** Supports 'eSpace', 'Core Space', or both */
  chains: ('evm' | 'core')[];
  constructorArgs: ConstructorArgDef[];
  /** JSON-serialisable ABI array */
  // biome-ignore lint/suspicious/noExplicitAny: ABI is heterogeneous
  abi: readonly any[];
  /** 0x-prefixed hex bytecode; omitted for precompile entries */
  bytecode?: string;
};

const CATALOG: Record<string, CatalogEntry> = {
  // ── Tokens ────────────────────────────────────────────────────────────────
  ERC20Base: {
    name: 'ERC20Base',
    category: 'tokens',
    description:
      'Full-featured ERC-20 token: capped supply, burnable, pausable, ERC-2612 permit, and role-based minter/pauser.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'name_',
        type: 'string',
        description: 'Token name',
        placeholder: 'My Token',
      },
      {
        name: 'symbol_',
        type: 'string',
        description: 'Token symbol',
        placeholder: 'MTK',
      },
      {
        name: 'cap_',
        type: 'uint256',
        description: 'Maximum total supply (in wei)',
        placeholder: '1000000000000000000000000',
      },
      {
        name: 'admin',
        type: 'address',
        description: 'Initial admin address (receives DEFAULT_ADMIN_ROLE)',
        placeholder: '0x…',
      },
    ],
    abi: erc20BaseAbi,
    bytecode: erc20BaseBytecode,
  },

  ERC721Base: {
    name: 'ERC721Base',
    category: 'tokens',
    description:
      'Full-featured ERC-721 NFT: enumerable, URI storage, burnable, pausable, ERC-2981 royalties, and role-based minter/pauser.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'name_',
        type: 'string',
        description: 'Collection name',
        placeholder: 'My NFT',
      },
      {
        name: 'symbol_',
        type: 'string',
        description: 'Collection symbol',
        placeholder: 'MNFT',
      },
      {
        name: 'maxSupply_',
        type: 'uint256',
        description: 'Maximum number of tokens (0 = unlimited)',
        placeholder: '10000',
      },
      {
        name: 'royaltyReceiver',
        type: 'address',
        description: 'Address to receive secondary-sale royalties',
        placeholder: '0x…',
      },
      {
        name: 'royaltyFeeNumer',
        type: 'uint96',
        description: 'Royalty in basis points (e.g. 500 = 5%)',
        placeholder: '500',
      },
      {
        name: 'admin',
        type: 'address',
        description: 'Initial admin address',
        placeholder: '0x…',
      },
    ],
    abi: erc721BaseAbi,
    bytecode: erc721BaseBytecode,
  },

  ERC1155Base: {
    name: 'ERC1155Base',
    category: 'tokens',
    description:
      'Full-featured ERC-1155 multi-token: per-token supply caps, burnable, pausable, ERC-2981 royalties, and role-based access.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'name_',
        type: 'string',
        description: 'Collection name',
        placeholder: 'My Multi Token',
      },
      {
        name: 'symbol_',
        type: 'string',
        description: 'Collection symbol',
        placeholder: 'MMT',
      },
      {
        name: 'uri_',
        type: 'string',
        description: 'Base URI template ({id} will be substituted)',
        placeholder: 'https://example.com/api/{id}.json',
      },
      {
        name: 'admin',
        type: 'address',
        description: 'Initial admin address',
        placeholder: '0x…',
      },
    ],
    abi: erc1155BaseAbi,
    bytecode: erc1155BaseBytecode,
  },

  WrappedCFX: {
    name: 'WrappedCFX',
    category: 'tokens',
    description:
      'Canonical WCFX — WETH9-identical wrapper for native CFX. Immutable, no admin.',
    chains: ['evm'],
    constructorArgs: [],
    abi: wrappedCfxAbi,
    bytecode: wrappedCfxBytecode,
  },

  // ── DeFi ──────────────────────────────────────────────────────────────────
  StakingRewards: {
    name: 'StakingRewards',
    category: 'defi',
    description:
      'Synthetix-style single-sided staking. Users deposit a staking token and earn a separate reward token streamed over a configurable duration.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'stakingToken_',
        type: 'address',
        description: 'Token users stake (deposit)',
        placeholder: '0x…',
      },
      {
        name: 'rewardsToken_',
        type: 'address',
        description: 'Token distributed as reward',
        placeholder: '0x…',
      },
      {
        name: 'owner_',
        type: 'address',
        description:
          'Owner — can call notifyRewardAmount and emergencyWithdraw',
        placeholder: '0x…',
      },
    ],
    abi: stakingRewardsAbi,
    bytecode: stakingRewardsBytecode,
  },

  VestingSchedule: {
    name: 'VestingSchedule',
    category: 'defi',
    description:
      'Multi-beneficiary cliff + linear vesting. The owner can create, revoke, and top-up schedules; revoked tokens return to a treasury.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'token_',
        type: 'address',
        description: 'ERC-20 token being vested',
        placeholder: '0x…',
      },
      {
        name: 'treasury_',
        type: 'address',
        description: 'Address to receive revoked unvested tokens',
        placeholder: '0x…',
      },
      {
        name: 'owner_',
        type: 'address',
        description: 'Contract owner — can create and revoke schedules',
        placeholder: '0x…',
      },
    ],
    abi: vestingScheduleAbi,
    bytecode: vestingScheduleBytecode,
  },

  MerkleAirdrop: {
    name: 'MerkleAirdrop',
    category: 'defi',
    description:
      'Pull-based Merkle proof airdrop with bitmap claim tracking. Expired unclaimed tokens can be swept by the owner.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'token_',
        type: 'address',
        description: 'ERC-20 token to airdrop',
        placeholder: '0x…',
      },
      {
        name: 'merkleRoot_',
        type: 'bytes32',
        description: 'Root of the claim Merkle tree',
        placeholder: '0x0000…',
      },
      {
        name: 'expiresAt_',
        type: 'uint256',
        description:
          'Unix timestamp after which the contract expires (0 = no expiry)',
        placeholder: '0',
      },
      {
        name: 'owner_',
        type: 'address',
        description: 'Owner — can update root and sweep expired tokens',
        placeholder: '0x…',
      },
    ],
    abi: merkleAirdropAbi,
    bytecode: merkleAirdropBytecode,
  },

  // ── Governance ────────────────────────────────────────────────────────────
  MultiSigWallet: {
    name: 'MultiSigWallet',
    category: 'governance',
    description:
      'Enhanced M-of-N multi-signature wallet with transaction expiry, cancellation, and self-managed owner addition/removal.',
    chains: ['evm', 'core'],
    constructorArgs: [
      {
        name: 'owners_',
        type: 'address[]',
        description: 'Initial owner addresses (comma-separated)',
        placeholder: '0xabc…, 0xdef…',
      },
      {
        name: 'required_',
        type: 'uint256',
        description: 'Number of required confirmations',
        placeholder: '2',
      },
    ],
    abi: multiSigWalletAbi,
    bytecode: multiSigWalletBytecode,
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  PaymentSplitter: {
    name: 'PaymentSplitter',
    category: 'utils',
    description:
      'Immutable proportional revenue splitter. Supports both native CFX and arbitrary ERC-20 tokens via pull-based release.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'payees',
        type: 'address[]',
        description: 'Payee addresses (comma-separated)',
        placeholder: '0xabc…, 0xdef…',
      },
      {
        name: 'shares_',
        type: 'uint256[]',
        description:
          'Proportional share values (comma-separated, same order as payees)',
        placeholder: '50, 50',
      },
    ],
    abi: paymentSplitterAbi,
    bytecode: paymentSplitterBytecode,
  },

  // ── Mocks ─────────────────────────────────────────────────────────────────
  MockPriceOracle: {
    name: 'MockPriceOracle',
    category: 'mocks',
    description:
      'Chainlink AggregatorV3Interface mock. Set arbitrary price answers for testing oracle-dependent contracts.',
    chains: ['evm'],
    constructorArgs: [
      {
        name: 'description_',
        type: 'string',
        description: 'Oracle description (e.g. "CFX / USD")',
        placeholder: 'CFX / USD',
      },
      {
        name: 'decimals_',
        type: 'uint8',
        description: 'Answer decimals (Chainlink convention: 8 for USD pairs)',
        placeholder: '8',
      },
      {
        name: 'initialAnswer',
        type: 'int256',
        description: 'Initial price answer (scaled by 10^decimals)',
        placeholder: '100000000',
      },
    ],
    abi: mockPriceOracleAbi,
    bytecode: mockPriceOracleBytecode,
  },
};

// ── Precompile reference entries (no bytecode — already deployed) ──────────

type PrecompileEntry = {
  name: string;
  category: 'precompile';
  description: string;
  chains: ('evm' | 'core')[];
  address: string;
  // biome-ignore lint/suspicious/noExplicitAny: ABI is heterogeneous
  abi: readonly any[];
};

const PRECOMPILES: Record<string, PrecompileEntry> = {
  AdminControl: {
    name: 'AdminControl',
    category: 'precompile',
    description:
      'Conflux Core Space precompile: destroy contracts, set admin. Address 0x0888.',
    chains: ['core'],
    address: adminControlAddress,
    abi: adminControlAbi,
  },
  SponsorWhitelist: {
    name: 'SponsorWhitelist',
    category: 'precompile',
    description:
      'Conflux Core Space precompile: gas and storage sponsorship. Address 0x0888.',
    chains: ['core'],
    address: sponsorWhitelistAddress,
    abi: sponsorWhitelistAbi,
  },
  CrossSpaceCall: {
    name: 'CrossSpaceCall',
    category: 'precompile',
    description:
      'Conflux Core Space precompile: atomic cross-space calls between Core and eSpace. Address 0x0888.',
    chains: ['core'],
    address: crossSpaceCallAddress,
    abi: crossSpaceCallAbi,
  },
  Staking: {
    name: 'Staking',
    category: 'precompile',
    description:
      'Conflux Core Space precompile: native CFX staking and interest. Address 0x0888.',
    chains: ['core'],
    address: stakingAddress,
    abi: stakingAbi,
  },
};

// ── Route factory ──────────────────────────────────────────────────────────

/**
 * Bootstrap routes
 *
 * GET  /catalog                  — list of catalog entries (metadata only, no bytecode)
 * GET  /catalog/:name            — full entry (ABI + bytecode)
 * POST /deploy                   — deploy a catalog entry by name
 */
export function createBootstrapRoutes(nodeManager: NodeManager): Router {
  const router = Router();
  const bootstrapService = new BootstrapApplicationService(nodeManager);

  // GET /catalog
  router.get('/catalog', (_req, res) => {
    res.json(bootstrapService.listCatalog(CATALOG, PRECOMPILES));
  });

  // GET /catalog/:name
  router.get('/catalog/:name', (req, res) => {
    const { name } = req.params;
    const entry = bootstrapService.getCatalogEntry(name, CATALOG, PRECOMPILES);
    if (!entry) {
      res.status(404).json({ error: `Catalog entry "${name}" not found` });
      return;
    }
    res.json(entry);
  });

  // POST /deploy
  router.post('/deploy', async (req, res) => {
    const {
      name,
      args = [],
      chain = 'evm',
      accountIndex = 0,
    } = req.body as {
      name?: string;
      args?: unknown[];
      chain?: 'evm' | 'core';
      accountIndex?: number;
    };

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    try {
      const result = await bootstrapService.deployCatalogEntry({
        name,
        args: args as unknown[],
        chain,
        accountIndex,
        catalog: CATALOG,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = mapBootstrapDeployErrorStatus(msg);
      res.status(status).json({ error: `Deploy failed: ${msg}` });
    }
  });

  return router;
}
