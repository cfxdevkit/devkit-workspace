#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const artifactsRoot = resolve(repoRoot, "packages", "devkit-base", "artifacts");
const generatedRoot = resolve(artifactsRoot, "generated");
const tempRoot = resolve(artifactsRoot, ".tmp");

function ensureDir(path) {
	mkdirSync(path, { recursive: true });
}

function run(command, args, cwd = repoRoot) {
	console.log(`  $ ${command} ${args.join(" ")}`);
	execFileSync(command, args, { cwd, stdio: "inherit" });
}

rmSync(tempRoot, { recursive: true, force: true });
rmSync(generatedRoot, { recursive: true, force: true });
ensureDir(tempRoot);
ensureDir(generatedRoot);

// ---------------------------------------------------------------------------
// 1. Build workspace packages (shared → backend → extension)
// ---------------------------------------------------------------------------
console.log("\n=== Building workspace packages ===\n");

console.log("Building @devkit/shared...");
run("pnpm", ["--filter", "@devkit/shared", "run", "build"]);

console.log("\nBuilding @devkit/devkit-backend...");
run("pnpm", ["--filter", "@devkit/devkit-backend", "run", "build"]);

console.log("\nPacking @devkit/devkit-backend...");
const backendDir = resolve(repoRoot, "packages", "devkit-backend");
// Mirror the old workspace's approach: copy to an isolated temp directory
// outside the pnpm workspace, set bundledDependencies: true so ALL deps
// (including @xcfx/node native binaries) are embedded in the tarball.
// This is critical — @xcfx/node has optional platform-specific native binaries
// that won't install correctly via npm install -g of a non-bundled tarball.
const backendPackDir = resolve(tempRoot, "backend-pack");
ensureDir(backendPackDir);
cpSync(resolve(backendDir, "dist"), resolve(backendPackDir, "dist"), {
	recursive: true,
});
cpSync(
	resolve(backendDir, "package.json"),
	resolve(backendPackDir, "package.json"),
);
// Copy @devkit/shared as a local dependency (it's a workspace:* dep, not on npm)
const sharedDir = resolve(repoRoot, "packages", "shared");
cpSync(sharedDir, resolve(backendPackDir, "shared"), { recursive: true });
// Rewrite package.json: point shared to local, drop devDeps, enable bundledDependencies
{
	const pkg = JSON.parse(
		readFileSync(resolve(backendPackDir, "package.json"), "utf8"),
	);
	pkg.dependencies = pkg.dependencies || {};
	pkg.dependencies["@devkit/shared"] = "file:./shared";
	delete pkg.private;
	delete pkg.devDependencies;
	pkg.bundledDependencies = true;
	writeFileSync(
		resolve(backendPackDir, "package.json"),
		JSON.stringify(pkg, null, 2),
	);
}
console.log("  Installing backend deps (with native binaries)...");
run(
	"npm",
	[
		"install",
		"--omit=dev",
		"--fetch-retries",
		"5",
		"--fetch-retry-mintimeout",
		"10000",
	],
	backendPackDir,
);
console.log("  Packing backend tarball...");
run("npm", ["pack", "--pack-destination", tempRoot], backendPackDir);
const backendTgz = resolve(
	tempRoot,
	readdirSync(tempRoot).find(
		(f) => f.startsWith("devkit-devkit-backend-") && f.endsWith(".tgz"),
	),
);
cpSync(backendTgz, resolve(generatedRoot, "devkit-backend.tgz"));
console.log(`  → ${resolve(generatedRoot, "devkit-backend.tgz")}`);

console.log("\nBuilding & packaging VS Code extension...");
run("pnpm", ["--filter", "devkit-workspace-ext", "run", "build"]);
run("pnpm", ["--filter", "devkit-workspace-ext", "run", "package"]);
const vsixPath = resolve(repoRoot, "dist", "devkit.vsix");
cpSync(vsixPath, resolve(generatedRoot, "devkit.vsix"));
console.log(`  → ${resolve(generatedRoot, "devkit.vsix")}`);

// ---------------------------------------------------------------------------
// 2. Package dex-ui as a global npm tarball (like the backend)
// ---------------------------------------------------------------------------
console.log("\n=== Packaging dex-ui as npm tarball ===\n");

const dexUiDir = resolve(repoRoot, "apps", "dex-ui");

console.log("Building dex-ui (vite build)...");
run("pnpm", ["--filter", "cfxdevkit-example-dapp", "run", "build"]);

// Stage dex-ui in an isolated temp directory (outside pnpm workspace)
const dexUiPackDir = resolve(tempRoot, "dex-ui-pack");
ensureDir(dexUiPackDir);

// Copy runtime files: server.mjs, dist/, public/
for (const item of ["server.mjs", "dist", "public"]) {
	const src = resolve(dexUiDir, item);
	if (existsSync(src)) {
		cpSync(src, resolve(dexUiPackDir, item), { recursive: true });
	}
}

// Embed @cfxdevkit/dex-contracts as a local directory dependency
const dexContractsDir = resolve(repoRoot, "packages", "contracts");
// Build dist/ from generated/*.ts if needed (dist/ is gitignored, absent in CI)
if (!existsSync(resolve(dexContractsDir, "dist", "index.js"))) {
	console.log("  Building dex-contracts (tsc)...");
	run("npx", ["tsc", "-p", "tsconfig.json"], dexContractsDir);
}
cpSync(dexContractsDir, resolve(dexUiPackDir, "dex-contracts"), {
	recursive: true,
});
// Strip dev-only scripts and devDeps from the embedded dex-contracts
{
	const contractsPkg = JSON.parse(
		readFileSync(
			resolve(dexUiPackDir, "dex-contracts", "package.json"),
			"utf8",
		),
	);
	delete contractsPkg.scripts?.postinstall;
	delete contractsPkg.devDependencies;
	delete contractsPkg.private;
	writeFileSync(
		resolve(dexUiPackDir, "dex-contracts", "package.json"),
		JSON.stringify(contractsPkg, null, 2),
	);
}

// Write a clean package.json with bin entry and bundledDependencies
{
	const pkg = {
		name: "@devkit/devkit-dex-ui",
		version: "0.0.0",
		description: "DEX swap UI server for CFX DevKit",
		type: "module",
		bin: { "devkit-dex-ui": "./server.mjs" },
		files: ["server.mjs", "dist/**/*", "public/**/*"],
		dependencies: {
			"@cfxdevkit/dex-contracts": "file:./dex-contracts",
			viem: "^2.23.0",
		},
		bundledDependencies: true,
		license: "Apache-2.0",
	};
	writeFileSync(
		resolve(dexUiPackDir, "package.json"),
		JSON.stringify(pkg, null, 2),
	);
}

console.log("  Installing dex-ui production deps...");
run(
	"npm",
	[
		"install",
		"--omit=dev",
		"--fetch-retries",
		"5",
		"--fetch-retry-mintimeout",
		"10000",
	],
	dexUiPackDir,
);

// npm v7+ creates a symlink for file: dependencies. npm pack does NOT follow
// symlinks when bundling node_modules, resulting in 0 bundled files.
// Fix: replace the symlink with a real directory copy, then remove the source
// dex-contracts/ dir so it doesn't leak into the tarball.
{
	const contractsLink = resolve(
		dexUiPackDir,
		"node_modules",
		"@cfxdevkit",
		"dex-contracts",
	);
	const stat = lstatSync(contractsLink);
	if (stat.isSymbolicLink()) {
		const target = resolve(dirname(contractsLink), readlinkSync(contractsLink));
		rmSync(contractsLink);
		cpSync(target, contractsLink, { recursive: true });
		console.log("  Replaced dex-contracts symlink with real copy");
	}
	// Remove the source dex-contracts/ dir so npm pack doesn't include it
	rmSync(resolve(dexUiPackDir, "dex-contracts"), {
		recursive: true,
		force: true,
	});
}

// Rewrite file: dependency to the resolved version so npm install -g doesn't
// try to re-resolve a stale file: path and strip the bundled node_modules.
{
	const pkg = JSON.parse(
		readFileSync(resolve(dexUiPackDir, "package.json"), "utf8"),
	);
	const contractsInstalledPkg = JSON.parse(
		readFileSync(
			resolve(
				dexUiPackDir,
				"node_modules",
				"@cfxdevkit",
				"dex-contracts",
				"package.json",
			),
			"utf8",
		),
	);
	pkg.dependencies["@cfxdevkit/dex-contracts"] = contractsInstalledPkg.version;
	writeFileSync(
		resolve(dexUiPackDir, "package.json"),
		JSON.stringify(pkg, null, 2),
	);
}

console.log("  Packing dex-ui tarball...");
run("npm", ["pack", "--pack-destination", tempRoot], dexUiPackDir);
const dexUiTgz = resolve(
	tempRoot,
	readdirSync(tempRoot).find(
		(f) => f.startsWith("devkit-devkit-dex-ui-") && f.endsWith(".tgz"),
	),
);
cpSync(dexUiTgz, resolve(generatedRoot, "devkit-dex-ui.tgz"));
console.log(`  → ${resolve(generatedRoot, "devkit-dex-ui.tgz")}`);

// ---------------------------------------------------------------------------
// 3. Build MCP server tarball
// ---------------------------------------------------------------------------
console.log("\n=== Building MCP artifact ===\n");

console.log("Building @devkit/mcp...");
run("pnpm", ["--filter", "@devkit/mcp", "run", "build"]);

const mcpDir = resolve(repoRoot, "packages", "mcp-server");
const mcpPackDir = resolve(tempRoot, "mcp-pack");
ensureDir(mcpPackDir);

// Copy dist/ output and package.json
cpSync(resolve(mcpDir, "dist"), resolve(mcpPackDir, "dist"), {
	recursive: true,
});
cpSync(resolve(mcpDir, "package.json"), resolve(mcpPackDir, "package.json"));

// Copy @devkit/shared as a local dependency (workspace:* dep, not on npm)
cpSync(sharedDir, resolve(mcpPackDir, "shared"), { recursive: true });

// Rewrite package.json: point shared to local, drop devDeps, enable bundledDependencies
{
	const pkg = JSON.parse(
		readFileSync(resolve(mcpPackDir, "package.json"), "utf8"),
	);
	pkg.dependencies = pkg.dependencies || {};
	pkg.dependencies["@devkit/shared"] = "file:./shared";
	delete pkg.private;
	delete pkg.devDependencies;
	pkg.bundledDependencies = true;
	writeFileSync(
		resolve(mcpPackDir, "package.json"),
		JSON.stringify(pkg, null, 2),
	);
}

console.log("  Installing MCP server deps (with bundled dependencies)...");
run(
	"npm",
	[
		"install",
		"--omit=dev",
		"--fetch-retries",
		"5",
		"--fetch-retry-mintimeout",
		"10000",
	],
	mcpPackDir,
);

console.log("  Packing MCP server tarball...");
run("npm", ["pack", "--pack-destination", tempRoot], mcpPackDir);
const mcpTgz = resolve(
	tempRoot,
	readdirSync(tempRoot).find(
		(f) => f.startsWith("devkit-mcp-") && f.endsWith(".tgz"),
	),
);
cpSync(mcpTgz, resolve(generatedRoot, "devkit-mcp.tgz"));
console.log(`  → ${resolve(generatedRoot, "devkit-mcp.tgz")}`);

// ---------------------------------------------------------------------------
// 3. Copy manifest and config
// ---------------------------------------------------------------------------
const manifestPath = resolve(artifactsRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
writeFileSync(
	resolve(generatedRoot, "manifest.resolved.json"),
	JSON.stringify(manifest, null, 2),
);

const configSource = resolve(artifactsRoot, "config");
if (existsSync(configSource)) {
	cpSync(configSource, resolve(generatedRoot, "config"), { recursive: true });
}

rmSync(tempRoot, { recursive: true, force: true });
console.log(`\nPrepared devkit artifacts in ${generatedRoot}`);
