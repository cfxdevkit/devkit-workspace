import * as cp from "node:child_process";
import * as vscode from "vscode";
import { workspaceUri } from "../utils/fs";

export function registerDevcontainerCommands(
	context: vscode.ExtensionContext,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.openDevcontainer", async () => {
			const uri = workspaceUri(".devcontainer", "devcontainer.json");
			await vscode.window.showTextDocument(uri);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.checkDocker", () => {
			cp.exec(
				'docker info --format "{{.ServerVersion}}"',
				(err, stdout, stderr) => {
					if (err) {
						vscode.window.showErrorMessage(
							`Docker socket unreachable: ${stderr || err.message}\n` +
								"Check that /var/run/docker.sock is mounted (devcontainer.json mounts section).",
						);
					} else {
						vscode.window.showInformationMessage(
							`Docker OK (host daemon v${stdout.trim()}) — DooD active`,
						);
					}
				},
			);
		}),
	);
}
