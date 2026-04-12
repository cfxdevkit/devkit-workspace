import { Router } from 'express';
import type { NodeManager } from '../node-manager.js';

/**
 * Mining routes
 *
 * GET  /api/mining/status        — current mining status
 * POST /api/mining/mine          — mine N blocks immediately
 *   body: { blocks?: number }
 * POST /api/mining/start         — start auto-mining at a given interval
 *   body: { intervalMs?: number }
 * POST /api/mining/stop          — stop auto-mining
 */
export function createMiningRoutes(nodeManager: NodeManager): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const manager = nodeManager.getManager();
    if (!manager) {
      res.json({ isRunning: false, blocksMined: 0 });
      return;
    }
    res.json(manager.getMiningStatus());
  });

  router.post('/mine', async (req, res) => {
    const { blocks = 1 } = req.body as { blocks?: number };
    const manager = nodeManager.requireManager();
    await manager.mine(blocks);
    res.json({ ok: true, mined: blocks });
  });

  router.post('/start', async (req, res) => {
    const { intervalMs = 2000 } = req.body as { intervalMs?: number };
    const manager = nodeManager.requireManager();
    await manager.startMining(intervalMs);
    res.json({ ok: true, status: manager.getMiningStatus() });
  });

  router.post('/stop', async (_req, res) => {
    const manager = nodeManager.requireManager();
    await manager.stopMining();
    res.json({ ok: true, status: manager.getMiningStatus() });
  });

  return router;
}
