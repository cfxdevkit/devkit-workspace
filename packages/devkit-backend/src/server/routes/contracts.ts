import { Router } from 'express';
import type { StoredContract } from '../contract-storage.js';
import { ContractsCatalogService } from '../application/contracts-catalog-service.js';
import { ContractsApplicationService, mapDeployErrorStatus } from '../application/contracts-service.js';
import type { NodeManager } from '../node-manager.js';

/**
 * Contract routes
 *
 * GET  /api/contracts/templates          — list available built-in templates
 * GET  /api/contracts/templates/:name    — get source + ABI + bytecode for a template
 * POST /api/contracts/compile            — compile arbitrary Solidity source
 *   body: { source: string, contractName?: string }
 * POST /api/contracts/deploy             — deploy a compiled contract
 *   body: { bytecode, abi, args?, chain?, accountIndex?, contractName? }
 * GET  /api/contracts/deployed           — list persisted deployed contracts
 * GET  /api/contracts/deployed/:id       — get one by id
 * DELETE /api/contracts/deployed/:id     — remove from tracking (doesn't affect chain)
 * DELETE /api/contracts/deployed         — clear all
 */
export function createContractRoutes(nodeManager: NodeManager): Router {
  const router = Router();
  const catalogService = new ContractsCatalogService();
  const contractsService = new ContractsApplicationService(nodeManager);

  // ── Templates ──────────────────────────────────────────────────────────────

  router.get('/templates', (_req, res) => {
    res.json(catalogService.listTemplates());
  });

  router.get('/templates/:name', (req, res) => {
    const template = catalogService.getTemplate(req.params.name);
    if (!template) {
      res.status(404).json({ error: `Template "${req.params.name}" not found` });
      return;
    }
    res.json(template);
  });

  // ── Compile ────────────────────────────────────────────────────────────────

  router.post('/compile', (req, res) => {
    const payload = req.body as { source?: string; contractName?: string };
    const result = catalogService.compile(payload);
    if (!result.ok) {
      if ('details' in result) {
        res.status(result.status).json({ error: result.error, details: result.details });
      } else {
        res.status(result.status).json({ error: result.error });
      }
      return;
    }

    res.json(result.payload);
  });

  // ── Deploy ─────────────────────────────────────────────────────────────────

  router.post('/deploy', async (req, res) => {
    const {
      bytecode,
      abi,
      args = [],
      chain = 'evm',
      accountIndex = 0,
      contractName = 'Contract',
      privateKey,
      rpcUrl,
      chainId,
    } = req.body as {
      bytecode?: string;
      abi?: unknown[];
      args?: unknown[];
      chain?: 'core' | 'evm';
      accountIndex?: number;
      contractName?: string;
      privateKey?: string;
      rpcUrl?: string;
      chainId?: number;
    };

    if (!bytecode || !abi) {
      res.status(400).json({ error: 'bytecode and abi are required' });
      return;
    }

    try {
      res.json(
        await contractsService.deploy({
          bytecode,
          abi,
          args,
          chain,
          accountIndex,
          contractName,
          privateKey,
          rpcUrl,
          chainId,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = mapDeployErrorStatus(msg);
      res.status(status).json({ error: msg });
    }
  });

  // ── Deployed contracts ─────────────────────────────────────────────────────

  router.get('/deployed', (req, res) => {
    const chain = req.query.chain as 'evm' | 'core' | undefined;
    res.json(contractsService.list(chain));
  });

  router.get('/deployed/:id', (req, res) => {
    const contract = contractsService.get(req.params.id);
    if (!contract) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }
    res.json(contract);
  });

  router.delete('/deployed/:id', (req, res) => {
    const deleted = contractsService.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Contract not found' });
      return;
    }
    res.json({ ok: true });
  });

  router.delete('/deployed', (_req, res) => {
    contractsService.clear();
    res.json({ ok: true });
  });

  // ── Register (external deploy) ─────────────────────────────────────────────
  // POST /api/contracts/register
  //   Registers a contract that was deployed by an external tool (MCP server,
  //   DEX service, etc.) rather than through the devkit's own deploy route.
  //   Allows MCP and other tooling to have a single persisted contract registry.
  //
  //   body: { name, address, chain, chainId, txHash?, deployer?,
  //           deployedAt?, abi?, constructorArgs?, metadata? }

  router.post('/register', (req, res) => {
    const body = req.body as Partial<StoredContract>;
    if (!body.address || !body.name || !body.chain || body.chainId === undefined) {
      res
        .status(400)
        .json({ error: 'Required fields: address, name, chain, chainId' });
      return;
    }
    const saved = contractsService.registerExternal(body);
    res.status(201).json(saved);
  });

  // ── Contract call / interact ───────────────────────────────────────────────
  // POST /api/contracts/:id/call
  //   body: { functionName, args?, accountIndex? }
  //   Read (view/pure)  → returns { success, result }
  //   Write             → packMine() + poll → returns { success, txHash, blockNumber, status }

  router.post('/:id/call', async (req, res) => {
    const { id } = req.params;
    const {
      functionName,
      args = [],
      accountIndex = 0,
      privateKey,
    } = req.body as {
      functionName?: string;
      args?: unknown[];
      accountIndex?: number;
      privateKey?: string;
    };

    if (!functionName) {
      res.status(400).json({ error: 'functionName is required' });
      return;
    }

    try {
      res.json(
        await contractsService.callContract({
          id,
          functionName,
          args,
          accountIndex,
          privateKey,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Call failed: ${msg}` });
    }
  });

  return router;
}

