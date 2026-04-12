import { Router } from 'express';
import type { NodeLifecycleService } from '../application/node-lifecycle-service.js';

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

  router.get('/status', async (_req, res) => {
    res.json(nodeService.getStatus());
  });

  router.post('/start', async (_req, res) => {
    try {
      res.json(await nodeService.start());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/stop', async (_req, res) => {
    try {
      res.json(await nodeService.stop());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/restart', async (_req, res) => {
    try {
      res.json(await nodeService.restart());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/restart-wipe', async (_req, res) => {
    try {
      res.json(await nodeService.restartWipe());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** Wipe data dir (stop first if running), without restarting. */
  router.post('/wipe', async (_req, res) => {
    try {
      res.json(await nodeService.wipe());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
