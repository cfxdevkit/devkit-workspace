import { Router } from "express";
import { ContractsCatalogService } from "../application/contracts-catalog-service.js";
import { ContractsApplicationService } from "../application/contracts-service.js";
import type { StoredContract } from "../contract-storage.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { asyncHandler } from "../middleware.js";
import type { NodeManager } from "../node-manager.js";

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

	router.get("/templates", (_req, res) => {
		res.json(catalogService.listTemplates());
	});

	router.get("/templates/:name", (req, res) => {
		const template = catalogService.getTemplate(req.params.name);
		if (!template) {
			throw new NotFoundError(`Template "${req.params.name}" not found`);
		}
		res.json(template);
	});

	// ── Compile ────────────────────────────────────────────────────────────────

	router.post("/compile", (req, res) => {
		const payload = req.body as { source?: string; contractName?: string };
		const result = catalogService.compile(payload);
		if (!result.ok) {
			if ("details" in result) {
				res
					.status(result.status)
					.json({ error: result.error, details: result.details });
			} else {
				res.status(result.status).json({ error: result.error });
			}
			return;
		}

		res.json(result.payload);
	});

	// ── Deploy ─────────────────────────────────────────────────────────────────

	router.post(
		"/deploy",
		asyncHandler(async (req, res) => {
			let {
				bytecode,
				abi,
				args = [],
				chain = "evm",
				accountIndex = 0,
				contractName = "Contract",
				privateKey,
				rpcUrl,
				chainId,
			} = req.body as {
				bytecode?: string;
				abi?: unknown[];
				args?: unknown[];
				chain?: "core" | "evm";
				accountIndex?: number;
				contractName?: string;
				privateKey?: string;
				rpcUrl?: string;
				chainId?: number;
			};

			// Auto-resolve from template catalog when bytecode/abi not provided
			if (!bytecode || !abi) {
				const template = catalogService.getTemplate(contractName);
				if (!template) {
					throw new ValidationError(
						"bytecode and abi are required (or provide a valid contractName matching a built-in template)",
					);
				}
				bytecode = template.bytecode;
				abi = template.abi;
			}

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
				}),
			);
		}),
	);

	// ── Deployed contracts ─────────────────────────────────────────────────────

	router.get("/deployed", (req, res) => {
		const chain = req.query.chain as "evm" | "core" | undefined;
		res.json(contractsService.list(chain));
	});

	router.get("/deployed/:id", (req, res) => {
		const contract = contractsService.get(req.params.id);
		if (!contract) {
			throw new NotFoundError("Contract not found");
		}
		res.json(contract);
	});

	router.delete("/deployed/:id", (req, res) => {
		const deleted = contractsService.delete(req.params.id);
		if (!deleted) {
			throw new NotFoundError("Contract not found");
		}
		res.json({ ok: true });
	});

	router.delete("/deployed", (_req, res) => {
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

	router.post("/register", (req, res) => {
		const body = req.body as Partial<StoredContract>;
		if (
			!body.address ||
			!body.name ||
			!body.chain ||
			body.chainId === undefined
		) {
			throw new ValidationError(
				"Required fields: address, name, chain, chainId",
			);
		}
		const saved = contractsService.registerExternal(body);
		res.status(201).json(saved);
	});

	router.post(
		"/:id/call",
		asyncHandler(async (req, res) => {
			const id = req.params.id as string;
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
				throw new ValidationError("functionName is required");
			}

			res.json(
				await contractsService.callContract({
					id,
					functionName,
					args,
					accountIndex,
					privateKey,
				}),
			);
		}),
	);

	return router;
}
