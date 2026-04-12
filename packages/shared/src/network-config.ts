/**
 * network-config.ts
 *
 * Network configuration registry for Conflux eSpace.
 * Maps chainId → verified contract addresses for Swappi V2, WCFX, and stablecoins.
 *
 * Local devnet addresses come from v2-manifest.json (written by dex_deploy).
 * Never hardcode local addresses here — they change on every node wipe.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SwappiConfig {
  factory:  string;
  router:   string;
  wcfx:     string;
}

export interface TokenConfig {
  address:  string;
  symbol:   string;
  name:     string;
  decimals: number;
}

export interface DexNetworkConfig {
  chainId:    number;
  name:       string;
  rpcUrl:     string;
  wsUrl?:     string;
  gecko?:     string;   // GeckoTerminal chain slug
  swappi:     SwappiConfig;
  tokens:     Record<string, TokenConfig>;  // symbol → TokenConfig
}

export type NetworkName = 'local' | 'testnet' | 'mainnet';

// ── Network definitions ───────────────────────────────────────────────────────

/**
 * Conflux eSpace mainnet (chainId 1030).
 * All addresses verified on-chain via ConfluxScan + GeckoTerminal pool data.
 */
const MAINNET: DexNetworkConfig = {
  chainId: 1030,
  name:    'Conflux eSpace Mainnet',
  rpcUrl:  'https://evm.confluxrpc.com',
  wsUrl:   'wss://evm.confluxrpc.com/ws',
  gecko:   'cfx',
  swappi: {
    // Router02 — confirmed deployed, only one with bytecode at this address
    router:  '0xE37B52296b0bAA91412cD0Cd97975B0805037B84',
    // Factory — confirmed from router.factory() on-chain call
    // (0x20b45b8a... candidate had no code)
    factory: '0xe2a6f7c0ce4d5d300f97aa7e125455f5cd3342f5',
    // WCFX — confirmed as quote token on all Swappi pools (GeckoTerminal)
    wcfx:    '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b',
  },
  tokens: {
    WCFX: {
      address:  '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b',
      symbol:   'WCFX',
      name:     'Wrapped CFX',
      decimals: 18,
    },
    USDT0: {
      // Confirmed from GeckoTerminal USDT0/WCFX pool (created 2025-12-15)
      address:  '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',
      symbol:   'USDT0',
      name:     'USDT0',
      decimals: 6,
    },
    AxCNH: {
      // Confirmed from GeckoTerminal AxCNH/WCFX + AxCNH/USDT0 pools (created 2025-10 / 2025-11)
      address:  '0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e',
      symbol:   'AxCNH',
      name:     'AxCNH',
      decimals: 6,
    },
    USDT: {
      address:  '0xfe97e85d13abd9c1c33384e796f10b73905637ce',
      symbol:   'USDT',
      name:     'Tether USD',
      decimals: 18,
    },
    USDC: {
      address:  '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372',
      symbol:   'USDC',
      name:     'USD Coin',
      decimals: 18,
    },
    ETH: {
      address:  '0xa47f43de2f9623acb395ca4905746496d2014d57',
      symbol:   'ETH',
      name:     'Ethereum',
      decimals: 18,
    },
    WBTC: {
      address:  '0x1f545487c62e5acfea45dcadd9c627361d1616d8',
      symbol:   'WBTC',
      name:     'Wrapped BTC',
      decimals: 8,
    },
  },
};

/**
 * Conflux eSpace testnet (chainId 71).
 * Swappi factory confirmed with 198 pairs deployed.
 * USDT0 / AxCNH not deployed on testnet as of March 2026.
 */
const TESTNET: DexNetworkConfig = {
  chainId: 71,
  name:    'Conflux eSpace Testnet',
  rpcUrl:  'https://evmtestnet.confluxrpc.com',
  wsUrl:   'wss://evmtestnet.confluxrpc.com/ws',
  gecko:   undefined,  // testnet not indexed by GeckoTerminal
  swappi: {
    router:  '0x873789aaF553FD0B4252d0D2b72C6331c47aff2E',
    factory: '0x36B83E0D41D1dd9C73a006F0c1cbC1F096E69E34',
    wcfx:    '',  // TODO: look up testnet WCFX from router.WETH() call
  },
  tokens: {
    // Only WCFX confirmed for testnet; other tokens TBD
    WCFX: {
      address:  '',  // TODO: resolve from router.WETH()
      symbol:   'WCFX',
      name:     'Wrapped CFX',
      decimals: 18,
    },
  },
};

/**
 * Local devnet (chainId 2030).
 * Addresses come from v2-manifest.json — never hardcoded here.
 * Use getLocalConfig() to build this dynamically.
 */
const LOCAL_TEMPLATE: DexNetworkConfig = {
  chainId: 2030,
  name:    'Local Devnet (conflux-devkit)',
  rpcUrl:  'http://localhost:8545',
  wsUrl:   'ws://localhost:8546',
  gecko:   undefined,
  swappi: {
    factory:  '',  // filled from v2-manifest.json
    router:   '',  // filled from v2-manifest.json
    wcfx:     '',  // weth9 address from v2-manifest.json
  },
  tokens: {},
};

// ── Registry ──────────────────────────────────────────────────────────────────

const REGISTRY: Record<number, DexNetworkConfig> = {
  1030: MAINNET,
  71:   TESTNET,
  2030: LOCAL_TEMPLATE,
};

/**
 * Get network config by chainId. Throws if unknown.
 */
export function getDexNetworkConfig(chainId: number): DexNetworkConfig {
  const cfg = REGISTRY[chainId];
  if (!cfg) throw new Error(`Unknown chainId: ${chainId}. Supported: ${Object.keys(REGISTRY).join(', ')}`);
  return cfg;
}

/**
 * Get network config by name.
 */
export function getNetworkByName(name: NetworkName): DexNetworkConfig {
  switch (name) {
    case 'local':   return LOCAL_TEMPLATE;
    case 'testnet': return TESTNET;
    case 'mainnet': return MAINNET;
  }
}

/**
 * Build a local config from a deployed v2-manifest.json.
 * Call this instead of getNetworkConfig(2030) when you have a manifest.
 */
export interface V2ManifestContracts {
  factory:  string;
  weth9:    string;
  router02: string;
}

export function buildLocalConfig(manifest: { chainId: number; rpcUrl: string; contracts: V2ManifestContracts }): DexNetworkConfig {
  return {
    ...LOCAL_TEMPLATE,
    chainId: manifest.chainId,
    rpcUrl:  manifest.rpcUrl,
    swappi: {
      factory: manifest.contracts.factory,
      router:  manifest.contracts.router02,
      wcfx:    manifest.contracts.weth9,
    },
  };
}

/**
 * GeckoTerminal chain slug → chainId mapping.
 * Extend as needed for multi-chain support.
 */
export const GECKO_SLUG_TO_CHAIN_ID: Record<string, number> = {
  cfx:           1030,
  eth:           1,
  bsc:           56,
  polygon_pos:   137,
  arbitrum:      42161,
  optimism:      10,
  base:          8453,
  avax:          43114,
  ftm:           250,
  'polygon-zkevm': 1101,
  core:          1116,
};

export function chainIdToGeckoSlug(chainId: number): string | undefined {
  for (const [slug, id] of Object.entries(GECKO_SLUG_TO_CHAIN_ID)) {
    if (id === chainId) return slug;
  }
  return undefined;
}

/**
 * Native wrapped-CFX addresses to exclude from mirror token selection.
 * These are the ETH-equivalent on each Conflux network — they cannot be
 * "mirrored" because they ARE the local chain's ETH (WETH9 in addLiquidityETH).
 */
export const NATIVE_TOKEN_ADDRESSES = new Set([
  '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b',  // WCFX mainnet (chainId 1030)
]);

export function isNativeToken(address: string): boolean {
  return NATIVE_TOKEN_ADDRESSES.has(address.toLowerCase());
}

/**
 * Stablecoin addresses to exclude from simulation token selection.
 * These are tracked as quote tokens / special tokens, not simulation targets.
 */
export const STABLECOIN_ADDRESSES = new Set([
  // Mainnet (chainId 1030)
  '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',  // USDT0
  '0xfe97e85d13abd9c1c33384e796f10b73905637ce',  // USDT
  '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372',  // USDC
  // Ethereum mainnet
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',  // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7',  // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f',  // DAI
]);

export function isStablecoin(address: string): boolean {
  return STABLECOIN_ADDRESSES.has(address.toLowerCase());
}
