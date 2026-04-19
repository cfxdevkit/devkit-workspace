#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const dappDist = resolve(projectRoot, "dapp", "dist");
const vercelDist = resolve(projectRoot, "dist");

function run(args) {
	execFileSync("pnpm", args, {
		cwd: projectRoot,
		stdio: "inherit",
		env: process.env,
	});
}

run(["run", "sync:network"]);
run(["run", "codegen"]);
run(["--dir", "dapp", "build"]);

if (!existsSync(dappDist)) {
	throw new Error(`Expected build output at ${dappDist}`);
}

rmSync(vercelDist, { recursive: true, force: true });
mkdirSync(vercelDist, { recursive: true });
cpSync(dappDist, vercelDist, { recursive: true });

console.log(`Staged Vercel output in ${vercelDist}`);