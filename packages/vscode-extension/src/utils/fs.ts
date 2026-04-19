import * as vscode from "vscode";

export async function readJson<T>(uri: vscode.Uri): Promise<T> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
}

export async function writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
	const text = JSON.stringify(data, null, 2);
	await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
}

export function workspaceUri(...segments: string[]): vscode.Uri {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders) throw new Error("No workspace folder open");
	let uri = folders[0].uri;
	for (const segment of segments) {
		uri = vscode.Uri.file(`${uri.fsPath}/${segment}`);
	}
	return uri;
}
