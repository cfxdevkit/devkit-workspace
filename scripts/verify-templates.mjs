#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const cliPath = resolve(repoRoot, "packages", "scaffold-cli", "src", "cli.js");
const generatedRoot = resolve(repoRoot, ".generated", "verify-templates");

function run(command, args, cwd = repoRoot) {
	execFileSync(command, args, { cwd, stdio: "inherit" });
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function verifyManifest(projectRoot, expectedTemplate, expectedTarget) {
	const manifestPath = resolve(projectRoot, ".devkit", "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`Missing generation manifest: ${manifestPath}`);
	}

	const manifest = readJson(manifestPath);
	if (manifest.template !== expectedTemplate) {
		throw new Error(
			`Expected template ${expectedTemplate} but found ${manifest.template}`,
		);
	}
	if (manifest.target !== expectedTarget) {
		throw new Error(
			`Expected target ${expectedTarget} but found ${manifest.target}`,
		);
	}
}

function verifyMinimal(projectRoot, expectedTarget) {
	verifyManifest(projectRoot, "minimal-dapp", expectedTarget);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "dapp", "scripts", "dev.mjs"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "dapp", "src", "main.js"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "ui-shared", "src", "devkit.js"),
	]);

	if (!existsSync(resolve(projectRoot, "pnpm-workspace.yaml"))) {
		throw new Error("Missing pnpm-workspace.yaml in minimal-dapp");
	}
}

function verifyProjectExample(projectRoot, expectedTarget) {
	verifyManifest(projectRoot, "project-example", expectedTarget);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "scripts", "lib", "operations.mjs"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "scripts", "doctor.mjs"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "scripts", "sync-project-network.mjs"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "scripts", "write-contract-artifact.mjs"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "scripts", "list-contracts.mjs"),
	]);
	run(process.execPath, [
		"--check",
		resolve(projectRoot, "contracts", "scripts", "compile.mjs"),
	]);

	// React/Vite dapp — verify key source files exist
	const dappFiles = [
		resolve(projectRoot, "dapp", "src", "main.tsx"),
		resolve(projectRoot, "dapp", "src", "App.tsx"),
		resolve(projectRoot, "dapp", "vite.config.ts"),
		resolve(projectRoot, "dapp", "index.html"),
	];
	for (const f of dappFiles) {
		if (!existsSync(f)) {
			throw new Error(`Missing expected dapp file: ${f}`);
		}
	}

	// Run project-level smoke checks (sync, codegen, contracts, doctor).
	// Skip the full `smoke:workspace` which includes `vite build` — that
	// requires node_modules installed in the generated project.
	run(process.execPath, [
		resolve(projectRoot, "scripts", "sync-project-network.mjs"),
		"--json",
	]);
	run(process.execPath, [
		resolve(projectRoot, "contracts", "scripts", "compile.mjs"),
	]);
	run(process.execPath, [
		resolve(projectRoot, "scripts", "write-contract-artifact.mjs"),
		"--json",
	]);
	run(process.execPath, [
		resolve(projectRoot, "scripts", "list-contracts.mjs"),
		"--json",
	]);
	run(process.execPath, [
		resolve(projectRoot, "scripts", "doctor.mjs"),
		"--json",
	]);
}

function createScaffold(destinationPath, template, target) {
	const args = [cliPath, "create", destinationPath, "--template", template];
	if (target) {
		args.push("--target", target);
	}
	run(process.execPath, args, repoRoot);
}

rmSync(generatedRoot, { recursive: true, force: true });

const minimalDefault = resolve(generatedRoot, "minimal-default");
const minimalCodeServer = resolve(generatedRoot, "minimal-code-server");
const projectExampleDefault = resolve(generatedRoot, "project-example-default");
const projectExampleCodeServer = resolve(
	generatedRoot,
	"project-example-code-server",
);

createScaffold(minimalDefault, "minimal-dapp", null);
createScaffold(minimalCodeServer, "minimal-dapp", "code-server");
createScaffold(projectExampleDefault, "project-example", null);
createScaffold(projectExampleCodeServer, "project-example", "code-server");

verifyMinimal(minimalDefault, "devcontainer");
verifyMinimal(minimalCodeServer, "code-server");
verifyProjectExample(projectExampleDefault, "devcontainer");
verifyProjectExample(projectExampleCodeServer, "code-server");

console.log("Template verification completed successfully.");
