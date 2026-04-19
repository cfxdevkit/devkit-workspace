import * as vscode from "vscode";

/**
 * Workspace service management commands.
 * These are intentionally minimal placeholders — the real implementation
 * lives in @devkit/shared and the MCP server, keeping business logic
 * outside the VS Code extension host.
 */

export function registerServiceCommands(
	context: vscode.ExtensionContext,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.start", async () => {
			const result = await vscode.window.showQuickPick(
				[
					{
						label: "$(play) Start Stack",
						detail: "Run docker compose up -d",
						id: "start",
					},
					{
						label: "$(file-code) Open Compose File",
						detail: "View and edit docker-compose.yml",
						id: "compose",
					},
					{
						label: "$(info) Stack Status",
						detail: "Show container status",
						id: "status",
					},
				],
				{ placeHolder: "DevKit: Workspace Services" },
			);
			if (!result) return;
			if (result.id === "start")
				vscode.commands.executeCommand("devkit.stackUp");
			if (result.id === "compose")
				vscode.commands.executeCommand("devkit.openCompose");
			if (result.id === "status")
				vscode.commands.executeCommand("devkit.stackPs");
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stop", async () => {
			const result = await vscode.window.showWarningMessage(
				"Stop all workspace services? Running containers will be stopped and removed.",
				{ modal: true },
				"Stop Services",
			);
			if (result === "Stop Services") {
				vscode.commands.executeCommand("devkit.stackDown");
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.status", () => {
			vscode.commands.executeCommand("devkit.stackPs");
		}),
	);
}
