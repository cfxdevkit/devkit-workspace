export interface KnownPoolTokenDescriptor {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface KnownPoolEntry {
  address: string;
  label: string;
  baseToken: KnownPoolTokenDescriptor;
  quoteToken: KnownPoolTokenDescriptor;
  reserveUsd: number;
  volume24h: number;
  isWcfxPair: boolean;
}

export interface KnownTokenPoolRef {
  poolAddress: string;
  label: string;
  tokenSide: 'base' | 'quote';
  token: KnownPoolTokenDescriptor;
  counterparty: KnownPoolTokenDescriptor;
  reserveUsd: number;
  volume24h: number;
  tokenPriceUsd?: number | null;
  isWcfxPair: boolean;
}

export interface KnownTokenCatalogEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  bestPool?: KnownTokenPoolRef | null;
  wcfxPool?: KnownTokenPoolRef | null;
  candidatePools?: KnownTokenPoolRef[];
}

export interface KnownTokenCatalog {
  version?: number;
  chainId?: number;
  generatedAt?: string;
  pools?: KnownPoolEntry[];
  tokens?: KnownTokenCatalogEntry[];
}

export interface PoolImportPresetFile {
  version?: number;
  chainId?: number;
  updatedAt?: string;
  selectedPoolAddresses?: string[];
}

export interface StableEntry {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
}

export interface V2Manifest {
  deployedAt: string;
  chainId: number;
  rpcUrl: string;
  deployer: string;
  contracts: {
    factory: string;
    weth9: string;
    router02: string;
  };
  stables?: Record<string, StableEntry>;
  initCodeHash: string;
  wcfxPriceUsd?: number;
}
