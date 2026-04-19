import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Log levels ─────────────────────────────────────────────────────────────

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_LABEL: Record<Level, string> = {
	debug: "DBG",
	info: "INF",
	warn: "WRN",
	error: "ERR",
};

// ── Log file ───────────────────────────────────────────────────────────────

const LOG_DIR = join(homedir(), ".devkit");
const LOG_FILE = join(LOG_DIR, "backend.log");

let logFileReady = false;

function ensureLogDir(): void {
	if (logFileReady) return;
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		logFileReady = true;
	} catch {
		// Best-effort — fall back to stderr-only logging
	}
}

function appendToFile(line: string): void {
	ensureLogDir();
	if (!logFileReady) return;
	try {
		appendFileSync(LOG_FILE, `${line}\n`);
	} catch {
		// Best-effort
	}
}

// ── Formatter ──────────────────────────────────────────────────────────────

function formatMessage(level: Level, msg: string, extra?: unknown): string {
	const ts = new Date().toISOString();
	let line = `${ts} [${LEVEL_LABEL[level]}] ${msg}`;
	if (extra !== undefined) {
		if (extra instanceof Error) {
			line += ` | ${extra.message}`;
			if (extra.stack) line += `\n${extra.stack}`;
		} else if (typeof extra === "string") {
			line += ` | ${extra}`;
		} else {
			try {
				line += ` | ${JSON.stringify(extra)}`;
			} catch {
				line += ` | [unserializable]`;
			}
		}
	}
	return line;
}

// ── Logger ─────────────────────────────────────────────────────────────────

function write(level: Level, msg: string, extra?: unknown): void {
	const line = formatMessage(level, msg, extra);
	appendToFile(line);

	// Also write to stderr for container visibility
	const stream =
		level === "error" || level === "warn" ? process.stderr : process.stdout;
	stream.write(`[devkit] ${line}\n`);
}

export const log = {
	debug(msg: string, extra?: unknown): void {
		write("debug", msg, extra);
	},
	info(msg: string, extra?: unknown): void {
		write("info", msg, extra);
	},
	warn(msg: string, extra?: unknown): void {
		write("warn", msg, extra);
	},
	error(msg: string, extra?: unknown): void {
		write("error", msg, extra);
	},
	/** Returns the path to the log file (useful for diagnostics). */
	get filePath(): string {
		return LOG_FILE;
	},
};
