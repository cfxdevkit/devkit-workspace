const vscode = require('vscode');

async function showStatus() {
  const healthUrl = 'http://127.0.0.1:7748/health';

  try {
    const response = await fetch(healthUrl);
    if (!response.ok) {
      throw new Error(`Backend request failed with status ${response.status}`);
    }
    const payload = await response.json();
    await vscode.window.showInformationMessage(`New DevKit backend: ${payload.status} (${payload.service})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showWarningMessage(`New DevKit backend unavailable: ${message}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('newDevkit.showStatus', showStatus),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
