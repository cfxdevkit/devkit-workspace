import { STABLECOIN_DEFS } from './dex-stables.js';

export const dexToolDefinitions = [
  {
    name: 'dex_status',
    description:
      'Check the Uniswap V2 DEX status on the local eSpace node. ' +
      'Returns whether the V2 stack is deployed, contract addresses from the DEX service, ' +
      'and live on-chain pair count from factory.allPairsLength(). ' +
      'Run dex_deploy first if status shows "not deployed".',
    inputSchema: {
      type: 'object',
      properties: {
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
    },
  },
  {
    name: 'dex_deploy',
    description:
      'Deploy a full Uniswap V2 DEX stack to the local Conflux eSpace node. ' +
      'Deploys contracts in order: UniswapV2Factory → WETH9 → UniswapV2Router02. ' +
      'All contracts are tracked in the devkit contract registry and the DEX service in-memory state. ' +
      'Uses pre-compiled artifacts from packages/contracts/artifacts/ — run `cd packages/contracts && pnpm build` if artifacts are missing. ' +
      'The node must be running (use conflux_status + conflux_node_start first).',
    inputSchema: {
      type: 'object',
      properties: {
        accountIndex: {
          type: 'number',
          description: 'Deployer account index from keystore (default: 0)',
        },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
    },
  },
  {
    name: 'dex_seed_from_gecko',
    description:
      'Fetch selected source pools from GeckoTerminal using the generated known-token catalog, ' +
      'deploy MirrorERC20 tokens on the local devnet for each imported token, ' +
      'and seed TOKEN/WCFX Uniswap V2 pools with realistic reserve ratios derived from the chosen source pools. ' +
      'Requires dex_deploy to have been run first. ' +
      'Idempotent — already-mirrored tokens are reused, only addLiquidity is re-called. ' +
      'If selectedPoolAddresses is omitted, dex-ui/public/pool-import-presets.json is used. ' +
      'Translation table (real mainnet → local mirror addresses) stored in DEX service.',
    inputSchema: {
      type: 'object',
      properties: {
        accountIndex: {
          type: 'number',
          description: 'Deployer account index from keystore (default: 0)',
        },
        selectedPoolAddresses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit GeckoTerminal pool addresses to import. Defaults to dex-ui/public/pool-import-presets.json when omitted.',
        },
        forceRefresh: {
          type: 'boolean',
          description: 'Force re-fetch from GeckoTerminal even if a matching selected-pool cache is fresh (default: false)',
        },
        selectedStablecoins: {
          type: 'array',
          items: { type: 'string' },
          description: `Explicit list of stablecoin symbols to deploy/seed. Available: ${STABLECOIN_DEFS.map((def) => def.symbol).join(', ')}. Defaults to all when omitted.`,
        },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
    },
  },
  {
    name: 'dex_simulation_step',
    description:
      'Execute a single simulation tick — advance one candle per token, compute smoothed VWAP price, ' +
      'and rebalance pools where price deviation exceeds the minimum threshold. ' +
      'Requires dex_seed_from_gecko to have been run first (pools must be seeded). ' +
      'The engine is auto-created on first call if not already initialized. ' +
      'Returns per-token rebalance results and overall progress.',
    inputSchema: {
      type: 'object',
      properties: {
        accountIndex: { type: 'number', description: 'Account index for swap execution (default: 0)' },
        minDeviationBps: { type: 'number', description: 'Min price change in bps to trigger rebalance (default: 50)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
    },
  },
  {
    name: 'dex_simulation_start',
    description:
      'Start continuous price simulation — auto-advances candles at the configured tick interval. ' +
      'Each tick processes one OHLCV candle per token, computes rolling VWAP, and executes swaps ' +
      'to move pool prices toward the target. Requires seeded pools (dex_seed_from_gecko). ' +
      'Returns immediately; use dex_simulation_step or dex_status to check progress. ' +
      'Call dex_simulation_stop to halt.',
    inputSchema: {
      type: 'object',
      properties: {
        accountIndex: { type: 'number', description: 'Account index for swap execution (default: 0)' },
        tickIntervalMs: { type: 'number', description: 'Milliseconds between ticks. 0 = max speed, 5000 = demo mode (default: 2000)' },
        minDeviationBps: { type: 'number', description: 'Min price change in bps to trigger rebalance (default: 50)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
    },
  },
  {
    name: 'dex_simulation_stop',
    description:
      'Stop the continuous price simulation loop. The engine state is preserved — ' +
      'you can resume with dex_simulation_start or step manually with dex_simulation_step.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'dex_simulation_reset',
    description:
      'Reset the simulation engine to its post-seed state. Reverts the EVM snapshot ' +
      'taken after seeding (all swap/rebalance history is undone). ' +
      'Candle indices are reset to 0 so the simulation can replay from the beginning.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'dex_create_token',
    description:
      'Deploy a new ERC-20 token (MirrorERC20) on the local eSpace node. ' +
      'Mints an initial supply to the deployer account. The token is tracked in .devkit-contracts.json. ' +
      'Useful for creating custom tokens before adding them to liquidity pools via dex_create_pair.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Token name (e.g. "My Token")' },
        symbol: { type: 'string', description: 'Token symbol (e.g. "MTK")' },
        decimals: { type: 'number', description: 'Token decimals (default: 18)' },
        initialSupply: { type: 'string', description: 'Initial supply in human units minted to deployer (default: "1000000")' },
        accountIndex: { type: 'number', description: 'Deployer account index from keystore (default: 0)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
      required: ['name', 'symbol'],
    },
  },
  {
    name: 'dex_create_pair',
    description:
      'Create a Uniswap V2 liquidity pair and add initial liquidity. ' +
      'If tokenB is omitted, pairs with WCFX (native CFX, wrapped via addLiquidityETH). ' +
      'The pair is created via the factory if it does not exist. ' +
      'Tokens must be deployed and the deployer must have sufficient balances. ' +
      'Requires dex_deploy to have been run first.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenA: { type: 'string', description: 'Token A address (0x...)' },
        tokenB: { type: 'string', description: 'Token B address (0x...). Omit or set to "WCFX" to pair with native CFX.' },
        amountA: { type: 'string', description: 'Amount of token A in human units (e.g. "10000")' },
        amountB: { type: 'string', description: 'Amount of token B in human units (e.g. "5000"). For WCFX pairs, this is CFX amount.' },
        accountIndex: { type: 'number', description: 'Account index from keystore (default: 0)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
        chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
      },
      required: ['tokenA', 'amountA', 'amountB'],
    },
  },
  {
    name: 'dex_add_liquidity',
    description:
      'Add liquidity to an existing Uniswap V2 pair. ' +
      'If tokenB is omitted or "WCFX", adds liquidity via addLiquidityETH. ' +
      'Requires the pair to already exist (use dex_create_pair first). ' +
      'The deployer must have sufficient token balances and approvals are handled automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenA: { type: 'string', description: 'Token A address (0x...)' },
        tokenB: { type: 'string', description: 'Token B address or "WCFX" (default: WCFX)' },
        amountA: { type: 'string', description: 'Amount of token A in human units' },
        amountB: { type: 'string', description: 'Amount of token B in human units (CFX if WCFX)' },
        accountIndex: { type: 'number', description: 'Account index (default: 0)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL' },
        chainId: { type: 'number', description: 'eSpace chain ID' },
      },
      required: ['tokenA', 'amountA', 'amountB'],
    },
  },
  {
    name: 'dex_remove_liquidity',
    description:
      'Remove liquidity from a Uniswap V2 pair. Burns LP tokens to receive underlying tokens. ' +
      'If tokenB is "WCFX" or omitted, uses removeLiquidityETH to receive native CFX. ' +
      'The lpAmount is in human units of the LP token (18 decimals).',
    inputSchema: {
      type: 'object',
      properties: {
        tokenA: { type: 'string', description: 'Token A address (0x...)' },
        tokenB: { type: 'string', description: 'Token B address or "WCFX" (default: WCFX)' },
        lpAmount: { type: 'string', description: 'LP token amount to burn in human units (18 decimals)' },
        accountIndex: { type: 'number', description: 'Account index (default: 0)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL' },
        chainId: { type: 'number', description: 'eSpace chain ID' },
      },
      required: ['tokenA', 'lpAmount'],
    },
  },
  {
    name: 'dex_swap',
    description:
      'Execute a token swap on the Uniswap V2 Router. Supports TOKEN→TOKEN, CFX→TOKEN, and TOKEN→CFX. ' +
      'If tokenIn is "WCFX" or "CFX", sends native CFX (swapExactETHForTokens). ' +
      'If tokenOut is "WCFX" or "CFX", receives native CFX (swapExactTokensForETH). ' +
      'Returns the amounts received.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Input token address or "CFX"/"WCFX" for native' },
        tokenOut: { type: 'string', description: 'Output token address or "CFX"/"WCFX" for native' },
        amountIn: { type: 'string', description: 'Input amount in human units' },
        slippage: { type: 'number', description: 'Max slippage in % (default: 1.0)' },
        accountIndex: { type: 'number', description: 'Account index (default: 0)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL' },
        chainId: { type: 'number', description: 'eSpace chain ID' },
      },
      required: ['tokenIn', 'tokenOut', 'amountIn'],
    },
  },
  {
    name: 'dex_pool_info',
    description:
      'Get detailed information about a specific liquidity pool (pair). ' +
      'Returns reserves, price, LP token supply, and token details. ' +
      'Accepts either a pair address or two token addresses to look up the pair.',
    inputSchema: {
      type: 'object',
      properties: {
        pairAddress: { type: 'string', description: 'Direct pair address (0x...)' },
        tokenA: { type: 'string', description: 'Token A address (alternative to pairAddress)' },
        tokenB: { type: 'string', description: 'Token B address (alternative to pairAddress)' },
        rpcUrl: { type: 'string', description: 'eSpace RPC URL' },
        chainId: { type: 'number', description: 'eSpace chain ID' },
      },
    },
  },
  {
    name: 'dex_list_pairs',
    description:
      'List all Uniswap V2 pairs deployed on the local node with reserves, symbols, and prices. ' +
      'Returns a formatted table of all pairs from the factory.',
    inputSchema: {
      type: 'object',
      properties: {
        rpcUrl: { type: 'string', description: 'eSpace RPC URL' },
        chainId: { type: 'number', description: 'eSpace chain ID' },
      },
    },
  },
] as const;
