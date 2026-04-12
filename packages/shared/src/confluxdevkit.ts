/**
 * confluxdevkit.ts
 *
 * Typed async HTTP client for the conflux-devkit REST API.
 *
 * ═══════════════════════════════════════════════════════════════
 * CONFLUX-DEVKIT LIFECYCLE (read this before calling any function)
 * ═══════════════════════════════════════════════════════════════
 *
 * The conflux-devkit is an Express server that manages a local Conflux
 * development node (both Core Space and eSpace). It must go through a
 * specific initialization sequence:
 *
 * STEP 1 — Start the server process
 *   Run: npx conflux-devkit --no-open --port 7748
 *   The HTTP server starts and listens, but the blockchain node is NOT yet
 *   running. Check with: isDevkitServerRunning()
 *
 * STEP 2 — Check keystore status (REQUIRED before starting the node)
 *   Call: getKeystoreStatus()
 *   Returns: { initialized: boolean, locked: boolean, encryptionEnabled: boolean }
 *
 *   If initialized === false → must complete first-time setup (STEP 3)
 *   If initialized === true && locked === true → must unlock (STEP 3b)
 *   If initialized === true && locked === false → skip to STEP 4
 *
 * STEP 3 — First-time keystore setup (only needed once per install)
 *   a) Generate a mnemonic: generateMnemonicWords()
 *   b) Save it! The mnemonic is the ONLY way to recover accounts.
 *   c) Initialize: setupKeystore(mnemonic, "Default")
 *   This stores the mnemonic encrypted in ~/.devkit.keystore.json
 *
 * STEP 3b — Unlock encrypted keystore (if encryptionEnabled && locked)
 *   Call: unlockKeystore(password)
 *
 * STEP 4 — Start the blockchain node
 *   Call: startNode()
 *   Starts @xcfx/node binary. Takes 5-15 seconds.
 *   Returns NodeStatus with rpcUrls: { core: ":12537", evm: ":8545" }
 *   10 genesis accounts are pre-funded with 1,000,000 CFX each.
 *
 * NORMAL OPERATION:
 *   - Mine blocks:    mine(blocks)
 *   - List accounts:  getAccounts()
 *   - Deploy contracts: deployContractTemplate() or deployBootstrapContract()
 *   - Check status:   getNodeStatus()
 *
 * TROUBLESHOOTING — Node failed to start / unexpected crash:
 *   Try 1 — Simple restart: restartNode()
 *   Try 2 — Wipe data + restart (resets blockchain state, keeps mnemonic):
 *            restartWipeNode()
 *            ⚠️  All deployed contracts and balances are reset.
 *            ✓  The mnemonic and accounts are preserved.
 *   Try 3 — Stop only + wipe (manual restart later): wipeNodeData()
 *
 * COMMON ERRORS AND SOLUTIONS:
 *   "Setup not completed. Configure a mnemonic first."
 *     → Call setupKeystore() first (see STEP 3)
 *   "Node is already running."
 *     → The node is up; no action needed
 *   "Node is not running. Start it first."
 *     → Call startNode()
 *   Port conflicts (EADDRINUSE on 12537 or 8545):
 *     → Call wipeNodeData() then startNode()
 *   Node starts but RPC is unresponsive:
 *     → Call restartWipeNode()
 *
 * ═══════════════════════════════════════════════════════════════
 * NETWORK DEFAULTS
 * ═══════════════════════════════════════════════════════════════
 *   Core Space: chainId=2029  RPC=http://127.0.0.1:12537  WS=ws://127.0.0.1:12535
 *   eSpace:     chainId=2030  RPC=http://127.0.0.1:8545   WS=ws://127.0.0.1:8546
 *
 * ═══════════════════════════════════════════════════════════════
 * FULL API ENDPOINT MAP
 * ═══════════════════════════════════════════════════════════════
 *   GET  /health                    isDevkitServerRunning()
 *   --- Keystore ---
 *   GET  /api/keystore/status       getKeystoreStatus()
 *   POST /api/keystore/generate     generateMnemonicWords()
 *   POST /api/keystore/setup        setupKeystore()
 *   POST /api/keystore/unlock       unlockKeystore()
 *   POST /api/keystore/lock         lockKeystore()
 *   GET  /api/keystore/wallets      getWallets()
 *   --- Node lifecycle ---
 *   GET  /api/node/status           getNodeStatus()
 *   POST /api/node/start            startNode()
 *   POST /api/node/stop             stopNode()
 *   POST /api/node/restart          restartNode()
 *   POST /api/node/restart-wipe     restartWipeNode()
 *   POST /api/node/wipe             wipeNodeData()
 *   --- Accounts ---
 *   GET  /api/accounts              getAccounts()
 *   POST /api/accounts/fund         fundAccount()
 *   --- Network config ---
 *   GET  /api/network/rpc-urls      getRpcUrls()
 *   GET  /api/network/config        getNetworkConfig()
 *   --- Mining ---
 *   GET  /api/mining/status         getMiningStatus()
 *   POST /api/mining/mine           mine()
 *   POST /api/mining/start          startMining()
 *   POST /api/mining/stop           stopMining()
 *   --- Contracts (compiler templates) ---
 *   GET  /api/contracts/templates   getContractTemplates()
 *   POST /api/contracts/compile     compileContract()
 *   POST /api/contracts/deploy      deployContractTemplate()
 *   GET  /api/contracts/deployed    getDeployedContracts()
 *   --- Bootstrap (production contract library) ---
 *   GET  /api/bootstrap/catalog     getBootstrapCatalog()
 *   GET  /api/bootstrap/catalog/:n  getBootstrapEntry()
 *   POST /api/bootstrap/deploy      deployBootstrapContract()
 */

// ── Configuration ──────────────────────────────────────────────────────────

export interface DevkitConfig {
  /** Port the conflux-devkit server listens on. Default: 7748 */
  port?: number;
  /** Host the conflux-devkit server binds to. Default: '127.0.0.1' */
  host?: string;
}

function baseUrl(config?: DevkitConfig): string {
  const host = config?.host ?? '127.0.0.1';
  const port = config?.port ?? 7748;
  return `http://${host}:${port}`;
}

async function apiFetch<T>(
  path: string,
  config?: DevkitConfig,
  init?: RequestInit
): Promise<T> {
  const url = `${baseUrl(config)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json() as T;
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(`conflux-devkit: ${msg}`);
  }
  return body;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface KeystoreStatus {
  /** Whether the keystore has been initialized with a mnemonic */
  initialized: boolean;
  /** Whether the keystore is currently locked (requires password to use) */
  locked: boolean;
  /** Whether encryption is enabled (password required on unlock) */
  encryptionEnabled: boolean;
}

export interface WalletEntry {
  id: string;
  label: string;
  adminAddress: string;
  isActive: boolean;
  createdAt: string;
}

export interface MiningStatus {
  isRunning: boolean;
  interval?: number;
  blocksMined?: number;
  blocksGenerated?: number;
}

export interface RpcUrls {
  core: string | null;
  evm: string | null;
  coreWs?: string;
  evmWs?: string;
  running: boolean;
  mode?: 'local' | 'public';
}

export interface NodeStatus {
  /** 'stopped' | 'starting' | 'running' | 'stopping' | 'error' */
  server: string;
  mining: MiningStatus | null;
  rpcUrls: RpcUrls | null;
  accounts: number;
  config?: Record<string, unknown>;
}

export interface AccountInfo {
  index: number;
  coreAddress: string;
  evmAddress: string;
  privateKey: string;
  evmPrivateKey?: string;
  coreBalance?: string;
  evmBalance?: string;
  mnemonic?: string;
}

export interface TemplateInfo {
  name: string;
  description: string;
  source?: string;
}

export interface TemplateContract {
  name: string;
  source: string;
  abi: unknown[];
  bytecode: string;
}

export interface CompiledContract {
  contractName?: string;
  abi: unknown[];
  bytecode: string;
  success?: boolean;
}

export interface BootstrapEntry {
  name: string;
  category: 'tokens' | 'defi' | 'governance' | 'utils' | 'mocks';
  description: string;
  chains: ('evm' | 'core')[];
  constructorArgs: Array<{
    name: string;
    type: string;
    description: string;
    placeholder?: string;
  }>;
  type?: 'deployable' | 'precompile';
  address?: string;
  /** Returned by /api/bootstrap/catalog/:name (single-entry endpoint) */
  abi?: unknown[];
  bytecode?: string;
}

export interface DeployedContract {
  id: string;
  name: string;
  address: string;
  chain: 'core' | 'evm';
  chainId?: number;
  txHash?: string;
  deployer?: string;
  deployedAt?: string;
  abi?: unknown[];
  constructorArgs?: unknown[];
  /** Arbitrary extra data attached by external tools (MCP, DEX service). */
  metadata?: Record<string, unknown>;
}

export interface NetworkConfig {
  chainId: number;
  evmChainId: number;
  coreRpcPort: number;
  evmRpcPort: number;
  wsPort: number;
  evmWsPort: number;
  accounts: number;
}

export type NetworkMode = 'local' | 'public';

export interface PublicNetworkConfig {
  coreRpcUrl?: string;
  evmRpcUrl?: string;
  chainId?: number;
  evmChainId?: number;
}

export interface CurrentNetwork {
  mode: NetworkMode;
  public: PublicNetworkConfig;
  chainId: number;
  evmChainId: number;
  localNodeRunning: boolean;
}

export interface NetworkCapabilities {
  mode: NetworkMode;
  capabilities: {
    localLifecycle: boolean;
    localMining: boolean;
    localAccounts: boolean;
    contractDeployLocal: boolean;
    contractDeployPublic: boolean;
    contractReadPublic: boolean;
    contractWritePublic: boolean;
  };
}

export interface PublicSignerOptions {
  accountIndex?: number;
  privateKey?: string;
  rpcUrl?: string;
  chainId?: number;
}

// ── Server health ──────────────────────────────────────────────────────────

/**
 * Returns true if the conflux-devkit server is reachable.
 * Never throws — returns false on any network error.
 *
 * This is the FIRST check in the lifecycle. If false, start the server with:
 *   npx conflux-devkit --no-open
 */
export async function isDevkitServerRunning(config?: DevkitConfig): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(config)}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Keystore (MUST complete before starting node) ──────────────────────────

/**
 * Get keystore initialization and lock status.
 *
 * LIFECYCLE STEP 2: Call this after confirming server is running.
 * - If initialized=false → call setupKeystore() (first-time setup)
 * - If initialized=true && locked=true → call unlockKeystore(password)
 * - If initialized=true && locked=false → ready to startNode()
 */
export async function getKeystoreStatus(config?: DevkitConfig): Promise<KeystoreStatus> {
  return apiFetch<KeystoreStatus>('/api/keystore/status', config);
}

/**
 * Generate a new random BIP-39 mnemonic phrase (24 words).
 *
 * LIFECYCLE STEP 3a: Use this output as input to setupKeystore().
 * ⚠️  SAVE THE MNEMONIC. It is the only way to recover your accounts.
 */
export async function generateMnemonicWords(config?: DevkitConfig): Promise<string> {
  const res = await apiFetch<{ mnemonic: string }>('/api/keystore/generate', config, {
    method: 'POST',
    body: '{}',
  });
  return res.mnemonic;
}

/**
 * Complete first-time keystore setup with a BIP-39 mnemonic.
 *
 * LIFECYCLE STEP 3: Call once when getKeystoreStatus().initialized === false.
 * After setup, the keystore is persistent (~/.devkit.keystore.json).
 * You can then call startNode().
 *
 * @param mnemonic - 12 or 24 word BIP-39 mnemonic (use generateMnemonicWords())
 * @param label - Human-readable wallet label (default: 'Default')
 * @param password - Optional password for encryption. If set, unlockKeystore() required after server restart.
 */
export async function setupKeystore(
  mnemonic: string,
  label = 'Default',
  password?: string,
  config?: DevkitConfig
): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/keystore/setup', config, {
    method: 'POST',
    body: JSON.stringify({ mnemonic, label, ...(password ? { password } : {}) }),
  });
}

/**
 * Unlock an encrypted keystore with the stored password.
 * Required when getKeystoreStatus().locked === true.
 */
export async function unlockKeystore(password: string, config?: DevkitConfig): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/keystore/unlock', config, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

/** Lock the keystore (requires password on next unlock). */
export async function lockKeystore(config?: DevkitConfig): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/keystore/lock', config, {
    method: 'POST',
    body: '{}',
  });
}

/** List all stored wallet mnemonics (summaries only — no private keys). */
export async function getWallets(config?: DevkitConfig): Promise<WalletEntry[]> {
  return apiFetch<WalletEntry[]>('/api/keystore/wallets', config);
}

// ── Node lifecycle ─────────────────────────────────────────────────────────

/**
 * Get current Conflux node status.
 *
 * server values: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
 * When server='running', rpcUrls contains live endpoints.
 */
export async function getNodeStatus(config?: DevkitConfig): Promise<NodeStatus> {
  return apiFetch<NodeStatus>('/api/node/status', config);
}

/**
 * Start the Conflux dev node (Core Space + eSpace).
 *
 * LIFECYCLE STEP 4: Call after keystore is initialized and unlocked.
 * Prerequisite: getKeystoreStatus().initialized === true && locked === false.
 * Takes 5-15 seconds. Returns NodeStatus with live rpcUrls.
 *
 * Throws "Setup not completed. Configure a mnemonic first." if keystore not initialized.
 */
export async function startNode(config?: DevkitConfig): Promise<NodeStatus> {
  const res = await apiFetch<{ ok: boolean; status: NodeStatus }>(
    '/api/node/start', config, { method: 'POST', body: '{}' }
  );
  return res.status;
}

/** Stop the Conflux dev node. Blockchain data is preserved on disk. */
export async function stopNode(config?: DevkitConfig): Promise<void> {
  await apiFetch<{ ok: boolean; server: string }>('/api/node/stop', config, {
    method: 'POST', body: '{}',
  });
}

/**
 * Restart the Conflux dev node (stop + start).
 * Blockchain data is preserved. Use for simple recovery from hangs.
 * If this fails, try restartWipeNode() instead.
 */
export async function restartNode(config?: DevkitConfig): Promise<NodeStatus> {
  const res = await apiFetch<{ ok: boolean; status: NodeStatus }>(
    '/api/node/restart', config, { method: 'POST', body: '{}' }
  );
  return res.status;
}

/**
 * Wipe blockchain data and restart the node fresh.
 *
 * TROUBLESHOOTING: Use when node fails to start, RPC is unresponsive,
 * or state is corrupted. This resets all blockchain state but PRESERVES
 * the mnemonic and accounts (same addresses, fresh balances).
 *
 * ⚠️  All deployed contracts and transaction history are lost.
 * ✓  Mnemonic, account addresses, and private keys are unchanged.
 */
export async function restartWipeNode(config?: DevkitConfig): Promise<NodeStatus> {
  const res = await apiFetch<{ ok: boolean; status: NodeStatus }>(
    '/api/node/restart-wipe', config, { method: 'POST', body: '{}' }
  );
  return res.status;
}

/**
 * Stop the node and wipe blockchain data WITHOUT restarting.
 * Call startNode() afterwards to bring the node back up fresh.
 */
export async function wipeNodeData(config?: DevkitConfig): Promise<void> {
  await apiFetch<{ ok: boolean; server: string }>('/api/node/wipe', config, {
    method: 'POST', body: '{}',
  });
}

// ── Accounts ───────────────────────────────────────────────────────────────

/** List genesis accounts with addresses and live balances. */
export async function getAccounts(config?: DevkitConfig): Promise<AccountInfo[]> {
  return apiFetch<AccountInfo[]>('/api/accounts', config);
}

/**
 * Fund an account from the genesis faucet.
 * @param address - Core Space (cfx:…) or eSpace (0x…) address
 * @param amount - Amount in CFX (default: '100')
 * @param chain - 'core' or 'evm' (auto-detected from address format if omitted)
 */
export async function fundAccount(
  address: string,
  amount = '100',
  chain?: 'core' | 'evm',
  config?: DevkitConfig
): Promise<void> {
  await apiFetch('/api/accounts/fund', config, {
    method: 'POST',
    body: JSON.stringify({ address, amount, ...(chain ? { chain } : {}) }),
  });
}

// ── Network config ─────────────────────────────────────────────────────────

/**
 * Get current RPC endpoint URLs.
 * When running=false, returns default config URLs (node may not be up yet).
 */
export async function getRpcUrls(config?: DevkitConfig): Promise<RpcUrls> {
  return apiFetch<RpcUrls>('/api/network/rpc-urls', config);
}

/** Get current node network configuration (ports, chain IDs). */
export async function getNetworkConfig(config?: DevkitConfig): Promise<NetworkConfig> {
  return apiFetch<NetworkConfig>('/api/network/config', config);
}

/** Get active network mode and effective chain ids. */
export async function getCurrentNetwork(config?: DevkitConfig): Promise<CurrentNetwork> {
  return apiFetch<CurrentNetwork>('/api/network/current', config);
}

/** Update active network mode and optional public RPC profile. */
export async function setCurrentNetwork(
  payload: { mode?: NetworkMode; public?: PublicNetworkConfig },
  config?: DevkitConfig
): Promise<CurrentNetwork> {
  return apiFetch<CurrentNetwork>('/api/network/current', config, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** Discover which operations are available in the active network mode. */
export async function getNetworkCapabilities(config?: DevkitConfig): Promise<NetworkCapabilities> {
  return apiFetch<NetworkCapabilities>('/api/network/capabilities', config);
}

// ── Contract templates ─────────────────────────────────────────────────────

/** List available built-in contract templates (from @cfxdevkit/compiler). */
export async function getContractTemplates(config?: DevkitConfig): Promise<TemplateInfo[]> {
  return apiFetch<TemplateInfo[]>('/api/contracts/templates', config);
}

/** Get one built-in contract template including source, ABI, and bytecode. */
export async function getContractTemplate(name: string, config?: DevkitConfig): Promise<TemplateContract> {
  return apiFetch<TemplateContract>(`/api/contracts/templates/${encodeURIComponent(name)}`, config);
}

/**
 * Compile arbitrary Solidity source code.
 * @param source - Full Solidity source (pragma + contract definition)
 * @param contractName - Name of the primary contract in the source
 */
export async function compileContract(
  source: string,
  contractName?: string,
  config?: DevkitConfig
): Promise<CompiledContract> {
  return apiFetch('/api/contracts/compile', config, {
    method: 'POST',
    body: JSON.stringify({ source, ...(contractName ? { contractName } : {}) }),
  });
}

/**
 * Deploy a contract from a built-in template.
 *
 * @param name - Template name (e.g. 'Counter', 'SimpleStorage', 'TestToken')
 * @param args - Constructor arguments
 * @param chain - Deploy to 'core' (Core Space) or 'evm' (eSpace). Default: 'evm'
 * @param accountIndex - Genesis account index to deploy from. Default: 0
 */
export async function deployContractTemplate(
  name: string,
  args: unknown[] = [],
  chain: 'core' | 'evm' = 'evm',
  accountIndex = 0,
  config?: DevkitConfig,
  signer?: PublicSignerOptions
): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/contracts/deploy', config, {
    method: 'POST',
    body: JSON.stringify({ contractName: name, args, chain, accountIndex, ...(signer ?? {}) }),
  });
}

/** List all contracts deployed during this session. */
export async function getDeployedContracts(config?: DevkitConfig): Promise<DeployedContract[]> {
  return apiFetch<DeployedContract[]>('/api/contracts/deployed', config);
}

/**
 * Register a contract that was deployed by an external tool (MCP, DEX service)
 * rather than through the devkit's own deploy route. Persists to the devkit
 * contract registry so it survives node restarts.
 */
export async function registerContract(
  contract: Omit<DeployedContract, 'id'>,
  config?: DevkitConfig
): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/contracts/register', config, {
    method: 'POST',
    body: JSON.stringify(contract),
  });
}

/**
 * Deploy a pre-compiled contract (ABI + bytecode) rather than a named template.
 * Use this after compileContract() when you have the bytecode client-side.
 */
export async function deployCompiledContract(
  contractName: string,
  abi: unknown[],
  bytecode: string,
  args: unknown[] = [],
  chain: 'core' | 'evm' = 'evm',
  accountIndex = 0,
  config?: DevkitConfig,
  signer?: PublicSignerOptions
): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/contracts/deploy', config, {
    method: 'POST',
    body: JSON.stringify({ contractName, abi, bytecode, args, chain, accountIndex, ...(signer ?? {}) }),
  });
}

// ── Bootstrap catalog ──────────────────────────────────────────────────────

/**
 * List the production-ready bootstrap contract catalog.
 *
 * The catalog includes:
 * - Tokens: ERC20Base, ERC721Base, ERC1155Base, WrappedCFX, ERC20Permit
 * - DeFi: StakingRewards, VestingSchedule, ERC4626Vault
 * - Governance: MultiSigWallet, GovernorCore, RoleRegistry
 * - Utils: PaymentSplitter, MerkleAirdrop, Create2Factory, UUPSProxy
 * - Mocks: MockPriceOracle
 * - Precompiles: AdminControl, SponsorWhitelist, CrossSpaceCall (read-only)
 */
export async function getBootstrapCatalog(config?: DevkitConfig): Promise<BootstrapEntry[]> {
  return apiFetch<BootstrapEntry[]>('/api/bootstrap/catalog', config);
}

/** Get a single bootstrap catalog entry with full ABI and bytecode. */
export async function getBootstrapEntry(name: string, config?: DevkitConfig): Promise<BootstrapEntry> {
  return apiFetch<BootstrapEntry>(`/api/bootstrap/catalog/${encodeURIComponent(name)}`, config);
}

/**
 * Deploy a contract from the bootstrap catalog.
 *
 * @param name - Catalog entry name (e.g. 'ERC20Base', 'MultiSigWallet')
 * @param args - Constructor arguments (must match constructorArgs schema from catalog)
 * @param chain - 'evm' (eSpace) or 'core' (Core Space). Default: 'evm'
 * @param accountIndex - Genesis account index to deploy from. Default: 0
 */
export async function deployBootstrapContract(
  name: string,
  args: unknown[] = [],
  chain: 'core' | 'evm' = 'evm',
  accountIndex = 0,
  config?: DevkitConfig
): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/bootstrap/deploy', config, {
    method: 'POST',
    body: JSON.stringify({ name, args, chain, accountIndex }),
  });
}

// ── Mining ─────────────────────────────────────────────────────────────────

/** Get current mining status. */
export async function getMiningStatus(config?: DevkitConfig): Promise<MiningStatus> {
  return apiFetch<MiningStatus>('/api/mining/status', config);
}

/**
 * Mine N blocks immediately.
 * @param blocks - Number of blocks to mine. Default: 1
 */
export async function mine(blocks = 1, config?: DevkitConfig): Promise<void> {
  await apiFetch<{ ok: boolean; mined: number }>('/api/mining/mine', config, {
    method: 'POST',
    body: JSON.stringify({ blocks }),
  });
}

/**
 * Start auto-mining at a given interval.
 * @param intervalMs - Mining interval in milliseconds. Default: 2000
 */
export async function startMining(intervalMs = 2000, config?: DevkitConfig): Promise<MiningStatus> {
  const res = await apiFetch<{ ok: boolean; status: MiningStatus }>(
    '/api/mining/start', config,
    { method: 'POST', body: JSON.stringify({ intervalMs }) }
  );
  return res.status;
}

/** Stop auto-mining. */
export async function stopMining(config?: DevkitConfig): Promise<MiningStatus> {
  const res = await apiFetch<{ ok: boolean; status: MiningStatus }>(
    '/api/mining/stop', config,
    { method: 'POST', body: '{}' }
  );
  return res.status;
}

// ── Composite helpers ──────────────────────────────────────────────────────

/**
 * Full readiness check — returns everything an agent needs to decide next steps.
 *
 * Returns:
 * - serverOnline: boolean
 * - keystoreStatus: KeystoreStatus | null
 * - nodeStatus: NodeStatus | null
 * - readyToStart: boolean (server up + keystore initialized + not locked)
 * - nodeRunning: boolean
 * - nextStep: human-readable string describing what to do next
 */
export async function getFullStatus(config?: DevkitConfig): Promise<{
  serverOnline: boolean;
  keystoreStatus: KeystoreStatus | null;
  nodeStatus: NodeStatus | null;
  readyToStart: boolean;
  nodeRunning: boolean;
  nextStep: string;
}> {
  const serverOnline = await isDevkitServerRunning(config);

  if (!serverOnline) {
    return {
      serverOnline: false,
      keystoreStatus: null,
      nodeStatus: null,
      readyToStart: false,
      nodeRunning: false,
      nextStep: 'Start the conflux-devkit server: use "Conflux: Start DevKit Server" in VSCode, or run `npx conflux-devkit --no-open` in the terminal.',
    };
  }

  let keystoreStatus: KeystoreStatus | null = null;
  let nodeStatus: NodeStatus | null = null;

  try { keystoreStatus = await getKeystoreStatus(config); } catch { /* ignore */ }
  try { nodeStatus = await getNodeStatus(config); } catch { /* ignore */ }

  if (!keystoreStatus?.initialized) {
    return {
      serverOnline,
      keystoreStatus,
      nodeStatus,
      readyToStart: false,
      nodeRunning: false,
      nextStep: 'Keystore not initialized. Run `conflux_setup_init` to generate a mnemonic and complete first-time setup.',
    };
  }

  if (keystoreStatus.locked) {
    return {
      serverOnline,
      keystoreStatus,
      nodeStatus,
      readyToStart: false,
      nodeRunning: false,
      nextStep: 'Keystore is locked. Call unlockKeystore(password) to unlock it.',
    };
  }

  const nodeRunning = nodeStatus?.server === 'running';

  if (!nodeRunning) {
    return {
      serverOnline,
      keystoreStatus,
      nodeStatus,
      readyToStart: true,
      nodeRunning: false,
      nextStep: 'Server is ready. Call `conflux_node_start` to start the Conflux dev node.',
    };
  }

  return {
    serverOnline,
    keystoreStatus,
    nodeStatus,
    readyToStart: true,
    nodeRunning: true,
    nextStep: `Node is running. Core RPC: ${nodeStatus?.rpcUrls?.core ?? ':12537'}  eSpace RPC: ${nodeStatus?.rpcUrls?.evm ?? ':8545'}`,
  };
}

