import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { recoverMessageAddress } from "viem";
import {
	type Connect,
	defineConfig,
	type Plugin,
	type ViteDevServer,
} from "vite";
import { codeServerProxyBasePlugin } from "./code-server-proxy-base";

// ── SIWE auth middleware for Vite dev ────────────────────────────────────────
// Mirrors the same logic in server.ts but as connect middleware.
function siweAuthPlugin(): Plugin {
	const sessions = new Map<string, { address: string; chainId: number }>();
	const pendingNonces = new Map<string, true>();

	function parseCookies(h?: string) {
		const c: Record<string, string> = {};
		if (!h) return c;
		for (const p of h.split(";")) {
			const [k, ...r] = p.trim().split("=");
			if (k) c[k] = r.join("=");
		}
		return c;
	}

	function parseSiweMessage(msg: string) {
		const lines = msg.split("\n");
		const r: Record<string, string | number> = {};
		for (const l of lines) {
			if (l.startsWith("Chain ID: ")) r.chainId = Number(l.slice(10));
			else if (l.startsWith("Nonce: ")) r.nonce = l.slice(7);
			else if (l.startsWith("Issued At: ")) r.issuedAt = l.slice(11);
			else if (/^0x[a-fA-F0-9]{40}$/.test(l.trim())) r.address = l.trim();
		}
		return r;
	}

	async function recoverAddress(
		message: string,
		signature: string,
	): Promise<string> {
		return recoverMessageAddress({
			message,
			signature: signature as `0x${string}`,
		});
	}

	return {
		name: "siwe-auth",
		configureServer(server: ViteDevServer) {
			server.middlewares.use(
				async (
					req: IncomingMessage,
					res: ServerResponse,
					next: Connect.NextFunction,
				) => {
					if (!req.url?.startsWith("/api/auth/")) return next();

					res.setHeader("Content-Type", "application/json");
					const send = (status: number, body: object) => {
						res.writeHead(status);
						res.end(JSON.stringify(body));
					};

					try {
						if (req.url === "/api/auth/nonce" && req.method === "GET") {
							const nonce = randomBytes(16).toString("hex");
							pendingNonces.set(nonce, true);
							setTimeout(() => pendingNonces.delete(nonce), 5 * 60_000);
							return send(200, { nonce });
						}

						if (req.url === "/api/auth/verify" && req.method === "POST") {
							const chunks: Buffer[] = [];
							for await (const c of req) chunks.push(c);
							const { message, signature } = JSON.parse(
								Buffer.concat(chunks).toString(),
							);
							if (!message || !signature)
								return send(400, { error: "Missing message or signature" });

							const parsed = parseSiweMessage(message);
							if (!parsed.address || !parsed.nonce)
								return send(400, { error: "Invalid SIWE message" });
							if (!pendingNonces.has(parsed.nonce as string))
								return send(400, { error: "Invalid or expired nonce" });
							pendingNonces.delete(parsed.nonce as string);

							if (parsed.issuedAt) {
								const age =
									Date.now() - new Date(parsed.issuedAt as string).getTime();
								if (age > 5 * 60_000)
									return send(400, { error: "Message expired" });
							}

							const recovered = await recoverAddress(message, signature);
							if (
								recovered.toLowerCase() !==
								(parsed.address as string).toLowerCase()
							)
								return send(401, { error: "Signature mismatch" });

							const sid = randomBytes(32).toString("hex");
							sessions.set(sid, {
								address: parsed.address as string,
								chainId: parsed.chainId as number,
							});
							res.setHeader(
								"Set-Cookie",
								`dex_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
							);
							return send(200, { ok: true, address: parsed.address });
						}

						if (req.url === "/api/auth/me" && req.method === "GET") {
							const sid = parseCookies(req.headers.cookie).dex_session;
							const session = sid ? sessions.get(sid) : null;
							if (!session) return send(401, { error: "Not authenticated" });
							return send(200, session);
						}

						if (req.url === "/api/auth/logout" && req.method === "POST") {
							const sid = parseCookies(req.headers.cookie).dex_session;
							if (sid) sessions.delete(sid);
							res.setHeader(
								"Set-Cookie",
								"dex_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
							);
							return send(200, { ok: true });
						}
					} catch (err: unknown) {
						return send(500, {
							error: err instanceof Error ? err.message : "Internal error",
						});
					}
					next();
				},
			);
		},
	};
}

const proxyBase = process.env.VITE_PROXY_BASE;
const fsAllow = [resolve(process.cwd(), ".."), "/workspace"];
const passthroughPrefixes = ["/rpc", "/core-rpc", "/api", "/devkit"];

export default defineConfig({
	base: proxyBase ?? "./",
	plugins: [
		react(),
		codeServerProxyBasePlugin(proxyBase, passthroughPrefixes),
		siweAuthPlugin(),
	].filter(Boolean),
	resolve: {
		dedupe: ["react", "react-dom", "wagmi", "viem", "@tanstack/react-query"],
	},
	server: {
		host: "0.0.0.0",
		port: 3001,
		strictPort: true,
		allowedHosts: "all",
		fs: {
			allow: fsAllow,
		},
		proxy: {
			"/devkit": {
				target: "http://localhost:7748",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/devkit/, ""),
			},
			"/rpc": {
				target: "http://localhost:8545",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/rpc/, ""),
			},
			"/core-rpc": {
				target: "http://localhost:12537",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/core-rpc/, ""),
			},
			// Proxy /api/* to devkit, EXCEPT routes handled by local plugins
			"/api": {
				target: "http://localhost:7748",
				changeOrigin: true,
				bypass(req) {
					const u = req.url ?? "";
					if (u.startsWith("/api/auth/")) return u;
					// Everything else goes to devkit
					return undefined;
				},
			},
		},
	},
	build: {
		outDir: "dist",
	},
});
