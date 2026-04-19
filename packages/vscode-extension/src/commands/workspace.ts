import * as vscode from "vscode";
import { readJson, workspaceUri, writeJson } from "../utils/fs";

const PRESET: Record<string, unknown> = {
	"editor.formatOnSave": true,
	"editor.tabSize": 2,
	"editor.rulers": [100],
	"python.defaultInterpreterPath": "/usr/local/bin/python",
	"[python]": { "editor.defaultFormatter": "ms-python.black-formatter" },
	"python.analysis.autoImportCompletions": true,
	"docker.showStartPage": false,
	"git.autofetch": true,
	"git.confirmSync": false,
	"files.exclude": {
		"**/__pycache__": true,
		"**/*.pyc": true,
		"**/node_modules": true,
	},
	"files.watcherExclude": {
		"**/node_modules/**": true,
		"**/.git/objects/**": true,
	},
};

export function registerWorkspaceCommands(
	context: vscode.ExtensionContext,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.syncSettings", async () => {
			const settingsUri = workspaceUri(".vscode", "settings.json");

			let existing: Record<string, unknown> = {};
			try {
				existing = await readJson<Record<string, unknown>>(settingsUri);
			} catch {
				// File doesn't exist yet — start fresh
			}

			const merged = { ...existing, ...PRESET };
			await writeJson(settingsUri, merged);

			const action = await vscode.window.showInformationMessage(
				"Workspace settings synced.",
				"Open settings.json",
			);
			if (action === "Open settings.json") {
				await vscode.window.showTextDocument(settingsUri);
			}
		}),
	);
}
