import * as cp from 'node:child_process';
import * as vscode from 'vscode';

function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) throw new Error('No workspace folder open');
  return folders[0].uri.fsPath;
}

function buildComposeArgs(subcommand: string[]): string[] {
  const config = vscode.workspace.getConfiguration('devkit');
  const composeFile = config.get<string>('composeFile', 'docker-compose.yml');
  const projectName = config.get<string>('composeProjectName', '');

  const args = ['docker', 'compose', '-f', composeFile];
  if (projectName) args.push('-p', projectName);
  return [...args, ...subcommand];
}

export function runComposeTask(
  label: string,
  subcommand: string[],
  reveal: vscode.TaskRevealKind = vscode.TaskRevealKind.Always
): void {
  const workspaceRoot = getWorkspaceRoot();
  const args = buildComposeArgs(subcommand);
  const taskScope = vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace;

  const task = new vscode.Task(
    { type: 'shell' },
    taskScope,
    label,
    'Project',
    new vscode.ShellExecution(args.join(' '), { cwd: workspaceRoot }),
    []
  );
  task.presentationOptions = {
    reveal,
    panel: vscode.TaskPanelKind.Dedicated,
    showReuseMessage: false,
    clear: true,
  };
  vscode.tasks.executeTask(task);
}

export function runComposeAndReturn(subcommand: string[]): Promise<string> {
  const workspaceRoot = getWorkspaceRoot();
  const args = buildComposeArgs(subcommand);

  return new Promise((resolve, reject) => {
    cp.exec(args.join(' '), { cwd: workspaceRoot }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}
