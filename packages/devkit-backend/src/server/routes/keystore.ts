import {
  validateMnemonic,
} from '@cfxdevkit/core/wallet';
import { Router } from 'express';
import type { KeystoreApplicationService } from '../application/keystore-service.js';

/**
 * Keystore / wallet management routes
 *
 * GET  /api/keystore/status           — setup state, lock state, mnemonic count
 * POST /api/keystore/setup            — first-time setup { mnemonic, label, password? }
 * POST /api/keystore/unlock           — unlock encrypted keystore { password }
 * POST /api/keystore/lock             — lock keystore
 * POST /api/keystore/generate         — generate a new random BIP-39 mnemonic
 *
 * GET  /api/keystore/wallets          — list all mnemonics (summary, no keys)
 * POST /api/keystore/wallets          — add mnemonic { mnemonic, label, password?, setAsActive? }
 * POST /api/keystore/wallets/:id/activate  — switch active mnemonic
 * DELETE /api/keystore/wallets/:id    — delete a mnemonic
 */
export function createKeystoreRoutes(keystoreService: KeystoreApplicationService): Router {
  const router = Router();

  router.get('/status', async (_req, res) => {
    res.json(await keystoreService.getStatus());
  });

  router.post('/generate', (_req, res) => {
    res.json(keystoreService.generateMnemonic());
  });

  router.post('/setup', async (req, res) => {
    const {
      mnemonic,
      label = 'Default',
      password,
      accountsCount,
    } = req.body as {
      mnemonic?: string;
      label?: string;
      password?: string;
      accountsCount?: number;
    };

    if (!mnemonic) {
      res.status(400).json({ error: 'mnemonic is required' });
      return;
    }
    if (!validateMnemonic(mnemonic)) {
      res.status(400).json({ error: 'Invalid BIP-39 mnemonic' });
      return;
    }

    await keystoreService.completeSetup({
      mnemonic,
      label,
      password,
      accountsCount,
    });
    res.json({ ok: true });
  });

  router.post('/unlock', async (req, res) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ error: 'password is required' });
      return;
    }
    res.json(await keystoreService.unlock(password));
  });

  router.post('/lock', async (_req, res) => {
    res.json(await keystoreService.lock());
  });

  router.get('/wallets', async (_req, res) => {
    try {
      res.json(await keystoreService.listWallets());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/wallets', async (req, res) => {
    const {
      mnemonic,
      label,
      setAsActive = false,
      accountsCount,
    } = req.body as {
      mnemonic?: string;
      label?: string;
      setAsActive?: boolean;
      accountsCount?: number;
    };

    if (!mnemonic || !label) {
      res.status(400).json({ error: 'mnemonic and label are required' });
      return;
    }
    if (!validateMnemonic(mnemonic)) {
      res.status(400).json({ error: 'Invalid BIP-39 mnemonic' });
      return;
    }

    const created = await keystoreService.addWallet({
      mnemonic,
      label,
      setAsActive,
      accountsCount,
    });
    res.status(201).json(created);
  });

  router.post('/wallets/:id/activate', async (req, res) => {
    res.json(await keystoreService.activateWallet(req.params.id));
  });

  router.delete('/wallets/:id', async (req, res) => {
    const { deleteData = false } = req.body as { deleteData?: boolean };
    res.json(await keystoreService.deleteWallet(req.params.id, deleteData));
  });

  router.patch('/wallets/:id', async (req, res) => {
    const { label } = req.body as { label?: string };
    if (!label) {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    try {
      res.json(await keystoreService.updateWalletLabel(req.params.id, label));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
