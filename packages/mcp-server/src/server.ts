import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  getComposeStatus, isDockerAvailable, runCompose,
} from '@cfxdevkit/shared';
import type { DevkitConfig } from '@cfxdevkit/shared';
import { blockchainToolDefinitions, blockchainToolHandler } from './blockchain.js';
import { compilerToolDefinitions, compilerToolHandler } from './compiler.js';
import { dexToolDefinitions, dexToolHandler } from './features/dex/dex.js';
import { DevkitClient } from './clients/devkit-client.js';
import { handleConfluxLifecycleTool } from './orchestration/conflux-lifecycle.js';
import { handleConfluxKeystoreTool } from './orchestration/conflux-keystore.js';
import { handleConfluxNetworkTool } from './orchestration/conflux-network.js';
import { handleConfluxContractsTool } from './orchestration/conflux-contracts.js';
import { EXTENSION_CAPABILITY_MAP } from './extension-capability-map.js';
import {
  addOperationStep,
  finishOperation,
  getOperation,
  listOperations,
  startOperation,
} from './operation-ledger.js';
import { saveContract } from './contracts.js';
import {
  getWorkspaceContext,
  isWorkspaceContainerContext,
  resolveDevkitPort,
} from './runtime-context.js';
import type { RuntimeContext } from './runtime-context.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const BACKEND_ENDPOINT_CATALOG: Record<string, string[]> = {
  health: ['GET /health'],
  settings: ['GET /api/settings'],
  node: [
    'GET /api/node/status',
    'POST /api/node/start',
    'POST /api/node/stop',
    'POST /api/node/restart',
    'POST /api/node/restart-wipe',
    'POST /api/node/wipe',
  ],
  keystore: [
    'GET /api/keystore/status',
    'POST /api/keystore/generate',
    'POST /api/keystore/setup',
    'POST /api/keystore/unlock',
    'POST /api/keystore/lock',
    'GET /api/keystore/wallets',
  ],
  accounts: [
    'GET /api/accounts',
    'POST /api/accounts/fund',
  ],
  contracts: [
    'GET /api/contracts/templates',
    'GET /api/contracts/templates/:name',
    'POST /api/contracts/compile',
    'POST /api/contracts/deploy',
    'GET /api/contracts/deployed',
    'GET /api/contracts/deployed/:id',
    'DELETE /api/contracts/deployed/:id',
    'DELETE /api/contracts/deployed',
    'POST /api/contracts/register',
    'POST /api/contracts/:id/call',
  ],
  bootstrap: [
    'GET /api/bootstrap/catalog',
    'GET /api/bootstrap/catalog/:name',
    'POST /api/bootstrap/deploy',
  ],
  mining: [
    'GET /api/mining/status',
    'POST /api/mining/mine',
    'POST /api/mining/start',
    'POST /api/mining/stop',
  ],
  network: [
    'GET /api/network/current',
    'PUT /api/network/current',
    'GET /api/network/capabilities',
    'GET /api/network/config',
    'PUT /api/network/config',
    'GET /api/network/rpc-urls',
  ],
  dex: [
    'GET /api/dex/manifest',
    'POST /api/dex/manifest',
    'GET /api/dex/translation-table',
    'POST /api/dex/translation-table',
  ],
};

async function devkitApiRequest(params: {
  path: string;
  method?: HttpMethod;
  body?: unknown;
  port?: number;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const {
    path,
    method = 'GET',
    body,
    port = 7748,
  } = params;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `http://127.0.0.1:${port}${normalizedPath}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = { error: `Non-JSON response from ${normalizedPath}` };
  }

  return { ok: res.ok, status: res.status, json };
}

async function executeRunbook(params: {
  runbook: string;
  args: Record<string, unknown>;
  devkitCfg: DevkitConfig;
  composeOpts: { composeFile?: string };
  workspaceCtx: RuntimeContext;
  devkitClient: DevkitClient;
  operationId?: string;
}): Promise<{ text: string; isError?: boolean }> {
  const { runbook, args, devkitCfg, composeOpts, workspaceCtx, devkitClient, operationId } = params;
  const steps: string[] = [];
  const failures: string[] = [];
  const rpcUrl = (args.rpcUrl as string | undefined) ?? 'http://localhost:8545';
  const chainId = (args.chainId as number | undefined) ?? 2030;
  const bootstrapName = (args.name as string | undefined) ?? 'ERC20Base';
  const deployChain = (args.chain as 'evm' | 'core' | undefined) ?? 'evm';
  const deployArgs = (args.args as unknown[] | undefined) ?? [];

  if (runbook === 'local_bootstrap_token_deploy') {
    if (operationId) addOperationStep(operationId, 'Starting local bootstrap token deploy checks');
    const docker = isDockerAvailable();
    if (!docker && !isWorkspaceContainerContext(workspaceCtx)) {
      failures.push('Docker is not reachable.');
    } else if (docker) {
      const compose = getComposeStatus(composeOpts);
      steps.push(`compose_services=${compose.services.length}`);
      if (operationId) addOperationStep(operationId, `Compose services detected: ${compose.services.length}`);
    } else {
      steps.push('docker=unreachable (non-blocking in workspace-container mode)');
    }

    const status = await devkitClient.getStatus(devkitCfg).catch(() => null);
    if (!status?.serverOnline) {
      failures.push('conflux-devkit server is offline (run conflux_server_start first).');
    }
    if (!status?.keystoreStatus?.initialized) {
      failures.push('keystore is not initialized (run conflux_setup_init).');
    }
    if (status?.keystoreStatus?.locked) {
      failures.push('keystore is locked (run conflux_keystore_unlock).');
    }
    if (!status?.nodeRunning) {
      failures.push('node is not running (run conflux_node_start).');
    }

    const prepare = await devkitApiRequest({
      path: '/api/bootstrap/catalog/' + encodeURIComponent(bootstrapName),
      method: 'GET',
      port: devkitCfg.port,
    });
    if (!prepare.ok) {
      failures.push(`bootstrap preset ${bootstrapName} is unavailable.`);
    } else {
      steps.push(`preset=${bootstrapName}`);
      if (operationId) addOperationStep(operationId, `Bootstrap preset ready: ${bootstrapName}`);
    }

    if (failures.length > 0) {
      return {
        text: ['❌ Runbook blocked.', ...failures.map((f) => `- ${f}`)].join('\n'),
        isError: true,
      };
    }

    const deploy = await devkitClient.deployBootstrapContract(
      bootstrapName,
      deployArgs,
      deployChain,
      (args.accountIndex as number | undefined) ?? 0,
      devkitCfg,
    );
    steps.push(`deployed=${deploy.address}`);
    if (operationId) addOperationStep(operationId, `Deployment complete at ${deploy.address}`);
    return {
      text: [
        '✅ Runbook completed: local_bootstrap_token_deploy',
        ...steps.map((s) => `- ${s}`),
        `- chain=${deploy.chain}`,
        `- tx=${deploy.txHash ?? 'n/a'}`,
      ].join('\n'),
    };
  }

  if (runbook === 'local_dex_full_setup') {
    if (operationId) addOperationStep(operationId, 'Starting local DEX full setup checks');
    if (!isDockerAvailable() && !isWorkspaceContainerContext(workspaceCtx)) {
      return { text: '❌ Docker is not reachable.', isError: true };
    }

    const status = await devkitClient.getStatus(devkitCfg).catch(() => null);
    if (!status?.serverOnline || !status.keystoreStatus?.initialized || status.keystoreStatus?.locked || !status.nodeRunning) {
      return {
        text: [
          '❌ Runbook blocked by Conflux lifecycle readiness.',
          `nextStep=${status?.nextStep ?? 'run local_stack_status'}`,
        ].join('\n'),
        isError: true,
      };
    }

    const deployResult = await dexToolHandler('dex_deploy', {
      accountIndex: (args.accountIndex as number | undefined) ?? 0,
      rpcUrl,
      chainId,
    });
    if (operationId) addOperationStep(operationId, 'dex_deploy executed');
    if (deployResult.isError) {
      return { text: `❌ dex_deploy failed\n${deployResult.text}`, isError: true };
    }

    const seedArgs: Record<string, unknown> = {
      accountIndex: (args.accountIndex as number | undefined) ?? 0,
      rpcUrl,
      chainId,
    };
    if (Array.isArray(args.selectedPoolAddresses)) {
      seedArgs.selectedPoolAddresses = args.selectedPoolAddresses;
    }
    if (Array.isArray(args.selectedStablecoins)) {
      seedArgs.selectedStablecoins = args.selectedStablecoins;
    }

    const seedResult = await dexToolHandler('dex_seed_from_gecko', seedArgs);
    if (operationId) addOperationStep(operationId, 'dex_seed_from_gecko executed');
    if (seedResult.isError) {
      return { text: `❌ dex_seed_from_gecko failed\n${seedResult.text}`, isError: true };
    }

    return {
      text: [
        '✅ Runbook completed: local_dex_full_setup',
        '--- dex_deploy ---',
        deployResult.text,
        '--- dex_seed_from_gecko ---',
        seedResult.text,
      ].join('\n'),
    };
  }

  if (runbook === 'local_stack_doctor') {
    if (operationId) addOperationStep(operationId, 'Running stack diagnostics');
    const docker = isDockerAvailable();
    const compose = docker ? getComposeStatus(composeOpts) : null;
    const status = await devkitClient.getStatus(devkitCfg).catch(() => null);
    const dexStatus = await dexToolHandler('dex_status', { rpcUrl, chainId }).catch((err) => ({
      text: `unavailable: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    }));

    return {
      text: [
        '=== local_stack_doctor ===',
        `runtime_mode=${workspaceCtx.runtimeMode}`,
        `backend=${workspaceCtx.backendBaseUrl}`,
        `docker=${docker ? 'ok' : 'down'}`,
        `compose_services=${compose?.services.length ?? 0}`,
        `server=${status?.serverOnline ? 'online' : 'offline'}`,
        `keystore_initialized=${status?.keystoreStatus?.initialized ? 'yes' : 'no'}`,
        `keystore_locked=${status?.keystoreStatus?.locked ? 'yes' : 'no'}`,
        `node_running=${status?.nodeRunning ? 'yes' : 'no'}`,
        `next_step=${status?.nextStep ?? 'run conflux_status'}`,
        '',
        'DEX:',
        dexStatus.text,
      ].join('\n'),
      isError: !status?.serverOnline,
    };
  }

  return {
    text: `Unsupported runbook: ${runbook}. Supported: local_stack_doctor, local_bootstrap_token_deploy, local_dex_full_setup`,
    isError: true,
  };
}

export function createDevkitMcpServer(): Server {
  const server = new Server(
    { name: 'cfxdevkit', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // ── Tool definitions ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // ── Docker Compose tools ────────────────────────────────────────────────
      {
        name: 'workspace_status',
        description:
          'Get the current status of Docker Compose services in this workspace. ' +
          'Returns which services are running, stopped, or missing.',
        inputSchema: {
          type: 'object',
          properties: {
            composeFile: {
              type: 'string',
              description: 'Path to docker-compose.yml (default: docker-compose.yml in workspace root)',
            },
          },
        },
      },
      {
        name: 'workspace_start',
        description: 'Start all Docker Compose services in this workspace (docker compose up -d).',
        inputSchema: {
          type: 'object',
          properties: {
            composeFile: { type: 'string' },
            service: {
              type: 'string',
              description: 'Optional: start only this specific service',
            },
          },
        },
      },
      {
        name: 'workspace_stop',
        description: 'Stop Docker Compose services in this workspace (docker compose stop).',
        inputSchema: {
          type: 'object',
          properties: {
            composeFile: { type: 'string' },
            service: {
              type: 'string',
              description: 'Optional: stop only this specific service',
            },
          },
        },
      },
      {
        name: 'workspace_logs',
        description: 'Get recent logs from Docker Compose services.',
        inputSchema: {
          type: 'object',
          properties: {
            composeFile: { type: 'string' },
            service: { type: 'string', description: 'Service name (omit for all)' },
            lines: {
              type: 'number',
              description: 'Number of log lines to return (default: 50)',
            },
          },
        },
      },
      {
        name: 'docker_available',
        description: 'Check whether the Docker daemon is reachable from this workspace.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'backend_api_catalog',
        description:
          'List all known conflux-devkit backend HTTP endpoints grouped by domain. ' +
          'Use with backend_api_call for direct endpoint access when a dedicated MCP tool is unavailable.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'backend_health',
        description: 'Call backend health endpoint (/health).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'backend_api_call',
        description:
          'Direct HTTP call to local conflux-devkit backend. ' +
          'Supports GET/POST/PUT/DELETE for /health and /api/* paths with JSON body.',
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: {
              type: 'string',
              description: 'Endpoint path, e.g. /api/network/current or /health',
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'DELETE'],
              description: 'HTTP method (default: GET)',
            },
            body: {
              description: 'Optional JSON body for POST/PUT calls',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'extension_capability_map',
        description:
          'Map VS Code extension command families to MCP tools, showing what is fully MCP-supported ' +
          'and what remains UI-only.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'agent_workspace_context',
        description:
          'Describe current MCP runtime workspace context (cwd, detected compose files, resolved compose target). ' +
          'Use this first when agents run inside project-example to avoid root-repo assumptions.',
        inputSchema: {
          type: 'object',
          properties: {
            composeFile: { type: 'string', description: 'Optional explicit compose file override' },
          },
        },
      },
      {
        name: 'agent_tool_contracts',
        description:
          'Return machine-readable tool reliability metadata (idempotency, side effects, and suggested usage order) for agent planning.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'agent_operation_get',
        description: 'Get one operation record by operation id.',
        inputSchema: {
          type: 'object',
          required: ['operationId'],
          properties: {
            operationId: { type: 'string' },
          },
        },
      },
      {
        name: 'agent_operations_recent',
        description: 'List recent operation records for observability and debugging.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max operations to return (default: 20)' },
          },
        },
      },
      {
        name: 'agent_runbook_execute',
        description:
          'Execute guided multi-step workflows for local stack operations with explicit readiness checks. ' +
          'Runbooks: local_stack_doctor, local_bootstrap_token_deploy, local_dex_full_setup.',
        inputSchema: {
          type: 'object',
          required: ['runbook'],
          properties: {
            runbook: {
              type: 'string',
              enum: ['local_stack_doctor', 'local_bootstrap_token_deploy', 'local_dex_full_setup'],
            },
            name: { type: 'string', description: 'Bootstrap preset for token deploy runbook (default: ERC20Base)' },
            args: { type: 'array', items: {}, description: 'Constructor args for bootstrap deploy runbook' },
            chain: { type: 'string', enum: ['evm', 'core'], description: 'Target chain (default: evm)' },
            accountIndex: { type: 'number', description: 'Signer account index (default: 0)' },
            selectedPoolAddresses: { type: 'array', items: { type: 'string' } },
            selectedStablecoins: { type: 'array', items: { type: 'string' } },
            composeFile: { type: 'string' },
            rpcUrl: { type: 'string', description: 'eSpace RPC URL (default: http://localhost:8545)' },
            chainId: { type: 'number', description: 'eSpace chain ID (default: 2030)' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'local_stack_status',
        description:
          'Aggregate readiness report for the full local dev stack: Docker, Compose services, ' +
          'conflux-devkit server, keystore, node, and DEX deployment status. ' +
          'Returns a recommended nextStep action to unblock the workflow.',
        inputSchema: {
          type: 'object',
          properties: {
            composeFile: {
              type: 'string',
              description: 'Path to docker-compose.yml (default: docker-compose.yml in workspace root)',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
            rpcUrl: { type: 'string', description: 'eSpace RPC URL for DEX checks (default: http://localhost:8545)' },
            chainId: { type: 'number', description: 'eSpace chain ID for DEX checks (default: 2030)' },
          },
        },
      },
      // ── Conflux node tools ──────────────────────────────────────────────────
      // ════════════════════════════════════════════════════════════════════════
      // Cold-start lifecycle:
      //   conflux_server_start → conflux_status → conflux_setup_init → conflux_node_start → deploy
      // ════════════════════════════════════════════════════════════════════════
      {
        name: 'conflux_server_start',
        description:
          'Start the conflux-devkit background server if it is not already running. ' +
          'ALWAYS call this first when conflux_status reports the server offline. ' +
          'Spawns the server as a detached background process and polls up to 30 s for it to be ready. ' +
          'After success, call conflux_status to continue the setup lifecycle.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'Port for conflux-devkit server (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_status',
        description:
          'Full lifecycle readiness check for the Conflux dev environment. ' +
          'Checks: (1) is the conflux-devkit server running, (2) is the keystore initialized, ' +
          '(3) is the node running. Returns a nextStep field with the exact action to take. ' +
          'Lifecycle order: conflux_server_start → conflux_setup_init → conflux_node_start → deploy contracts.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_node_status',
        description:
          'Get the current Conflux node status (state, RPC URLs, accounts, mining). ' +
          'Use conflux_status instead if you are unsure whether the server or keystore is ready.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      // ── Keystore lifecycle (must complete before starting node) ─────────────
      {
        name: 'conflux_setup_init',
        description:
          'Complete first-time keystore setup. ' +
          'Automatically generates a BIP-39 mnemonic and initializes the keystore in one step. ' +
          'PREREQUISITE: conflux-devkit server must be running. ' +
          'WHEN TO USE: call when conflux_status reports keystore not initialized. ' +
          'After this, call conflux_node_start to start the blockchain node. ' +
          'The mnemonic is returned — save it for account recovery.',
        inputSchema: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description: 'Wallet label (default: "Default")',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_keystore_status',
        description:
          'Check keystore initialization and lock state. ' +
          'Returns: initialized (bool), locked (bool), encryptionEnabled (bool). ' +
          'If not initialized → call conflux_setup_init. ' +
          'If locked → call conflux_keystore_unlock.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_keystore_unlock',
        description:
          'Unlock an encrypted keystore with the stored password. ' +
          'Required when conflux_keystore_status returns locked=true. ' +
          'After unlocking, call conflux_node_start.',
        inputSchema: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', description: 'Keystore password' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_keystore_lock',
        description:
          'Lock the active keystore. Useful before exporting logs or after privileged actions.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_wallets',
        description: 'List all configured wallet mnemonics (summaries only, no private keys).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      // ── Node lifecycle ───────────────────────────────────────────────────────
      {
        name: 'conflux_node_start',
        description:
          'Start the local Conflux development node (Core Space + eSpace). ' +
          'PREREQUISITE: server must be running AND keystore must be initialized and unlocked. ' +
          'If you get "Setup not completed" error, call conflux_setup_init first. ' +
          'Returns RPC URLs: Core=:12537 (chainId=2029), eSpace=:8545 (chainId=2030). ' +
          '10 genesis accounts are pre-funded with 1,000,000 CFX each.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_node_stop',
        description: 'Stop the local Conflux development node. Blockchain data is preserved.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_node_restart',
        description:
          'Restart the Conflux node (stop + start). Preserves all blockchain state. ' +
          'If restart fails (node unresponsive), use conflux_node_wipe_restart instead.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_node_wipe_restart',
        description:
          'TROUBLESHOOTING: Wipe all blockchain data and restart the node fresh. ' +
          'Use this when: node fails to start, RPC is unresponsive, state is corrupted, ' +
          'or you want a clean slate. ' +
          '⚠️  All deployed contracts and transaction history are lost. ' +
          '✓  Mnemonic and account addresses are preserved (same keys, fresh balances). ' +
          'After this, the node is running with 10 freshly funded genesis accounts.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_node_wipe',
        description:
          'Stop the Conflux node and wipe blockchain data WITHOUT restarting. ' +
          'Use when you want to manually control when the node restarts. ' +
          'Call conflux_node_start afterwards to bring it back up fresh.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      // ── Network & accounts ───────────────────────────────────────────────────
      {
        name: 'conflux_network_current',
        description:
          'Get current backend network mode selection (local/public), active chain IDs, and RPC settings.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_network_capabilities',
        description: 'Get backend network capability flags for current mode.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_network_config_get',
        description: 'Get backend network config (chain IDs, RPC ports, account count).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_network_config_set',
        description: 'Set backend local network config values (chain IDs, ports, account count).',
        inputSchema: {
          type: 'object',
          properties: {
            chainId: { type: 'number' },
            evmChainId: { type: 'number' },
            coreRpcPort: { type: 'number' },
            evmRpcPort: { type: 'number' },
            wsPort: { type: 'number' },
            evmWsPort: { type: 'number' },
            accounts: { type: 'number' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_network_set',
        description:
          'Set backend network mode. ' +
          'For mode="local", omit public config. ' +
          'For mode="public", provide coreRpcUrl and/or evmRpcUrl plus optional chain IDs.',
        inputSchema: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { type: 'string', enum: ['local', 'public'] },
            public: {
              type: 'object',
              properties: {
                coreRpcUrl: { type: 'string' },
                evmRpcUrl: { type: 'string' },
                chainId: { type: 'number' },
                evmChainId: { type: 'number' },
              },
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_settings',
        description:
          'Read backend runtime settings (host, port, authEnabled, CORS and rate limits).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_rpc_urls',
        description:
          'Get the current RPC endpoint URLs for the Conflux dev node. ' +
          'Returns Core Space and eSpace HTTP + WebSocket URLs, plus network config (chainIds, ports).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_accounts',
        description:
          'List all genesis accounts with Core Space and eSpace addresses, private keys, and live balances. ' +
          'Requires the node to be running. Use index 0 for default deployer account.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_fund_account',
        description:
          'Fund any address from the genesis faucet. Useful for testing with external wallets. ' +
          'Requires the node to be running.',
        inputSchema: {
          type: 'object',
          required: ['address'],
          properties: {
            address: {
              type: 'string',
              description: 'Core Space (cfx:...) or eSpace (0x...) address to fund',
            },
            amount: {
              type: 'string',
              description: 'Amount in CFX (default: "100")',
            },
            chain: {
              type: 'string',
              enum: ['core', 'evm'],
              description: 'Chain to fund on (auto-detected from address format if omitted)',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      // ── Mining ───────────────────────────────────────────────────────────────
      {
        name: 'conflux_mine',
        description:
          'Mine N blocks immediately on the local Conflux dev node. ' +
          'Useful for advancing block height or confirming transactions.',
        inputSchema: {
          type: 'object',
          properties: {
            blocks: {
              type: 'number',
              description: 'Number of blocks to mine (default: 1)',
            },
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_mining_start',
        description: 'Start auto-mining at a given interval (useful for keeping the chain active).',
        inputSchema: {
          type: 'object',
          properties: {
            intervalMs: {
              type: 'number',
              description: 'Auto-mining interval in milliseconds (default: 2000)',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_mining_stop',
        description: 'Stop auto-mining. Blocks will only be produced when explicitly mined.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      // ── Contract templates (compiler-based) ──────────────────────────────────
      {
        name: 'conflux_templates',
        description:
          'List available built-in contract templates (compiled with solc). ' +
          'Templates: Counter, SimpleStorage, TestToken, BasicNFT, Voting, Escrow, MultiSig, Registry. ' +
          'For production-ready contracts (ERC20Base, MultiSigWallet, etc.), use conflux_bootstrap_catalog.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_deploy',
        description:
          'Deploy a built-in contract template to the local Conflux dev node. ' +
          'Supports BOTH eSpace and Core Space — use chain="core" for Core Space deployment. ' +
          'Use conflux_templates to see available names. ' +
          'Runs the same constructor validation as conflux_deploy_prepare before deployment. ' +
          'For production contracts (ERC20Base, MultiSigWallet, etc.) use conflux_bootstrap_deploy.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description: 'Template name (e.g. "Counter", "SimpleStorage", "TestToken")',
            },
            args: {
              type: 'array',
              description: 'Constructor arguments (optional)',
              items: {},
            },
            chain: {
              type: 'string',
              enum: ['evm', 'core'],
              description: 'Deploy to eSpace (evm) or Core Space (core). Default: evm',
            },
            accountIndex: {
              type: 'number',
              description: 'Genesis account index to deploy from (default: 0)',
            },
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_deploy_prepare',
        description:
          'Prepare and validate a built-in template deployment WITHOUT deploying. ' +
          'Checks template existence and validates constructor argument count against the template ABI constructor schema.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description: 'Template name (e.g. Counter, TestToken, BasicNFT, MultiSigWallet)',
            },
            args: {
              type: 'array',
              description: 'Optional partial constructor arguments for validation',
              items: {},
            },
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_contracts',
        description:
          'List all contracts deployed during this session (both templates and bootstrap).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit server port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_contract_template_get',
        description: 'Get a single built-in contract template including source, ABI, and bytecode.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_contract_get',
        description: 'Get one tracked deployed contract by registry id.',
        inputSchema: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_contract_delete',
        description: 'Delete one tracked deployed contract by registry id (does not affect chain state).',
        inputSchema: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_contracts_clear',
        description: 'Clear all tracked deployed contracts from registry (does not affect chain state).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      // ── Bootstrap catalog (production-ready @cfxdevkit/dex-contracts) ────────────
      {
        name: 'conflux_bootstrap_catalog',
        description:
          'List the production-ready bootstrap contract catalog from @cfxdevkit/dex-contracts. ' +
          'Categories: tokens (ERC20Base, ERC721Base, ERC1155Base, WrappedCFX), ' +
          'defi (StakingRewards, VestingSchedule, ERC4626Vault), ' +
          'governance (MultiSigWallet, GovernorCore, RoleRegistry), ' +
          'utils (PaymentSplitter, MerkleAirdrop, Create2Factory), mocks (MockPriceOracle). ' +
          'Also lists Conflux precompiles (AdminControl, SponsorWhitelist, CrossSpaceCall) with fixed addresses.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_bootstrap_entry',
        description:
          'Get one bootstrap catalog preset with full deployment schema (constructor arg names/types/descriptions, ' +
          'supported chains, deployability, ABI/bytecode availability). Use this before prepare/deploy for strict validation.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', description: 'Catalog name (e.g. ERC20Base, MultiSigWallet)' },
            accountIndex: { type: 'number', description: 'Account index used for address placeholder defaults (default: 0)' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_bootstrap_prepare',
        description:
          'Prepare and validate a bootstrap deployment WITHOUT deploying. ' +
          'Checks preset name, chain compatibility, arg count, missing required args, and auto-fills safe defaults. ' +
          'Returns ready=true only when deployment inputs are complete.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description: 'Catalog name (e.g. ERC20Base, MultiSigWallet, StakingRewards)',
            },
            args: {
              type: 'array',
              description: 'Optional partial constructor args; missing slots are validated/defaulted',
              items: {},
            },
            chain: {
              type: 'string',
              enum: ['evm', 'core'],
              description: 'Target chain for compatibility checks. Default: evm',
            },
            accountIndex: {
              type: 'number',
              description: 'Genesis account index for default placeholder resolution (default: 0)',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_bootstrap_deploy',
        description:
          'Deploy a production-ready contract from the @cfxdevkit/dex-contracts bootstrap catalog. ' +
          'Use conflux_bootstrap_catalog to list available contracts and their constructor args. ' +
          'Runs the same strict validation as conflux_bootstrap_prepare before attempting deployment. ' +
          'Validates constructor args against the selected preset, auto-fills safe placeholder defaults where possible, ' +
          'and returns an explicit missing-args checklist before deploy. ' +
          'Supports both eSpace (EVM-compatible) and Core Space deployment.',
        inputSchema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description: 'Catalog name (e.g. "ERC20Base", "MultiSigWallet", "StakingRewards")',
            },
            args: {
              type: 'array',
              description: 'Constructor arguments matching the catalog schema',
              items: {},
            },
            chain: {
              type: 'string',
              enum: ['evm', 'core'],
              description: 'Deploy to eSpace (evm) or Core Space (core). Default: evm',
            },
            accountIndex: {
              type: 'number',
              description: 'Genesis account index (default: 0)',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'conflux_bootstrap_deploy_multi',
        description:
          'Deploy one bootstrap catalog contract to multiple chains in one workflow. ' +
          'Uses the same constructor args and account index, validates each chain independently, ' +
          'and returns per-chain success/failure details without hiding partial results.',
        inputSchema: {
          type: 'object',
          required: ['name', 'chains'],
          properties: {
            name: {
              type: 'string',
              description: 'Catalog name (e.g. "ERC20Base", "StakingRewards")',
            },
            chains: {
              type: 'array',
              items: { type: 'string', enum: ['evm', 'core'] },
              description: 'Target chains in desired execution order (e.g. ["evm","core"])',
            },
            args: {
              type: 'array',
              description: 'Constructor arguments used for each chain unless chainArgs override is provided.',
              items: {},
            },
            chainArgs: {
              type: 'object',
              description: 'Optional per-chain constructor args overrides: { evm: [...], core: [...] }',
              properties: {
                evm: { type: 'array', items: {} },
                core: { type: 'array', items: {} },
              },
            },
            accountIndex: {
              type: 'number',
              description: 'Genesis account index for deploy transactions (default: 0)',
            },
            continueOnError: {
              type: 'boolean',
              description: 'Continue remaining chains if one chain fails (default: true)',
            },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      // ── Blockchain interaction tools (@cfxdevkit/core) ────────────────────
      ...blockchainToolDefinitions,
      // ── Solidity compiler + template tools ───────────────────────────────
      ...compilerToolDefinitions,
      // ── DEX (Uniswap V2) tools ────────────────────────────────────────────
      ...dexToolDefinitions,
      {
        name: 'dex_manifest_get',
        description: 'Get DEX runtime manifest from backend /api/dex/manifest.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'dex_manifest_set',
        description: 'Set DEX runtime manifest via backend /api/dex/manifest.',
        inputSchema: {
          type: 'object',
          required: ['manifest'],
          properties: {
            manifest: {},
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'dex_translation_table_get',
        description: 'Get DEX real-to-local translation table from backend /api/dex/translation-table.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'dex_translation_table_set',
        description: 'Set DEX real-to-local translation table via backend /api/dex/translation-table.',
        inputSchema: {
          type: 'object',
          required: ['table'],
          properties: {
            table: {},
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'dex_pricing_wcfx_usd',
        description: 'Get WCFX/USD price snapshot from backend runtime providers.',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'dex_source_pools_refresh',
        description: 'Refresh selected source pool cache in backend dex runtime.',
        inputSchema: {
          type: 'object',
          required: ['chainId', 'tokenSelections'],
          properties: {
            chainId: { type: 'number' },
            tokenSelections: { type: 'array', items: {} },
            forceRefresh: { type: 'boolean' },
            maxAgeMs: { type: 'number' },
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
      {
        name: 'dex_runtime_state_clear',
        description: 'Clear backend dex runtime cached state (manifest, translation table, price cache).',
        inputSchema: {
          type: 'object',
          properties: {
            port: { type: 'number', description: 'conflux-devkit port (default: 7748)' },
          },
        },
      },
    ],
  }));

  // ── Tool handlers ─────────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;
    const workspaceCtx = getWorkspaceContext(a.composeFile as string | undefined);
    const composeOpts = { composeFile: workspaceCtx.composeFile };
    const devkitCfg: DevkitConfig = { port: resolveDevkitPort(workspaceCtx, a.port as number | undefined) };
    const devkitClient = new DevkitClient();

    try {
      // ── Compiler + template tools ──────────────────────────────────────────
      if (name.startsWith('cfxdevkit_compile') || name === 'cfxdevkit_list_templates' || name === 'cfxdevkit_get_template') {
        const result = await compilerToolHandler(name, a);
        if (result) {
          return { content: [{ type: 'text', text: result.text }] };
        }
      }

      // ── Blockchain tools (@cfxdevkit/core + keystore) ──────────────────────
      if (name.startsWith('blockchain_') || name.startsWith('cfxdevkit_')) {
        const result = await blockchainToolHandler(name, a);
        return {
          content: [{ type: 'text', text: result.text }],
          isError: result.isError,
        };
      }

      // ── DEX tools ──────────────────────────────────────────────────────────
      if (name.startsWith('dex_')) {
        const result = await dexToolHandler(name, a);
        return {
          content: [{ type: 'text', text: result.text }],
          isError: result.isError,
        };
      }

      const lifecycleResult = await handleConfluxLifecycleTool({
        name,
        args: a,
        devkitCfg,
        client: devkitClient,
      });
      if (lifecycleResult) {
        return lifecycleResult;
      }

      const keystoreResult = await handleConfluxKeystoreTool({
        name,
        args: a,
        devkitCfg,
        client: devkitClient,
      });
      if (keystoreResult) {
        return keystoreResult;
      }

      const networkResult = await handleConfluxNetworkTool({
        name,
        args: a,
        devkitCfg,
        client: devkitClient,
      });
      if (networkResult) {
        return networkResult;
      }

      const contractsResult = await handleConfluxContractsTool({
        name,
        args: a,
        devkitCfg,
        client: devkitClient,
        saveContract,
        deployCoreFromCatalogBytecode: async ({ name: contractName, abi, bytecode, constructorArgs, accountIndex }) => {
          const coreResult = await blockchainToolHandler('blockchain_core_deploy_contract', {
            abi: JSON.stringify(abi),
            bytecode,
            contractName,
            constructorArgs,
            accountIndex,
          });
          return { text: coreResult.text, isError: coreResult.isError };
        },
      });
      if (contractsResult) {
        return contractsResult;
      }

      switch (name) {

        // ── Docker Compose ────────────────────────────────────────────────────
        case 'workspace_status': {
          const status = getComposeStatus(composeOpts);
          if (!status.services.length) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No services found. Is docker-compose.yml present and Docker running?',
                },
              ],
            };
          }
          const lines = status.services.map(
            (s) => `${s.state === 'running' ? '✓' : '✗'} ${s.name.padEnd(20)} ${s.state}${s.ports ? `  (${s.ports})` : ''}`
          );
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        case 'workspace_start': {
          const service = a.service as string | undefined;
          const output = runCompose(service ? ['up', '-d', service] : ['up', '-d'], composeOpts);
          return {
            content: [{ type: 'text', text: output || `Services started${service ? `: ${service}` : ''}` }],
          };
        }

        case 'workspace_stop': {
          const service = a.service as string | undefined;
          const output = runCompose(service ? ['stop', service] : ['stop'], composeOpts);
          return {
            content: [{ type: 'text', text: output || `Services stopped${service ? `: ${service}` : ''}` }],
          };
        }

        case 'workspace_logs': {
          const service = a.service as string | undefined;
          const lines = (a.lines as number | undefined) ?? 50;
          const output = runCompose(
            ['logs', '--no-color', `--tail=${lines}`, ...(service ? [service] : [])],
            composeOpts
          );
          return { content: [{ type: 'text', text: output || 'No logs available.' }] };
        }

        case 'docker_available': {
          const available = isDockerAvailable();
          return {
            content: [
              {
                type: 'text',
                text: available
                  ? 'Docker daemon is reachable.'
                  : 'Docker daemon is NOT reachable. Check /var/run/docker.sock mount.',
              },
            ],
          };
        }

        case 'backend_api_catalog': {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(BACKEND_ENDPOINT_CATALOG, null, 2),
            }],
          };
        }

        case 'backend_health': {
          const result = await devkitApiRequest({
            path: '/health',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'backend_api_call': {
          const op = startOperation(name, a);
          const path = (a.path as string | undefined)?.trim();
          if (!path) {
            finishOperation(op.id, 'failed', 'missing path');
            return {
              content: [{ type: 'text', text: `Error: backend_api_call requires \`path\`. operationId=${op.id}` }],
              isError: true,
            };
          }

          const normalizedPath = path.startsWith('/') ? path : `/${path}`;
          if (!(normalizedPath === '/health' || normalizedPath.startsWith('/api/'))) {
            finishOperation(op.id, 'failed', 'invalid path');
            return {
              content: [{
                type: 'text',
                text: `Error: path must be /health or start with /api/. operationId=${op.id}`,
              }],
              isError: true,
            };
          }

          const method = ((a.method as string | undefined)?.toUpperCase() ?? 'GET') as HttpMethod;
          if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
            finishOperation(op.id, 'failed', 'invalid method');
            return {
              content: [{ type: 'text', text: `Error: method must be one of GET, POST, PUT, DELETE. operationId=${op.id}` }],
              isError: true,
            };
          }

          const port = (a.port as number | undefined) ?? 7748;
          addOperationStep(op.id, `${method} ${normalizedPath}`);
          const result = await devkitApiRequest({
            path: normalizedPath,
            method,
            body: a.body,
            port,
          });
          finishOperation(op.id, result.ok ? 'succeeded' : 'failed', result.ok ? undefined : `HTTP ${result.status}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                operationId: op.id,
                ok: result.ok,
                status: result.status,
                path: normalizedPath,
                method,
                data: result.json,
              }, null, 2),
            }],
            isError: !result.ok,
          };
        }

        case 'extension_capability_map': {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(EXTENSION_CAPABILITY_MAP, null, 2),
            }],
          };
        }

        case 'agent_workspace_context': {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                cwd: workspaceCtx.cwd,
                runtimeMode: workspaceCtx.runtimeMode,
                workspaceRoot: workspaceCtx.workspaceRoot,
                projectRoot: workspaceCtx.projectRoot,
                backendBaseUrl: workspaceCtx.backendBaseUrl,
                source: workspaceCtx.source,
                composeFileResolved: workspaceCtx.composeFile ?? null,
                composeCandidates: workspaceCtx.composeCandidates,
                guidance: isWorkspaceContainerContext(workspaceCtx)
                  ? 'Workspace-container mode detected. Prefer backend and MCP workflows over compose-first assumptions.'
                  : 'Repo-root mode detected. Pass composeFile explicitly when operating on project-example from the monorepo root.',
              }, null, 2),
            }],
          };
        }

        case 'agent_tool_contracts': {
          const contracts = {
            idempotent: [
              'backend_api_catalog',
              'extension_capability_map',
              'agent_tool_contracts',
              'agent_operation_get',
              'agent_operations_recent',
              'local_stack_status',
              'conflux_status',
              'conflux_keystore_status',
              'conflux_node_status',
              'conflux_deploy_prepare',
              'conflux_bootstrap_catalog',
              'conflux_bootstrap_entry',
              'conflux_bootstrap_prepare',
              'dex_status',
            ],
            mutating: [
              'workspace_start',
              'workspace_stop',
              'conflux_server_start',
              'conflux_setup_init',
              'conflux_keystore_unlock',
              'conflux_keystore_lock',
              'conflux_node_start',
              'conflux_node_stop',
              'conflux_node_restart',
              'conflux_node_wipe_restart',
              'conflux_node_wipe',
              'conflux_network_set',
              'conflux_network_config_set',
              'conflux_deploy',
              'conflux_bootstrap_deploy',
              'conflux_bootstrap_deploy_multi',
              'dex_deploy',
              'dex_seed_from_gecko',
              'dex_simulation_start',
              'dex_simulation_stop',
              'agent_runbook_execute',
            ],
            recommendedOrder: [
              'local_stack_status',
              'conflux_status',
              'conflux_deploy_prepare',
              'conflux_bootstrap_entry',
              'conflux_bootstrap_prepare',
              'conflux_bootstrap_deploy',
              'conflux_bootstrap_deploy_multi',
            ],
          };
          return { content: [{ type: 'text', text: JSON.stringify(contracts, null, 2) }] };
        }

        case 'agent_operation_get': {
          const id = a.operationId as string;
          const operation = id ? getOperation(id) : null;
          if (!operation) {
            return {
              content: [{ type: 'text', text: `Operation not found: ${id ?? '(missing id)'}` }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(operation, null, 2) }] };
        }

        case 'agent_operations_recent': {
          const limit = (a.limit as number | undefined) ?? 20;
          return {
            content: [{ type: 'text', text: JSON.stringify(listOperations(limit), null, 2) }],
          };
        }

        case 'agent_runbook_execute': {
          const op = startOperation(name, a);
          const runbook = a.runbook as string;
          if (!runbook) {
            finishOperation(op.id, 'failed', 'missing runbook');
            return {
              content: [{ type: 'text', text: `Error: agent_runbook_execute requires runbook. operationId=${op.id}` }],
              isError: true,
            };
          }
          const result = await executeRunbook({
            runbook,
            args: a,
            devkitCfg,
            composeOpts,
            workspaceCtx,
            devkitClient,
            operationId: op.id,
          });
          finishOperation(op.id, result.isError ? 'failed' : 'succeeded', result.isError ? result.text : undefined);
          return {
            content: [{ type: 'text', text: `${result.text}\noperationId=${op.id}` }],
            isError: result.isError,
          };
        }

        case 'conflux_keystore_lock': {
          const result = await devkitApiRequest({
            path: '/api/keystore/lock',
            method: 'POST',
            body: {},
            port: devkitCfg.port,
          });
          return {
            content: [{
              type: 'text',
              text: result.ok
                ? 'Keystore locked.'
                : `Failed to lock keystore: ${JSON.stringify(result.json)}`,
            }],
            isError: !result.ok,
          };
        }

        case 'conflux_network_current': {
          const result = await devkitApiRequest({
            path: '/api/network/current',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result.json, null, 2),
            }],
            isError: !result.ok,
          };
        }

        case 'conflux_network_capabilities': {
          const result = await devkitApiRequest({
            path: '/api/network/capabilities',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'conflux_network_config_get': {
          const result = await devkitApiRequest({
            path: '/api/network/config',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'conflux_network_config_set': {
          const payload: Record<string, unknown> = {};
          for (const k of ['chainId', 'evmChainId', 'coreRpcPort', 'evmRpcPort', 'wsPort', 'evmWsPort', 'accounts']) {
            if (a[k] !== undefined) {
              payload[k] = a[k];
            }
          }
          const result = await devkitApiRequest({
            path: '/api/network/config',
            method: 'PUT',
            body: payload,
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'conflux_network_set': {
          const payload: Record<string, unknown> = { mode: a.mode };
          if (a.public && typeof a.public === 'object') {
            payload.public = a.public;
          }
          const result = await devkitApiRequest({
            path: '/api/network/current',
            method: 'PUT',
            body: payload,
            port: devkitCfg.port,
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result.json, null, 2),
            }],
            isError: !result.ok,
          };
        }

        case 'conflux_settings': {
          const result = await devkitApiRequest({
            path: '/api/settings',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result.json, null, 2),
            }],
            isError: !result.ok,
          };
        }

        case 'conflux_contract_template_get': {
          const templateName = a.name as string;
          if (!templateName) {
            return { content: [{ type: 'text', text: 'Error: name is required.' }], isError: true };
          }
          const result = await devkitApiRequest({
            path: `/api/contracts/templates/${encodeURIComponent(templateName)}`,
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'conflux_contract_get': {
          const contractId = a.id as string;
          if (!contractId) {
            return { content: [{ type: 'text', text: 'Error: id is required.' }], isError: true };
          }
          const result = await devkitApiRequest({
            path: `/api/contracts/deployed/${encodeURIComponent(contractId)}`,
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'conflux_contract_delete': {
          const contractId = a.id as string;
          if (!contractId) {
            return { content: [{ type: 'text', text: 'Error: id is required.' }], isError: true };
          }
          const result = await devkitApiRequest({
            path: `/api/contracts/deployed/${encodeURIComponent(contractId)}`,
            method: 'DELETE',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'conflux_contracts_clear': {
          const result = await devkitApiRequest({
            path: '/api/contracts/deployed',
            method: 'DELETE',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_manifest_get': {
          const result = await devkitApiRequest({
            path: '/api/dex/manifest',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_manifest_set': {
          const result = await devkitApiRequest({
            path: '/api/dex/manifest',
            method: 'POST',
            body: a.manifest,
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_translation_table_get': {
          const result = await devkitApiRequest({
            path: '/api/dex/translation-table',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_translation_table_set': {
          const result = await devkitApiRequest({
            path: '/api/dex/translation-table',
            method: 'POST',
            body: a.table,
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_pricing_wcfx_usd': {
          const result = await devkitApiRequest({
            path: '/api/dex/pricing/wcfx-usd',
            method: 'GET',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_source_pools_refresh': {
          const result = await devkitApiRequest({
            path: '/api/dex/source-pools/refresh',
            method: 'POST',
            body: {
              chainId: a.chainId,
              tokenSelections: a.tokenSelections,
              forceRefresh: a.forceRefresh,
              maxAgeMs: a.maxAgeMs,
            },
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'dex_runtime_state_clear': {
          const result = await devkitApiRequest({
            path: '/api/dex/state',
            method: 'DELETE',
            port: devkitCfg.port,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result.json, null, 2) }],
            isError: !result.ok,
          };
        }

        case 'local_stack_status': {
          const docker = isDockerAvailable();
          const compose = docker ? getComposeStatus(composeOpts) : null;
          const fullStatus = await devkitClient.getStatus(devkitCfg).catch(() => null);
          const rpcUrl = (a.rpcUrl as string | undefined) ?? 'http://localhost:8545';
          const chainId = (a.chainId as number | undefined) ?? 2030;
          const dexResult = await dexToolHandler('dex_status', { rpcUrl, chainId }).catch((err) => ({
            text: `unavailable: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          }));

          let nextStep = 'Ready for deploys and interactions.';
          if (!fullStatus?.serverOnline) {
            nextStep = 'Run conflux_server_start.';
          } else if (!docker && !isWorkspaceContainerContext(workspaceCtx)) {
            nextStep = 'Start Docker daemon and re-run local_stack_status.';
          } else if (!fullStatus.keystoreStatus?.initialized) {
            nextStep = 'Run conflux_setup_init.';
          } else if (fullStatus.keystoreStatus.locked) {
            nextStep = 'Run conflux_keystore_unlock.';
          } else if (!fullStatus.nodeRunning) {
            nextStep = 'Run conflux_node_start.';
          } else if (dexResult.isError || dexResult.text.toLowerCase().includes('not deployed')) {
            nextStep = 'Run dex_deploy (then optionally dex_seed_from_gecko).';
          }

          const composeLines = compose?.services.length
            ? compose.services.map(
              (s) => `  ${s.state === 'running' ? '✓' : '✗'} ${s.name}${s.ports ? ` (${s.ports})` : ''}`
            )
            : [isWorkspaceContainerContext(workspaceCtx)
              ? '  (compose visibility not required in workspace-container mode)'
              : '  (no compose services detected)'];

          return {
            content: [{
              type: 'text',
              text: [
                '=== Local Stack Status ===',
                `Runtime mode: ${workspaceCtx.runtimeMode}`,
                `Workspace cwd: ${workspaceCtx.cwd}`,
                `Workspace root: ${workspaceCtx.workspaceRoot}`,
                `Backend: ${workspaceCtx.backendBaseUrl}`,
                `Compose file: ${composeOpts.composeFile ?? '(default docker-compose.yml not found in cwd)'}`,
                `Docker: ${docker ? 'reachable' : 'unreachable'}`,
                'Compose services:',
                ...composeLines,
                `Conflux server: ${fullStatus?.serverOnline ? 'online' : 'offline'}`,
                `Keystore initialized: ${fullStatus?.keystoreStatus?.initialized ? 'yes' : 'no'}`,
                `Keystore locked: ${fullStatus?.keystoreStatus?.locked ? 'yes' : 'no'}`,
                `Node running: ${fullStatus?.nodeRunning ? 'yes' : 'no'}`,
                `DEX status (${chainId} @ ${rpcUrl}):`,
                ...dexResult.text.split('\n').map((line) => `  ${line}`),
                '',
                `nextStep: ${nextStep}`,
              ].join('\n'),
            }],
            isError: !fullStatus?.serverOnline,
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
