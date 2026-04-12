import { Router } from 'express';
import type { NodeManager } from '../node-manager.js';

/**
 * Network / node configuration routes
 *
 * GET /api/network/config        — current node configuration (redacted)
 * PUT /api/network/config        — update node configuration
 *   body: Partial<ServerConfig>  (node must be stopped to apply most changes)
 * GET /api/network/rpc-urls      — current RPC endpoint URLs
 */
export function createNetworkRoutes(nodeManager: NodeManager): Router {
  const router = Router();

  router.get('/current', (_req, res) => {
    const profile = nodeManager.getNetworkProfile();
    const chainIds = nodeManager.getEffectiveChainIds();
    res.json({
      mode: profile.mode,
      public: profile.public,
      chainId: chainIds.chainId,
      evmChainId: chainIds.evmChainId,
      localNodeRunning: nodeManager.isRunning(),
    });
  });

  router.put('/current', async (req, res) => {
    const { mode, public: publicConfig } = req.body as {
      mode?: 'local' | 'public';
      public?: {
        coreRpcUrl?: string;
        evmRpcUrl?: string;
        chainId?: number;
        evmChainId?: number;
      };
    };

    if (!mode && !publicConfig) {
      res.status(400).json({
        error: 'Provide at least one field: mode or public',
      });
      return;
    }

    try {
      const profile = await nodeManager.setNetworkProfile({
        mode,
        public: publicConfig,
      });
      const chainIds = nodeManager.getEffectiveChainIds();
      res.json({
        ok: true,
        mode: profile.mode,
        public: profile.public,
        chainId: chainIds.chainId,
        evmChainId: chainIds.evmChainId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('running') ? 409 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.get('/capabilities', (_req, res) => {
    const profile = nodeManager.getNetworkProfile();
    const hasPublicCore = !!profile.public.coreRpcUrl;
    const hasPublicEvm = !!profile.public.evmRpcUrl;
    const inLocalMode = profile.mode === 'local';
    res.json({
      mode: profile.mode,
      capabilities: {
        localLifecycle: inLocalMode,
        localMining: inLocalMode,
        localAccounts: inLocalMode,
        contractDeployLocal: inLocalMode,
        contractDeployPublic: hasPublicCore || hasPublicEvm,
        contractReadPublic: hasPublicCore || hasPublicEvm,
        contractWritePublic: hasPublicCore || hasPublicEvm,
      },
    });
  });

  router.get('/config', (_req, res) => {
    res.json(nodeManager.getConfig());
  });

  router.put('/config', async (req, res) => {
    if (nodeManager.isRunning()) {
      res.status(409).json({
        error:
          'Node is running. Stop it before changing the network configuration.',
      });
      return;
    }

    const {
      coreRpcPort,
      evmRpcPort,
      wsPort,
      evmWsPort,
      chainId,
      evmChainId,
      log,
    } = req.body as {
      coreRpcPort?: number;
      evmRpcPort?: number;
      wsPort?: number;
      evmWsPort?: number;
      chainId?: number;
      evmChainId?: number;
      log?: boolean;
    };

    nodeManager.updateConfig({
      coreRpcPort,
      evmRpcPort,
      wsPort,
      evmWsPort,
      chainId,
      evmChainId,
      log,
    });
    res.json({ ok: true, config: nodeManager.getConfig() });
  });

  router.get('/rpc-urls', (_req, res) => {
    const profile = nodeManager.getNetworkProfile();
    if (profile.mode === 'public') {
      res.json({
        core: profile.public.coreRpcUrl ?? null,
        evm: profile.public.evmRpcUrl ?? null,
        coreWs: null,
        evmWs: null,
        ws: null,
        running: false,
        mode: 'public',
      });
      return;
    }

    const manager = nodeManager.getManager();
    if (!manager) {
      const cfg = nodeManager.getConfig();
      res.json({
        core: `http://localhost:${cfg.coreRpcPort}`,
        evm: `http://localhost:${cfg.evmRpcPort}`,
        coreWs: `ws://localhost:${cfg.wsPort}`,
        evmWs: `ws://localhost:${cfg.evmWsPort}`,
        ws: `ws://localhost:${cfg.wsPort}`,
        running: false,
        mode: 'local',
      });
      return;
    }
    res.json({ ...manager.getRpcUrls(), running: true, mode: 'local' });
  });

  return router;
}
