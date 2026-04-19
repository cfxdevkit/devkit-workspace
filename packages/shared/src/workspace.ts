import * as fs from "node:fs";
import * as path from "node:path";

/** Resolve a path relative to the workspace root (process.cwd() at runtime). */
export function workspaceRoot(): string {
	return process.cwd();
}

export function workspacePath(...segments: string[]): string {
	return path.join(workspaceRoot(), ...segments);
}

export function fileExists(filePath: string): boolean {
	return fs.existsSync(filePath);
}

export function readJsonFile<T = unknown>(filePath: string): T {
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

/** Read the compose file path from devkit settings or fallback to docker-compose.yml */
export function getComposeFilePath(override?: string): string {
	return workspacePath(override ?? "docker-compose.yml");
}
