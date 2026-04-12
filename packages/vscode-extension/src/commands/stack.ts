import * as vscode from 'vscode';
import { runComposeAndReturn, runComposeTask } from '../utils/compose';

export function registerStackCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stackUp', () => {
      runComposeTask('Project Stack Up', ['up', '-d']);
      setTimeout(() => vscode.commands.executeCommand('devkit.refreshStatus'), 5_000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stackRebuild', () => {
      runComposeTask('Project Stack Rebuild', ['up', '-d', '--build', '--force-recreate']);
      setTimeout(() => vscode.commands.executeCommand('devkit.refreshStatus'), 5_000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stackDown', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Stop and remove all stack containers?',
        { modal: true },
        'Yes'
      );
      if (answer === 'Yes') {
        runComposeTask('Project Stack Down', ['down']);
        setTimeout(() => vscode.commands.executeCommand('devkit.refreshStatus'), 5_000);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stackRestart', () => {
      runComposeTask('Project Stack Restart', ['restart']);
      setTimeout(() => vscode.commands.executeCommand('devkit.refreshStatus'), 8_000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stackLogs', () => {
      runComposeTask(
        'Project Stack Logs',
        ['logs', '--follow', '--tail=200'],
        vscode.TaskRevealKind.Always
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stackPs', async () => {
      try {
        const output = await runComposeAndReturn(['ps']);
        const panel = vscode.window.createOutputChannel('Project Stack Status');
        panel.clear();
        panel.appendLine(output);
        panel.show(true);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Stack status failed: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.openCompose', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) return;
      const config = vscode.workspace.getConfiguration('devkit');
      const composeFile = config.get<string>('composeFile', 'docker-compose.yml');
      const uri = vscode.Uri.file(`${folders[0].uri.fsPath}/${composeFile}`);
      await vscode.window.showTextDocument(uri);
    })
  );
}
