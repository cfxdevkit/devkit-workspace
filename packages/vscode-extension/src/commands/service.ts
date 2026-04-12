import * as vscode from 'vscode';

/**
 * Workspace service management commands.
 * These are intentionally minimal placeholders — the real implementation
 * lives in @cfxdevkit/shared and the MCP server, keeping business logic
 * outside the VS Code extension host.
 */

export function registerServiceCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.start', async () => {
      const result = await vscode.window.showInformationMessage(
        'DevKit: Start workspace services?',
        { modal: false },
        'Start',
        'Open Compose File'
      );
      if (result === 'Start') {
        // Delegate to the stack command which runs docker compose up -d
        vscode.commands.executeCommand('devkit.stackUp');
      } else if (result === 'Open Compose File') {
        vscode.commands.executeCommand('devkit.openCompose');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.stop', async () => {
      const result = await vscode.window.showWarningMessage(
        'DevKit: Stop workspace services?',
        { modal: true },
        'Stop Services'
      );
      if (result === 'Stop Services') {
        vscode.commands.executeCommand('devkit.stackDown');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devkit.status', () => {
      // Delegate to stackPs which uses the configured compose file + workspace cwd
      vscode.commands.executeCommand('devkit.stackPs');
    })
  );
}
