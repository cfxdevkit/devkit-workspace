import { Router } from 'express';
import type { NodeManager } from '../node-manager.js';

/**
 * Fetch Core Space balance via JSON-RPC (drip → CFX string).
 */
async function fetchCoreBalance(
  rpcUrl: string,
  address: string
): Promise<string> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'cfx_getBalance',
        params: [address, 'latest_state'],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const { result } = (await res.json()) as { result?: string };
    if (!result) return '0';
    // result is hex drip; divide by 10^18 for CFX
    const drip = BigInt(result);
    const whole = drip / 10n ** 18n;
    const frac = drip % 10n ** 18n;
    const fracStr = frac
      .toString()
      .padStart(18, '0')
      .replace(/0+$/, '')
      .slice(0, 4);
    return fracStr ? `${whole}.${fracStr}` : String(whole);
  } catch {
    return '';
  }
}

/**
 * Account routes
 *
 * GET  /api/accounts           — list all genesis accounts with live balances
 * GET  /api/accounts/faucet    — get the faucet account info
 * POST /api/accounts/fund      — fund an account from the faucet
 *   body: { address: string, amount?: string, chain?: 'core' | 'evm' }
 */
export function createAccountRoutes(nodeManager: NodeManager): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const manager = nodeManager.requireManager();
      const accounts = manager.getAccounts();
      const rpcUrls = manager.getRpcUrls();
      const config = nodeManager.getConfig();

      // Fetch live EVM and Core balances in parallel for all accounts
      const { createPublicClient, http, formatEther } = await import('viem');
      const publicClient = createPublicClient({
        chain: {
          id: config.evmChainId ?? 71,
          name: 'Conflux eSpace Local',
          nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
          rpcUrls: { default: { http: [rpcUrls.evm] } },
        },
        transport: http(rpcUrls.evm, { timeout: 5_000 }),
      });

      const accountsWithBalances = await Promise.all(
        accounts.map(async (a) => {
          const [evmBalance, coreBalance] = await Promise.all([
            publicClient
              .getBalance({ address: a.evmAddress as `0x${string}` })
              .then((b) => formatEther(b))
              .catch(() => ''),
            fetchCoreBalance(rpcUrls.core, a.coreAddress),
          ]);
          return { ...a, coreBalance, evmBalance };
        })
      );

      res.json(accountsWithBalances);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.get('/faucet', async (_req, res) => {
    try {
      const manager = nodeManager.requireManager();
      const faucet = manager.getFaucetAccount();
      const balances = await manager.getFaucetBalances();
      res.json({
        coreAddress: faucet.coreAddress,
        evmAddress: faucet.evmAddress,
        coreBalance: balances.core,
        evmBalance: balances.evm,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });

  router.post('/fund', async (req, res) => {
    const { address, amount, chain } = req.body as {
      address?: string;
      amount?: string;
      chain?: 'core' | 'evm';
    };

    if (!address) {
      res.status(400).json({ error: 'address is required' });
      return;
    }

    // Auto-detect chain from address format when not specified:
    // EVM/eSpace addresses start with '0x'; Conflux Core addresses use base32 (cfx:, cfxtest:, net...).
    const detectedChain: 'core' | 'evm' =
      chain ?? (address.trim().toLowerCase().startsWith('0x') ? 'evm' : 'core');

    try {
      const manager = nodeManager.requireManager();

      // Parse amount (default 100 CFX) and capture pre-fund balances to verify changes
      const amountStr = amount ?? '100';
      const amountNum = Number(amountStr);
      const faucetBefore = await manager.getFaucetBalances();
      const targetBefore =
        detectedChain === 'core'
          ? await manager.getCoreBalance(address)
          : await manager.getEvmBalance(address);

      let txHash: string;
      if (detectedChain === 'core') {
        txHash = await manager.fundCoreAccount(address, amountStr);
      } else {
        txHash = await manager.fundEvmAccount(address, amountStr);
      }

      // Immediately pack the pending funding tx into a block — same pattern as
      // contract deployment.  Without this, the auto-miner's next tick would
      // eventually pick it up, but the user would wait up to the mining interval
      // before the balance change is visible.
      await manager.packMine();

      // Poll for confirmation / balance change (timeout after 30s)
      const timeoutMs = 30_000;
      const intervalMs = 500; // fast: tx was just packed by packMine()
      const start = Date.now();
      let confirmed = false;
      let message = 'pending';

      while (Date.now() - start < timeoutMs) {
        try {
          if (detectedChain === 'core') {
            const targetAfter = await manager.getCoreBalance(address);
            if (
              Number(targetAfter || 0) >=
              Number(targetBefore || 0) + amountNum - 1e-9
            ) {
              confirmed = true;
              message = 'confirmed';
              break;
            }
            // also check faucet decreased
            const faucetAfter = await manager.getFaucetBalances();
            if (
              Number(faucetAfter.core || 0) <=
              Number(faucetBefore.core || 0) - amountNum - 1e-9
            ) {
              confirmed = true;
              message = 'confirmed (faucet debited)';
              break;
            }
          } else {
            // EVM funding uses the Core->eSpace bridge: check faucet core decrease or target eSpace increase
            const faucetAfter = await manager.getFaucetBalances();
            if (
              Number(faucetAfter.core || 0) <=
              Number(faucetBefore.core || 0) - amountNum - 1e-9
            ) {
              confirmed = true;
              message = 'confirmed (bridge tx mined)';
              break;
            }
            const targetAfter = await manager.getEvmBalance(address);
            if (
              Number(targetAfter || 0) >=
              Number(targetBefore || 0) + amountNum - 1e-9
            ) {
              confirmed = true;
              message = 'confirmed (eSpace balance updated)';
              break;
            }
          }
        } catch {
          // ignore transient errors and continue polling
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }

      res.json({ ok: true, txHash, confirmed, message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
