import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

type SignalName = "SIGTERM" | "SIGKILL";

export interface ManagedProcessRecord {
	id: string;
	label: string;
	command: string;
	cwd: string;
	pid: number | null;
	logPath: string;
	scriptPath: string;
	startedAt: string | null;
	stoppedAt: string | null;
}

export interface ManagedProcessSpec {
	id: string;
	label: string;
	command: string;
	cwd: string;
	env?: Record<string, string | undefined>;
}

let processStoreDir: string | null = null;

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function requireStoreDir(): string {
	if (!processStoreDir) {
		throw new Error("Persistent process manager has not been initialized.");
	}
	fs.mkdirSync(processStoreDir, { recursive: true });
	return processStoreDir;
}

function recordPath(id: string): string {
	return path.join(requireStoreDir(), `${id}.json`);
}

function scriptPath(id: string): string {
	return path.join(requireStoreDir(), `${id}.sh`);
}

function logPath(id: string): string {
	return path.join(requireStoreDir(), `${id}.log`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeRecord(record: ManagedProcessRecord): void {
	fs.writeFileSync(
		recordPath(record.id),
		JSON.stringify(record, null, 2),
		"utf8",
	);
}

function readRecord(id: string): ManagedProcessRecord | null {
	const file = recordPath(id);
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as ManagedProcessRecord;
	} catch {
		return null;
	}
}

function isPidAlive(pid: number | null): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function buildRunnerScript(spec: ManagedProcessSpec): string {
	const envLines = Object.entries(spec.env ?? {})
		.filter((entry): entry is [string, string] => typeof entry[1] === "string")
		.map(([key, value]) => `export ${key}=${shellQuote(value)}`);

	return [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		`cd ${shellQuote(spec.cwd)}`,
		...envLines,
		`exec /bin/bash -lc ${shellQuote(spec.command)}`,
		"",
	].join("\n");
}

function killProcessTree(pid: number, signal: SignalName): void {
	try {
		process.kill(-pid, signal);
		return;
	} catch {
		// Fall back to direct PID kill when process groups are unavailable.
	}

	try {
		process.kill(pid, signal);
	} catch {
		// Process already gone.
	}
}

export function initPersistentProcessManager(
	context: vscode.ExtensionContext,
): void {
	const storageUri = context.storageUri ?? context.globalStorageUri;
	processStoreDir = path.join(storageUri.fsPath, "managed-processes");
	fs.mkdirSync(processStoreDir, { recursive: true });
}

export function getManagedProcessRecord(
	id: string,
): ManagedProcessRecord | null {
	return readRecord(id);
}

export function isManagedProcessRunning(id: string): boolean {
	const record = readRecord(id);
	if (!record) return false;
	return isPidAlive(record.pid);
}

export async function startManagedProcess(
	spec: ManagedProcessSpec,
): Promise<ManagedProcessRecord> {
	const existing = readRecord(spec.id);
	if (existing && isPidAlive(existing.pid)) {
		return existing;
	}

	fs.mkdirSync(spec.cwd, { recursive: true });

	const runnerPath = scriptPath(spec.id);
	const outputPath = logPath(spec.id);
	fs.writeFileSync(runnerPath, buildRunnerScript(spec), { mode: 0o755 });
	fs.closeSync(fs.openSync(outputPath, "a"));

	const launchCommand = [
		"if command -v setsid >/dev/null 2>&1; then",
		`  nohup setsid ${shellQuote(runnerPath)} >> ${shellQuote(outputPath)} 2>&1 < /dev/null &`,
		"else",
		`  nohup ${shellQuote(runnerPath)} >> ${shellQuote(outputPath)} 2>&1 < /dev/null &`,
		"fi",
		"echo $!",
	].join("\n");

	const stdout = cp
		.execFileSync("/bin/bash", ["-lc", launchCommand], {
			encoding: "utf8",
			env: { ...process.env },
		})
		.trim();

	const pid = Number.parseInt(stdout, 10);
	if (!Number.isFinite(pid) || pid <= 0) {
		throw new Error(`Failed to start ${spec.label}: could not determine PID.`);
	}

	const record: ManagedProcessRecord = {
		id: spec.id,
		label: spec.label,
		command: spec.command,
		cwd: spec.cwd,
		pid,
		logPath: outputPath,
		scriptPath: runnerPath,
		startedAt: new Date().toISOString(),
		stoppedAt: null,
	};

	writeRecord(record);
	return record;
}

export async function stopManagedProcess(id: string): Promise<boolean> {
	const record = readRecord(id);
	if (!record?.pid || !isPidAlive(record.pid)) {
		if (record) {
			record.pid = null;
			record.stoppedAt = new Date().toISOString();
			writeRecord(record);
		}
		return false;
	}

	killProcessTree(record.pid, "SIGTERM");

	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if (!isPidAlive(record.pid)) {
			record.pid = null;
			record.stoppedAt = new Date().toISOString();
			writeRecord(record);
			return true;
		}
		await delay(200);
	}

	killProcessTree(record.pid, "SIGKILL");
	await delay(300);

	record.pid = null;
	record.stoppedAt = new Date().toISOString();
	writeRecord(record);
	return true;
}

export async function openManagedProcessLogs(
	id: string,
	label?: string,
): Promise<void> {
	const record = readRecord(id);
	if (!record || !fs.existsSync(record.logPath)) {
		vscode.window.showWarningMessage(`${label ?? id} has no log file yet.`);
		return;
	}

	const terminal = vscode.window.createTerminal({
		name: `${label ?? record.label} Logs`,
		shellPath: "/bin/bash",
		shellArgs: ["-lc", `tail -n 200 -f ${shellQuote(record.logPath)}`],
	});
	terminal.show(true);
}

/**
 * Tail the managed process log file into a VS Code output channel.
 * Reads new lines every second and appends them to the channel.
 * Returns a dispose function that stops the polling.
 *
 * Call this immediately after startManagedProcess to stream live output
 * into the channel — new content only (offset starts at current file end).
 */
export function tailManagedProcessLog(
	id: string,
	channel: vscode.OutputChannel,
): () => void {
	const lp = processStoreDir ? path.join(processStoreDir, `${id}.log`) : null;
	if (!lp) return () => undefined;

	// Start from the current end of the file so we don't replay old runs.
	let offset = 0;
	try {
		if (fs.existsSync(lp)) {
			offset = fs.statSync(lp).size;
		}
	} catch {
		/* ignore */
	}

	function drain(): void {
		try {
			// biome-ignore lint/style/noNonNullAssertion: lp is guaranteed non-null when drain() runs
			if (!fs.existsSync(lp!)) return;
			// biome-ignore lint/style/noNonNullAssertion: lp is guaranteed non-null when drain() runs
			const stat = fs.statSync(lp!);
			if (stat.size <= offset) return;
			const buf = Buffer.allocUnsafe(stat.size - offset);
			// biome-ignore lint/style/noNonNullAssertion: lp is guaranteed non-null when drain() runs
			const fd = fs.openSync(lp!, "r");
			fs.readSync(fd, buf, 0, buf.length, offset);
			fs.closeSync(fd);
			offset = stat.size;
			// Split on newlines and emit each non-empty line
			const text = buf.toString("utf8");
			const lines = text.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Last element may be an incomplete line that will be completed on next drain
				if (i < lines.length - 1) {
					channel.appendLine(line);
				} else if (line.length > 0) {
					channel.append(line);
				}
			}
		} catch {
			/* log file not ready yet */
		}
	}

	const timer = setInterval(drain, 1_000);
	return () => clearInterval(timer);
}
