#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseOperationFlags, runOperation } from "./lib/operations.mjs";

const flags = parseOperationFlags();

function buildChecks() {
	const checks = [
		{
			name: "target-metadata",
			path: "dapp/src/generated/devkit-target.js",
			ok: existsSync(
				resolve(process.cwd(), "dapp", "src", "generated", "devkit-target.js"),
			),
		},
		{
			name: "project-network",
			path: "dapp/src/generated/project-network.js",
			ok: existsSync(
				resolve(
					process.cwd(),
					"dapp",
					"src",
					"generated",
					"project-network.js",
				),
			),
		},
		{
			name: "contract-addresses",
			path: "dapp/src/generated/contracts-addresses.js",
			ok: existsSync(
				resolve(
					process.cwd(),
					"dapp",
					"src",
					"generated",
					"contracts-addresses.js",
				),
			),
		},
		{
			name: "contract-addresses-types",
			path: "dapp/src/generated/contracts-addresses.ts",
			ok: existsSync(
				resolve(
					process.cwd(),
					"dapp",
					"src",
					"generated",
					"contracts-addresses.ts",
				),
			),
		},
		{
			name: "contract-artifact",
			path: "contracts/generated/example-counter.js",
			ok: existsSync(
				resolve(process.cwd(), "contracts", "generated", "example-counter.js"),
			),
		},
		{
			name: "generation-manifest",
			path: ".devkit/manifest.json",
			ok: existsSync(resolve(process.cwd(), ".devkit", "manifest.json")),
		},
	];

	return checks;
}

await runOperation("doctor", flags, async ({ step }) => {
	step("inspect-project-files", { status: "completed" });

	const checks = buildChecks();
	const ready = checks.every((check) => check.ok);
	const result = {
		project: "Conflux DevKit — Project Example",
		target: "devcontainer",
		features: {
			baseUrl: "false",
			proxy: "true",
			codeServer: "false",
		},
		ready,
		checks,
		message: ready
			? "Project example scaffold is ready."
			: "Project example scaffold is missing generated artifacts. Run pnpm sync:network and pnpm codegen.",
	};

	step("summarize-readiness", {
		status: ready ? "completed" : "warning",
		ready,
	});
	return result;
});
