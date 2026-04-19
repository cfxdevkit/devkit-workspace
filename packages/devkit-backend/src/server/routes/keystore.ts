import { validateMnemonic } from "@cfxdevkit/core/wallet";
import { Router } from "express";
import type { KeystoreApplicationService } from "../application/keystore-service.js";
import { ValidationError } from "../errors.js";
import { asyncHandler } from "../middleware.js";

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
export function createKeystoreRoutes(
	keystoreService: KeystoreApplicationService,
): Router {
	const router = Router();

	router.get(
		"/status",
		asyncHandler(async (_req, res) => {
			res.json(await keystoreService.getStatus());
		}),
	);

	router.post("/generate", (_req, res) => {
		res.json(keystoreService.generateMnemonic());
	});

	router.post(
		"/setup",
		asyncHandler(async (req, res) => {
			const {
				mnemonic,
				label = "Default",
				password,
				accountsCount,
			} = req.body as {
				mnemonic?: string;
				label?: string;
				password?: string;
				accountsCount?: number;
			};

			if (!mnemonic) {
				throw new ValidationError("mnemonic is required");
			}
			if (!validateMnemonic(mnemonic)) {
				throw new ValidationError("Invalid BIP-39 mnemonic");
			}

			await keystoreService.completeSetup({
				mnemonic,
				label,
				password,
				accountsCount,
			});
			res.json({ ok: true });
		}),
	);

	router.post(
		"/unlock",
		asyncHandler(async (req, res) => {
			const { password } = req.body as { password?: string };
			if (!password) {
				throw new ValidationError("password is required");
			}
			res.json(await keystoreService.unlock(password));
		}),
	);

	router.post(
		"/lock",
		asyncHandler(async (_req, res) => {
			res.json(await keystoreService.lock());
		}),
	);

	router.get(
		"/wallets",
		asyncHandler(async (_req, res) => {
			res.json(await keystoreService.listWallets());
		}),
	);

	router.post(
		"/wallets",
		asyncHandler(async (req, res) => {
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
				throw new ValidationError("mnemonic and label are required");
			}
			if (!validateMnemonic(mnemonic)) {
				throw new ValidationError("Invalid BIP-39 mnemonic");
			}

			const created = await keystoreService.addWallet({
				mnemonic,
				label,
				setAsActive,
				accountsCount,
			});
			res.status(201).json(created);
		}),
	);

	router.post(
		"/wallets/:id/activate",
		asyncHandler(async (req, res) => {
			res.json(await keystoreService.activateWallet(req.params.id as string));
		}),
	);

	router.delete(
		"/wallets/:id",
		asyncHandler(async (req, res) => {
			const { deleteData = false } = req.body as { deleteData?: boolean };
			res.json(
				await keystoreService.deleteWallet(req.params.id as string, deleteData),
			);
		}),
	);

	router.patch(
		"/wallets/:id",
		asyncHandler(async (req, res) => {
			const { label } = req.body as { label?: string };
			if (!label) {
				throw new ValidationError("label is required");
			}
			res.json(
				await keystoreService.updateWalletLabel(req.params.id as string, label),
			);
		}),
	);

	return router;
}
