#!/usr/bin/env node
/**
 * prefetch-dex-feeds.mjs
 *
 * Warms the GeckoTerminal feed cache so that dex_seed can run without
 * waiting for a full network fetch.
 *
 * Fast path: if the known-tokens catalog is present in the DEX UI package
 * (baked into the npm global install), seeding will use local data and no
 * GeckoTerminal calls are needed. In that case this script exits immediately.
 *
 * Slow path: no catalog — warm the GeckoTerminal feed cache with verbose
 * progress output so the user can tell it is not stuck.
 *
 * Called during postCreateCommand so the cache is ready before the user
 * deploys the DEX for the first time.
 *
 * Exits 0 on success or if the backend is unreachable (non-fatal for
 * container setup — dex_seed retries automatically).
 */

import { existsSync, readFileSync } from "node:fs";

const BACKEND_PORT = process.env.DEVKIT_BACKEND_PORT ?? "7748";
const BASE = `http://127.0.0.1:${BACKEND_PORT}`;
const TIMEOUT_MS = 300_000; // GeckoTerminal 429 back-off: up to 5 min in worst case

/** Paths where known-tokens.json catalog may live after npm global install. */
const CATALOG_CANDIDATES = [
	"/usr/local/lib/node_modules/@devkit/devkit-dex-ui/dist/known-tokens.json", // npm global (devcontainer): Next.js build output
	"/usr/local/lib/node_modules/@devkit/devkit-dex-ui/public/known-tokens.json", // npm global: pre-built
	"/usr/lib/node_modules/@devkit/devkit-dex-ui/dist/known-tokens.json", // alternate npm global
	"/usr/lib/node_modules/@devkit/devkit-dex-ui/public/known-tokens.json", // alternate npm global
	"/opt/devkit/apps/dex-ui/public/known-tokens.json", // legacy
];

function findCatalog() {
	for (const p of CATALOG_CANDIDATES) {
		if (!existsSync(p)) continue;
		try {
			const data = JSON.parse(readFileSync(p, "utf-8"));
			const count = Array.isArray(data?.pools) ? data.pools.length : 0;
			if (count > 0) return { path: p, count };
		} catch {
			/* malformed — skip */
		}
	}
	return null;
}

async function apiFetch(path, init = {}) {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(`${BASE}${path}`, {
			...init,
			headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
			signal: ctrl.signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

async function waitForBackend(maxWaitMs = 30_000) {
	const deadline = Date.now() + maxWaitMs;
	let dots = 0;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE}/health`, {
				signal: AbortSignal.timeout(2_000),
			});
			if (res.ok) return true;
		} catch {
			/* not ready yet */
		}
		dots++;
		if (dots % 5 === 1) {
			process.stdout.write(
				`[prefetch-dex-feeds] Backend not ready yet, retrying`,
			);
		} else {
			process.stdout.write(".");
		}
		if (dots % 5 === 0) process.stdout.write("\n");
		await new Promise((r) => setTimeout(r, 1_000));
	}
	process.stdout.write("\n");
	return false;
}

async function main() {
	// ── Fast path: catalog present → seeding needs no GeckoTerminal calls ──
	const catalog = findCatalog();
	if (catalog) {
		console.log(
			`[prefetch-dex-feeds] ✓ Local token catalog: ${catalog.path} (${catalog.count} pools)`,
		);
		console.log(
			"[prefetch-dex-feeds] Seeding resolves tokens from the local catalog — GeckoTerminal prefetch not needed.",
		);
		process.exit(0);
	}

	// ── Slow path: no catalog — warm the GeckoTerminal feed cache ──────────
	console.log(
		"[prefetch-dex-feeds] No local catalog found — will warm GeckoTerminal feed cache.",
	);
	console.log("[prefetch-dex-feeds] Waiting for devkit backend…");

	const t0 = Date.now();
	const ready = await waitForBackend(30_000);
	if (!ready) {
		console.warn(
			"[prefetch-dex-feeds] Backend not reachable after 30 s — skipping prefetch.",
		);
		process.exit(0);
	}
	console.log(`[prefetch-dex-feeds] Backend ready (${Date.now() - t0} ms).`);

	// Step 1: fetch pool suggestions (proves GeckoTerminal is reachable)
	console.log(
		"[prefetch-dex-feeds] Step 1/2 — fetching top Conflux pools from GeckoTerminal…",
	);
	const t1 = Date.now();
	try {
		const sugg = await apiFetch("/api/dex/source-pools/suggestions?limit=10");
		const n = sugg?.suggestions?.length ?? 0;
		console.log(
			`[prefetch-dex-feeds] Step 1/2 — ${n} pool suggestions (${Date.now() - t1} ms).`,
		);
	} catch (err) {
		console.warn(
			`[prefetch-dex-feeds] Step 1/2 failed: ${err.message} — will still attempt cache warm.`,
		);
	}

	// Step 2: warm token feed cache (resolves price history — slow with 429 back-off)
	console.log(
		"[prefetch-dex-feeds] Step 2/2 — warming token feed cache (may take 1–3 min if GeckoTerminal rate-limits)…",
	);
	const t2 = Date.now();
	try {
		const result = await apiFetch("/api/dex/source-pools/prefetch", {
			method: "POST",
			body: JSON.stringify({ forceRefresh: false }),
		});
		if (result.tokens === 0) {
			console.log(
				`[prefetch-dex-feeds] ${result.message ?? "No tokens cached."}`,
			);
		} else {
			console.log(
				`[prefetch-dex-feeds] ✓ Feed cache warm — ${result.tokens} tokens, WCFX $${(result.wcfxPriceUsd ?? 0).toFixed(4)} (${Date.now() - t2} ms).`,
			);
		}
	} catch (err) {
		console.warn(
			`[prefetch-dex-feeds] Feed prefetch failed: ${err.message} — will be retried on dex_seed.`,
		);
		process.exit(0);
	}
}

main().catch((err) => {
	console.error("[prefetch-dex-feeds] Unexpected error:", err);
	process.exit(0); // non-fatal — never break container setup
});
