/**
 * conflux-devkit — CLI entry point
 *
 * Usage:
 *   npx conflux-devkit
 *   npx conflux-devkit --port 4200
 *   npx conflux-devkit --host 0.0.0.0 --api-key mysecret
 *   npx conflux-devkit --no-open
 */

import { createApp } from "./server/index.js";
import { log } from "./server/logger.js";

// ---- simple argument parser (avoids extra dep) ----
const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
	console.log(`
conflux-devkit — Conflux local development environment

Usage:
  npx conflux-devkit [options]

Options:
  -p, --port <port>       Port for the web UI  (default: 7748)
  --host <address>        Network interface to bind on (default: 127.0.0.1)
                          Use 0.0.0.0 to expose on all interfaces (public hosting).
  --api-key <secret>      Require this Bearer token on all API requests.
                          Strongly recommended when --host is not localhost.
  --cors-origin <origin>  Allowed CORS origin(s), comma-separated.
  --no-open               Do not open the browser automatically
  -h, --help              Show this help message

Security notes:
  When binding to a non-loopback interface (--host 0.0.0.0) without --api-key,
  a warning is printed. Set --api-key to enable Bearer token authentication on
  all /api routes. Loopback connections are always trusted.
`);
	process.exit(0);
}

function getArg(flag: string, short?: string): string | undefined {
	for (const [i, a] of args.entries()) {
		if ((a === flag || (short && a === short)) && args[i + 1])
			return args[i + 1];
		if (a.startsWith(`${flag}=`)) return a.split("=").slice(1).join("=");
	}
	return undefined;
}

const port = Number.parseInt(getArg("--port", "-p") ?? "7748", 10);
const host = getArg("--host") ?? "127.0.0.1";
const apiKey = getArg("--api-key");
const corsOriginsRaw = getArg("--cors-origin");
const corsOrigins = corsOriginsRaw
	? corsOriginsRaw.split(",").map((s) => s.trim())
	: undefined;
const shouldOpen = !args.includes("--no-open");

const instance = createApp({ port, host, apiKey, corsOrigins });

// ── Graceful shutdown on Ctrl+C / SIGTERM ──────────────────────────────────
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	log.info(`Received ${signal} — shutting down…`);
	try {
		await instance.stop();
		log.info("Shutdown complete. Goodbye.");
		process.exit(0);
	} catch (err) {
		log.error("Shutdown error", err);
		process.exit(1);
	}
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start ──────────────────────────────────────────────────────────────────
instance
	.start()
	.then(async () => {
		const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
		log.info(`conflux-devkit started → ${url}`);
		console.log(`\n  ✦  conflux-devkit  →  ${url}\n`);
		if (apiKey) {
			console.log(
				`  🔒  API key auth enabled — pass  Authorization: Bearer <key>  on remote requests\n`,
			);
		}

		if (shouldOpen) {
			// dynamic import avoids bundling 'open' into the critical path
			const { default: open } = await import("open");
			await open(url);
		}
	})
	.catch((err: unknown) => {
		log.error("Failed to start conflux-devkit", err);
		process.exit(1);
	});
