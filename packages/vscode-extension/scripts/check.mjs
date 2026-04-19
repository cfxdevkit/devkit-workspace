#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = process.cwd();
const packageJson = JSON.parse(
	readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const commands = (packageJson.contributes?.commands ?? []).map(
	(entry) => entry.command,
);

if (!commands.includes("devkit.showStatus")) {
	throw new Error("Missing extension command: devkit.showStatus");
}

const extensionEntry = resolve(packageRoot, "src", "extension.js");
if (!existsSync(extensionEntry)) {
	throw new Error("Missing extension entry: src/extension.js");
}

console.log(JSON.stringify({ status: "success", commands }, null, 2));
