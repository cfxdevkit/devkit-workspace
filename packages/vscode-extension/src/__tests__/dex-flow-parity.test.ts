import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const dexRoutesPath = join(
	repoRoot,
	"packages/devkit-backend/src/server/routes/dex-runtime.ts",
);
const extApiPath = join(
	repoRoot,
	"packages/vscode-extension/src/conflux/api.ts",
);
const extSrcPath = join(
	repoRoot,
	"packages/vscode-extension/src/commands/conflux-deploy-commands.ts",
);

const dexRoutes = readFileSync(dexRoutesPath, "utf8");
const extApi = readFileSync(extApiPath, "utf8");
const extSource = readFileSync(extSrcPath, "utf8");

/**
 * DEX is no longer served by MCP tool definitions — it is proxied through
 * the backend REST API. These tests verify the backend-side route registrations
 * and the extension-side API call parity.
 */

const BACKEND_ROUTES: Array<{
	method: string;
	path: string;
	description: string;
}> = [
	{ method: "get", path: "/status", description: "DEX status endpoint" },
	{ method: "post", path: "/deploy", description: "DEX deploy endpoint" },
	{ method: "post", path: "/seed", description: "DEX seed endpoint" },
];

const EXTENSION_API_CALLS: Array<{ fn: string; route: string }> = [
	{ fn: "getDexStatus", route: "/api/dex/status" },
	{ fn: "dexDeploy", route: "/api/dex/deploy" },
	{ fn: "dexSeed", route: "/api/dex/seed" },
];

describe("DEX backend routes → extension parity", () => {
	it.each(BACKEND_ROUTES)("backend exposes $method $path ($description)", ({
		method,
		path,
	}) => {
		expect(
			new RegExp(`router\\.${method}\\(\\s*["']${path}["']`).test(dexRoutes),
		).toBe(true);
	});

	it.each(EXTENSION_API_CALLS)("extension api.ts calls $route via $fn", ({
		fn,
		route,
	}) => {
		expect(extApi.includes(fn)).toBe(true);
		expect(new RegExp(`["']${route}["']`).test(extApi)).toBe(true);
	});

	it("extension registers cfxdevkit.deployDex command", () => {
		expect(/["']cfxdevkit\.deployDex["']/.test(extSource)).toBe(true);
	});
});
