/**
 * server.ts — CFX DevKit project example server
 *
 * Serves the Vite-built SPA + SIWE auth + proxy to devkit API and eSpace RPC.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverMessageAddress } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");
const INDEX_PATH = join(DIST_DIR, "index.html");

const DEVKIT_URL = process.env.DEVKIT_URL ?? "http://localhost:7748";
const ESPACE_RPC = process.env.ESPACE_RPC_URL ?? "http://localhost:8545";
const CORE_RPC = process.env.CORE_RPC_URL ?? "http://localhost:12537";
const PORT = Number(process.env.PORT ?? 3030);

interface DevkitContract {
	name: string;
	address: string;
	chain: string;
}

interface DevkitContractEnvelope {
	data?: { contracts?: DevkitContract[] };
	contracts?: DevkitContract[];
}

interface SessionData {
	address: string;
	chainId: number;
}

const sessions = new Map<string, SessionData>();
const pendingNonces = new Map<string, true>();
const SESSION_COOKIE = "devkit_session";
const SESSION_MAX_AGE = 86400;

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

function extractContracts(data: unknown): DevkitContract[] {
	if (Array.isArray(data)) return data as DevkitContract[];
	const envelope = data as DevkitContractEnvelope | null;
	return envelope?.data?.contracts ?? envelope?.contracts ?? [];
}

function generateNonce(): string {
	return randomBytes(16).toString("hex");
}

function generateSessionId(): string {
	return randomBytes(32).toString("hex");
}

function parseCookies(
	cookieHeader: string | undefined,
): Record<string, string> {
	const cookies: Record<string, string> = {};
	if (!cookieHeader) return cookies;
	for (const pair of cookieHeader.split(";")) {
		const [key, ...rest] = pair.trim().split("=");
		if (key) cookies[key] = rest.join("=");
	}
	return cookies;
}

function setSessionCookie(res: ServerResponse, sessionId: string): void {
	res.setHeader(
		"Set-Cookie",
		`${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`,
	);
}

function clearSessionCookie(res: ServerResponse): void {
	res.setHeader(
		"Set-Cookie",
		`${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
	);
}

function getSession(req: IncomingMessage): SessionData | null {
	const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
	return sid ? (sessions.get(sid) ?? null) : null;
}

function parseSiweMessage(message: string): {
	address?: string;
	nonce?: string;
	chainId?: number;
	issuedAt?: string;
} {
	const lines = message.split("\n");
	const result: {
		address?: string;
		nonce?: string;
		chainId?: number;
		issuedAt?: string;
	} = {};
	for (const line of lines) {
		if (line.startsWith("Chain ID: ")) result.chainId = Number(line.slice(10));
		else if (line.startsWith("Nonce: ")) result.nonce = line.slice(7);
		else if (line.startsWith("Issued At: ")) result.issuedAt = line.slice(11);
		else if (/^0x[a-fA-F0-9]{40}$/.test(line.trim()))
			result.address = line.trim();
	}
	return result;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body, null, 2);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Content-Length": Buffer.byteLength(text),
	});
	res.end(text);
}

function sendFile(res: ServerResponse, filePath: string): void {
	const ext = extname(filePath);
	const content = readFileSync(filePath);
	res.writeHead(200, {
		"Content-Type": MIME[ext] ?? "application/octet-stream",
		"Content-Length": content.length,
		"Cache-Control":
			ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
	});
	res.end(content);
}

async function proxyJsonRequest(
	req: IncomingMessage,
	res: ServerResponse,
	targetUrl: string,
): Promise<void> {
	const body =
		req.method === "GET" || req.method === "HEAD"
			? undefined
			: await readBody(req);
	const upstream = await fetch(targetUrl, {
		method: req.method,
		headers: body
			? { "Content-Type": req.headers["content-type"] ?? "application/json" }
			: undefined,
		body,
		signal: AbortSignal.timeout(10_000),
	});
	const text = await upstream.text();
	res.writeHead(upstream.status, {
		"Content-Type": upstream.headers.get("content-type") ?? "application/json",
		"Access-Control-Allow-Origin": "*",
		"Content-Length": Buffer.byteLength(text),
	});
	res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString();
}

const server = createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
		const pathname = url.pathname;

		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			});
			res.end();
			return;
		}

		try {
			if (pathname === "/health" && req.method === "GET") {
				return sendJson(res, 200, {
					ok: true,
					server: "cfxdevkit-project-example",
				});
			}

			if (pathname.startsWith("/devkit/")) {
				return proxyJsonRequest(
					req,
					res,
					`${DEVKIT_URL}${pathname.slice("/devkit".length)}${url.search}`,
				);
			}

			if (pathname === "/rpc" && req.method === "POST") {
				const body = await readBody(req);
				const rpcRes = await fetch(ESPACE_RPC, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
					signal: AbortSignal.timeout(10_000),
				});
				const rpcText = await rpcRes.text();
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
					"Content-Length": Buffer.byteLength(rpcText),
				});
				res.end(rpcText);
				return;
			}

			if (pathname === "/core-rpc" && req.method === "POST") {
				const body = await readBody(req);
				const rpcRes = await fetch(CORE_RPC, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
					signal: AbortSignal.timeout(10_000),
				});
				const rpcText = await rpcRes.text();
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
					"Content-Length": Buffer.byteLength(rpcText),
				});
				res.end(rpcText);
				return;
			}

			if (pathname === "/api/auth/nonce" && req.method === "GET") {
				const nonce = generateNonce();
				pendingNonces.set(nonce, true);
				setTimeout(() => pendingNonces.delete(nonce), 5 * 60_000);
				return sendJson(res, 200, { nonce });
			}

			if (pathname === "/api/auth/verify" && req.method === "POST") {
				const { message, signature } = JSON.parse(await readBody(req)) as {
					message?: string;
					signature?: string;
				};
				if (!message || !signature)
					return sendJson(res, 400, { error: "Missing message or signature" });
				const parsed = parseSiweMessage(message);
				if (!parsed.address || !parsed.nonce)
					return sendJson(res, 400, { error: "Invalid SIWE message" });
				if (!pendingNonces.has(parsed.nonce))
					return sendJson(res, 400, { error: "Invalid or expired nonce" });
				pendingNonces.delete(parsed.nonce);

				if (
					parsed.issuedAt &&
					Date.now() - new Date(parsed.issuedAt).getTime() > 5 * 60_000
				) {
					return sendJson(res, 400, { error: "Message expired" });
				}

				let recovered: string;
				try {
					recovered = await recoverMessageAddress({
						message,
						signature: signature as `0x${string}`,
					});
				} catch (error) {
					return sendJson(res, 400, {
						error: "Signature recovery failed",
						detail: (error as Error).message,
					});
				}

				if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
					return sendJson(res, 401, { error: "Signature mismatch" });
				}

				const sessionId = generateSessionId();
				sessions.set(sessionId, {
					address: parsed.address,
					chainId: parsed.chainId ?? 0,
				});
				setSessionCookie(res, sessionId);
				return sendJson(res, 200, { ok: true, address: parsed.address });
			}

			if (pathname === "/api/auth/me" && req.method === "GET") {
				const session = getSession(req);
				return session
					? sendJson(res, 200, {
							address: session.address,
							chainId: session.chainId,
						})
					: sendJson(res, 401, { error: "Not authenticated" });
			}

			if (pathname === "/api/auth/logout" && req.method === "POST") {
				const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
				if (sid) sessions.delete(sid);
				clearSessionCookie(res);
				return sendJson(res, 200, { ok: true });
			}

			if (pathname === "/api/contracts/deployed" && req.method === "GET") {
				try {
					const response = await fetch(`${DEVKIT_URL}/api/contracts/deployed`, {
						signal: AbortSignal.timeout(5_000),
					});
					if (!response.ok)
						return sendJson(res, response.status, { error: "devkit error" });
					const payload = (await response.json()) as unknown;
					const contracts = extractContracts(payload).map((contract) => ({
						name: contract.name,
						address: contract.address,
						chain: contract.chain,
					}));
					return sendJson(res, 200, contracts);
				} catch (error) {
					return sendJson(res, 503, {
						error: "devkit unreachable",
						detail: (error as Error).message,
					});
				}
			}

			// General /api/* proxy → devkit (accounts/faucet, accounts/fund, etc.)
			if (pathname.startsWith("/api/")) {
				return proxyJsonRequest(
					req,
					res,
					`${DEVKIT_URL}${pathname}${url.search}`,
				);
			}

			if (req.method === "GET") {
				const safePath = pathname.replace(/\.\./g, "");
				const filePath = join(DIST_DIR, safePath);
				if (existsSync(filePath) && statSync(filePath).isFile())
					return sendFile(res, filePath);
				if (existsSync(INDEX_PATH)) return sendFile(res, INDEX_PATH);
			}

			sendJson(res, 404, { error: "Not found" });
		} catch (error) {
			console.error("Unhandled error:", error);
			sendJson(res, 500, {
				error: "Internal server error",
				detail: (error as Error).message,
			});
		}
	},
);

server.listen(PORT, () => {
	console.log(`\nCFX DevKit Project Example`);
	console.log(`  http://localhost:${PORT}`);
	console.log(`  DevKit: ${DEVKIT_URL}`);
	console.log(`  Core RPC: ${CORE_RPC}`);
	console.log(`  eSpace RPC: ${ESPACE_RPC}\n`);
});
