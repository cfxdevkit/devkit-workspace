#!/usr/bin/env node

import { resolve } from "node:path";

import {
	createProject,
	getTargetSummaries,
	getTemplateSummaries,
	resolveTemplateTarget,
} from "./template-core.js";

async function promptInteractive(destinationArg) {
	const { select, input } = await import("@inquirer/prompts");

	const templates = getTemplateSummaries();
	const targets = getTargetSummaries();

	const destination =
		destinationArg ??
		(await input({
			message: "Project directory:",
			default: "./my-dapp",
			validate: (v) => (v.trim() ? true : "Directory is required"),
		}));

	const templateName = await select({
		message: "Select a template:",
		choices: templates.map((t) => ({
			name: `${t.name}  —  ${t.description}`,
			value: t.name,
		})),
	});

	const template = templates.find((t) => t.name === templateName);
	const supportedTargets = template.supportedTargets?.length
		? targets.filter((t) => template.supportedTargets.includes(t.name))
		: targets;

	let targetName = template.defaultTarget;
	if (supportedTargets.length > 1) {
		targetName = await select({
			message: "Select a target:",
			choices: supportedTargets.map((t) => ({
				name: `${t.name}${t.recommended ? " (recommended)" : ""}  —  ${t.description}`,
				value: t.name,
			})),
			default: template.defaultTarget,
		});
	}

	return { destination, templateName, targetName };
}

function printUsage() {
	console.log("Usage: scaffold-cli <command> [options]");
	console.log("");
	console.log("Commands:");
	console.log("  new <destination>                                    Interactive mode");
	console.log(
		"  new <destination> --template <name> [--target <name>] [--json]",
	);
	console.log(
		"  create <destination> --template <name> [--target <name>] [--json]",
	);
	console.log("  list-templates [--json]");
	console.log("  list-targets [--json]");
	console.log("  help");
	console.log("");
	console.log("Examples:");
	console.log(
		"  npx @cfxdevkit/scaffold-cli new my-dapp                  (interactive)",
	);
	console.log(
		"  npx @cfxdevkit/scaffold-cli new ./my-app --template minimal-dapp",
	);
	console.log(
		"  scaffold-cli new ./my-app --template project-example --target code-server",
	);
	console.log("  scaffold-cli list-templates");
}

function parseArgs(argv) {
	const positionals = [];
	const options = {};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}

		if (token === "--json") {
			options.json = true;
			continue;
		}

		const nextValue = argv[index + 1];
		if (!nextValue || nextValue.startsWith("--")) {
			throw new Error(`Missing value for option: ${token}`);
		}

		options[token.slice(2)] = nextValue;
		index += 1;
	}

	return { positionals, options };
}

function printTemplateList(jsonOutput) {
	const templates = getTemplateSummaries();

	if (jsonOutput) {
		console.log(JSON.stringify(templates, null, 2));
		return;
	}

	for (const template of templates) {
		const tags =
			template.tags.length > 0 ? ` [${template.tags.join(", ")}]` : "";
		const defaultTarget = template.defaultTarget
			? ` default=${template.defaultTarget}`
			: "";
		console.log(`${template.name}${tags}`);
		console.log(`  ${template.description}`);
		console.log(
			`  targets=${template.supportedTargets.join(", ")}${defaultTarget}`,
		);
	}
}

function printTargetList(jsonOutput) {
	const targets = getTargetSummaries();

	if (jsonOutput) {
		console.log(JSON.stringify(targets, null, 2));
		return;
	}

	for (const target of targets) {
		const status = target.recommended ? "recommended" : "optional";
		const featureFlags = Object.entries(target.features)
			.map(([key, enabled]) => `${key}=${enabled}`)
			.join(", ");
		console.log(`${target.name} (${status})`);
		console.log(`  ${target.description}`);
		console.log(`  runtime=${target.runtime} features=${featureFlags}`);
	}
}

function printCreateResult(result, jsonOutput) {
	if (jsonOutput) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	console.log(`Created ${result.template} at ${result.destinationPath}`);
	console.log(`Target: ${result.target}`);
	console.log(`Package: ${result.packageName}`);
}

function runCreate(positionals, options) {
	const destinationArg = positionals[1];
	const templateName = options.template;

	if (!destinationArg || !templateName) {
		return runCreateInteractive(destinationArg, options);
	}

	const { template, target } = resolveTemplateTarget(
		templateName,
		options.target ?? null,
	);
	const result = createProject({
		destinationPath: resolve(process.cwd(), destinationArg),
		templateName: template.name,
		targetName: target.name,
	});

	printCreateResult(result, Boolean(options.json));
}

async function runCreateInteractive(destinationArg, options) {
	const { destination, templateName, targetName } =
		await promptInteractive(destinationArg);

	const { template, target } = resolveTemplateTarget(templateName, targetName);
	const result = createProject({
		destinationPath: resolve(process.cwd(), destination),
		templateName: template.name,
		targetName: target.name,
	});

	printCreateResult(result, Boolean(options.json));
}

async function main() {
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (!command || command === "help" || command === "--help") {
		printUsage();
		return;
	}

	let parsed;
	try {
		parsed = parseArgs(argv.slice(1));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.log("");
		printUsage();
		process.exit(1);
	}

	try {
		if (command === "list-templates") {
			printTemplateList(Boolean(parsed.options.json));
			return;
		}

		if (command === "list-targets") {
			printTargetList(Boolean(parsed.options.json));
			return;
		}

		if (command === "create" || command === "new") {
			await runCreate([command, ...parsed.positionals], parsed.options);
			return;
		}

		throw new Error(`Unknown command: ${command}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

main();
