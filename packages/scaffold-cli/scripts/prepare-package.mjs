#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
const assetsRoot = resolve(packageRoot, "assets");

const copyTargets = [
	{
		source: resolve(workspaceRoot, "templates"),
		destination: resolve(assetsRoot, "templates"),
	},
	{
		source: resolve(workspaceRoot, "targets"),
		destination: resolve(assetsRoot, "targets"),
	},
	{
		source: resolve(workspaceRoot, "packages", "ui-shared"),
		destination: resolve(assetsRoot, "packages", "ui-shared"),
	},
	{
		source: resolve(workspaceRoot, "packages", "conflux-wallet"),
		destination: resolve(assetsRoot, "packages", "conflux-wallet"),
	},
];

const excludedDirectories = new Set(["node_modules", "dist", ".turbo", ".next"]);

rmSync(assetsRoot, { recursive: true, force: true });

for (const target of copyTargets) {
	mkdirSync(dirname(target.destination), { recursive: true });
	cpSync(target.source, target.destination, {
		recursive: true,
		filter(sourcePath) {
			return ![...excludedDirectories].some(
				(directoryName) =>
					sourcePath.includes(`/${directoryName}/`) ||
					sourcePath.endsWith(`/${directoryName}`),
			);
		},
	});
}

console.log(`Prepared scaffold-cli package assets in ${assetsRoot}`);