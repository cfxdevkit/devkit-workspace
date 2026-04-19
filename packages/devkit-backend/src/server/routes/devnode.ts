import { Router } from "express";
import type { NodeLifecycleService } from "../application/node-lifecycle-service.js";
import { asyncHandler } from "../middleware.js";

/**
 * Node lifecycle routes
 *
 * POST /api/node/start    — start the local Conflux node
 * POST /api/node/stop     — stop the node
 * POST /api/node/restart  — restart the node
 * GET  /api/node/status   — comprehensive status (running, rpc urls, mining, etc.)
 */
export function createDevnodeRoutes(nodeService: NodeLifecycleService): Router {
	const router = Router();

	router.get("/status", (_req, res) => {
		res.json(nodeService.getStatus());
	});

	router.post(
		"/start",
		asyncHandler(async (_req, res) => {
			res.json(await nodeService.start());
		}),
	);

	router.post(
		"/stop",
		asyncHandler(async (_req, res) => {
			res.json(await nodeService.stop());
		}),
	);

	router.post(
		"/restart",
		asyncHandler(async (_req, res) => {
			res.json(await nodeService.restart());
		}),
	);

	router.post(
		"/restart-wipe",
		asyncHandler(async (_req, res) => {
			res.json(await nodeService.restartWipe());
		}),
	);

	router.post(
		"/wipe",
		asyncHandler(async (_req, res) => {
			res.json(await nodeService.wipe());
		}),
	);

	return router;
}
