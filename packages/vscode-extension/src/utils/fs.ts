import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';

export async function readJson<T>(uri: vscode.Uri): Promise<T> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
}

export async function writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
}

export function workspaceUri(...segments: string[]): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) throw new Error('No workspace folder open');
  let uri = folders[0].uri;
  for (const segment of segments) {
    uri = vscode.Uri.file(`${uri.fsPath}/${segment}`);
  }
  return uri;
}

/**
 * Resolve the absolute path to a @cfxdevkit/mcp dist module.
 * Checks the workspace-local dev layout first (packages/mcp-server/dist/);
 * falls back to the globally installed npm package via `npm root -g`.
 */
export async function resolveMcpDist(module: string, workspaceRoot: string): Promise<string> {
  const localCandidates = [
    path.join(workspaceRoot, 'packages', 'mcp-server', 'dist', `${module}.js`),
  ];

  // DEX moved under features/dex; keep legacy fallback for published images.
  if (module === 'dex') {
    localCandidates.unshift(
      path.join(workspaceRoot, 'packages', 'mcp-server', 'dist', 'features', 'dex', 'dex.js'),
    );
  }

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('npm', ['root', '-g'], { timeout: 5_000 });

  const globalRoot = path.join(stdout.trim(), '@cfxdevkit', 'mcp', 'dist');
  const globalCandidates = [
    path.join(globalRoot, `${module}.js`),
  ];

  if (module === 'dex') {
    globalCandidates.unshift(path.join(globalRoot, 'features', 'dex', 'dex.js'));
  }

  for (const candidate of globalCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Cannot resolve @cfxdevkit/mcp dist module '${module}'. ` +
    `Tried: ${[...localCandidates, ...globalCandidates].join(', ')}`,
  );
}
