import { existsSync } from "node:fs";
import {
	createServer as createHttpServer,
	type Server as HttpServer,
} from "node:http";
import { join } from "node:path";
import compression from "compression";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { Server as IOServer } from "socket.io";
import { KeystoreApplicationService } from "./application/keystore-service.js";
import { NodeLifecycleService } from "./application/node-lifecycle-service.js";
import { log } from "./logger.js";
import { errorMiddleware } from "./middleware.js";
import { NodeManager } from "./node-manager.js";
import { createAccountRoutes } from "./routes/accounts.js";
import { createBootstrapRoutes } from "./routes/bootstrap.js";
import { createContractRoutes } from "./routes/contracts.js";
import { createDevnodeRoutes } from "./routes/devnode.js";
import { createDexRuntimeRoutes } from "./routes/dex-runtime.js";
import { createKeystoreRoutes } from "./routes/keystore.js";
import { createMiningRoutes } from "./routes/mining.js";
import { createNetworkRoutes } from "./routes/network.js";
import { setupWebSocket } from "./ws.js";

/** Locations where the pre-built Next.js static export may reside */
const UI_CANDIDATES = [
	// In CJS output __dirname is the directory containing the built cli.js
	join(__dirname, "..", "ui", "out"), // published npm package
	join(__dirname, "..", "..", "devkit-ui", "out"), // local monorepo development
];

// ── Simple in-memory rate limiter (no extra deps) ───────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_PER_WINDOW = 2000; // requests per IP per window
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimitMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	const ip =
		(req.headers["x-forwarded-for"] as string | undefined)
			?.split(",")[0]
			.trim() ??
		req.socket.remoteAddress ??
		"unknown";

	const now = Date.now();
	const entry = rateLimitStore.get(ip);

	if (!entry || now > entry.resetAt) {
		rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
		next();
		return;
	}

	entry.count++;
	if (entry.count > RATE_LIMIT_MAX_PER_WINDOW) {
		res
			.status(429)
			.json({ error: "Rate limit exceeded. Max 2000 requests/min per IP." });
		return;
	}

	next();
}

/**
 * Bearer token auth middleware — only activated when apiKey is set.
 * Allows requests:
 *  - from the loopback interface (127.0.0.1 / ::1)
 *  - with a valid Authorization: Bearer <apiKey> header
 *  - GET /health (always public)
 */
function makeAuthMiddleware(apiKey: string) {
	return function authMiddleware(
		req: Request,
		res: Response,
		next: NextFunction,
	): void {
		// Health check is always public
		if (req.path === "/health") {
			next();
			return;
		}

		// Loopback requests are trusted without a key
		const remoteIp = req.socket.remoteAddress ?? "";
		if (
			remoteIp === "127.0.0.1" ||
			remoteIp === "::1" ||
			remoteIp === "::ffff:127.0.0.1"
		) {
			next();
			return;
		}

		const authHeader = req.headers.authorization ?? "";
		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

		if (token !== apiKey) {
			res
				.status(401)
				.json({ error: "Unauthorized. Provide a valid Bearer token." });
			return;
		}

		next();
	};
}

export interface AppConfig {
	port: number;
	/** Network interface to bind on. Default: '127.0.0.1' (localhost only).
	 *  Set to '0.0.0.0' to expose on all interfaces (public hosting).
	 *  When not localhost, --api-key should also be set. */
	host?: string;
	/** API key for Bearer token auth. Required when host != 127.0.0.1 for security. */
	apiKey?: string;
	/** Allowed CORS origins. Default: '*' (local) or explicit list (public). */
	corsOrigins?: string | string[];
}

export interface AppInstance {
	app: Express;
	httpServer: HttpServer;
	io: IOServer;
	start(): Promise<void>;
	/** Gracefully close the HTTP server, WebSocket server, and stop the Conflux node. */
	stop(): Promise<void>;
}

export function createApp(config: AppConfig): AppInstance {
	const { port, host = "127.0.0.1", apiKey, corsOrigins } = config;

	// Warn when exposed to non-loopback without an API key
	const isPublic = host !== "127.0.0.1" && host !== "localhost";
	if (isPublic && !apiKey) {
		log.warn(
			"Backend is bound to a public interface without an API key. " +
				"Pass --api-key <secret> to require Bearer token authentication.",
		);
	}

	// Effective CORS origins: default open for localhost, restricted for public
	const effectiveCorsOrigins = corsOrigins ?? (isPublic ? [] : "*");

	const app = express();
	const httpServer = createHttpServer(app);
	const io = new IOServer(httpServer, {
		cors: { origin: effectiveCorsOrigins },
	});

	const nodeManager = new NodeManager();
	const nodeService = new NodeLifecycleService(nodeManager);
	const keystoreService = new KeystoreApplicationService();

	// ── Middleware ───────────────────────────────────────────────────────────
	app.use(cors({ origin: effectiveCorsOrigins }));
	app.use(compression() as express.RequestHandler);
	app.use(express.json({ limit: "10mb" }));

	// Rate limiting — always on
	app.use(rateLimitMiddleware);

	// Auth — only on /api when apiKey is set
	if (apiKey) {
		app.use("/api", makeAuthMiddleware(apiKey));
	}

	// ── Health ───────────────────────────────────────────────────────────────
	app.get("/health", (_req, res) => {
		res.json({ ok: true, ts: new Date().toISOString() });
	});

	// ── Settings (read-only) ─────────────────────────────────────────────────
	// Returns the active runtime security/hosting settings so the UI can display
	// them in a Settings panel.  The apiKey value is NEVER included in the response.
	app.get("/api/settings", (_req, res) => {
		res.json({
			host,
			port,
			isPublic,
			authEnabled: !!apiKey,
			corsOrigins: effectiveCorsOrigins,
			rateLimit: {
				windowMs: RATE_LIMIT_WINDOW_MS,
				maxRequests: RATE_LIMIT_MAX_PER_WINDOW,
			},
		});
	});

	// ── API routes ───────────────────────────────────────────────────────────
	app.use("/api/node", createDevnodeRoutes(nodeService));
	app.use("/api/accounts", createAccountRoutes(nodeManager));
	app.use("/api/contracts", createContractRoutes(nodeManager));
	app.use("/api/bootstrap", createBootstrapRoutes(nodeManager));
	app.use("/api/mining", createMiningRoutes(nodeManager));
	app.use("/api/network", createNetworkRoutes(nodeManager));
	app.use("/api/keystore", createKeystoreRoutes(keystoreService));
	app.use("/api/dex", createDexRuntimeRoutes(nodeManager));

	// ── Static UI ─────────────────────────────────────────────────────────
	const uiDir = UI_CANDIDATES.find(existsSync);
	if (uiDir) {
		app.use(express.static(uiDir));
		// SPA fallback — return index.html for any non-API route
		app.get("*", (_req, res) => {
			const index = join(uiDir, "index.html");
			if (existsSync(index)) {
				res.sendFile(index);
			} else {
				res.status(404).send("index.html not found");
			}
		});
	} else {
		app.get("/", (_req, res) => {
			res.json({
				message: "conflux-devkit API is running",
				note: "UI not built. Run: pnpm --filter conflux-devkit-ui build",
				endpoints: [
					"/api/node",
					"/api/accounts",
					"/api/contracts",
					"/api/mining",
					"/api/network",
					"/api/keystore",
					"/api/dex",
				],
			});
		});
	}

	// ── Error handler ────────────────────────────────────────────────────────
	app.use(errorMiddleware);

	// ── WebSocket ────────────────────────────────────────────────────────────
	setupWebSocket(io, nodeManager);

	return {
		app,
		httpServer,
		io,
		async start(): Promise<void> {
			log.info(
				`Initializing backend (port=${port}, host=${host}, log=${log.filePath})`,
			);
			await nodeManager.initialize();
			return new Promise<void>((resolve, reject) => {
				httpServer.listen(port, host, (err?: Error) => {
					if (err) {
						log.error("Failed to bind HTTP server", err);
						reject(err);
					} else {
						log.info(`HTTP server listening on ${host}:${port}`);
						resolve();
					}
				});
			});
		},

		async stop(): Promise<void> {
			log.info("Shutting down...");
			// Stop WebSocket server first so no new events are emitted
			await new Promise<void>((resolve) => io.close(() => resolve()));
			// Stop the Conflux node
			try {
				await nodeManager.stop();
			} catch {
				/* already stopped */
			}
			// Close HTTP server — io.close() already closes it, so ignore ERR_SERVER_NOT_RUNNING
			await new Promise<void>((resolve) =>
				httpServer.close(() => resolve()),
			).catch(() => {
				/* already closed by io.close() */
			});
			log.info("Shutdown complete");
		},
	};
}
