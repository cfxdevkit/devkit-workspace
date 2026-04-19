import * as vscode from "vscode";
import { runComposeAndReturn, runComposeTask } from "../utils/compose";

export function registerStackCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stackUp", async () => {
			runComposeTask("Project Stack Up", ["up", "-d"]);
			const action = await vscode.window.showInformationMessage(
				"Stack starting… containers are being launched.",
				"View Logs",
				"Stack Status",
			);
			if (action === "View Logs")
				vscode.commands.executeCommand("devkit.stackLogs");
			if (action === "Stack Status")
				vscode.commands.executeCommand("devkit.stackPs");
			setTimeout(
				() => vscode.commands.executeCommand("devkit.refreshStatus"),
				5_000,
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stackRebuild", async () => {
			runComposeTask("Project Stack Rebuild", [
				"up",
				"-d",
				"--build",
				"--force-recreate",
			]);
			const action = await vscode.window.showInformationMessage(
				"Stack rebuilding… images are being rebuilt and containers recreated.",
				"View Logs",
				"Stack Status",
			);
			if (action === "View Logs")
				vscode.commands.executeCommand("devkit.stackLogs");
			if (action === "Stack Status")
				vscode.commands.executeCommand("devkit.stackPs");
			setTimeout(
				() => vscode.commands.executeCommand("devkit.refreshStatus"),
				5_000,
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stackDown", async () => {
			const answer = await vscode.window.showWarningMessage(
				"Stop and remove all stack containers? Running services will be interrupted.",
				{ modal: true },
				"Stop Stack",
			);
			if (answer === "Stop Stack") {
				runComposeTask("Project Stack Down", ["down"]);
				setTimeout(
					() => vscode.commands.executeCommand("devkit.refreshStatus"),
					5_000,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stackRestart", async () => {
			runComposeTask("Project Stack Restart", ["restart"]);
			const action = await vscode.window.showInformationMessage(
				"Stack restarting… containers are being restarted.",
				"View Logs",
				"Stack Status",
			);
			if (action === "View Logs")
				vscode.commands.executeCommand("devkit.stackLogs");
			if (action === "Stack Status")
				vscode.commands.executeCommand("devkit.stackPs");
			setTimeout(
				() => vscode.commands.executeCommand("devkit.refreshStatus"),
				8_000,
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stackLogs", () => {
			runComposeTask(
				"Project Stack Logs",
				["logs", "--follow", "--tail=200"],
				vscode.TaskRevealKind.Always,
			);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.stackPs", async () => {
			try {
				const output = await runComposeAndReturn(["ps"]);
				const panel = vscode.window.createOutputChannel(
					"Project Stack Status",
					{ log: true },
				);
				panel.clear();
				panel.appendLine(
					`Stack status at ${new Date().toLocaleTimeString()}\n`,
				);
				panel.appendLine(output);
				panel.show(true);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				const action = await vscode.window.showErrorMessage(
					`Stack status failed: ${message}`,
					"View Compose File",
				);
				if (action === "View Compose File")
					vscode.commands.executeCommand("devkit.openCompose");
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.openCompose", async () => {
			const folders = vscode.workspace.workspaceFolders;
			if (!folders) return;
			const config = vscode.workspace.getConfiguration("devkit");
			const composeFile = config.get<string>(
				"composeFile",
				"docker-compose.yml",
			);
			const uri = vscode.Uri.file(`${folders[0].uri.fsPath}/${composeFile}`);
			await vscode.window.showTextDocument(uri);
		}),
	);
}
